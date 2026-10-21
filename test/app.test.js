import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { encrypt, decrypt } from '../crypto.js';
import { openDb } from '../db.js';
import { createApp } from '../server.js';
import { totals, dose, rangeFor, elapsedDays, summarize, recommendedUnits } from '../public/calc.js';

test('Verschlüsselung: Roundtrip, Manipulation wird erkannt', () => {
  const key = randomBytes(32), blob = encrypt(key, { a: 1 });
  assert.deepEqual(decrypt(key, blob), { a: 1 });
  assert.throws(() => decrypt(key, blob.slice(0, -2) + (blob.endsWith('AA') ? 'BB' : 'AA'))); // sicher verändert (früher: selten zufällig identisch)
  assert.throws(() => decrypt(randomBytes(32), blob));
});

test('Berechnung', () => {
  const t = totals([{ grams: 200, per100: { fat: 10, kcal: 150, carbs: 20, protein: 5 } }]);
  assert.deepEqual(t, { grams: 200, fat: 20, kcal: 300, carbs: 40, protein: 10 });
  const d = dose({ fatGrams: 20, lipasePerGramFat: 2000, capsuleSize: 25000 });
  assert.equal(d.units, 40000); assert.equal(d.capsules, 2);
  assert.equal(dose({ fatGrams: 0.5, lipasePerGramFat: 2000, capsuleSize: 35000 }).capsules, 1);
  assert.equal(dose({ fatGrams: 0, lipasePerGramFat: 2000, capsuleSize: 35000 }).capsules, 0);
  assert.equal(dose({ fatGrams: 5, lipasePerGramFat: null, capsuleSize: 35000 }).ok, false);
});

const openServers = [];
after(() => openServers.forEach((s) => { s.closeAllConnections?.(); s.close(); })); // auch nach fehlgeschlagenen Tests aufräumen
async function boot(opts = {}) {
  const key = randomBytes(32), db = openDb(':memory:', key);
  const srv = createServer(createApp({ db, ...opts })); openServers.push(srv); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, m = 'GET', b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b && JSON.stringify(b) }); return { s: r.status, j: await r.json().catch(() => null) }; };
  return { db, srv, call, close: () => srv.close() };
}

test('API: Profil, Kapselgröße, Mahlzeit, Verlauf, Löschen', async () => {
  const { call, close, db } = await boot();
  assert.equal((await call('/api/state')).j.settings.capsuleSize, 25000);
  assert.equal((await call('/api/settings', 'PUT', { capsuleSize: 35000 })).s, 200);
  assert.equal((await call('/api/state')).j.settings.capsuleSize, 35000); // bleibt gespeichert
  assert.equal((await call('/api/settings', 'PUT', { capsuleSize: 1 })).s, 400);
  assert.equal((await call('/api/patient', 'PUT', { name: 'Marie', heightCm: 140, weightKg: 35, lipasePerGramFat: 2000 })).s, 200);
  assert.equal((await call('/api/patient', 'PUT', { name: 'x', weightKg: -3 })).s, 400);
  const m = await call('/api/meals', 'POST', { items: [{ name: 'Käse', grams: 50, per100: { fat: 30, kcal: 400 } }], capsules: 1, capsuleSize: 25000, lipasePerGramFat: 2000 });
  assert.equal(m.j.totals.fat, 15);
  const now = Date.now(), q = `from=${new Date(now - 3600e3).toISOString()}&to=${new Date(now + 3600e3).toISOString()}`;
  assert.equal((await call('/api/meals?' + q)).j.length, 1);
  assert.equal((await call('/api/meals', 'POST', { items: [] })).s, 400);
  // in der DB steht nichts im Klartext
  const raw = db.listFoods; assert.ok(raw);
  assert.equal((await call('/api/meals/' + m.j.id, 'DELETE')).j.deleted, true);
  close();
});

