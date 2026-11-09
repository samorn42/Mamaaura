'use strict';
// Mamaaura arayüzü. Veriyi Supabase'deki 'durum' işlevinden alır, her işlemden sonra yeniden yükler.
const $ = id => document.getElementById(id);
const SLOT = 32; // takvimde yarım saatin piksel yüksekliği
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saat = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const tl = n => Number(n).toLocaleString('tr-TR') + ' ₺';
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const lower = s => String(s).toLocaleLowerCase('tr-TR').trim();

let TODAY = iso(new Date());
let S = null;        // sunucudan gelen salon verisi
let secimIslemi = null; // nakit/kart seçimi bekleyen işlem
const st = { tab: 'ozet', date: TODAY, from: TODAY, staff: 'all', q: '' };
const TABS = { ozet: 'Bugünün özeti', takvim: 'Takvim', musteri: 'Müşteriler', kasa: 'Kasa', stok: 'Ürünler ve giderler', ayar: 'Ayarlar' };
const STATUS = { bekliyor: ['Bekleniyor', 'n'], geldi: ['Ödeme bekliyor', 'warn'], gelmedi: ['Gelmedi', 'bad'], odendi: ['Ödendi', 'ok'], veresiye: ['Veresiye', 'warn'] };
const YONTEM = { nakit: 'nakit', kart: 'kart', paket: 'paketten', veresiye: 'veresiye' };
const KATALOG = {
  staff: { ad: 'Personel', alanlar: [['name', 'Ad', 'text'], ['commission', 'Prim oranı (%)', 'number']], ozet: x => `Prim %${x.commission}` },
  services: { ad: 'Hizmet', alanlar: [['name', 'Hizmet adı', 'text'], ['minutes', 'Süre (dakika)', 'number'], ['price', 'Fiyat (₺)', 'number']], ozet: x => `${x.minutes} dk · ${tl(x.price)}` },
  products: { ad: 'Ürün', alanlar: [['name', 'Ürün adı', 'text'], ['stock', 'Stok adedi', 'number'], ['price', 'Fiyat (₺)', 'number']], ozet: x => `Stok ${x.stock} · ${tl(x.price)}` },
};

const svc = id => S.services.find(x => x.id === id) || { name: 'Hizmet', minutes: 30, price: 0 };
const stf = id => S.staff.find(x => x.id === id) || { name: 'Personel', color: 1, commission: 0 };
const cus = id => S.customers.find(x => x.id === id) || { name: 'Müşteri', phone: '', note: '' };
const appt = id => S.appointments.find(x => x.id === id);
const uzun = d => parse(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const gunAd = d => d === TODAY ? 'Bugün' : d === addDays(TODAY, 1) ? 'Yarın' : uzun(d);
const basHarf = ad => ad.split(/\s+/).map(x => x[0] || '').slice(0, 2).join('').toLocaleUpperCase('tr-TR');
const badge = d => `<span class="badge ${STATUS[d][1]}">${STATUS[d][0]}</span>`;
const dot = c => `<i class="dot" style="background:var(--s${c})"></i>`;
const tahsilat = (d, m) => sum(S.payments.filter(p => p.date === d && (m ? p.method === m : p.method === 'nakit' || p.method === 'kart')), p => p.amount);
const kutular = a => a.map(x => `<div class="tile"><span class="k">${x[0]}</span><span class="v">${x[1]}</span><span class="s">${x[2]}</span></div>`).join('');

const rpc = (ad, p) => Bulut.rpc(ad, p);
async function load() {
  if (!Bulut.girisli()) { location.replace('giris.html'); return; }
  TODAY = iso(new Date());
  const p = { p_from: st.from, p_today: TODAY };
  try { S = await rpc('durum', p); }
  catch (e) {
    if (e.oturumYok) { location.replace('giris.html'); return; }
    if (e.message !== 'SALON_YOK') throw e;
    // İlk giriş: kayıt sırasında not edilen salon adıyla salonu oluştur.
    const k = Bulut.kullanici();
    await rpc('salon_olustur', { p_salon: k.meta.salon || 'Salonum', p_ad: k.meta.name || String(k.email || 'Salon sahibi').split('@')[0] });
    S = await rpc('durum', p);
  }
  render();
}
// Bir işlemi yapar, veriyi yeniler, sonucu bildirir. Hata olursa mesajı gösterir ve false döner.
async function yap(fn, mesaj, kapatSonra = true) {
  try { await fn(); await load(); if (kapatSonra) kapat(); if (mesaj) toast(mesaj); return true; }
  catch (e) { if (e.oturumYok) location.replace('giris.html'); else toast(e.message); return false; }
}

function render() {
  $('loading').hidden = true;
  $('title').textContent = TABS[st.tab];
  $('subtitle').textContent = st.tab === 'ozet' ? `${uzun(TODAY)} · ${S.salon.name}` : st.tab === 'musteri' ? `${S.customers.length} kayıtlı müşteri`
    : st.tab === 'ayar' ? S.salon.name : st.date === TODAY ? 'Bugün, ' + uzun(TODAY) : uzun(st.date);
  $('foot').innerHTML = `${esc(S.salon.name)}<br>${esc(S.user.name)}`;
  $('daynav').hidden = ['ozet', 'musteri', 'ayar'].includes(st.tab);
  $('btn-today').hidden = st.from === TODAY && st.date === TODAY;
  $('days').innerHTML = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(st.from, i), x = parse(d);
    return `<button class="day" data-date="${d}" aria-pressed="${st.date === d}"><span>${d === TODAY ? 'Bugün' : x.toLocaleDateString('tr-TR', { weekday: 'short' })}</span><b>${x.getDate()}</b></button>`;
  }).join('');
  for (const t of Object.keys(TABS)) {
    $('v-' + t).hidden = st.tab !== t;
    if (st.tab === t) $('tab-' + t).setAttribute('aria-current', 'page'); else $('tab-' + t).removeAttribute('aria-current');
  }
  ozet(); takvim(); musteri(); kasa(); stok(); ayar();
}

