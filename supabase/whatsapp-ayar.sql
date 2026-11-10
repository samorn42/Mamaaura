-- WhatsApp bağlantı ayarı. Bu metni SQL Editor'e yapıştırın, iki yeri kendi bilgilerinizle değiştirin, sonra "Run" deyin.
-- Bu dosyayı bilgilerinizi yazdıktan sonra GitHub'a YÜKLEMEYİN; erişim anahtarı gizli kalmalı.

-- 1) Meta > WhatsApp > API Setup sayfasındaki "Phone number ID" değeri:
--    api_version: aynı sayfadaki örnek komutta graph.facebook.com/ sonrasında yazan sürüm (ör. v25.0).
insert into public.wa_ayar(id, phone_number_id, api_version) values (1, 'TELEFON_NUMARASI_KIMLIGI', 'v25.0')
  on conflict (id) do update set phone_number_id = excluded.phone_number_id, api_version = excluded.api_version;

-- 2) Kalıcı erişim anahtarı (System user token). Eski anahtar varsa silinir, yenisi kaydedilir:
delete from vault.secrets where name = 'whatsapp_token';
select vault.create_secret('ERISIM_ANAHTARI', 'whatsapp_token', 'Mamaaura WhatsApp Cloud API');