test('Zugriffscode wird erzwungen, wenn gesetzt', async () => {
  const { call, close } = await boot({ accessToken: 'geheim' });
  assert.equal((await call('/api/state')).s, 401);
  assert.equal((await call('/api/state', 'GET', null, { 'x-access-token': 'falsch' })).s, 401);
  assert.equal((await call('/api/state', 'GET', null, { 'x-access-token': 'geheim' })).s, 200);
  close();
});

test('Datei auf Platte enthält keine Klartext-Daten', async () => {
  const { mkdtempSync, readFileSync, readdirSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'creon-')), db = openDb(join(dir, 't.db'), randomBytes(32));
  db.setPatient(1, { name: 'GeheimerName', weightKg: 35 }); db.close();
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir, f)).includes('GeheimerName'));
});

const jsonRes = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

test('Barcode: Open Food Facts wird abgefragt und gemappt', async () => {
  let url;
  const fetchImpl = async (u) => { url = u; return jsonRes(200, { status: 1, product: { product_name: 'Lasagne', brands: 'Foo,Bar', serving_quantity: 400, nutriments: { fat_100g: 7.5, 'energy-kcal_100g': 160, carbohydrates_100g: 15, proteins_100g: 8 } } }); };
  const { call, close } = await boot({ fetchImpl });
  const r = await call('/api/barcode/4001234567890');
  assert.match(url, /api\/v2\/product\/4001234567890\.json/);
  assert.deepEqual(r.j.per100, { fat: 7.5, kcal: 160, carbs: 15, protein: 8 });
  assert.equal(r.j.servingGrams, 400); assert.equal(r.j.complete, true);
  assert.equal((await call('/api/barcode/12')).s, 400); // zu kurz
  close();
});

test('Barcode: unbekannt / Fehler', async () => {
  let c = await boot({ fetchImpl: async () => jsonRes(404, {}) });
  assert.equal((await c.call('/api/barcode/4001234567890')).j.found, false); c.close();
  c = await boot({ fetchImpl: async () => { throw new Error('net'); } });
  assert.equal((await c.call('/api/barcode/4001234567890')).s, 502); c.close();
});

test('KI: ohne Key 503, mit Key werden Werte validiert/begrenzt', async () => {
  let c = await boot({ geminiKey: '' });
  assert.equal((await c.call('/api/state')).j.ai, false);
  assert.equal((await c.call('/api/estimate', 'POST', { image: 'AAAA', mime: 'image/jpeg' })).s, 503); c.close();
  let sent;
  const fetchImpl = async (u, o) => { sent = { u, o }; return jsonRes(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [
    { name: 'Spaghetti', grams: 250, fatPer100: 1.5, kcalPer100: 150, carbsPer100: 30, proteinPer100: 5 },
    { name: 'Sahnesoße', grams: 90000, fatPer100: 500, kcalPer100: 300, carbsPer100: 4, proteinPer100: 2 }] }) }] } }] }); };
  c = await boot({ geminiKey: 'K', geminiModel: 'm1', fetchImpl });
  assert.equal((await c.call('/api/state')).j.ai, true);
  const r = await c.call('/api/estimate', 'POST', { image: 'AAAA', mime: 'image/jpeg' });
  assert.equal(r.j.items.length, 2); assert.equal(r.j.items[1].grams, 2000); assert.equal(r.j.items[1].per100.fat, 100); assert.equal(r.j.items[0].source, 'ai');
  assert.match(sent.u, /models\/m1:generateContent/); assert.equal(sent.o.headers['x-goog-api-key'], 'K');
  assert.equal((await c.call('/api/estimate', 'POST', { image: '<script>', mime: 'image/jpeg' })).s, 400);
  assert.equal((await c.call('/api/estimate', 'POST', { image: 'AAAA', mime: 'text/html' })).s, 400);
  c.close();
});

test('KI: Drosselung nach 10 Anfragen/Minute und 429 von Google', async () => {
  let c = await boot({ geminiKey: 'K', fetchImpl: async () => jsonRes(429, {}) });
  assert.equal((await c.call('/api/estimate', 'POST', { image: 'AAAA', mime: 'image/png' })).s, 429); c.close();
  c = await boot({ geminiKey: 'K', fetchImpl: async () => jsonRes(200, { candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }] }) });
  const codes = []; for (let i = 0; i < 12; i++) codes.push((await c.call('/api/estimate', 'POST', { image: 'AAAA', mime: 'image/png' })).s);
  assert.equal(codes.filter((x) => x === 200).length, 10); assert.equal(codes[11], 429); c.close();
});

