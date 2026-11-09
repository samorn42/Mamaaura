'use strict';
// Mamaaura sunucusu. Dış paket kullanmaz: Node.js 22.13+ ile gelen http, sqlite ve crypto yeterli.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS salons(id INTEGER PRIMARY KEY, name TEXT NOT NULL, open_min INTEGER NOT NULL DEFAULT 540,
  close_min INTEGER NOT NULL DEFAULT 1200, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS staff(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), name TEXT NOT NULL,
  commission INTEGER NOT NULL DEFAULT 0, color INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), name TEXT NOT NULL,
  minutes INTEGER NOT NULL, price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 0,
  pkg_service_id INTEGER, pkg_total INTEGER NOT NULL DEFAULT 0, pkg_remaining INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), date TEXT NOT NULL,
  start INTEGER NOT NULL, minutes INTEGER NOT NULL, price INTEGER NOT NULL, service_id INTEGER NOT NULL REFERENCES services(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id), customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'bekliyor');
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), date TEXT NOT NULL,
  appointment_id INTEGER REFERENCES appointments(id), customer_id INTEGER REFERENCES customers(id), label TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY, salon_id INTEGER NOT NULL REFERENCES salons(id), date TEXT NOT NULL,
  name TEXT NOT NULL, amount INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_appt ON appointments(salon_id, date);