function ozet() {
  const t = S.appointments.filter(a => a.date === TODAY), aktif = S.staff.filter(p => p.active).length || 1;
  const biten = t.filter(a => a.status === 'odendi' || a.status === 'veresiye').length, yok = t.filter(a => a.status === 'gelmedi').length;
  const dol = Math.round(sum(t.filter(a => a.status !== 'gelmedi'), a => a.minutes) / (aktif * (S.salon.close_min - S.salon.open_min)) * 100);
  const yeni = !S.customers.length && !S.appointments.length;
  $('oz-banner').hidden = !yeni;
  $('oz-banner').textContent = 'Hoş geldiniz. Önce Ayarlar bölümünden personelinizi ve hizmet fiyatlarınızı düzenleyin, sonra "Yeni randevu" ile ilk randevunuzu ekleyin.';
  $('oz-tiles').innerHTML = kutular([['Randevu', t.length, biten + ' tamamlandı'], ['Ciro', tl(tahsilat(TODAY)), `Nakit ${tl(tahsilat(TODAY, 'nakit'))} · Kart ${tl(tahsilat(TODAY, 'kart'))}`],
    ['Doluluk', '%' + dol, `${aktif} personel, ${saat(S.salon.open_min)}–${saat(S.salon.close_min)}`], ['Gelmeyen', yok, yok ? 'Hatırlatma mesajı bunu azaltır' : 'Gelmeyen yok']]);
  const a = t.filter(x => x.status === 'bekliyor' || x.status === 'geldi');
  $('oz-agenda').innerHTML = a.length ? a.map(x => `<button class="row" data-rid="${x.id}"><span class="tm">${saat(x.start)}</span><span class="g"><b>${esc(cus(x.customer_id).name)}</b><span class="sub">${dot(stf(x.staff_id).color)} ${esc(svc(x.service_id).name)} · ${esc(stf(x.staff_id).name)}</span></span>${badge(x.status)}</button>`).join('')
    : '<div class="empty">Bugün bekleyen randevu yok.</div>';
  const c = [0, 1, 2, 3, 4, 5, 6].map(i => S.appointments.filter(x => x.date === addDays(TODAY, i)).length), mx = Math.max(1, ...c);
  $('oz-bars').innerHTML = c.map((n, i) => `<div class="bar${i === 0 ? ' on' : ''}"><b>${n}</b><i style="height:${Math.round(n / mx * 88) + 2}px"></i><span>${i === 0 ? 'Bugün' : parse(addDays(TODAY, i)).toLocaleDateString('tr-TR', { weekday: 'short' })}</span></div>`).join('');
  const u = [], bek = t.filter(x => x.status === 'geldi').length, borc = sum(S.payments.filter(p => p.method === 'veresiye'), p => p.amount);
  if (bek) u.push(['warn', 'Ödeme', `${bek} müşteri geldi, ödemesi alınmadı`]);
  if (borc) u.push(['warn', 'Borç', 'Açık veresiye toplamı ' + tl(borc)]);
  S.products.filter(x => x.active && x.stock < 3).forEach(x => u.push([x.stock ? 'warn' : 'bad', 'Stok', x.stock ? `${x.name}: ${x.stock} adet kaldı` : `${x.name} tükendi`]));
  S.customers.filter(m => m.pkg_service_id && m.pkg_total > 0 && m.pkg_remaining <= 2).forEach(m => u.push(['n', 'Paket', `${m.name}: pakette ${m.pkg_remaining} seans kaldı, yenileme teklif edin`]));
  $('oz-uyari').innerHTML = u.length ? u.map(x => `<div class="row"><span class="g">${esc(x[2])}</span><span class="badge ${x[0]}">${x[1]}</span></div>`).join('') : '<div class="empty">Şu an dikkat gerektiren bir şey yok.</div>';
}