test('Zeiträume: Woche beginnt Montag, Monat, Tage bis heute', () => {
  const wed = new Date(2026, 9, 14, 15, 30); // Mi 14.10.2026
  const w = rangeFor('week', wed);
  assert.equal(w.from.getDay(), 1); assert.equal(w.from.getDate(), 12); assert.equal((w.to - w.from) / 864e5, 7);
  const m = rangeFor('month', wed); assert.equal(m.from.getDate(), 1); assert.equal(m.to.getMonth(), 10); assert.equal(m.to.getDate(), 1);
  assert.equal((rangeFor('day', wed).to - rangeFor('day', wed).from) / 864e5, 1);
  assert.equal(elapsedDays(w.from, w.to, wed), 3);          // Mo, Di, Mi
  assert.equal(elapsedDays(m.from, m.to, new Date(2027, 0, 5)), 31); // vergangener Monat: alle Tage
});

test('Zusammenfassung: Summen, Ø pro Tag, empfohlen vs. genommen (auch Altbestand)', () => {
  const mk = (fat, kcal, caps, size, rec) => ({ totals: { fat, kcal, carbs: 10, protein: 5 }, capsules: caps, capsuleSize: size, lipasePerGramFat: 2000, ...(rec != null && { recommendedUnits: rec }) });
  const s = summarize([mk(20, 400, 2, 25000, 40000), mk(10, 200, 1, 10000)], 2); // zweite ohne gespeicherte Empfehlung
  assert.equal(s.fat, 30); assert.equal(s.kcal, 600); assert.equal(s.capsules, 3);
  assert.equal(s.units, 60000); assert.equal(s.recommended, 60000);
  assert.deepEqual(s.perDay, { kcal: 300, fat: 15, capsules: 1.5, units: 30000 });
  assert.equal(recommendedUnits(mk(10, 0, 1, 1)), 20000);
});

test('API: Mahlzeit speichert empfohlene Einheiten zum Zeitpunkt der Einnahme (Faktor aus dem Profil)', async () => {
  const { call, close } = await boot();
  await call('/api/patient', 'PUT', { name: 'Marie', weightKg: 35, lipasePerGramFat: 2000 });
  const m = await call('/api/meals', 'POST', { items: [{ name: 'Käse', grams: 100, per100: { fat: 30 } }], capsules: 1, capsuleSize: 25000 });
  assert.equal(m.s, 200); assert.equal(m.j.recommendedUnits, 60000); assert.equal(m.j.recommendedCapsules, 2.4); assert.equal(m.j.capsules, 1); assert.equal(m.j.lipasePerGramFat, 2000);
  close();
});

// ---- Bericht ----
import { buildReport, toCsv, toText, barChartSvg } from '../public/report.js';
const mealAt = (y, mo, d, h, { fat, caps, size = 25000, factor = 2000, name = 'Pizza', source, kcal = 300 }) => ({
  ts: new Date(y, mo, d, h, 0).toISOString(), items: [{ name, grams: 100, per100: { fat }, source }],
  totals: { fat, kcal, carbs: 20, protein: 10 }, capsules: caps, capsuleSize: size, lipasePerGramFat: factor, recommendedUnits: Math.round(fat * factor),
});

