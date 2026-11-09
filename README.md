# Mamaaura

Güzellik salonları için randevu, müşteri ve kasa yönetimi. Her salon kendi hesabıyla giriş yapar ve yalnızca kendi verisini görür.

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

## Çalıştırma

Node.js 22.13 ya da daha yenisi gerekir. Kurulacak ek paket yoktur.

```
npm start
```

Tarayıcıda `http://localhost:3000` adresini açın ve salonunuzu kaydedin.

Ayarlar (ortam değişkenleri):

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucunun dinlediği port |
| `DATA_DIR` | `./data` | Veritabanı dosyasının duracağı klasör |

## Test

```
npm test
```

Testler kayıt ve girişi, randevu çakışmasını, ödeme, veresiye ve paket akışlarını, stok düşümünü ve bir salonun başka salonun verisine ulaşamadığını doğrular.

## Yayına alma

Node.js çalıştırabilen ve **kalıcı disk** veren herhangi bir sunucu yeterlidir (ör. Render, Railway, Fly.io ya da bir VPS).

- Başlatma komutu: `npm start`
- `DATA_DIR` değişkenini kalıcı diskin yoluna ayarlayın. Kalıcı disk olmazsa her yeniden başlatmada veriler silinir.
- Sunucu HTTPS arkasında çalışmalıdır; oturum çerezi o zaman yalnızca güvenli bağlantıda gönderilir.
- `data/mamaaura.db` dosyasını düzenli yedekleyin.

## Yapı

```
server.js            Sunucu: üyelik, veritabanı şeması, API
public/              Arayüz (index.html, app.js, app.css, giriş sayfası)
public/ek.css        Elle düzenlenen stil eklemeleri (app.css'in sonuna eklenir)
test/api.test.js     API testleri
tools/varliklar.py   Prototipten app.css ve logo dosyalarını üretir
```

Veriler SQLite veritabanında tutulur. Tutarlar tam lira olarak saklanır.

## Henüz yok

- Müşterinin kendi randevusunu aldığı online randevu sayfası
- Otomatik SMS / WhatsApp hatırlatma (şu an mesaj metni kopyalanıyor)
- Şifre sıfırlama ve e-posta doğrulama
- Personel için ayrı giriş ve yetkiler, çok şube
- Abonelik ve ödeme altyapısı
- e-Fatura / e-Arşiv
- KVKK aydınlatma metni ve açık rıza akışı
