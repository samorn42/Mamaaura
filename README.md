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
- WhatsApp hatırlatma: randevudan tek dokunuşla hazır mesaj; özet ekranında yarının hatırlatma listesi; metin Ayarlar'dan düzenlenir
- Otomatik WhatsApp hatırlatma: salon açarsa yarınki randevulara Meta WhatsApp Cloud API ile onaylı şablon mesajı gider (10:00–20:00 arası saat başı, randevu başına bir kez); sonuç randevuda görünür
- Raporlar: dönemlik ciro, net, günlük/aylık ciro grafiği, hizmet, personel primi, en çok harcayan müşteriler, ürün satışları
- Personel girişi: salon sahibi davet kodu oluşturur; personel takvim, müşteri, randevu ve ödeme işlemlerini yapar, kasa, rapor ve ayarları göremez
- Telefonda ana ekrana uygulama olarak eklenebilir

## Kurulum

1. **Supabase projesi:** supabase.com'da bir proje açın.
2. **Veritabanı:** Supabase panelinde SQL Editor'ü açın, `supabase/kurulum.sql` dosyasının tamamını yapıştırıp "Run" deyin. Tekrar çalıştırmak güvenlidir; uygulama güncellendiğinde aynı adım yeni sürümü kurar, mevcut veriyi silmez.
3. **E-posta doğrulaması:** Deneme aşamasında Authentication > Sign In / Providers > Email altındaki "Confirm email" seçeneğini kapatın. Açık kalacaksa Authentication > URL Configuration altındaki "Site URL" alanına uygulamanın adresini yazın.
4. **Bağlantı bilgileri:** `docs/ayar.js` dosyasına projenin adresini (Project URL) ve anon / publishable anahtarını yazın. `service_role` (secret) anahtarı hiçbir dosyaya yazılmaz.
5. **Yayın:** GitHub'da Settings > Pages altında kaynak olarak `main` dalını ve `/docs` klasörünü seçin.

## Otomatik WhatsApp kurulumu

Tüm salonların mesajları Mamaaura'nın tek WhatsApp Business numarasından gider.

1. **Meta tarafı:** developers.facebook.com'da bir uygulama oluşturun ve "Connect with customers through WhatsApp" kullanım alanını ekleyin. API Setup sayfasındaki **Phone number ID** değerini alın. Business Settings > System users altında bir sistem kullanıcısı oluşturup `whatsapp_business_messaging` ve `whatsapp_business_management` izinleriyle **kalıcı erişim anahtarı** üretin.
2. **Şablon:** WhatsApp Manager > Message templates altında `randevu_hatirlatma` adında, **Utility** kategorisinde, **Turkish (tr)** dilinde şu gövdeyle şablon oluşturun ve onaylanmasını bekleyin:

   ```
   Merhaba {{1}}, {{2}} günü saat {{3}} için {{4}} salonunda {{5}} randevunuz bulunmaktadır. Randevunuzu değiştirmek ya da iptal etmek için lütfen salonu arayın: {{6}}. Bu mesaj otomatik olarak gönderilmiştir.
   ```

   Sıra: {{1}} ad, {{2}} tarih, {{3}} saat, {{4}} salon, {{5}} hizmet, {{6}} salon telefonu.
3. **Veritabanı:** SQL Editor'de önce `supabase/kurulum.sql`, sonra `supabase/whatsapp.sql` dosyasını çalıştırın.
4. **Bağlantı:** `supabase/whatsapp-ayar.sql` içeriğini SQL Editor'e yapıştırın, Phone number ID ile erişim anahtarını yazıp çalıştırın. Anahtar Supabase Vault'ta şifreli saklanır; bu bilgileri depoya yüklemeyin.
5. **Salon:** Ayarlar > Otomatik WhatsApp hatırlatma bölümünden salon telefonunu yazıp seçeneği açın, "Deneme mesajı gönder" ile kontrol edin.

Graph API sürümü `wa_ayar.api_version` alanındadır (varsayılan `v23.0`); Meta eski sürümleri kapattıkça güncellenmelidir.

## Yapı

```
docs/                 Yayınlanan arayüz
docs/ayar.js          Supabase adresi ve anahtarı
docs/bulut.js         Supabase istemcisi: oturum ve veritabanı işlevleri
docs/app.js           Uygulama ekranları
docs/ek.css           Elle düzenlenen stil eklemeleri (app.css'in sonuna eklenir)
supabase/kurulum.sql  Tablolar, güvenlik ve iş kuralları
supabase/whatsapp.sql Otomatik WhatsApp gönderimi ve zamanlaması
supabase/whatsapp-ayar.sql  WhatsApp bağlantı bilgilerinin girileceği şablon
tools/varliklar.py    Prototipten app.css ve logo dosyalarını üretir
```

## Güvenlik modeli

Tablolara doğrudan erişim kapalıdır (satır düzeyi güvenlik açık, izin kuralı yok). Arayüz yalnızca `kurulum.sql` içindeki işlevleri çağırır; her işlev giriş yapan kullanıcının salonunu kendisi bulur ve yalnızca o salonun kayıtlarına dokunur. Çakışma kontrolü, ödeme ve stok kuralları da bu işlevlerin içindedir; arayüz atlatılsa bile geçerlidir.

Tutarlar tam lira olarak saklanır.

## Henüz yok

- Müşterinin kendi randevusunu aldığı online randevu sayfası
- WhatsApp teslim/okundu bilgisi (webhook); şu an yalnızca WhatsApp'ın mesajı kabul edip etmediği görünüyor
- Her salonun kendi WhatsApp numarasından göndermesi; şu an tüm mesajlar Mamaaura'nın tek numarasından gider
- Şifre sıfırlama
- Çok şube, personel için ayrıntılı yetki ayarı
- Abonelik ve ödeme altyapısı
- e-Fatura / e-Arşiv
- KVKK aydınlatma metni ve açık rıza akışı
