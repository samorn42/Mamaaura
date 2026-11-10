'use strict';
const $ = id => document.getElementById(id);
// Üç görünüm: giriş, salon sahibi kaydı, davet koduyla personel kaydı.
let mod = location.hash === '#kayit' ? 'kayit' : location.hash === '#davet' ? 'davet' : 'giris';
if (Bulut.girisli()) location.replace('./');

function mesaj(s, hata = true) { $('a-err').textContent = s; $('a-err').hidden = false; $('a-err').style.color = hata ? '' : 'var(--ok)'; }
function ciz() {
  $('l-salon').hidden = mod !== 'kayit';
  $('l-name').hidden = mod === 'giris';
  $('l-davet').hidden = mod !== 'davet';
  $('a-salonbilgi').hidden = true;
  $('a-title').textContent = { giris: 'Salonunuza giriş yapın', kayit: 'Salonunuzu kaydedin', davet: 'Davet koduyla katılın' }[mod];
  $('a-submit').textContent = mod === 'giris' ? 'Giriş yap' : 'Hesap oluştur';
  $('a-q').textContent = mod === 'giris' ? 'Hesabınız yok mu?' : 'Zaten hesabınız var mı?';
  $('a-switch').textContent = mod === 'giris' ? 'Salonunuzu kaydedin' : 'Giriş yapın';
  $('a-davetsatir').hidden = mod === 'davet';
  $('a-pass').autocomplete = mod === 'giris' ? 'current-password' : 'new-password';
  $('a-err').hidden = true;
  if (!Bulut.hazir) mesaj('Kurulum tamamlanmadı: ayar.js dosyasına Supabase adresi ve anahtarı yazılmalı.');
}
$('a-switch').addEventListener('click', () => { mod = mod === 'giris' ? 'kayit' : 'giris'; ciz(); });
$('a-davetbtn').addEventListener('click', () => { mod = 'davet'; ciz(); });
// Kod yazılınca hangi salona katılacağını göster.
$('a-davet').addEventListener('change', async () => {
  const kod = $('a-davet').value.trim(); if (!kod) return;
  try { const r = await Bulut.rpcAcik('davet_kontrol', { p_code: kod }); $('a-salonbilgi').textContent = `${r.salon} salonuna ${r.staff} olarak katılacaksınız.`; $('a-salonbilgi').hidden = false; $('a-err').hidden = true; }
  catch (err) { $('a-salonbilgi').hidden = true; mesaj(err.message); }
});
$('f-auth').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('a-email').value.trim(), sifre = $('a-pass').value, salon = $('a-salon').value.trim(), ad = $('a-name').value.trim(), kod = $('a-davet').value.trim();
  if (mod === 'kayit' && !salon) return mesaj('Salon adını yazın.');
  if (mod !== 'giris' && !ad) return mesaj('Adınızı yazın.');
  if (mod === 'davet' && !kod) return mesaj('Davet kodunu yazın.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mesaj('E-posta adresi geçersiz.');
  if (mod !== 'giris' && sifre.length < 8) return mesaj('Şifre en az 8 karakter olmalı.');
  if (!sifre) return mesaj('Şifrenizi yazın.');
  $('a-submit').disabled = true;
  try {
    if (mod === 'giris') await Bulut.giris(email, sifre);
    else {
      // Davet kodu hesap açılmadan önce doğrulanır; geçersizse boşuna hesap açılmaz.
      if (mod === 'davet') await Bulut.rpcAcik('davet_kontrol', { p_code: kod });
      // Salon adı ya da davet kodu hesaba not edilir; ilk girişte salona bu bilgiyle bağlanılır.
      const veri = mod === 'kayit' ? { salon, name: ad } : { davet: kod, name: ad };
      if (!(await Bulut.kayit(email, sifre, veri))) {
        mod = 'giris'; ciz();
        return mesaj('Hesabınız oluşturuldu. E-postanıza gelen doğrulama bağlantısına tıklayın, sonra buradan giriş yapın.', false);
      }
    }
    location.href = './';
  } catch (err) { mesaj(err.message); }
  finally { $('a-submit').disabled = false; }
});
ciz();