function takvim() {
  const H0 = S.salon.open_min, H1 = S.salon.close_min, gun = S.appointments.filter(a => a.date === st.date);
  const hepsi = S.staff.filter(p => p.active || gun.some(a => a.staff_id === p.id));
  if (st.staff !== 'all' && !hepsi.some(p => p.id === st.staff)) st.staff = 'all';
  $('chips').innerHTML = `<button class="chip" data-staff="all" aria-pressed="${st.staff === 'all'}">Tüm personel</button>` +
    hepsi.map(p => `<button class="chip" data-staff="${p.id}" aria-pressed="${st.staff === p.id}">${dot(p.color)}${esc(p.name)}</button>`).join('');
  const cols = st.staff === 'all' ? hepsi : hepsi.filter(p => p.id === st.staff);
  $('tl-head').style.setProperty('--cols', cols.length || 1); $('tl-body').style.setProperty('--cols', cols.length || 1);
  $('tl-head').innerHTML = '<div></div>' + cols.map(p => `<div>${dot(p.color)}${esc(p.name)}</div>`).join('');
  const yukseklik = (H1 - H0) / 30 * SLOT;
  let h = `<div class="hours" style="height:${yukseklik}px;overflow:hidden">`; for (let m = H0; m < H1; m += 60) h += `<div>${saat(m)}</div>`; h += '</div>';
  if (!cols.length) h += `<div class="empty">Henüz personel yok. Ayarlar bölümünden personel ekleyin.</div>`;
  cols.forEach(p => {
    h += `<div class="col" data-col="${p.id}" style="height:${yukseklik}px">`;
    gun.filter(a => a.staff_id === p.id && a.start >= H0 && a.start < H1).forEach(a => {
      const ad = esc(cus(a.customer_id).name), hz = esc(svc(a.service_id).name);
      h += `<button class="ap c${p.color} ${a.status}" data-rid="${a.id}" style="top:${(a.start - H0) / 30 * SLOT + 1}px;height:${a.minutes / 30 * SLOT - 2}px" aria-label="${saat(a.start)} ${ad}, ${hz}"><strong>${a.status === 'odendi' ? '✓ ' : ''}${ad}</strong>${a.minutes > 30 ? `<small>${saat(a.start)} · ${hz}</small>` : ''}</button>`;
    });
    h += '</div>';
  });
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
  if (st.date === TODAY && nm >= H0 && nm < H1) h += `<div class="now" style="top:${(nm - H0) / 30 * SLOT}px"></div>`;
  $('tl-body').innerHTML = h;
}

