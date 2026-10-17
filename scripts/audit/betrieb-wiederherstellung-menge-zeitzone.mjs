// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../db.js';
import { createApp } from '../../server.js';
import { buildReport } from '../../public/report.js';

console.log('=== Wiederherstellungstest (Sicherung → neue Datei → lesen) ===');
const dir = mkdtempSync(join(tmpdir(), 'rest-')), key = randomBytes(32);
const a = openDb(join(dir, 'live.db'), key); a.setPatient(1, { name: 'Marie', lipasePerGramFat: 2000 }); a.addMeal(1, '2026-10-15T08:00:00.000Z', { items: [{ name: 'Käse' }], capsules: 2 });
const bak = a.backupTo(join(dir, 'sicherung.bak')); a.close();
copyFileSync(bak, join(dir, 'wiederhergestellt.db')); const r = openDb(join(dir, 'wiederhergestellt.db'), key);
console.log('Wiederhergestellt: Profil', r.getPatient(1).name, '| Mahlzeiten', r.listMeals(1, '2026-10-15T00:00:00.000Z', '2026-10-16T00:00:00.000Z').length, '| Integrität', JSON.stringify(r.verifyAll())); r.close();
const wrong = openDb(join(dir, 'wiederhergestellt.db'), randomBytes(32)); console.log('Mit falschem Schlüssel:', JSON.stringify(wrong.verifyAll().failed.length + ' fehlerhafte Zeilen')); wrong.close();
console.log('Hinweis: Es gibt kein Wiederherstellungs-Werkzeug und keine zeitgesteuerte Sicherung; die Prüfung zeigt nur, dass die Sicherungsdatei lesbar ist.');

console.log('\n=== Mengentest: 5.000 Mahlzeiten (≈ 4 Jahre bei 4 Mahlzeiten täglich) ===');
const db = openDb(join(dir, 'gross.db'), key); const t0 = Date.now(); const N = 5000;
db.getPatient(1); const start = Date.parse('2022-10-01T06:00:00Z');
for (let i = 0; i < N; i++) { const ts = new Date(start + i * 7.5 * 3600e3).toISOString(); db.addMeal(1, ts, { items: [{ name: 'Mahlzeit ' + i, grams: 200, per100: { fat: 9, kcal: 180, carbs: 20, protein: 7 }, source: 'manual' }], totals: { fat: 18, kcal: 360, carbs: 40, protein: 14 }, capsuleSize: 25000, capsules: 2, lipasePerGramFat: 2000, recommendedUnits: 36000, recommendedCapsules: 1.44 }); }
console.log(`Einfügen ${N} Mahlzeiten einzeln: ${((Date.now() - t0) / 1000).toFixed(1)} s (${((Date.now() - t0) / N).toFixed(1)} ms je Mahlzeit)`);
const T = (f) => { const t = Date.now(); const v = f(); return [Date.now() - t, v]; };
const [m1, l1] = T(() => db.listMeals(1, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')); const [m2, l2] = T(() => db.listMeals(1, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'));
console.log(`Lesen Monat (${l1.length} Zeilen): ${m1} ms · Lesen alles (${l2.length} Zeilen, entschlüsselt): ${m2} ms · JSON-Größe alles: ${(JSON.stringify(l2).length / 1e6).toFixed(1)} MB`);
const [m3] = T(() => buildReport({ meals: l2, range: { from: new Date('2022-10-01'), to: new Date('2026-10-16') }, patient: { weightKg: 35 }, now: new Date('2026-10-16') })); console.log(`Berichtsberechnung über alles (~1.500 Tage): ${m3} ms`);
db.close();
console.log('Hinweis: Die API hat keine Seitenaufteilung; ein Zeitraum „alles“ lädt und entschlüsselt alle Zeilen.');

console.log('\n=== Zeitzone im Browser: Mahlzeit 22:30 UTC am 15.10. ===');
const db2 = openDb(':memory:', randomBytes(32)); const srv = createServer(createApp({ db: db2 })); await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
const api = (p, m = 'GET', b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }).then((r) => r.json());
await api('/api/patient', 'PUT', { name: 'T', lipasePerGramFat: 2000 }); await api('/api/meals', 'POST', { ts: '2026-10-15T22:30:00Z', items: [{ name: 'Spät', grams: 100, per100: { fat: 10 } }], capsules: 1, capsuleSize: 25000 });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
for (const tz of ['UTC', 'Europe/Berlin', 'America/Los_Angeles']) { const ctx = await b.newContext({ timezoneId: tz, viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.goto(base); await page.waitForSelector('#manualBtn'); await page.click('#menuBtn'); await page.click('[data-go=history]'); await page.waitForTimeout(400);
  const today = await page.locator('#meals li:not(.dayhead)').count(); await page.click('#dayPrev'); await page.waitForTimeout(300); const prev = await page.locator('#meals li:not(.dayhead)').count();
  console.log(`${tz.padEnd(20)} heute (16.10.): ${today} Mahlzeit(en), Vortag (15.10.): ${prev}${tz === 'Europe/Berlin' ? '   ← erwartet: 22:30 UTC = 00:30 am 16.10. Ortszeit' : ''}`); await ctx.close(); }
await b.close(); srv.close();

process.exit(0);
