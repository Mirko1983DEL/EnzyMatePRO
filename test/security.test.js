import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { openDb } from '../db.js';
import { createApp, CSP } from '../server.js';

const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections?.(); s.close(); }));
async function boot(opts = {}) {
  const db = openDb(':memory:', randomBytes(32)), wrapped = opts.wrap ? opts.wrap(db) : db;
  const srv = createServer(createApp({ db: wrapped, ...opts.app })); servers.push(srv); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const raw = (p, init) => fetch(base + p, init);
  const call = async (p, m = 'GET', b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; };
  return { db, call, raw };
}
const meal = (extra = {}) => ({ items: [{ name: 'Käse', grams: 100, per100: { fat: 30 } }], capsules: 1, capsuleSize: 25000, ...extra });

test('Faktor kommt aus dem Profil; ein anderer Faktor in der Anfrage wird ignoriert', async () => {
  const { call } = await boot();
  await call('/api/patient', 'PUT', { name: 'M', lipasePerGramFat: 2000 });
  const r = await call('/api/meals', 'POST', meal({ lipasePerGramFat: 99999 }));
  assert.equal(r.s, 200); assert.equal(r.j.lipasePerGramFat, 2000); assert.equal(r.j.recommendedUnits, 60000);
});

test('Ohne Faktor im Profil wird nichts gespeichert', async () => {
  const { call } = await boot();
  const r = await call('/api/meals', 'POST', meal({ lipasePerGramFat: 2000 }));
  assert.equal(r.s, 400); assert.match(r.j.error, /Faktor/);
  const now = Date.now(); assert.equal((await call(`/api/meals?from=${new Date(now - 864e5).toISOString()}&to=${new Date(now + 864e5).toISOString()}`)).j.length, 0);
});

test('Stand-Prüfung: geändertes Profil → 409, nichts gespeichert; passender Stand → ok', async () => {
  const { call } = await boot();
  await call('/api/patient', 'PUT', { name: 'M', lipasePerGramFat: 2000 });
  await call('/api/patient', 'PUT', { name: 'M', lipasePerGramFat: 3000 });      // z. B. von einem anderen Gerät
  const stale = await call('/api/meals', 'POST', meal({ basedOnFactor: 2000 }));
  assert.equal(stale.s, 409); assert.match(stale.j.error, /Profil wurde inzwischen geändert/);
  assert.equal((await call('/api/meals', 'POST', meal({ basedOnFactor: 3000 }))).s, 200);
});

test('Kapselgröße nur aus der Liste; Zeitpunkt nur im zulässigen Bereich', async () => {
  const { call } = await boot();
  await call('/api/patient', 'PUT', { name: 'M', lipasePerGramFat: 2000 });
  assert.equal((await call('/api/meals', 'POST', meal({ capsuleSize: 12345 }))).s, 400);
  assert.equal((await call('/api/meals', 'POST', meal({ ts: '2019-12-31T23:00:00Z' }))).s, 400);
  assert.equal((await call('/api/meals', 'POST', meal({ ts: new Date(Date.now() + 3600e3).toISOString() }))).s, 400);
  assert.equal((await call('/api/meals', 'POST', meal({ ts: new Date(Date.now() + 60e3).toISOString() }))).s, 200);   // Uhrenabweichung toleriert
  assert.equal((await call('/api/meals', 'POST', meal({ ts: '2025-03-01T08:00:00Z' }))).s, 200);                       // Nachtragen
  assert.equal((await call('/api/meals', 'POST', meal({ ts: 'kein-datum' }))).s, 400);
});

test('Unbekannter Nutzer: sauberer Fehler statt Absturz', async () => {
  const { call } = await boot({ wrap: (db) => ({ ...db, getPatient: () => null }) });
  assert.equal((await call('/api/state')).s, 404);
  assert.equal((await call('/api/meals', 'POST', meal())).s, 404);
});

test('Sicherheits-Header: strenge CSP, keine Einbettung, Kamera nur für die App', async () => {
  const { raw } = await boot();
  const r = await raw('/');
  assert.equal(r.headers.get('content-security-policy'), CSP);
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"]) assert.ok(CSP.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval(?!')/.test(CSP.replace("'wasm-unsafe-eval'", '')), 'kein unsafe-inline/unsafe-eval');
  assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('permissions-policy'), /camera=\(self\)/); assert.match(r.headers.get('permissions-policy'), /microphone=\(\)/);
});

test('Statische Dateien: nur GET/HEAD, kein Ausbruch aus dem Ordner', async () => {
  const { raw } = await boot();
  assert.equal((await raw('/', { method: 'POST' })).status, 405);
  assert.equal((await raw('/index.html', { method: 'DELETE' })).status, 405);
  for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/..\\server.js', '/./../db.js', '//etc/passwd', '/vendor/']) {
    const r = await raw(p, { redirect: 'manual' }); const t = await r.text();
    assert.ok(r.status !== 200 || !/createApp|DatabaseSync/.test(t), `${p} → ${r.status}`);
    assert.ok(!/createApp|DatabaseSync|Keyring/.test(t), `${p} gibt Quellcode preis`);
  }
  assert.equal((await raw('/app.js')).status, 200);
});
