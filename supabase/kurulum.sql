-- Mamaaura veritabanı kurulumu.
-- Supabase panelinde SQL Editor'e yapıştırıp "Run" deyin. Tekrar çalıştırmak güvenlidir; mevcut veriyi silmez.
--
-- Güvenlik modeli: tablolara doğrudan erişim kapalıdır (RLS açık, izin kuralı yok).
-- Uygulama yalnızca aşağıdaki işlevleri çağırır; her işlev giriş yapan kullanıcının salonunu
-- kendisi bulur ve yalnızca o salonun kayıtlarına dokunur.

create table if not exists public.salons(
  id bigint generated always as identity primary key, name text not null,
  open_min int not null default 540, close_min int not null default 1200, created_at timestamptz not null default now());
create table if not exists public.members(
  user_id uuid primary key references auth.users(id) on delete cascade,
  salon_id bigint not null references public.salons(id), name text not null);
create table if not exists public.staff(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  name text not null, commission int not null default 0, color int not null default 1, active boolean not null default true);
create table if not exists public.services(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  name text not null, minutes int not null, price int not null, active boolean not null default true);
create table if not exists public.products(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  name text not null, stock int not null default 0, price int not null, active boolean not null default true);
create table if not exists public.customers(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  name text not null, phone text not null default '', note text not null default '', points int not null default 0,
  pkg_service_id bigint references public.services(id), pkg_total int not null default 0, pkg_remaining int not null default 0);
create table if not exists public.appointments(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  date date not null, start int not null, minutes int not null, price int not null,
  service_id bigint not null references public.services(id), staff_id bigint not null references public.staff(id),
  customer_id bigint not null references public.customers(id), status text not null default 'bekliyor');
create table if not exists public.payments(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  date date not null, appointment_id bigint references public.appointments(id), customer_id bigint references public.customers(id),
  label text not null default '', method text not null, amount int not null);
create table if not exists public.expenses(
  id bigint generated always as identity primary key, salon_id bigint not null references public.salons(id),
  date date not null, name text not null, amount int not null);

-- Sürüm 2: personel hesapları, davet kodları, hatırlatma metni ve işareti.
alter table public.salons add column if not exists reminder_text text not null default '';
alter table public.members add column if not exists role text not null default 'sahip';
alter table public.members add column if not exists staff_id bigint references public.staff(id);
alter table public.appointments add column if not exists reminded boolean not null default false;
create table if not exists public.invites(
  code text primary key, salon_id bigint not null references public.salons(id), staff_id bigint not null references public.staff(id),
  expires_at timestamptz not null default now() + interval '7 days', used_by uuid);

-- Sürüm 1'den gelen salon sahiplerini, kayıtta oluşturulan personel kaydına bağla.
update public.members m set staff_id = (select min(id) from public.staff s where s.salon_id = m.salon_id)
  where m.role = 'sahip' and m.staff_id is null;

create index if not exists ix_appt on public.appointments(salon_id, date);
create index if not exists ix_pay on public.payments(salon_id, date);
create index if not exists ix_cust on public.customers(salon_id);
create index if not exists ix_exp on public.expenses(salon_id, date);

alter table public.salons enable row level security;
alter table public.members enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.invites enable row level security;
revoke all on table public.salons, public.members, public.staff, public.services, public.products,
  public.customers, public.appointments, public.payments, public.expenses, public.invites from anon, authenticated;

-- Yardımcılar ---------------------------------------------------------------

create or replace function public._salon() returns bigint language plpgsql stable security definer set search_path = public as $$
declare s bigint;
begin
  select salon_id into s from members where user_id = auth.uid();
  if s is null then raise exception 'SALON_YOK'; end if;
  return s;
end $$;

-- Yalnızca salon sahibinin yapabileceği işlemler için.
create or replace function public._sahip() returns bigint language plpgsql stable security definer set search_path = public as $$
declare s bigint; r text;
begin
  select salon_id, role into s, r from members where user_id = auth.uid();
  if s is null then raise exception 'SALON_YOK'; end if;
  if r <> 'sahip' then raise exception 'Bu işlem için salon sahibi yetkisi gerekiyor.'; end if;
  return s;
end $$;