function paketEtiketi(m) { return m.pkg_service_id && m.pkg_total > 0 ? `${svc(m.pkg_service_id).name}: ${m.pkg_remaining}/${m.pkg_total} seans` : ''; }
function musteri() {
  const q = lower(st.q), qt = q.replace(/\s/g, '');
  const l = S.customers.filter(m => !q || lower(m.name).includes(q) || (qt && m.phone.replace(/\s/g, '').includes(qt)));
  $('musteri-list').innerHTML = l.length ? l.map(m => {
    const pk = paketEtiketi(m);
    const tg = (pk ? `<span class="badge n">${esc(pk)}</span>` : '') + (m.points ? `<span class="badge ok">${m.points} puan</span>` : '') + (m.debt ? `<span class="badge warn">Borç ${tl(m.debt)}</span>` : '');
    return `<button class="row" data-cid="${m.id}"><span class="av">${esc(basHarf(m.name))}</span><span class="g"><b>${esc(m.name)}</b>
      <span class="sub">${esc(m.phone || 'Telefon yok')} · ${m.next ? `Sıradaki: ${gunAd(m.next.date)} ${saat(m.next.start)}, ${esc(svc(m.next.service_id).name)}` : 'Bekleyen randevusu yok'}</span>
      ${m.note ? `<span class="sub">Not: ${esc(m.note)}</span>` : ''}${tg ? `<span class="tags">${tg}</span>` : ''}</span></button>`;
  }).join('') : `<div class="empty">${S.customers.length ? 'Bu aramayla eşleşen müşteri yok.' : 'Henüz müşteri yok. Randevu eklediğinizde müşteri kaydı kendiliğinden oluşur.'}</div>`;
}

function kasa() {
  const d = st.date, l = S.payments.filter(p => p.date === d), gd = sum(S.expenses.filter(x => x.date === d), x => x.amount), c = tahsilat(d);
  $('kasa-tiles').innerHTML = kutular([['Ciro', tl(c), `${l.filter(p => p.method === 'paket').length} paket seansı ayrıca kullanıldı`], ['Nakit', tl(tahsilat(d, 'nakit')), 'Kasadaki nakit'],
    ['Kart', tl(tahsilat(d, 'kart')), 'Veresiye yazılan: ' + tl(tahsilat(d, 'veresiye'))], ['Gider', tl(gd), 'Gün sonu net: ' + tl(c - gd)]]);
  $('kasa-list').innerHTML = l.length ? l.map(p => {
    const alt = p.appointment_id ? `${esc(p.service_name)} · ${esc(p.staff_name)} · ${YONTEM[p.method]}` : p.customer_name ? `${esc(p.label)} · ${YONTEM[p.method]}` : `Ürün satışı · ${YONTEM[p.method]}`;
    return `<div class="row"><span class="g"><b>${esc(p.customer_name || p.label)}</b><span class="sub">${alt}</span></span><span class="r">${p.method === 'paket' ? 'Paketten' : tl(p.amount)}</span></div>`;
  }).join('') : '<div class="empty">Bu gün için tahsilat yok. Randevuya dokunup ödeme alınca burada görünür.</div>';
  const pr = S.staff.filter(p => p.active || l.some(x => x.staff_id === p.id));
  $('prim-list').innerHTML = pr.length ? pr.map(p => {
    const pc = sum(l.filter(x => x.staff_id === p.id && (x.method === 'nakit' || x.method === 'kart')), x => x.amount);
    return `<div class="row">${dot(p.color)}<span class="g"><b>${esc(p.name)}</b><span class="sub">${tl(pc)} ciro × %${p.commission}</span></span><span class="r">${tl(Math.round(pc * p.commission / 100))}</span></div>`;
  }).join('') : '<div class="empty">Henüz personel yok.</div>';
}

function stok() {
  const ur = S.products.filter(u => u.active);
  $('urun-list').innerHTML = ur.length ? ur.map(u => `<div class="row"><span class="g"><b>${esc(u.name)}</b><span class="sub">${u.stock ? `Stok: ${u.stock}` : 'Stokta yok'}${u.stock > 0 && u.stock < 3 ? ' · azaldı' : ''} · ${tl(u.price)}</span></span><button class="btn sm" data-sat="${u.id}"${u.stock ? '' : ' disabled'}>Sat</button></div>`).join('')
    : '<div class="empty">Henüz ürün yok. Ayarlar bölümünden satışa sunduğunuz ürünleri ekleyin.</div>';
  const b = S.payments.filter(p => p.method === 'veresiye');
  $('borc-list').innerHTML = b.length ? b.map(p => `<div class="row"><span class="g"><b>${esc(p.customer_name)}</b><span class="sub">${esc(p.service_name)} · ${tl(p.amount)} · ${gunAd(p.date)}</span></span><button class="btn sm" data-tahsil="${p.id}">Tahsil et</button></div>`).join('')
    : '<div class="empty">Açık borç yok. Ödeme alırken "Veresiye" seçilen işlemler burada birikir.</div>';
  const g = S.expenses.filter(x => x.date === st.date);
  $('gider-list').innerHTML = g.length ? g.map(x => `<div class="row"><span class="g"><b>${esc(x.name)}</b></span><span class="r">${tl(x.amount)}</span><button class="btn sm danger" data-gsil="${x.id}">Sil</button></div>`).join('')
    : `<div class="empty">${gunAd(st.date)} için gider girilmedi.</div>`;
}

