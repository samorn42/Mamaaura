'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

const TODAY = '2026-11-10';
let server, base;

test.before(async () => {
  server = createApp(':memory:');
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => new Promise(r => server.close(r)));

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), cookie },
      body: method !== 'GET' ? JSON.stringify(body || {}) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
  return { call, state: async () => (await call('GET', `/api/state?from=${TODAY}&today=${TODAY}`)).body };
}
async function signup(n) {
  const c = client();
  const r = await c.call('POST', '/api/signup', { salon: 'Salon ' + n, name: 'Sahip ' + n, email: `s${n}@ornek.com`, password: 'gizli-sifre-' + n });
  assert.equal(r.status, 200);
  return c;
}

test('oturum açmadan veri okunamaz', async () => {
  assert.equal((await client().call('GET', `/api/state?from=${TODAY}&today=${TODAY}`)).status, 401);
});

test('kayıt, hazır hizmetler ve giriş', async () => {
  const c = await signup(1), s = await c.state();
  assert.equal(s.salon.name, 'Salon 1');
  assert.equal(s.services.length, 7);
  assert.equal(s.staff.length, 1);
  const again = client();
  assert.equal((await again.call('POST', '/api/login', { email: 's1@ornek.com', password: 'yanlis-sifre' })).status, 401);
  assert.equal((await again.call('POST', '/api/login', { email: 'S1@ornek.com', password: 'gizli-sifre-1' })).status, 200);
  assert.equal((await again.state()).salon.name, 'Salon 1');
  assert.equal((await client().call('POST', '/api/signup', { salon: 'x', name: 'y', email: 's1@ornek.com', password: '12345678' })).status, 409);
});

test('randevu çakışması, ödeme, veresiye, paket ve prim verisi', async () => {
  const c = await signup(2); let s = await c.state();
  const staff = s.staff[0].id, kesim = s.services[0], lazer = s.services[5];
  const mk = (extra) => c.call('POST', '/api/appointments', { customer_name: 'Ayşe Yılmaz', phone: '0555', service_id: kesim.id, staff_id: staff, date: TODAY, start: 600, ...extra });
  const a1 = await mk(); assert.equal(a1.status, 200);
  const clash = await mk({ start: 630 }); assert.equal(clash.status, 409); assert.match(clash.body.error, /10:00–11:00 arasında dolu/);
  assert.equal((await mk({ start: 1170 })).status, 400); // kapanışı aşar
  const a2 = await mk({ start: 660 }); const a3 = await mk({ start: 720, service_id: lazer.id });
  s = await c.state();
  assert.equal(s.customers.length, 1, 'aynı isim tek müşteri kaydı olur');
  const cust = s.customers[0].id;

  assert.equal((await c.call('POST', `/api/appointments/${a1.body.id}/pay`, { method: 'kart', today: TODAY })).status, 200);
  assert.equal((await c.call('POST', `/api/appointments/${a1.body.id}/pay`, { method: 'kart', today: TODAY })).status, 409);
  assert.equal((await c.call('DELETE', `/api/appointments/${a1.body.id}`)).status, 400);
  assert.equal((await c.call('POST', `/api/appointments/${a2.body.id}/pay`, { method: 'veresiye', today: TODAY })).status, 200);
  s = await c.state();
  assert.equal(s.customers[0].debt, 600); assert.equal(s.customers[0].points, 6);
  const debt = s.payments.find(p => p.method === 'veresiye');
  assert.equal((await c.call('POST', `/api/payments/${debt.id}/collect`, { method: 'nakit', today: TODAY })).status, 200);

  assert.equal((await c.call('POST', `/api/appointments/${a3.body.id}/pay`, { method: 'paket', today: TODAY })).status, 400);
  assert.equal((await c.call('POST', `/api/customers/${cust}/package`, { service_id: lazer.id, total: 8, price: 6000, method: 'kart', today: TODAY })).status, 200);
  assert.equal((await c.call('POST', `/api/appointments/${a3.body.id}/pay`, { method: 'paket', today: TODAY })).status, 200);
  s = await c.state();
  assert.equal(s.customers[0].debt, 0); assert.equal(s.customers[0].pkg_remaining, 7); assert.equal(s.customers[0].points, 72);
  assert.equal(s.payments.filter(p => p.method !== 'paket').reduce((t, p) => t + p.amount, 0), 7200);
  assert.ok(s.appointments.every(a => a.status === 'odendi'));
});

test('ürün satışı stoğu düşürür, stok bitince satılmaz', async () => {
  const c = await signup(3);
  const p = await c.call('POST', '/api/products', { name: 'Şampuan', stock: 1, price: 450 });
  assert.equal((await c.call('POST', `/api/products/${p.body.id}/sell`, { method: 'nakit', today: TODAY })).status, 200);
  assert.equal((await c.call('POST', `/api/products/${p.body.id}/sell`, { method: 'nakit', today: TODAY })).status, 409);
  const s = await c.state();
  assert.equal(s.products[0].stock, 0); assert.equal(s.payments[0].label, 'Şampuan');
});

test('bir salon başka salonun verisine ulaşamaz', async () => {
  const a = await signup(4), b = await signup(5);
  const sa = await a.state(), sb = await b.state();
  const appt = await a.call('POST', '/api/appointments', { customer_name: 'Gizli Müşteri', service_id: sa.services[0].id, staff_id: sa.staff[0].id, date: TODAY, start: 600 });
  assert.equal((await b.state()).customers.length, 0);
  assert.equal((await b.call('POST', `/api/appointments/${appt.body.id}/status`, { status: 'geldi' })).status, 404);
  assert.equal((await b.call('DELETE', `/api/appointments/${appt.body.id}`)).status, 404);
  assert.equal((await b.call('POST', `/api/staff/${sa.staff[0].id}`, { name: 'Ele geçirildi', commission: 99 })).status, 404);
  assert.equal((await b.call('POST', '/api/appointments', { customer_name: 'x', service_id: sa.services[0].id, staff_id: sb.staff[0].id, date: TODAY, start: 600 })).status, 404);
  assert.equal((await a.state()).staff[0].name, 'Sahip');
});

test('geçersiz girişler reddedilir', async () => {
  const c = await signup(6);
  assert.equal((await c.call('POST', '/api/expenses', { date: 'dün', name: 'Kira', amount: 100 })).status, 400);
  assert.equal((await c.call('POST', '/api/expenses', { date: TODAY, name: 'Kira', amount: -5 })).status, 400);
  assert.equal((await c.call('POST', '/api/services', { name: '', minutes: 30, price: 10 })).status, 400);
  assert.equal((await c.call('POST', '/api/salon', { name: 'Yeni Ad', open_min: 600, close_min: 600 })).status, 400);
  assert.equal((await c.call('POST', '/api/logout')).status, 200);
  assert.equal((await c.call('GET', `/api/state?from=${TODAY}&today=${TODAY}`)).status, 401);
});
