// Tests zum Paket „Fehler, die die Dosis verfälschen können“ (Audit 16.10.2026):
// Plausibilitätsprüfung statt stiller Nullwerte, exakte Fettsumme in der Dosis, ehrliche Anzeige, Serverfehler, Log.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { openDb } from '../db.js';
import { createApp } from '../server.js';
import { estimateWithGemini } from '../analyze.js';
import { plausibilityIssues, normalizeEstimate } from '../public/estimate.js';
import { fatExact, truncated, dose, totals } from '../public/calc.js';

const servers = [];
after(() => servers.forEach((s) => { s.closeAllConnections?.(); s.close(); }));
async function boot(opts = {}) {
  const db = openDb(':memory:', randomBytes(32)), srv = createServer(createApp({ db, ...opts }));
  servers.push(srv); await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const call = async (p, m = 'GET', b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; };
  await call('/api/patient', 'PUT', { name: 'T', lipasePerGramFat: 2000 });
  return { call, port };
}
const est = (i) => normalizeEstimate({ items: [i] })[0];

test('KI-Antwort: fehlender oder unlesbarer Fettwert wird markiert, nie stillschweigend akzeptiert', () => {
  for (const fatPer100 of [undefined, null, '', 'hoch', 'n/a', NaN]) {
    const r = est({ name: 'Soße', grams: 100, fatPer100, kcalPer100: 200, carbsPer100: 4, proteinPer100: 2 });
    assert.ok(r.issues.includes('fat_missing'), String(fatPer100)); assert.equal(r.needsReview, true); assert.equal(r.per100.fat, 0);
  }
  assert.ok(est({ name: 'x', fatPer100: 5, kcalPer100: 60, carbsPer100: 2, proteinPer100: 3 }).issues.includes('grams_missing'));
  assert.deepEqual(est({ name: 'x', grams: 'viel', fatPer100: 5, kcalPer100: 60, carbsPer100: 2, proteinPer100: 3 }).issues, ['grams_missing']);
});

test('KI-Antwort: unmögliche Summen und widersprüchliche Kalorien werden erkannt, stimmige Werte nicht beanstandet', () => {
  const clean = est({ name: 'Spaghetti', grams: 250, fatPer100: 1.5, kcalPer100: 150, carbsPer100: 30, proteinPer100: 5 });
  assert.deepEqual(clean.issues, []); assert.equal(clean.needsReview, false);
  const sum = est({ name: 'Wunder', grams: 300, fatPer100: 40, kcalPer100: 120, carbsPer100: 60, proteinPer100: 30 });
  assert.ok(sum.issues.includes('sum_over_100')); assert.ok(sum.issues.includes('kcal_mismatch'));
  // zu niedriges Fett fällt über die Kalorien auf: Sahnesoße mit 3 g Fett, aber 200 kcal
  assert.ok(est({ name: 'Sahnesoße', grams: 100, fatPer100: 3, kcalPer100: 200, carbsPer100: 4, proteinPer100: 2 }).issues.includes('kcal_mismatch'));
  const out = est({ name: 'x', grams: 100, fatPer100: 150, kcalPer100: 50, carbsPer100: 0, proteinPer100: 0 });
  assert.ok(out.issues.includes('clamped')); assert.equal(out.per100.fat, 100);
  assert.deepEqual(normalizeEstimate(null), []); assert.deepEqual(normalizeEstimate({}), []);
});

test('Plausibilität: Schwellen an den Grenzen (Summe 101 g, Kalorienabweichung 60 kcal und 35 %)', () => {
  const p = (fat, kcal, carbs = 0, protein = 0) => plausibilityIssues({ fat, kcal, carbs, protein });
  assert.deepEqual(p(50, 0, 30, 21), []);                              // Summe 101 noch toleriert
  assert.deepEqual(p(50, 0, 30, 21.5), ['sum_over_100']);              // 101,5
  assert.deepEqual(p(10, 125), []);                                    // Rechenwert 90, Abweichung 35 < 60
  assert.deepEqual(p(33.3, 400), []);                                  // Rechenwert ≈ 300, 33 % < 35 %
  assert.deepEqual(p(33.3, 420), ['kcal_mismatch']);                   // Abweichung ≈ 120 kcal, 40 %
  assert.deepEqual(p(0, 500), []);                                     // kein Rechenwert (alles 0): keine Aussage
  assert.deepEqual(plausibilityIssues({ fat: 5 }, { fatKnown: false }).slice(0, 1), ['fat_missing']);
});

