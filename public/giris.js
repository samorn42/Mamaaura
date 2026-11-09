'use strict';
const $ = id => document.getElementById(id);
let kayit = location.hash === '#kayit';

function ciz() {
  $('l-salon').hidden = $('l-name').hidden = !kayit;
  $('a-title').textContent = kayit ? 'Salonunuzu kaydedin' : 'Salonunuza giriş yapın';
  $('a-submit').textContent = kayit ? 'Hesap oluştur' : 'Giriş yap';
  $('a-q').textContent = kayit ? 'Zaten hesabınız var mı?' : 'Hesabınız yok mu?';
  $('a-switch').textContent = kayit ? 'Giriş yapın' : 'Salonunuzu kaydedin';
  $('a-pass').autocomplete = kayit ? 'new-password' : 'current-password';
  $('a-err').hidden = true;
}
$('a-switch').addEventListener('click', () => { kayit = !kayit; ciz(); });
$('f-auth').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { email: $('a-email').value, password: $('a-pass').value };
  if (kayit) { body.salon = $('a-salon').value; body.name = $('a-name').value; }
  $('a-submit').disabled = true;
  try {
    const r = await fetch(kayit ? '/api/signup' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'İşlem yapılamadı. Tekrar deneyin.');
    location.href = '/';
  } catch (err) {
    $('a-err').textContent = err instanceof TypeError ? 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.' : err.message;
    $('a-err').hidden = false;
  } finally { $('a-submit').disabled = false; }
});
ciz();
