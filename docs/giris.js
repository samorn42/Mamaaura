'use strict';
const $ = id => document.getElementById(id);
let kayit = location.hash === '#kayit';
if (Bulut.girisli()) location.replace('./');

function mesaj(s, hata = true) { $('a-err').textContent = s; $('a-err').hidden = false; $('a-err').style.color = hata ? '' : 'var(--ok)'; }
function ciz() {
  $('l-salon').hidden = $('l-name').hidden = !kayit;
  $('a-title').textContent = kayit ? 'Salonunuzu kaydedin' : 'Salonunuza giriş yapın';
  $('a-submit').textContent = kayit ? 'Hesap oluştur' : 'Giriş yap';
  $('a-q').textContent = kayit ? 'Zaten hesabınız var mı?' : 'Hesabınız yok mu?';
  $('a-switch').textContent = kayit ? 'Giriş yapın' : 'Salonunuzu kaydedin';
  $('a-pass').autocomplete = kayit ? 'new-password' : 'current-password';
  $('a-err').hidden = true;
  if (!Bulut.hazir) mesaj('Kurulum tamamlanmadı: ayar.js dosyasına Supabase adresi ve anahtarı yazılmalı.');
}
$('a-switch').addEventListener('click', () => { kayit = !kayit; ciz(); });
$('f-auth').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('a-email').value.trim(), sifre = $('a-pass').value, salon = $('a-salon').value.trim(), ad = $('a-name').value.trim();
  if (kayit && !salon) return mesaj('Salon adını yazın.');
  if (kayit && !ad) return mesaj('Adınızı yazın.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mesaj('E-posta adresi geçersiz.');
  if (kayit && sifre.length < 8) return mesaj('Şifre en az 8 karakter olmalı.');
  if (!sifre) return mesaj('Şifrenizi yazın.');
  $('a-submit').disabled = true;
  try {
    if (kayit) {
      // Salon adı hesaba not edilir; salon kaydı ilk girişte bu bilgiyle oluşturulur.
      if (!(await Bulut.kayit(email, sifre, { salon, name: ad }))) {
        kayit = false; ciz();
        return mesaj('Hesabınız oluşturuldu. E-postanıza gelen doğrulama bağlantısına tıklayın, sonra buradan giriş yapın.', false);
      }
    } else await Bulut.giris(email, sifre);
    location.href = './';
  } catch (err) { mesaj(err.message); }
  finally { $('a-submit').disabled = false; }
});
ciz();
