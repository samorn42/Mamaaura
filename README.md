# Mamaaura

Güzellik salonları için randevu, müşteri ve kasa yönetimi. Her salon kendi hesabıyla giriş yapar ve yalnızca kendi verisini görür.

Sunucu yoktur: arayüz GitHub Pages'te yayınlanır, üyelik ve veriler Supabase'de durur.

## Neler var

- Salon kaydı ve giriş (e-posta + şifre)
- Randevu takvimi: personel sütunları, çakışma kontrolü, hafta gezinme
- Randevu akışı: geldi / gelmedi, nakit, kart, veresiye ya da paketten ödeme
- Müşteri kartı: telefon, not, sadakat puanı, borç, paket seansları
- Paket satışı ve seans takibi
- Kasa: günlük ciro, nakit/kart ayrımı, gider, gün sonu neti, personel primi
- Ürün satışı ve stok, veresiye tahsilatı, gider kaydı
- Ayarlar: personel, hizmet, ürün, çalışma saatleri
- Telefonda ana ekrana uygulama olarak eklenebilir

## Kurulum

1. **Supabase projesi:** supabase.com'da bir proje açın.
2. **Veritabanı:** Supabase panelinde SQL Editor'ü açın, `supabase/kurulum.sql` dosyasının tamamını yapıştırıp "Run" deyin. Tekrar çalıştırmak güvenlidir.
3. **E-posta doğrulaması:** Deneme aşamasında Authentication > Sign In / Providers > Email altındaki "Confirm email" seçeneğini kapatın. Açık kalacaksa Authentication > URL Configuration altındaki "Site URL" alanına uygulamanın adresini yazın.
4. **Bağlantı bilgileri:** `docs/ayar.js` dosyasına projenin adresini (Project URL) ve anon / publishable anahtarını yazın. `service_role` (secret) anahtarı hiçbir dosyaya yazılmaz.
5. **Yayın:** GitHub'da Settings > Pages altında kaynak olarak `main` dalını ve `/docs` klasörünü seçin.

## Yapı

```
docs/                 Yayınlanan arayüz
docs/ayar.js          Supabase adresi ve anahtarı
docs/bulut.js         Supabase istemcisi: oturum ve veritabanı işlevleri
docs/app.js           Uygulama ekranları
docs/ek.css           Elle düzenlenen stil eklemeleri (app.css'in sonuna eklenir)
supabase/kurulum.sql  Tablolar, güvenlik ve iş kuralları
tools/varliklar.py    Prototipten app.css ve logo dosyalarını üretir
```

## Güvenlik modeli

Tablolara doğrudan erişim kapalıdır (satır düzeyi güvenlik açık, izin kuralı yok). Arayüz yalnızca `kurulum.sql` içindeki işlevleri çağırır; her işlev giriş yapan kullanıcının salonunu kendisi bulur ve yalnızca o salonun kayıtlarına dokunur. Çakışma kontrolü, ödeme ve stok kuralları da bu işlevlerin içindedir; arayüz atlatılsa bile geçerlidir.

Tutarlar tam lira olarak saklanır.

## Henüz yok

- Müşterinin kendi randevusunu aldığı online randevu sayfası
- Otomatik SMS / WhatsApp hatırlatma (şu an mesaj metni kopyalanıyor)
- Şifre sıfırlama
- Personel için ayrı giriş ve yetkiler, çok şube
- Abonelik ve ödeme altyapısı
- e-Fatura / e-Arşiv
- KVKK aydınlatma metni ve açık rıza akışı