create or replace function public._metin(v text, ad text, mx int, zorunlu boolean default true) returns text language plpgsql immutable as $$
begin
  v := btrim(coalesce(v, ''));
  if v = '' and zorunlu then raise exception '% boş bırakılamaz.', ad; end if;
  if char_length(v) > mx then raise exception '% en fazla % karakter olabilir.', ad, mx; end if;
  return v;
end $$;

create or replace function public._sayi(v int, ad text, mn int, mx int) returns int language plpgsql immutable as $$
begin
  if v is null or v < mn or v > mx then raise exception '% % ile % arasında bir tam sayı olmalı.', ad, mn, mx; end if;
  return v;
end $$;

create or replace function public._yontem(v text) returns text language plpgsql immutable as $$
begin
  if v is null or v not in ('nakit', 'kart') then raise exception 'Ödeme yöntemi nakit ya da kart olmalı.'; end if;
  return v;
end $$;

create or replace function public._saat(m int) returns text language sql immutable as $$
  select to_char(m / 60, 'FM00') || ':' || to_char(m % 60, 'FM00')
$$;

-- Salon ve genel durum ------------------------------------------------------

create or replace function public.salon_olustur(p_salon text, p_ad text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint; ad text; st bigint;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı. Tekrar giriş yapın.'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then return jsonb_build_object('ok', true); end if;
  ad := _metin(p_ad, 'Adınız', 60);
  insert into salons(name) values (_metin(p_salon, 'Salon adı', 80)) returning id into s;
  insert into staff(salon_id, name, color) values (s, split_part(ad, ' ', 1), 1) returning id into st;
  insert into members(user_id, salon_id, name, role, staff_id) values (auth.uid(), s, ad, 'sahip', st);
  insert into services(salon_id, name, minutes, price) values
    (s, 'Saç kesimi', 60, 600), (s, 'Saç boyama', 120, 2500), (s, 'Fön', 30, 350), (s, 'Manikür', 60, 500),
    (s, 'Cilt bakımı', 60, 1200), (s, 'Lazer epilasyon', 30, 900), (s, 'Kaş alımı', 30, 200);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.durum(p_from date, p_today date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s bigint := _salon(); f2 date; t2 date; me members; sahip boolean;
begin
  if p_from is null or p_today is null then raise exception 'Tarih geçersiz.'; end if;
  f2 := p_from + 6; t2 := p_today + 6;
  select * into me from members where user_id = auth.uid();
  sahip := me.role = 'sahip';
  -- Personel kasa, gider, ürün ve hesap bilgilerini görmez; bu alanlar boş döner.
  return jsonb_build_object(
    'salon', (select jsonb_build_object('name', name, 'open_min', open_min, 'close_min', close_min, 'reminder_text', reminder_text) from salons where id = s),
    'user', jsonb_build_object('name', me.name, 'email', coalesce(auth.jwt() ->> 'email', ''), 'role', me.role, 'staff_id', me.staff_id),
    'staff', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id, name, commission, color, active from staff where salon_id = s) x), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id, name, minutes, price, active from services where salon_id = s) x), '[]'::jsonb),
    'products', case when sahip then coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (select id, name, stock, price, active from products where salon_id = s) x), '[]'::jsonb) else '[]'::jsonb end,
    'members', case when sahip then coalesce((select jsonb_agg(to_jsonb(x) order by x.role desc, x.name) from (
        select mb.user_id, mb.name, mb.role, mb.staff_id, coalesce(u.email, '') as email from members mb left join auth.users u on u.id = mb.user_id
        where mb.salon_id = s) x), '[]'::jsonb) else '[]'::jsonb end,
    'invites', case when sahip then coalesce((select jsonb_agg(to_jsonb(x) order by x.expires_at) from (
        select code, staff_id, expires_at from invites where salon_id = s and used_by is null and expires_at > now()) x), '[]'::jsonb) else '[]'::jsonb end,
    'customers', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name), x.id) from (
        select cu.id, cu.name, cu.phone, cu.note, cu.points, cu.pkg_service_id, cu.pkg_total, cu.pkg_remaining,
          coalesce((select sum(py.amount) from payments py join appointments ap on ap.id = py.appointment_id
                    where py.method = 'veresiye' and ap.customer_id = cu.id), 0)::int as debt,
          (select jsonb_build_object('date', ap.date, 'start', ap.start, 'service_id', ap.service_id) from appointments ap
            where ap.customer_id = cu.id and ap.status = 'bekliyor' and ap.date >= p_today order by ap.date, ap.start limit 1) as next
        from customers cu where cu.salon_id = s) x), '[]'::jsonb),
    'appointments', coalesce((select jsonb_agg(to_jsonb(x) order by x.date, x.start, x.id) from (
        select id, date, start, minutes, price, service_id, staff_id, customer_id, status, reminded from appointments
        where salon_id = s and (date between p_from and f2 or date between p_today and t2)) x), '[]'::jsonb),
    'payments', case when not sahip then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select py.id, py.date, py.appointment_id, py.label, py.method, py.amount, ap.staff_id,
          cu.name as customer_name, sv.name as service_name, stf.name as staff_name
        from payments py left join appointments ap on ap.id = py.appointment_id
          left join customers cu on cu.id = coalesce(ap.customer_id, py.customer_id)
          left join services sv on sv.id = ap.service_id left join staff stf on stf.id = ap.staff_id
        where py.salon_id = s and (py.method = 'veresiye' or py.date between p_from and f2 or py.date between p_today and t2)) x), '[]'::jsonb) end,
    'expenses', case when not sahip then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id, date, name, amount from expenses
        where salon_id = s and (date between p_from and f2 or date between p_today and t2)) x), '[]'::jsonb) end);