test('Dosis nutzt die exakte Fettsumme (keine vorzeitige Rundung auf 0,1 g)', async () => {
  const items = [{ name: 'x', grams: 333, per100: { fat: 7.5 } }];
  assert.equal(fatExact(items), 24.975); assert.equal(totals(items).fat, 25);           // Anzeigewert gerundet, Rechenwert exakt
  assert.equal(dose({ fatGrams: fatExact(items), lipasePerGramFat: 2000, capsuleSize: 25000 }).units, 49950);
  const { call } = await boot();
  const m = (await call('/api/meals', 'POST', { items, capsules: 2, capsuleSize: 25000 })).j;
  assert.equal(m.recommendedUnits, 49950); assert.equal(m.totals.fat, 25); assert.equal(m.fatExact, 24.975);
  // Rundungsregeln selbst sind unverändert: halbe Kapsel → auf, mindestens 1 bei Fett > 0
  assert.equal(dose({ fatGrams: 6.25, lipasePerGramFat: 2000, capsuleSize: 25000 }).capsules, 1);
  assert.equal(dose({ fatGrams: 31.25, lipasePerGramFat: 2000, capsuleSize: 25000 }).capsules, 3);
  assert.equal(dose({ fatGrams: 0.04, lipasePerGramFat: 2000, capsuleSize: 25000 }).capsules, 1);
  assert.equal(dose({ fatGrams: 0, lipasePerGramFat: 2000, capsuleSize: 25000 }).capsules, 0);
});

test('Anzeige widerspricht der Empfehlung nie: abgeschnittene Anzeige rundet zur gleichen Kapselzahl', () => {
  assert.equal(truncated(1.496, 2), 1.49); assert.equal(truncated(1.5, 2), 1.5); assert.equal(truncated(2, 2), 2); assert.equal(truncated(0.29, 2), 0.29);
  let bad = 0;
  for (let units = 0; units <= 250000; units++) { const exact = units / 25000; if (Math.round(truncated(exact, 2)) !== Math.round(exact)) bad++; }
  assert.equal(bad, 0, `${bad} Einheitenwerte mit widersprüchlicher Anzeige`);
});

test('Mehr als 50 Kapseln: verständliche Meldung statt „ungültig“', async () => {
  const { call } = await boot();
  const r = await call('/api/meals', 'POST', { items: [{ name: 'x', grams: 100, per100: { fat: 10 } }], capsules: 6000, capsuleSize: 25000 });
  assert.equal(r.s, 400); assert.match(r.j.error, /erlaubt sind 0 bis 50/);
});

test('Ungültiger Pfad lässt die Verbindung nicht mehr hängen; Server bleibt erreichbar', async () => {
  const { call, port } = await boot();
  const raw = (txt) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); let d = ''; const t0 = Date.now(); s.on('data', (x) => (d += x)); s.on('close', () => res({ line: d.split('\r\n')[0], ms: Date.now() - t0 })); s.on('error', () => res({ line: 'Fehler', ms: Date.now() - t0 })); s.write(txt); setTimeout(() => { s.destroy(); res({ line: d.split('\r\n')[0] || 'HÄNGT', ms: Date.now() - t0 }); }, 2500); });
  for (const path of ['//[', '//%', '/api/%ZZ', '//a b']) {
    const r = await raw(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(r.line, /HTTP\/1\.1 (400|404)/, `${path} → ${r.line}`); assert.ok(r.ms < 2000, `${path} dauerte ${r.ms} ms`);
  }
  assert.equal((await call('/api/state')).s, 200);
});

test('Gemini-Fehler: Protokoll ohne API-Schlüssel und gekürzt', async () => {
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.map(String).join(' '));
  try {
    const fetchImpl = async () => ({ status: 500, ok: false, text: async () => `Fehler SCHLUESSEL-123 ${'x'.repeat(500)}`, json: async () => ({}) });
    const r = await estimateWithGemini({ base64: 'AAAA', mime: 'image/jpeg' }, { apiKey: 'SCHLUESSEL-123', model: 'm', fetchImpl });
    assert.equal(r.status, 502);
  } finally { console.error = orig; }
  assert.equal(logs.length, 1); assert.ok(!logs[0].includes('SCHLUESSEL-123'), 'Schlüssel im Log'); assert.ok(logs[0].length < 220, `Log zu lang: ${logs[0].length}`);
});