function ayar() {
  for (const k of Object.keys(KATALOG)) {
    $('ay-' + k).innerHTML = S[k].length ? S[k].map(x => `<button class="row${x.active ? '' : ' muted-row'}" data-edit="${k}:${x.id}">${k === 'staff' ? dot(x.color) : ''}<span class="g"><b>${esc(x.name)}</b><span class="sub">${KATALOG[k].ozet(x)}</span></span>${x.active ? '' : '<span class="badge bad">Kaldırıldı</span>'}</button>`).join('')
      : `<div class="empty">Henüz kayıt yok.</div>`;
  }
  if (!$('f-salon').contains(document.activeElement)) {
    const sec = (v) => { let o = ''; for (let m = 0; m <= 1440; m += 30) o += `<option value="${m}"${m === v ? ' selected' : ''}>${saat(m)}</option>`; return o; };
    $('sl-ad').value = S.salon.name; $('sl-ac').innerHTML = sec(S.salon.open_min); $('sl-kapa').innerHTML = sec(S.salon.close_min);
  }
  $('hs-ad').textContent = S.user.name; $('hs-mail').textContent = S.user.email;
}

/* Açılır pencereler */
function ac(html) { $('sheet').innerHTML = html; $('backdrop').hidden = false; const f = $('sheet').querySelector('input:not([type=date])'); if (f && matchMedia('(min-width:900px)').matches) f.focus(); }
function kapat() { $('backdrop').hidden = true; secimIslemi = null; }
let tt; function toast(s) { $('toast').textContent = s; $('toast').hidden = false; clearTimeout(tt); tt = setTimeout(() => $('toast').hidden = true, 3200); }
const baslik = (t, alt) => `<div class="head"><div><h2>${t}</h2>${alt ? `<span class="sub">${alt}</span>` : ''}</div><button class="x" data-kapat="1" aria-label="Kapat">×</button></div>`;

function detay(id) {
  const a = appt(id); if (!a) return; const m = cus(a.customer_id), hz = svc(a.service_id);
  const pk = m.pkg_service_id === a.service_id && m.pkg_total > 0 ? m : null;
  let ek = '';
  if (a.status === 'bekliyor') ek = `<div class="acts"><button class="btn primary" data-set="geldi" data-id="${id}">Geldi</button><button class="btn" data-set="gelmedi" data-id="${id}">Gelmedi</button><button class="btn danger" data-iptal="${id}">İptal et</button></div>
    <div class="note"><div class="sub">Hatırlatma mesajı</div><div class="msg" id="msg">Merhaba ${esc(m.name.split(' ')[0])}, ${gunAd(a.date).toLocaleLowerCase('tr-TR')} saat ${saat(a.start)} için ${esc(hz.name.toLocaleLowerCase('tr-TR'))} randevunuz var. Gelemeyecekseniz lütfen haber verin. ${esc(S.salon.name)}</div></div>
    <button class="btn block" data-kopya="1">Mesajı kopyala</button>`;
  else if (a.status === 'geldi') ek = `<div class="sub">Ödeme al: ${tl(a.price)}</div><div class="acts"><button class="btn primary" data-ode="nakit" data-id="${id}">Nakit</button><button class="btn primary" data-ode="kart" data-id="${id}">Kart</button><button class="btn" data-ode="veresiye" data-id="${id}">Veresiye</button>${pk && pk.pkg_remaining > 0 ? `<button class="btn" data-ode="paket" data-id="${id}">Paketten düş</button>` : ''}</div>
    <button class="btn block" data-set="bekliyor" data-id="${id}">Geldi işaretini geri al</button>`;
  else if (a.status === 'gelmedi') ek = `<div class="acts"><button class="btn" data-set="bekliyor" data-id="${id}">Geri al</button><button class="btn danger" data-iptal="${id}">Randevuyu sil</button></div>`;
  ac(`<div class="head"><div class="row" style="padding:0"><span class="av">${esc(basHarf(m.name))}</span><span class="g"><h2>${esc(m.name)}</h2><span class="sub">${esc(m.phone || 'Telefon yok')}</span></span></div><button class="x" data-kapat="1" aria-label="Kapat">×</button></div>
   <div class="tags">${badge(a.status)}${pk ? `<span class="badge n">${esc(paketEtiketi(m))} kaldı</span>` : ''}</div>
   <dl class="kv"><dt>Zaman</dt><dd>${gunAd(a.date)}, ${saat(a.start)}–${saat(a.start + a.minutes)}</dd><dt>Hizmet</dt><dd>${esc(hz.name)} · ${tl(a.price)}</dd><dt>Personel</dt><dd>${esc(stf(a.staff_id).name)}</dd></dl>
   ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}${ek}`);
}