CREATE INDEX IF NOT EXISTS ix_pay ON payments(salon_id, date);
CREATE INDEX IF NOT EXISTS ix_cust ON customers(salon_id);
`;

const DEFAULT_SERVICES = [['Saç kesimi', 60, 600], ['Saç boyama', 120, 2500], ['Fön', 30, 350], ['Manikür', 60, 500],
  ['Cilt bakımı', 60, 1200], ['Lazer epilasyon', 30, 900], ['Kaş alımı', 30, 200]];

// Personel, hizmet ve ürün aynı kalıpla yönetilir: ad + sayısal alanlar + aktif/pasif.
const CATALOG = {
  staff: { label: 'Personel adı', ints: { commission: ['Prim oranı', 0, 100] } },
  services: { label: 'Hizmet adı', ints: { minutes: ['Süre', 15, 480], price: ['Fiyat', 0, 1000000] } },
  products: { label: 'Ürün adı', ints: { stock: ['Stok', 0, 100000], price: ['Fiyat', 0, 1000000] } },
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

function text(v, name, max = 80, required = true) {
  v = typeof v === 'string' ? v.trim() : '';
  if (!v && required) bad(`${name} boş bırakılamaz.`);
  if (v.length > max) bad(`${name} en fazla ${max} karakter olabilir.`);
  return v;
}
function int(v, name, min, max) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) bad(`${name} ${min} ile ${max} arasında bir tam sayı olmalı.`);
  return n;
}
function day(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) bad('Tarih geçersiz.');
  return v;
}
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const clock = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createApp(dbFile) {
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const get = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const attempts = new Map(); // giriş denemesi sınırı: adres başına 10 dakikada 20 deneme
  function throttle(req) {
    // Yayında sunucu bir vekil (proxy) arkasında çalışır; gerçek adres X-Forwarded-For'un son değeridir.
    const ip = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
    const now = Date.now(), a = (attempts.get(ip) || []).filter(t => now - t < 600000);
    if (a.length >= 20) bad('Çok fazla deneme yapıldı. 10 dakika sonra tekrar deneyin.', 429);
    a.push(now); attempts.set(ip, a);
  }

  function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  }
  function sessionToken(req) { const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m && m[1]; }
  function currentUser(req) {
    const t = sessionToken(req);
    return t && get(`SELECT u.id,u.salon_id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=? AND s.expires>?`, sha(t), Date.now());
  }
  // Her kayıt salon_id ile birlikte sorgulanır; bir salon başka salonun verisine ulaşamaz.
  const own = (table, id, salonId, what) => get(`SELECT * FROM ${table} WHERE id=? AND salon_id=?`, id, salonId) || bad(`${what} bulunamadı.`, 404);
  const addPoints = (customerId, amount) => run('UPDATE customers SET points=points+? WHERE id=?', Math.floor(amount / 100), customerId);
  const cashMethod = m => (m === 'nakit' || m === 'kart') ? m : bad('Ödeme yöntemi nakit ya da kart olmalı.');

  const routes = [];
  const route = (method, pattern, handler, open = false) => routes.push({ method, pattern, handler, open });

  route('POST', /^\/api\/signup$/, ({ req, res, b }) => {
    throttle(req);
    const salon = text(b.salon, 'Salon adı'), name = text(b.name, 'Adınız', 60);
    const email = text(b.email, 'E-posta', 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('E-posta adresi geçersiz.');
    if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) bad('Şifre en az 8 karakter olmalı.');
    if (get('SELECT 1 FROM users WHERE email=?', email)) bad('Bu e-posta ile kayıtlı bir hesap var. Giriş yapmayı deneyin.', 409);
    const userId = tx(() => {
      const sid = run('INSERT INTO salons(name) VALUES(?)', salon).lastInsertRowid;
      const uid = run('INSERT INTO users(salon_id,name,email,pass) VALUES(?,?,?,?)', sid, name, email, hashPassword(b.password)).lastInsertRowid;
      run('INSERT INTO staff(salon_id,name,color) VALUES(?,?,1)', sid, name.split(' ')[0]);
      for (const s of DEFAULT_SERVICES) run('INSERT INTO services(salon_id,name,minutes,price) VALUES(?,?,?,?)', sid, ...s);
      return uid;
    });
    startSession(req, res, userId);
    return { ok: true };
  }, true);

  route('POST', /^\/api\/login$/, ({ req, res, b }) => {
    throttle(req);
    const u = get('SELECT id,pass FROM users WHERE email=?', String(b.email || '').trim().toLowerCase());
    if (!u || typeof b.password !== 'string' || !checkPassword(b.password, u.pass)) bad('E-posta ya da şifre hatalı.', 401);
    startSession(req, res, u.id);
    return { ok: true };
  }, true);

  route('POST', /^\/api\/logout$/, ({ req, res }) => {
    const t = sessionToken(req); if (t) run('DELETE FROM sessions WHERE token=?', sha(t));
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    return { ok: true };
  }, true);

  route('GET', /^\/api\/state$/, ({ u, url }) => {
    const s = u.salon_id, from = day(url.searchParams.get('from')), today = day(url.searchParams.get('today'));
    const range = [from, addDays(from, 6), today, addDays(today, 6)];
    const next = new Map();
    for (const a of all(`SELECT customer_id,date,start,service_id FROM appointments WHERE salon_id=? AND status='bekliyor' AND date>=?
      ORDER BY date,start`, s, today)) if (!next.has(a.customer_id)) next.set(a.customer_id, a);
    return {
      salon: get('SELECT name,open_min,close_min FROM salons WHERE id=?', s),
      user: { name: u.name, email: u.email },
      staff: all('SELECT id,name,commission,color,active FROM staff WHERE salon_id=? ORDER BY id', s),
      services: all('SELECT id,name,minutes,price,active FROM services WHERE salon_id=? ORDER BY id', s),
      products: all('SELECT id,name,stock,price,active FROM products WHERE salon_id=? ORDER BY id', s),
      customers: all(`SELECT c.id,c.name,c.phone,c.note,c.points,c.pkg_service_id,c.pkg_total,c.pkg_remaining,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN appointments a ON a.id=p.appointment_id
          WHERE p.method='veresiye' AND a.customer_id=c.id) AS debt
        FROM customers c WHERE c.salon_id=? ORDER BY c.name COLLATE NOCASE`, s).map(c => ({ ...c, next: next.get(c.id) || null })),
      appointments: all(`SELECT id,date,start,minutes,price,service_id,staff_id,customer_id,status FROM appointments
        WHERE salon_id=? AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?) ORDER BY date,start`, s, ...range),
      payments: all(`SELECT p.id,p.date,p.appointment_id,p.label,p.method,p.amount,a.staff_id,c.name AS customer_name,
        sv.name AS service_name,st.name AS staff_name
        FROM payments p LEFT JOIN appointments a ON a.id=p.appointment_id
        LEFT JOIN customers c ON c.id=COALESCE(a.customer_id,p.customer_id)
        LEFT JOIN services sv ON sv.id=a.service_id LEFT JOIN staff st ON st.id=a.staff_id
        WHERE p.salon_id=? AND (p.method='veresiye' OR p.date BETWEEN ? AND ? OR p.date BETWEEN ? AND ?) ORDER BY p.id`, s, ...range),
      expenses: all(`SELECT id,date,name,amount FROM expenses WHERE salon_id=? AND (date BETWEEN ? AND ? OR date BETWEEN ? AND ?)
        ORDER BY id`, s, ...range),
    };
  });

  route('POST', /^\/api\/salon$/, ({ u, b }) => {
    const name = text(b.name, 'Salon adı'), open = int(b.open_min, 'Açılış saati', 0, 1380), close = int(b.close_min, 'Kapanış saati', 60, 1440);
    if (open % 30 || close % 30) bad('Açılış ve kapanış saatleri yarım saatlik dilimlerde olmalı.');
    if (close - open < 60) bad('Kapanış saati açılıştan en az 1 saat sonra olmalı.');
    run('UPDATE salons SET name=?,open_min=?,close_min=? WHERE id=?', name, open, close, u.salon_id);
    return { ok: true };
  });

  route('POST', /^\/api\/(staff|services|products)(?:\/(\d+))?$/, ({ u, b, m }) => {
    const table = m[1], spec = CATALOG[table], id = m[2] && Number(m[2]);
    if (id && Object.keys(b).length === 1 && 'active' in b) { // kaldır / geri al
      own(table, id, u.salon_id, 'Kayıt');
      run(`UPDATE ${table} SET active=? WHERE id=?`, b.active ? 1 : 0, id);
      return { ok: true };
    }
    const cols = ['name', ...Object.keys(spec.ints)];
    const vals = [text(b.name, spec.label, 60), ...Object.entries(spec.ints).map(([k, [label, min, max]]) => int(b[k], label, min, max))];
    if (id) {
      own(table, id, u.salon_id, 'Kayıt');
      run(`UPDATE ${table} SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`, ...vals, id);
      return { ok: true };
    }
    if (table === 'staff') { cols.push('color'); vals.push(get('SELECT COUNT(*) n FROM staff WHERE salon_id=?', u.salon_id).n % 6 + 1); }
    const r = run(`INSERT INTO ${table}(salon_id,${cols.join(',')}) VALUES(?,${cols.map(() => '?').join(',')})`, u.salon_id, ...vals);
    return { id: Number(r.lastInsertRowid) };
  });

  route('POST', /^\/api\/appointments$/, ({ u, b }) => {
    const s = u.salon_id, date = day(b.date);
    const service = own('services', int(b.service_id, 'Hizmet', 1, 1e12), s, 'Hizmet');
    const staff = own('staff', int(b.staff_id, 'Personel', 1, 1e12), s, 'Personel');
    if (!service.active || !staff.active) bad('Seçilen hizmet ya da personel artık kullanılmıyor.');
    const salon = get('SELECT open_min,close_min FROM salons WHERE id=?', s);
    const start = int(b.start, 'Saat', salon.open_min, salon.close_min - 15);
    if (start + service.minutes > salon.close_min)
      bad(`${service.name} ${service.minutes} dakika sürüyor ve kapanış saati ${clock(salon.close_min)}'i aşıyor. Daha erken bir saat seçin.`);
    return tx(() => {
      const clash = get(`SELECT a.start,a.minutes,c.name FROM appointments a JOIN customers c ON c.id=a.customer_id
        WHERE a.salon_id=? AND a.date=? AND a.staff_id=? AND a.status!='gelmedi' AND a.start<? AND a.start+a.minutes>?`,
        s, date, staff.id, start + service.minutes, start);
      if (clash) bad(`${staff.name} ${clock(clash.start)}–${clock(clash.start + clash.minutes)} arasında dolu (${clash.name}). Başka saat ya da personel seçin.`, 409);
      let customerId;
      if (b.customer_id) customerId = own('customers', int(b.customer_id, 'Müşteri', 1, 1e12), s, 'Müşteri').id;
      else {
        const name = text(b.customer_name, 'Müşteri adı'), phone = text(b.phone, 'Telefon', 30, false);
        const found = get('SELECT id FROM customers WHERE salon_id=? AND name=?', s, name);
        customerId = found ? found.id : run('INSERT INTO customers(salon_id,name,phone) VALUES(?,?,?)', s, name, phone).lastInsertRowid;
      }
      const r = run(`INSERT INTO appointments(salon_id,date,start,minutes,price,service_id,staff_id,customer_id) VALUES(?,?,?,?,?,?,?,?)`,
        s, date, start, service.minutes, service.price, service.id, staff.id, customerId);
      return { id: Number(r.lastInsertRowid) };
    });
  });

  route('POST', /^\/api\/appointments\/(\d+)\/status$/, ({ u, b, m }) => {
    const a = own('appointments', Number(m[1]), u.salon_id, 'Randevu');
    if (!['bekliyor', 'geldi', 'gelmedi'].includes(b.status)) bad('Durum geçersiz.');
    if (a.status === 'odendi' || a.status === 'veresiye') bad('Ödemesi işlenmiş randevunun durumu değiştirilemez.');
    run('UPDATE appointments SET status=? WHERE id=?', b.status, a.id);
    return { ok: true };
  });

  route('DELETE', /^\/api\/appointments\/(\d+)$/, ({ u, m }) => {
    const a = own('appointments', Number(m[1]), u.salon_id, 'Randevu');
    if (a.status === 'odendi' || a.status === 'veresiye') bad('Ödemesi işlenmiş randevu silinemez.');
    run('DELETE FROM appointments WHERE id=?', a.id);
    return { ok: true };
  });

  route('POST', /^\/api\/appointments\/(\d+)\/pay$/, ({ u, b, m }) => tx(() => {
    const a = own('appointments', Number(m[1]), u.salon_id, 'Randevu'), date = day(b.today), method = b.method;
    if (a.status === 'odendi' || a.status === 'veresiye') bad('Bu randevunun ödemesi zaten işlenmiş.', 409);
    if (!['nakit', 'kart', 'veresiye', 'paket'].includes(method)) bad('Ödeme yöntemi geçersiz.');
    if (method === 'paket') {
      const c = get('SELECT pkg_service_id,pkg_remaining FROM customers WHERE id=?', a.customer_id);
      if (c.pkg_service_id !== a.service_id || c.pkg_remaining < 1) bad('Müşterinin bu hizmet için kullanılabilir paket seansı yok.');
      run('UPDATE customers SET pkg_remaining=pkg_remaining-1 WHERE id=?', a.customer_id);
    }
    const amount = method === 'paket' ? 0 : a.price;
    run('INSERT INTO payments(salon_id,date,appointment_id,method,amount) VALUES(?,?,?,?,?)', u.salon_id, date, a.id, method, amount);
    run('UPDATE appointments SET status=? WHERE id=?', method === 'veresiye' ? 'veresiye' : 'odendi', a.id);
    if (method === 'nakit' || method === 'kart') addPoints(a.customer_id, amount);
    return { ok: true };
  }));

  route('POST', /^\/api\/payments\/(\d+)\/collect$/, ({ u, b, m }) => tx(() => {
    const p = own('payments', Number(m[1]), u.salon_id, 'Borç kaydı'), date = day(b.today), method = cashMethod(b.method);
    if (p.method !== 'veresiye') bad('Bu kayıt zaten tahsil edilmiş.', 409);
    run('UPDATE payments SET method=?,date=? WHERE id=?', method, date, p.id);
    const a = get('SELECT id,customer_id FROM appointments WHERE id=?', p.appointment_id);
    run("UPDATE appointments SET status='odendi' WHERE id=?", a.id);
    addPoints(a.customer_id, p.amount);
    return { ok: true };
  }));

  route('POST', /^\/api\/products\/(\d+)\/sell$/, ({ u, b, m }) => tx(() => {
    const p = own('products', Number(m[1]), u.salon_id, 'Ürün'), date = day(b.today), method = cashMethod(b.method);
    if (p.stock < 1) bad(`${p.name} stokta kalmadı.`, 409);
    run('UPDATE products SET stock=stock-1 WHERE id=?', p.id);
    run('INSERT INTO payments(salon_id,date,label,method,amount) VALUES(?,?,?,?,?)', u.salon_id, date, p.name, method, p.price);
    return { ok: true };
  }));

  route('POST', /^\/api\/expenses$/, ({ u, b }) => {
    run('INSERT INTO expenses(salon_id,date,name,amount) VALUES(?,?,?,?)', u.salon_id, day(b.date), text(b.name, 'Gider adı'), int(b.amount, 'Tutar', 1, 10000000));
    return { ok: true };
  });
  route('DELETE', /^\/api\/expenses\/(\d+)$/, ({ u, m }) => {
    run('DELETE FROM expenses WHERE id=?', own('expenses', Number(m[1]), u.salon_id, 'Gider').id);
    return { ok: true };
  });

  route('POST', /^\/api\/customers\/(\d+)$/, ({ u, b, m }) => {
    const c = own('customers', Number(m[1]), u.salon_id, 'Müşteri');
    run('UPDATE customers SET name=?,phone=?,note=? WHERE id=?', text(b.name, 'Müşteri adı'), text(b.phone, 'Telefon', 30, false), text(b.note, 'Not', 500, false), c.id);
    return { ok: true };
  });

  route('POST', /^\/api\/customers\/(\d+)\/package$/, ({ u, b, m }) => tx(() => {
    const c = own('customers', Number(m[1]), u.salon_id, 'Müşteri');
    const service = own('services', int(b.service_id, 'Hizmet', 1, 1e12), u.salon_id, 'Hizmet');
    const total = int(b.total, 'Seans sayısı', 1, 100), price = int(b.price, 'Paket fiyatı', 0, 10000000);
    const date = day(b.today), method = cashMethod(b.method);
    // Aynı hizmetin paketi sürüyorsa seanslar üstüne eklenir; farklı hizmetse yeni paket eskisinin yerini alır.
    if (c.pkg_service_id === service.id && c.pkg_remaining > 0)
      run('UPDATE customers SET pkg_total=pkg_total+?,pkg_remaining=pkg_remaining+? WHERE id=?', total, total, c.id);
    else run('UPDATE customers SET pkg_service_id=?,pkg_total=?,pkg_remaining=? WHERE id=?', service.id, total, total, c.id);
    run('INSERT INTO payments(salon_id,date,customer_id,label,method,amount) VALUES(?,?,?,?,?,?)', u.salon_id, date, c.id,
      `${service.name} paketi (${total} seans)`, method, price);
    addPoints(c.id, price);
    return { ok: true };
  }));

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > 100000) { reject(new HttpError(413, 'Gönderilen veri çok büyük.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); }
        catch { reject(new HttpError(400, 'Gönderilen veri okunamadı.')); }
      });
      req.on('error', reject);
    });
  }
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  function serveStatic(url, res) {
    let rel; try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
    if (rel === '/') rel = '/index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sayfa bulunamadı.'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'");
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/healthz') return json(res, 200, { ok: true });
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') bad('Bu adres yalnızca görüntülenebilir.', 405);
        return serveStatic(url, res);
      }
      for (const r of routes) {
        const m = r.method === req.method && r.pattern.exec(url.pathname);
        if (!m) continue;
        const u = r.open ? null : currentUser(req);
        if (!r.open && !u) bad('Oturum süresi doldu. Tekrar giriş yapın.', 401);
        // Veri değiştiren isteklerde JSON şartı, başka sitelerden form ile istek gönderilmesini engeller.
        if (req.method !== 'GET' && !/^application\/json/.test(req.headers['content-type'] || '')) bad('İstek biçimi geçersiz.', 415);
        const b = req.method === 'GET' ? {} : await readBody(req);
        return json(res, 200, await r.handler({ req, res, u, b, m, url }));
      }
      bad('Adres bulunamadı.', 404);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error(e);
      json(res, 500, { error: 'Sunucuda beklenmeyen bir hata oluştu. Tekrar deneyin.' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

module.exports = { createApp };

if (require.main === module) {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const port = Number(process.env.PORT) || 3000;
  createApp(path.join(dir, 'mamaaura.db')).listen(port, () => console.log(`Mamaaura çalışıyor: http://localhost:${port}`));
}
