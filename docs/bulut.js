'use strict';
// Supabase'e bağlanan küçük istemci: üyelik oturumu ve veritabanı işlevleri. Dış kütüphane kullanmaz.
const Bulut = (() => {
  const A = window.MAMAAURA_AYAR || {};
  const ADRES = String(A.url || '').trim().replace(/\/+$/, ''), ANAHTAR = String(A.anahtar || '').trim();
  const hazir = /^https?:\/\//.test(ADRES) && ANAHTAR.length > 20;
  const DEPO = 'mamaaura-oturum';
  let oturum = null, yenileme = null;
  try { oturum = JSON.parse(localStorage.getItem(DEPO)); } catch { /* depolama kapalıysa oturum yalnızca bu sekmede tutulur */ }
  function sakla(o) { oturum = o; try { o ? localStorage.setItem(DEPO, JSON.stringify(o)) : localStorage.removeItem(DEPO); } catch { /* yok say */ } }

  const CEVIRI = [
    [/invalid login credentials/i, 'E-posta ya da şifre hatalı.'],
    [/already registered|already been registered|user_already_exists/i, 'Bu e-posta ile kayıtlı bir hesap var. Giriş yapmayı deneyin.'],
    [/email not confirmed/i, 'E-posta adresiniz doğrulanmamış. Gelen kutunuzdaki bağlantıya tıklayın, sonra giriş yapın.'],
    [/password should be|weak_password/i, 'Şifre en az 8 karakter olmalı.'],
    [/rate limit|too many/i, 'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.'],
    [/validate email|invalid.*email|email.*invalid/i, 'E-posta adresi geçersiz.'],
    [/signups? (not allowed|disabled)/i, 'Yeni kayıt şu an kapalı.'],
    [/invalid input syntax|out of range/i, 'Girilen değer geçersiz.'],
    [/could not find the function|schema cache/i, 'Veritabanı kurulumu eksik ya da güncel değil. Kurulum metnini yeniden çalıştırın.'],
    [/invalid api key|no api key/i, 'Bağlantı anahtarı geçersiz. ayar.js dosyasındaki bilgileri kontrol edin.'],
  ];
  function cevir(m) { for (const [r, t] of CEVIRI) if (r.test(m)) return t; return m; }

  async function istek(yol, govde, token) {
    if (!hazir) throw new Error('Kurulum tamamlanmadı: ayar.js dosyasına Supabase adresi ve anahtarı yazılmalı.');
    let r;
    try {
      const h = { apikey: ANAHTAR, 'Content-Type': 'application/json' };
      if (token) h.Authorization = 'Bearer ' + token;
      r = await fetch(ADRES + yol, { method: 'POST', headers: h, body: JSON.stringify(govde || {}) });
    } catch { throw new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.'); }
    const t = await r.text(); let j = null;
    try { j = t ? JSON.parse(t) : null; } catch { /* gövde JSON değil */ }
    if (!r.ok) {
      const ham = j && (j.msg || j.message || j.error_description || j.error_code || j.error);
      const e = new Error(cevir(String(ham || 'İşlem yapılamadı. Tekrar deneyin.'))); e.status = r.status; throw e;
    }
    return j;
  }
  function oturumAc(j) {
    sakla({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() / 1000 + (j.expires_in || 3600),
      email: j.user && j.user.email, meta: (j.user && j.user.user_metadata) || {} });
  }
  async function yenile() {
    if (!oturum || !oturum.refresh_token) { sakla(null); return null; }
    // Aynı anda gelen istekler tek bir yenileme isteğini paylaşır.
    yenileme = yenileme || istek('/auth/v1/token?grant_type=refresh_token', { refresh_token: oturum.refresh_token })
      .then(j => { oturumAc(j); return oturum.access_token; })
      .catch(e => { if (e.status) sakla(null); return null; })
      .finally(() => { yenileme = null; });
    return yenileme;
  }
  async function jeton() {
    if (!oturum) return null;
    return oturum.expires_at - Date.now() / 1000 < 60 ? yenile() : oturum.access_token;
  }
  const oturumYok = () => { const e = new Error('Oturum süresi doldu. Tekrar giriş yapın.'); e.oturumYok = true; return e; };

  return {
    hazir,
    girisli: () => !!oturum,
    kullanici: () => oturum ? { email: oturum.email, meta: oturum.meta } : null,
    // Veritabanı işlevi çağırır. Oturum düşmüşse bir kez yenileyip tekrar dener.
    async rpc(ad, p) {
      let t = await jeton(); if (!t) throw oturumYok();
      try { return await istek('/rest/v1/rpc/' + ad, p, t); }
      catch (e) {
        if (e.status !== 401) throw e;
        t = await yenile(); if (!t) throw oturumYok();
        return istek('/rest/v1/rpc/' + ad, p, t);
      }
    },
    // true: oturum açıldı. false: e-posta doğrulaması bekleniyor.
    async kayit(email, sifre, veri) {
      const j = await istek('/auth/v1/signup', { email, password: sifre, data: veri });
      if (j && j.access_token) { oturumAc(j); return true; }
      return false;
    },
    async giris(email, sifre) { oturumAc(await istek('/auth/v1/token?grant_type=password', { email, password: sifre })); },
    async cikis() { const t = oturum && oturum.access_token; sakla(null); if (t) await istek('/auth/v1/logout', {}, t).catch(() => {}); },
  };
})();
