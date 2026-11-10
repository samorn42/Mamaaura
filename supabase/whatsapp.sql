-- Mamaaura otomatik WhatsApp hatırlatma.
-- Önce kurulum.sql çalışmış olmalı. Bu dosyayı SQL Editor'e yapıştırıp "Run" deyin; tekrar çalıştırmak güvenlidir.
--
-- Nasıl çalışır: Her gün 10:00–20:00 arasında saat başı, otomatik hatırlatmayı açmış salonların YARINKİ bekleyen
-- randevularına Meta'da onaylı "randevu_hatirlatma" şablonuyla mesaj gönderilir. Bir randevuya en fazla bir kez
-- gönderilir; elle "WhatsApp" ile hatırlatılmış randevular atlanır. Sonuçlar 10 dakikada bir okunur.
--
-- Bağlantı ayarı (telefon numarası kimliği ve erişim anahtarı) ayrıca, whatsapp-ayar.sql ile yapılır.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Türkiye numaralarını uluslararası biçime çevirir (0555… → 90555…). Geçersizse boş (null) döner.
create or replace function public._wa_no(t text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(t, ''), '\D', '', 'g');
begin
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if length(d) = 11 and left(d, 1) = '0' then d := '90' || substr(d, 2);
  elsif length(d) = 10 and left(d, 1) = '5' then d := '90' || d; end if;
  return case when length(d) between 11 and 15 then d end;
end $$;

-- 11 Kasım Çarşamba
create or replace function public._tr_tarih(d date) returns text language sql immutable as $$
  select extract(day from d)::int || ' ' ||
    (array['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'])[extract(month from d)::int] || ' ' ||
    (array['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'])[extract(isodow from d)::int]
$$;

create or replace function public._json(t text) returns jsonb language plpgsql immutable as $$
begin return t::jsonb; exception when others then return null; end $$;

-- Şablon mesajı için Meta'ya istek kuyruğa koyar; istek numarasını döner. Sonuç net._http_response tablosuna düşer.
-- Şablon gövdesindeki sıra: {{1}} ad, {{2}} tarih, {{3}} saat, {{4}} salon, {{5}} hizmet, {{6}} salon telefonu
create or replace function public._wa_istek(p_to text, p_params text[]) returns bigint language plpgsql security definer set search_path = public as $$
declare a wa_ayar; tok text;
begin
  select * into a from wa_ayar where id = 1;
  if not found or a.phone_number_id = '' then raise exception 'WhatsApp bağlantısı henüz kurulmadı.'; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'whatsapp_token' order by created_at desc limit 1;
  if coalesce(tok, '') = '' then raise exception 'WhatsApp erişim anahtarı kaydedilmemiş.'; end if;
  return net.http_post(
    url := format('https://graph.facebook.com/%s/%s/messages', a.api_version, a.phone_number_id),
    body := jsonb_build_object('messaging_product', 'whatsapp', 'to', p_to, 'type', 'template',
      'template', jsonb_build_object('name', a.template, 'language', jsonb_build_object('code', a.language),
        'components', jsonb_build_array(jsonb_build_object('type', 'body', 'parameters',
          (select jsonb_agg(jsonb_build_object('type', 'text', 'text', x) order by i) from unnest(p_params) with ordinality t(x, i)))))),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || tok),
    timeout_milliseconds := 10000);
end $$;

create or replace function public.wa_hatirlatmalari_gonder() returns int language plpgsql security definer set search_path = public as $$
declare yarin date := (now() at time zone 'Europe/Istanbul')::date + 1; r record; no text; istek bigint; n int := 0;
begin
  if not exists(select 1 from wa_ayar where phone_number_id <> '')
     or not exists(select 1 from vault.decrypted_secrets where name = 'whatsapp_token') then return 0; end if;
  for r in
    select a.id, a.date, a.start, c.name as musteri, c.phone, sv.name as hizmet, sl.name as salon, sl.phone as salon_tel
    from appointments a join customers c on c.id = a.customer_id join services sv on sv.id = a.service_id join salons sl on sl.id = a.salon_id
    where a.date = yarin and a.status = 'bekliyor' and not a.reminded and a.wa_istek is null and sl.wa_otomatik and sl.phone <> ''
    order by a.start limit 300
  loop
    no := _wa_no(r.phone);
    continue when no is null; -- telefonu olmayan müşteri atlanır; numara eklenirse sonraki saatte gönderilir
    begin
      istek := _wa_istek(no, array[split_part(r.musteri, ' ', 1), _tr_tarih(r.date), _saat(r.start), r.salon, r.hizmet, r.salon_tel]);
      update appointments set wa_istek = istek, wa_durum = 'gonderiliyor', wa_hata = '', reminded = true where id = r.id;
      n := n + 1;
    exception when others then
      update appointments set wa_istek = 0, wa_durum = 'hata', wa_hata = left(sqlerrm, 300) where id = r.id;
    end;
  end loop;
  return n;
end $$;

-- Meta'nın yanıtlarını randevulara işler. 2xx: WhatsApp mesajı kabul etti. Diğerleri: hata mesajı saklanır.
create or replace function public.wa_sonuclari_isle() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update appointments a set
    wa_durum = case when r.status_code between 200 and 299 then 'gonderildi' else 'hata' end,
    wa_hata = case when r.status_code between 200 and 299 then '' else left(coalesce(nullif(r.error_msg, ''),
      _json(r.content) -> 'error' ->> 'message', 'HTTP ' || r.status_code, 'Yanıt alınamadı'), 300) end
  from net._http_response r
  where r.id = a.wa_istek and a.wa_durum = 'gonderiliyor';
  get diagnostics n = row_count;
  return n;
end $$;

-- Salon sahibi Ayarlar'dan deneme mesajı gönderir.
create or replace function public.wa_test(p_tel text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); no text := _wa_no(p_tel); sl salons;
begin
  if no is null then raise exception 'Telefon numarası geçersiz. 05xx xxx xx xx biçiminde yazın.'; end if;
  select * into sl from salons where id = s;
  return jsonb_build_object('istek', _wa_istek(no, array['Deneme', _tr_tarih((now() at time zone 'Europe/Istanbul')::date + 1), '10:00',
    sl.name, 'Saç kesimi', coalesce(nullif(sl.phone, ''), '0555 000 00 00')]));
end $$;

create or replace function public.wa_test_sonuc(p_istek bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); r record;
begin
  select status_code, error_msg, content into r from net._http_response where id = p_istek;
  if not found then return jsonb_build_object('bitti', false); end if;
  return jsonb_build_object('bitti', true, 'ok', coalesce(r.status_code between 200 and 299, false),
    'hata', coalesce(nullif(r.error_msg, ''), _json(r.content) -> 'error' ->> 'message', 'HTTP ' || r.status_code, 'Yanıt alınamadı'));
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_wa_no', '_tr_tarih', '_json', '_wa_istek', 'wa_hatirlatmalari_gonder', 'wa_sonuclari_isle') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('wa_test', 'wa_test_sonuc') loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Zamanlama (saatler UTC): 07–17 UTC = Türkiye saatiyle 10:00–20:00.
select cron.schedule('mamaaura-wa-gonder', '0 7-17 * * *', 'select public.wa_hatirlatmalari_gonder()');
select cron.schedule('mamaaura-wa-sonuc', '*/10 * * * *', 'select public.wa_sonuclari_isle()');

notify pgrst, 'reload schema';