end $$;

drop function if exists public.salon_guncelle(text, int, int);
create or replace function public.salon_guncelle(p_name text, p_open_min int, p_close_min int, p_reminder_text text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  update salons set reminder_text = _metin(p_reminder_text, 'Hatırlatma metni', 500, false) where id = s;
  perform _sayi(p_open_min, 'Açılış saati', 0, 1380); perform _sayi(p_close_min, 'Kapanış saati', 60, 1440);
  if p_open_min % 30 <> 0 or p_close_min % 30 <> 0 then raise exception 'Açılış ve kapanış saatleri yarım saatlik dilimlerde olmalı.'; end if;
  if p_close_min - p_open_min < 60 then raise exception 'Kapanış saati açılıştan en az 1 saat sonra olmalı.'; end if;
  update salons set name = _metin(p_name, 'Salon adı', 80), open_min = p_open_min, close_min = p_close_min where id = s;
  return jsonb_build_object('ok', true);
end $$;

-- Personel, hizmet, ürün ----------------------------------------------------

create or replace function public.katalog_kaydet(p_tur text, p_id bigint, p_veri jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); ad text; n1 int; n2 int; yeni bigint;
begin
  if p_tur = 'staff' then
    ad := _metin(p_veri ->> 'name', 'Personel adı', 60);
    n1 := _sayi((p_veri ->> 'commission')::int, 'Prim oranı', 0, 100);
    if p_id is null then
      insert into staff(salon_id, name, commission, color)
        values (s, ad, n1, (select count(*) from staff where salon_id = s)::int % 6 + 1) returning id into yeni;
    else
      update staff set name = ad, commission = n1 where id = p_id and salon_id = s;
      if not found then raise exception 'Kayıt bulunamadı.'; end if;
    end if;
  elsif p_tur = 'services' then
    ad := _metin(p_veri ->> 'name', 'Hizmet adı', 60);
    n1 := _sayi((p_veri ->> 'minutes')::int, 'Süre', 15, 480);
    n2 := _sayi((p_veri ->> 'price')::int, 'Fiyat', 0, 1000000);
    if p_id is null then
      insert into services(salon_id, name, minutes, price) values (s, ad, n1, n2) returning id into yeni;
    else
      update services set name = ad, minutes = n1, price = n2 where id = p_id and salon_id = s;
      if not found then raise exception 'Kayıt bulunamadı.'; end if;
    end if;
  elsif p_tur = 'products' then
    ad := _metin(p_veri ->> 'name', 'Ürün adı', 60);
    n1 := _sayi((p_veri ->> 'stock')::int, 'Stok', 0, 100000);
    n2 := _sayi((p_veri ->> 'price')::int, 'Fiyat', 0, 1000000);
    if p_id is null then
      insert into products(salon_id, name, stock, price) values (s, ad, n1, n2) returning id into yeni;
    else
      update products set name = ad, stock = n1, price = n2 where id = p_id and salon_id = s;
      if not found then raise exception 'Kayıt bulunamadı.'; end if;
    end if;
  else
    raise exception 'Tür geçersiz.';
  end if;
  return jsonb_build_object('id', coalesce(yeni, p_id));
end $$;

create or replace function public.katalog_aktif(p_tur text, p_id bigint, p_aktif boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  if p_tur not in ('staff', 'services', 'products') then raise exception 'Tür geçersiz.'; end if;
  execute format('update public.%I set active = $1 where id = $2 and salon_id = $3', p_tur) using coalesce(p_aktif, false), p_id, s;
  if not found then raise exception 'Kayıt bulunamadı.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Randevular ----------------------------------------------------------------

create or replace function public.randevu_ekle(p_service_id bigint, p_staff_id bigint, p_date date, p_start int,
  p_customer_id bigint default null, p_customer_name text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _salon(); sv services; pr staff; sl salons; dolu record; cid bigint; ad text; yeni bigint;
begin
  if p_date is null then raise exception 'Tarih geçersiz.'; end if;
  select * into sv from services where id = p_service_id and salon_id = s;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  select * into pr from staff where id = p_staff_id and salon_id = s;
  if not found then raise exception 'Personel bulunamadı.'; end if;
  if not sv.active or not pr.active then raise exception 'Seçilen hizmet ya da personel artık kullanılmıyor.'; end if;
  select * into sl from salons where id = s;
  perform _sayi(p_start, 'Saat', sl.open_min, sl.close_min - 15);
  if p_start + sv.minutes > sl.close_min then
    raise exception '% % dakika sürüyor ve kapanış saatini (%) aşıyor. Daha erken bir saat seçin.', sv.name, sv.minutes, _saat(sl.close_min);
  end if;
  perform pg_advisory_xact_lock(s); -- aynı salonda eşzamanlı iki kayıt aynı saate düşmesin
  select ap.start, ap.minutes, cu.name into dolu from appointments ap join customers cu on cu.id = ap.customer_id
    where ap.salon_id = s and ap.date = p_date and ap.staff_id = pr.id and ap.status <> 'gelmedi'
      and ap.start < p_start + sv.minutes and ap.start + ap.minutes > p_start limit 1;
  if found then
    raise exception '% %–% arasında dolu (%). Başka saat ya da personel seçin.', pr.name, _saat(dolu.start), _saat(dolu.start + dolu.minutes), dolu.name;
  end if;
  if p_customer_id is not null then
    select id into cid from customers where id = p_customer_id and salon_id = s;
    if not found then raise exception 'Müşteri bulunamadı.'; end if;
  else
    ad := _metin(p_customer_name, 'Müşteri adı', 80);
    select id into cid from customers where salon_id = s and name = ad limit 1;
    if not found then
      insert into customers(salon_id, name, phone) values (s, ad, _metin(p_phone, 'Telefon', 30, false)) returning id into cid;
    end if;
  end if;
  insert into appointments(salon_id, date, start, minutes, price, service_id, staff_id, customer_id)
    values (s, p_date, p_start, sv.minutes, sv.price, sv.id, pr.id, cid) returning id into yeni;
  return jsonb_build_object('id', yeni);
end $$;

create or replace function public.randevu_durum(p_id bigint, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _salon(); eski text;
begin
  if p_status is null or p_status not in ('bekliyor', 'geldi', 'gelmedi') then raise exception 'Durum geçersiz.'; end if;
  select status into eski from appointments where id = p_id and salon_id = s for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if eski in ('odendi', 'veresiye') then raise exception 'Ödemesi işlenmiş randevunun durumu değiştirilemez.'; end if;
  update appointments set status = p_status where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.randevu_sil(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _salon(); eski text;
begin
  select status into eski from appointments where id = p_id and salon_id = s for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if eski in ('odendi', 'veresiye') then raise exception 'Ödemesi işlenmiş randevu silinemez.'; end if;
  delete from appointments where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.randevu_ode(p_id bigint, p_method text, p_today date) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _salon(); r appointments; m customers; tutar int;
begin
  if p_today is null then raise exception 'Tarih geçersiz.'; end if;
  if p_method is null or p_method not in ('nakit', 'kart', 'veresiye', 'paket') then raise exception 'Ödeme yöntemi geçersiz.'; end if;
  select * into r from appointments where id = p_id and salon_id = s for update;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  if r.status in ('odendi', 'veresiye') then raise exception 'Bu randevunun ödemesi zaten işlenmiş.'; end if;
  if p_method = 'paket' then
    select * into m from customers where id = r.customer_id for update;
    if m.pkg_service_id is distinct from r.service_id or m.pkg_remaining < 1 then
      raise exception 'Müşterinin bu hizmet için kullanılabilir paket seansı yok.';
    end if;
    update customers set pkg_remaining = pkg_remaining - 1 where id = m.id;
  end if;
  tutar := case when p_method = 'paket' then 0 else r.price end;
  insert into payments(salon_id, date, appointment_id, method, amount) values (s, p_today, r.id, p_method, tutar);
  update appointments set status = case when p_method = 'veresiye' then 'veresiye' else 'odendi' end where id = r.id;
  if p_method in ('nakit', 'kart') then update customers set points = points + tutar / 100 where id = r.customer_id; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Kasa: borç, ürün, gider ---------------------------------------------------

create or replace function public.borc_tahsil(p_id bigint, p_method text, p_today date) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); o payments; mid bigint;
begin
  if p_today is null then raise exception 'Tarih geçersiz.'; end if;
  perform _yontem(p_method);
  select * into o from payments where id = p_id and salon_id = s for update;
  if not found then raise exception 'Borç kaydı bulunamadı.'; end if;
  if o.method <> 'veresiye' then raise exception 'Bu kayıt zaten tahsil edilmiş.'; end if;
  update payments set method = p_method, date = p_today where id = o.id;
  update appointments set status = 'odendi' where id = o.appointment_id returning customer_id into mid;
  update customers set points = points + o.amount / 100 where id = mid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.urun_sat(p_id bigint, p_method text, p_today date) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); u products;
begin
  if p_today is null then raise exception 'Tarih geçersiz.'; end if;
  perform _yontem(p_method);
  select * into u from products where id = p_id and salon_id = s for update;
  if not found then raise exception 'Ürün bulunamadı.'; end if;
  if u.stock < 1 then raise exception '% stokta kalmadı.', u.name; end if;
  update products set stock = stock - 1 where id = u.id;
  insert into payments(salon_id, date, label, method, amount) values (s, p_today, u.name, p_method, u.price);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gider_ekle(p_date date, p_name text, p_amount int) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  if p_date is null then raise exception 'Tarih geçersiz.'; end if;
  insert into expenses(salon_id, date, name, amount) values (s, p_date, _metin(p_name, 'Gider adı', 80), _sayi(p_amount, 'Tutar', 1, 10000000));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gider_sil(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  delete from expenses where id = p_id and salon_id = s;
  if not found then raise exception 'Gider bulunamadı.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Müşteriler ----------------------------------------------------------------

create or replace function public.musteri_guncelle(p_id bigint, p_name text, p_phone text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _salon();
begin
  update customers set name = _metin(p_name, 'Müşteri adı', 80), phone = _metin(p_phone, 'Telefon', 30, false), note = _metin(p_note, 'Not', 500, false)
    where id = p_id and salon_id = s;
  if not found then raise exception 'Müşteri bulunamadı.'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.paket_sat(p_id bigint, p_service_id bigint, p_total int, p_price int, p_method text, p_today date) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); m customers; sv services;
begin
  if p_today is null then raise exception 'Tarih geçersiz.'; end if;
  perform _yontem(p_method); perform _sayi(p_total, 'Seans sayısı', 1, 100); perform _sayi(p_price, 'Paket fiyatı', 0, 10000000);
  select * into m from customers where id = p_id and salon_id = s for update;
  if not found then raise exception 'Müşteri bulunamadı.'; end if;
  select * into sv from services where id = p_service_id and salon_id = s;
  if not found then raise exception 'Hizmet bulunamadı.'; end if;
  -- Aynı hizmetin paketi sürüyorsa seanslar üstüne eklenir; farklı hizmetse yeni paket eskisinin yerini alır.
  if m.pkg_service_id = sv.id and m.pkg_remaining > 0 then
    update customers set pkg_total = pkg_total + p_total, pkg_remaining = pkg_remaining + p_total where id = m.id;
  else
    update customers set pkg_service_id = sv.id, pkg_total = p_total, pkg_remaining = p_total where id = m.id;
  end if;
  insert into payments(salon_id, date, customer_id, label, method, amount)
    values (s, p_today, m.id, sv.name || ' paketi (' || p_total || ' seans)', p_method, p_price);
  update customers set points = points + p_price / 100 where id = m.id;
  return jsonb_build_object('ok', true);
end $$;

-- Hatırlatma ----------------------------------------------------------------

create or replace function public.randevu_hatirlatildi(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _salon();
begin
  update appointments set reminded = true where id = p_id and salon_id = s;
  if not found then raise exception 'Randevu bulunamadı.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Personel hesapları ve davet kodları ----------------------------------------

create or replace function public.davet_olustur(p_staff_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip(); st staff; kod text;
begin
  select * into st from staff where id = p_staff_id and salon_id = s;
  if not found then raise exception 'Personel bulunamadı.'; end if;
  if not st.active then raise exception 'Kaldırılmış personele davet gönderilemez.'; end if;
  if exists(select 1 from members where staff_id = st.id) then raise exception '% için zaten bir hesap var.', st.name; end if;
  delete from invites where staff_id = st.id and used_by is null;
  kod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into invites(code, salon_id, staff_id) values (kod, s, st.id);
  return jsonb_build_object('code', kod);
end $$;

create or replace function public.davet_iptal(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  delete from invites where code = upper(btrim(coalesce(p_code, ''))) and salon_id = s and used_by is null;
  return jsonb_build_object('ok', true);
end $$;

-- Kayıt sayfası, hesap açmadan önce kodun geçerli olduğunu buradan doğrular.
create or replace function public.davet_kontrol(p_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select sl.name as salon, st.name as staff into r from invites i join salons sl on sl.id = i.salon_id join staff st on st.id = i.staff_id
    where i.code = upper(btrim(coalesce(p_code, ''))) and i.used_by is null and i.expires_at > now();
  if not found then raise exception 'Davet kodu geçersiz, kullanılmış ya da süresi dolmuş. Salon sahibinden yeni kod isteyin.'; end if;
  return jsonb_build_object('salon', r.salon, 'staff', r.staff);
end $$;

create or replace function public.davete_katil(p_code text, p_ad text) returns jsonb language plpgsql security definer set search_path = public as $$
declare i invites;
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı. Tekrar giriş yapın.'; end if;
  if exists(select 1 from members where user_id = auth.uid()) then raise exception 'Bu hesap zaten bir salona bağlı.'; end if;
  select * into i from invites where code = upper(btrim(coalesce(p_code, ''))) and used_by is null and expires_at > now() for update;
  if not found then raise exception 'Davet kodu geçersiz, kullanılmış ya da süresi dolmuş. Salon sahibinden yeni kod isteyin.'; end if;
  if exists(select 1 from members where staff_id = i.staff_id) then raise exception 'Bu personel için zaten bir hesap var.'; end if;
  insert into members(user_id, salon_id, name, role, staff_id) values (auth.uid(), i.salon_id, _metin(p_ad, 'Adınız', 60), 'personel', i.staff_id);
  update invites set used_by = auth.uid() where code = i.code;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.uye_kaldir(p_user_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  if p_user_id = auth.uid() then raise exception 'Kendi erişiminizi kaldıramazsınız.'; end if;
  delete from members where user_id = p_user_id and salon_id = s and role <> 'sahip';
  if not found then raise exception 'Hesap bulunamadı.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Raporlar ------------------------------------------------------------------
-- Ciro ödeme tarihine göre; hizmet ve personel tabloları randevu tarihine göre hesaplanır.

create or replace function public.rapor(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s bigint := _sahip();
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Tarih aralığı geçersiz.'; end if;
  if p_to - p_from > 400 then raise exception 'Rapor en fazla 400 günlük olabilir.'; end if;
  return jsonb_build_object(
    'ozet', (select jsonb_build_object(
        'ciro', coalesce(sum(amount) filter (where method in ('nakit', 'kart')), 0),
        'nakit', coalesce(sum(amount) filter (where method = 'nakit'), 0),
        'kart', coalesce(sum(amount) filter (where method = 'kart'), 0),
        'hizmet', coalesce(sum(amount) filter (where method in ('nakit', 'kart') and appointment_id is not null), 0),
        'paket', coalesce(sum(amount) filter (where method in ('nakit', 'kart') and appointment_id is null and customer_id is not null), 0),
        'urun', coalesce(sum(amount) filter (where method in ('nakit', 'kart') and appointment_id is null and customer_id is null), 0))
      from payments where salon_id = s and date between p_from and p_to),
    'randevu', (select jsonb_build_object('toplam', count(*), 'tamam', count(*) filter (where status in ('odendi', 'veresiye')),
        'gelmedi', count(*) filter (where status = 'gelmedi'), 'bekleyen', count(*) filter (where status in ('bekliyor', 'geldi')))
      from appointments where salon_id = s and date between p_from and p_to),
    'gider', (select coalesce(sum(amount), 0) from expenses where salon_id = s and date between p_from and p_to),
    'acik_borc', (select coalesce(sum(amount), 0) from payments where salon_id = s and method = 'veresiye'),
    'gunluk', (select jsonb_agg(jsonb_build_object('date', g.d, 'ciro', coalesce(t.ciro, 0)) order by g.d)
      from (select generate_series(p_from, p_to, interval '1 day')::date as d) g
      left join (select date, sum(amount) as ciro from payments where salon_id = s and date between p_from and p_to and method in ('nakit', 'kart') group by date) t on t.date = g.d),
    'hizmetler', coalesce((select jsonb_agg(to_jsonb(x) order by x.ciro desc, x.adet desc) from (
        select sv.name, count(a.id) as adet, coalesce(sum(py.amount), 0)::int as ciro
        from appointments a join services sv on sv.id = a.service_id
          left join payments py on py.appointment_id = a.id and py.method in ('nakit', 'kart')
        where a.salon_id = s and a.date between p_from and p_to and a.status in ('odendi', 'veresiye') group by sv.id) x), '[]'::jsonb),
    'personel', coalesce((select jsonb_agg(to_jsonb(x) order by x.ciro desc, x.name) from (
        select st.name, st.color, st.commission, count(a.id) as adet, coalesce(sum(py.amount), 0)::int as ciro,
          (coalesce(sum(py.amount), 0) * st.commission / 100)::int as prim
        from staff st left join appointments a on a.staff_id = st.id and a.date between p_from and p_to and a.status in ('odendi', 'veresiye')
          left join payments py on py.appointment_id = a.id and py.method in ('nakit', 'kart')
        where st.salon_id = s group by st.id having st.active or count(a.id) > 0) x), '[]'::jsonb),
    'musteriler', coalesce((select jsonb_agg(to_jsonb(x) order by x.harcama desc) from (
        select cu.name, t.harcama, (select count(*) from appointments ap where ap.customer_id = cu.id and ap.date between p_from and p_to
          and ap.status in ('odendi', 'veresiye')) as ziyaret
        from (select coalesce(a.customer_id, py.customer_id) as cid, sum(py.amount)::int as harcama
              from payments py left join appointments a on a.id = py.appointment_id
              where py.salon_id = s and py.date between p_from and p_to and py.method in ('nakit', 'kart')
                and coalesce(a.customer_id, py.customer_id) is not null
              group by 1 order by 2 desc limit 5) t join customers cu on cu.id = t.cid) x), '[]'::jsonb),
    'urunler', coalesce((select jsonb_agg(to_jsonb(x) order by x.ciro desc) from (
        select label as name, count(*) as adet, sum(amount)::int as ciro from payments
        where salon_id = s and date between p_from and p_to and method in ('nakit', 'kart') and appointment_id is null and customer_id is null
        group by label) x), '[]'::jsonb));
end $$;

-- İzinler: yardımcılar dışarıdan çağrılamaz; diğer işlevleri yalnızca giriş yapmış kullanıcı çağırabilir.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_salon', '_sahip', '_metin', '_sayi', '_yontem', '_saat') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('salon_olustur', 'durum', 'salon_guncelle', 'katalog_kaydet', 'katalog_aktif',
             'randevu_ekle', 'randevu_durum', 'randevu_sil', 'randevu_ode', 'borc_tahsil', 'urun_sat', 'gider_ekle', 'gider_sil',
             'musteri_guncelle', 'paket_sat', 'randevu_hatirlatildi', 'davet_olustur', 'davet_iptal', 'davete_katil', 'uye_kaldir', 'rapor') loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Davet kodu kontrolü, hesap açılmadan önce (giriş yapmadan) çağrılır.
revoke all on function public.davet_kontrol(text) from public;
grant execute on function public.davet_kontrol(text) to anon, authenticated;

-- Supabase'in API katmanına işlev listesini yeniden okumasını söyler.
notify pgrst, 'reload schema';