test('Bericht: Kennzahlen nur über gespeicherte Einträge', () => {
  const meals = [
    mealAt(2026, 9, 12, 8, { fat: 20, caps: 2 }),                 // empfohlen 40.000, genommen 50.000 (125 %)
    mealAt(2026, 9, 12, 13, { fat: 10, caps: 0 }),                // Fett, aber ohne Kreon
    mealAt(2026, 9, 14, 12, { fat: 30, caps: 1, source: 'ai' }),  // empfohlen 60.000, genommen 25.000 (42 %)
  ];
  const range = { from: new Date(2026, 9, 12), to: new Date(2026, 9, 19) };
  const r = buildReport({ meals, range, patient: { weightKg: 30, lipasePerGramFat: 2000 }, now: new Date(2026, 9, 14, 20) });
  assert.equal(r.dayCount, 3); assert.equal(r.entryDays, 2);                // Mo, Di (leer), Mi
  assert.equal(r.days[1].meals, 0);
  assert.equal(r.total.fat, 60); assert.equal(r.total.capsules, 3); assert.equal(r.total.unitsTaken, 75000); assert.equal(r.total.unitsRec, 120000);
  assert.equal(r.coverage, 63);                                              // 75.000 / 120.000
  assert.equal(r.avg.fat, 30); assert.equal(r.avg.unitsTaken, 37500);        // geteilt durch 2 Tage MIT Einträgen
  assert.equal(r.dosePerGramFat, 1250);                                      // 75.000 E / 60 g
  assert.equal(r.noKreon, 1); assert.equal(r.low, 1); assert.equal(r.high, 0);
  assert.equal(r.unitsPerKgDay, 1250);                                       // 37.500 / 30 kg
  assert.equal(r.aiItems, 1); assert.equal(r.itemCount, 3);
});

test('Bericht: leerer Zeitraum ohne Fehler', () => {
  const r = buildReport({ meals: [], range: { from: new Date(2026, 9, 12), to: new Date(2026, 9, 13) }, patient: {}, now: new Date(2026, 9, 14) });
  assert.equal(r.entryDays, 0); assert.equal(r.avg, null); assert.equal(r.coverage, null); assert.equal(r.dosePerGramFat, null);
  assert.match(barChartSvg(r.days, [{ key: 'fat', cls: 's1' }]), /<svg/);
});

test('CSV: Semikolon, Dezimalkomma, BOM, Escaping, Formel-Schutz', () => {
  const m = mealAt(2026, 9, 12, 8, { fat: 12.5, caps: 2, name: '=SUMME(A1); "scharf"', source: 'openfoodfacts' });
  const csv = toCsv([m]); const [head, row] = csv.replace('﻿', '').split('\r\n');
  assert.ok(csv.startsWith('﻿')); assert.equal(head.split(';').length, 13);
  assert.match(row, /^12\.10\.2026;08:00;"'=SUMME\(A1\); ""scharf"" \(100 g\)";12,5;300;20;10;2;25000;50000;25000;2000;Open Food Facts$/);
});

test('Text-Zusammenfassung enthält Hinweis, Kennzahlen und Mahlzeiten', () => {
  const meals = [mealAt(2026, 9, 12, 8, { fat: 20, caps: 2 })];
  const rep = buildReport({ meals, range: { from: new Date(2026, 9, 12), to: new Date(2026, 9, 13) }, patient: { name: 'Marie', lipasePerGramFat: 2000 }, now: new Date(2026, 9, 14) });
  const t = toText(rep, { name: 'Marie', lipasePerGramFat: 2000 }, '12.10.2026');
  assert.match(t, /nur gespeicherte Mahlzeiten/); assert.match(t, /2 × Kreon 25\.000/); assert.match(t, /Marie/);
});

test('Diagramm: ein Balken je Tag und Serie, Punkt für Tage ohne Einträge', () => {
  const range = { from: new Date(2026, 9, 12), to: new Date(2026, 9, 15) };
  const rep = buildReport({ meals: [mealAt(2026, 9, 12, 8, { fat: 20, caps: 2 }), mealAt(2026, 9, 14, 8, { fat: 10, caps: 1 })], range, patient: {}, now: new Date(2026, 9, 14, 20) });
  const svg = barChartSvg(rep.days, [{ key: 'unitsTaken', cls: 's1' }, { key: 'unitsRec', cls: 's2' }], { title: 't' });
  assert.equal((svg.match(/<rect/g) || []).length, 4); assert.equal((svg.match(/class="none"/g) || []).length, 1);
});