function yeni(bas, staffId) {
  const H0 = S.salon.open_min, H1 = S.salon.close_min, hz = S.services.filter(x => x.active), ps = S.staff.filter(x => x.active);
  if (!hz.length || !ps.length) return ac(baslik('Yeni randevu') + `<div class="note">Randevu ekleyebilmek için Ayarlar bölümünde en az bir personel ve bir hizmet olmalı.</div><button class="btn primary block" data-tab="ayar">Ayarlar'a git</button>`);
  const b = Math.min(Math.max(bas || H0, H0), H1 - 30); let so = '';
  for (let m = H0; m < H1; m += 30) so += `<option value="${m}"${m === b ? ' selected' : ''}>${saat(m)}</option>`;
  ac(baslik('Yeni randevu') + `<form id="f-yeni" novalidate>
   <label class="full">Müşteri adı<input id="f-ad" list="dl-m" autocomplete="off" placeholder="Ad Soyad"><datalist id="dl-m">${S.customers.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist></label>
   <label class="full">Telefon<input id="f-tel" inputmode="tel" autocomplete="off" placeholder="05xx xxx xx xx"></label>
   <label class="full">Hizmet<select id="f-h">${hz.map(h => `<option value="${h.id}">${esc(h.name)} · ${h.minutes} dk · ${tl(h.price)}</option>`).join('')}</select></label>
   <label>Personel<select id="f-p">${ps.map(p => `<option value="${p.id}"${p.id === staffId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
   <label>Saat<select id="f-s">${so}</select></label>
   <label class="full">Gün<input id="f-g" type="date" value="${st.tab === 'ozet' ? TODAY : st.date}"></label>
   <p class="err" id="f-err" hidden></p>
   <button class="btn primary" type="submit">Randevuyu kaydet</button></form>`);
}

function musteriPenceresi(id) {
  const m = cus(id), hz = S.services.filter(x => x.active), pk = paketEtiketi(m);
  ac(baslik(esc(m.name), [pk, m.points ? m.points + ' puan' : '', m.debt ? 'Borç ' + tl(m.debt) : ''].filter(Boolean).map(esc).join(' · ')) + `
   <form id="f-cus" data-id="${id}" novalidate>
    <label class="full">Ad Soyad<input id="c-ad" value="${esc(m.name)}"></label>
    <label class="full">Telefon<input id="c-tel" inputmode="tel" value="${esc(m.phone)}"></label>
    <label class="full">Not (boya numarası, alerji, tercih)<textarea id="c-not">${esc(m.note)}</textarea></label>
    <button class="btn primary" type="submit">Bilgileri kaydet</button></form>
   ${hz.length ? `<h2>Paket sat</h2><form id="f-pkg" data-id="${id}" novalidate>
    <label class="full">Hizmet<select id="p-h">${hz.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select></label>
    <label>Seans sayısı<input id="p-n" inputmode="numeric" value="8"></label>
    <label>Paket fiyatı (₺)<input id="p-f" inputmode="numeric" placeholder="Örn. 6000"></label>
    <label class="full">Ödeme<select id="p-y"><option value="nakit">Nakit</option><option value="kart">Kart</option></select></label>
    <button class="btn" type="submit">Paketi sat</button></form>` : ''}`);
}

function katalogPenceresi(k, id) {
  const K = KATALOG[k], x = id ? S[k].find(y => y.id === id) : null;
  ac(baslik(x ? `${K.ad} düzenle` : `${K.ad} ekle`) + `<form id="f-kat" data-k="${k}" data-id="${id || ''}" novalidate>
    ${K.alanlar.map(([a, e, t]) => `<label class="full">${e}<input id="k-${a}" ${t === 'number' ? 'inputmode="numeric"' : ''} value="${x ? esc(x[a]) : ''}"></label>`).join('')}
    <button class="btn primary" type="submit">Kaydet</button></form>
    ${x ? `<button class="btn block${x.active ? ' danger' : ''}" data-aktif="${k}:${id}:${x.active ? 0 : 1}">${x.active ? 'Kaldır' : 'Yeniden kullanıma al'}</button>
    ${x.active ? '<span class="sub">Kaldırılan kayıt yeni işlemlerde seçilemez; geçmiş kayıtlar korunur.</span>' : ''}` : ''}`);
}

function yontemSec(metin, islem) {
  secimIslemi = islem;
  ac(baslik('Ödeme yöntemi', esc(metin)) + `<div class="acts"><button class="btn primary" data-pick="nakit">Nakit</button><button class="btn primary" data-pick="kart">Kart</button></div>`);
}

const sayi = v => { const n = parseInt(String(v).replace(/\D/g, ''), 10); return Number.isNaN(n) ? null : n; };

document.addEventListener('click', e => {
  if (e.target === $('backdrop')) return kapat();
  const t = e.target.closest('button,[data-col]'); if (!t || !S) return; const d = t.dataset;
  if (d.kapat) return kapat();
  if (d.tab) { st.tab = d.tab; kapat(); render(); return scrollTo(0, 0); }
  if (d.date) { st.date = d.date; return render(); }
  if (d.week !== undefined) { st.from = d.week === '0' ? TODAY : addDays(st.from, 7 * Number(d.week)); st.date = st.from; return yap(async () => {}, '', false); }
  if (d.staff) { st.staff = d.staff === 'all' ? 'all' : Number(d.staff); return takvim(); }
  if (d.act === 'new') return yeni();
  if (d.act === 'cikis') return Bulut.cikis().finally(() => { location.href = 'giris.html'; });
  if (d.rid) return detay(Number(d.rid));
  if (d.cid) return musteriPenceresi(Number(d.cid));
  if (d.col) { const y = e.clientY - t.getBoundingClientRect().top; return yeni(S.salon.open_min + Math.floor(y / SLOT) * 30, Number(d.col)); }
  if (d.set) return yap(() => rpc('randevu_durum', { p_id: Number(d.id), p_status: d.set }), '', false).then(ok => ok && detay(Number(d.id)));
  if (d.iptal) { if (!d.emin) { t.dataset.emin = 1; t.textContent = 'Emin misiniz? Sil'; return; } return yap(() => rpc('randevu_sil', { p_id: Number(d.iptal) }), 'Randevu silindi'); }
  if (d.ode) return yap(() => rpc('randevu_ode', { p_id: Number(d.id), p_method: d.ode, p_today: TODAY }), d.ode === 'paket' ? 'Paketten 1 seans düşüldü' : d.ode === 'veresiye' ? 'Borç olarak yazıldı' : 'Ödeme kasaya işlendi');
  if (d.sat) { const u = S.products.find(x => x.id === Number(d.sat)); return yontemSec(`${u.name} · ${tl(u.price)}`, y => yap(() => rpc('urun_sat', { p_id: u.id, p_method: y, p_today: TODAY }), 'Satış kasaya işlendi, stok düşüldü')); }
  if (d.tahsil) { const p = S.payments.find(x => x.id === Number(d.tahsil)); return yontemSec(`${p.customer_name} · ${tl(p.amount)}`, y => yap(() => rpc('borc_tahsil', { p_id: p.id, p_method: y, p_today: TODAY }), 'Borç tahsil edildi')); }
  if (d.pick && secimIslemi) return secimIslemi(d.pick);
  if (d.gsil) return yap(() => rpc('gider_sil', { p_id: Number(d.gsil) }), 'Gider silindi');
  if (d.yeni) return katalogPenceresi(d.yeni);
  if (d.edit) { const [k, id] = d.edit.split(':'); return katalogPenceresi(k, Number(id)); }
  if (d.aktif) { const [k, id, v] = d.aktif.split(':'); return yap(() => rpc('katalog_aktif', { p_tur: k, p_id: Number(id), p_aktif: v === '1' }), v === '1' ? 'Yeniden kullanıma alındı' : 'Kaldırıldı'); }
  if (d.kopya) {
    const s = $('msg').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('Mesaj kopyalandı'))
      .catch(() => { const r = document.createRange(); r.selectNodeContents($('msg')); const x = getSelection(); x.removeAllRanges(); x.addRange(r); toast('Mesaj seçildi, kopyalayabilirsiniz'); });
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === 'f-yeni') {
    const err = s => { $('f-err').textContent = s; $('f-err').hidden = false; };
    const ad = $('f-ad').value.trim(), gun = $('f-g').value;
    if (!ad) return err('Müşteri adını yazın.');
    if (!gun) return err('Randevu gününü seçin.');
    const m = S.customers.find(x => lower(x.name) === lower(ad));
    try {
      await rpc('randevu_ekle', { p_customer_id: m ? m.id : null, p_customer_name: ad, p_phone: $('f-tel').value, p_service_id: Number($('f-h').value), p_staff_id: Number($('f-p').value), p_date: gun, p_start: Number($('f-s').value) });
    } catch (x) { if (x.oturumYok) return location.replace('giris.html'); return err(x.message); }
    // Kaydedilen güne git; o gün görünen haftanın dışındaysa haftayı da değiştir.
    st.date = gun; if (gun < st.from || gun > addDays(st.from, 6)) st.from = gun;
    if (st.tab !== 'ozet' || gun !== TODAY) st.tab = 'takvim';
    return yap(async () => {}, 'Randevu kaydedildi');
  }
  if (f.id === 'f-gider') {
    const ad = $('g-ad').value.trim(), t = sayi($('g-tutar').value);
    if (!ad || !t) return toast('Gider adını ve tutarını yazın.');
    if (await yap(() => rpc('gider_ekle', { p_date: st.date, p_name: ad, p_amount: t }), 'Gider eklendi', false)) { $('g-ad').value = ''; $('g-tutar').value = ''; }
  }
  if (f.id === 'f-salon') { document.activeElement.blur(); return yap(() => rpc('salon_guncelle', { p_name: $('sl-ad').value, p_open_min: Number($('sl-ac').value), p_close_min: Number($('sl-kapa').value) }), 'Salon bilgileri kaydedildi', false); }
  if (f.id === 'f-cus') return yap(() => rpc('musteri_guncelle', { p_id: Number(f.dataset.id), p_name: $('c-ad').value, p_phone: $('c-tel').value, p_note: $('c-not').value }), 'Müşteri bilgileri kaydedildi');
  if (f.id === 'f-pkg') {
    const n = sayi($('p-n').value), fy = sayi($('p-f').value);
    if (!n || fy === null) return toast('Seans sayısını ve paket fiyatını yazın.');
    return yap(() => rpc('paket_sat', { p_id: Number(f.dataset.id), p_service_id: Number($('p-h').value), p_total: n, p_price: fy, p_method: $('p-y').value, p_today: TODAY }), 'Paket satıldı, kasaya işlendi');
  }
  if (f.id === 'f-kat') {
    const k = f.dataset.k, body = {};
    for (const [a, e2, t] of KATALOG[k].alanlar) { const v = $('k-' + a).value.trim(); body[a] = t === 'number' ? sayi(v) : v; if (body[a] === null || body[a] === '') return toast(`${e2} boş bırakılamaz.`); }
    return yap(() => rpc('katalog_kaydet', { p_tur: k, p_id: f.dataset.id ? Number(f.dataset.id) : null, p_veri: body }), 'Kaydedildi');
  }
});
document.addEventListener('change', e => { if (e.target.id === 'f-ad') { const m = S.customers.find(x => lower(x.name) === lower(e.target.value)); if (m) $('f-tel').value = m.phone; } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') kapat(); });
$('q').addEventListener('input', e => { st.q = e.target.value; musteri(); });
// Sekmeye geri dönüldüğünde veriyi tazele (başka cihazdan yapılan değişiklikler görünsün).
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && $('backdrop').hidden) load().catch(() => {}); });

load().catch(e => { $('loading').textContent = e.message; });
