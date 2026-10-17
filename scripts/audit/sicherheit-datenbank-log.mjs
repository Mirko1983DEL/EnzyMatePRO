// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../db.js';
import { Keyring } from '../../crypto.js';
import { createApp } from '../../server.js';

console.log('=== D) Nutzertrennung auf Datenbankebene (zweiter Nutzer von Hand angelegt) ===');
const dir = mkdtempSync(join(tmpdir(), 'audit-')), file = join(dir, 'm.db'), key = randomBytes(32);
const db = openDb(file, key);
const raw = new DatabaseSync(file); const ring = new Keyring(key);
raw.prepare('INSERT INTO users(id, enc) VALUES (2, ?)').run(ring.encrypt({ name: 'Zweiter' }, 'users|2')); raw.prepare('INSERT INTO settings(user_id, enc) VALUES (2, ?)').run(ring.encrypt({ capsuleSize: 10000 }, 'settings|2')); raw.close();
const m1 = db.addMeal(1, '2026-10-15T08:00:00.000Z', { items: [{ name: 'Nutzer1' }] }), m2 = db.addMeal(2, '2026-10-15T08:00:00.000Z', { items: [{ name: 'Nutzer2' }] });
const F = '2026-10-15T00:00:00.000Z', T = '2026-10-16T00:00:00.000Z';
console.log('Liste Nutzer 1:', db.listMeals(1, F, T).map((m) => m.items[0].name), '| Nutzer 2:', db.listMeals(2, F, T).map((m) => m.items[0].name));
console.log('Nutzer 2 löscht Mahlzeit von Nutzer 1:', db.deleteMeal(2, m1), '| Nutzer 1 löscht Mahlzeit von Nutzer 2:', db.deleteMeal(1, m2));
console.log('Profile getrennt:', db.getPatient(1).name, '/', db.getPatient(2).name, '| Einstellungen:', db.getSettings(1).capsuleSize, '/', db.getSettings(2).capsuleSize);
console.log('Hinweis: Die HTTP-Schicht kennt nur Nutzer 1 (resolveUser). Ein Mehrbenutzerbetrieb ist über die API derzeit nicht möglich.');

console.log('\n=== E) Protokollierung sensibler Daten (Gemini-Fehlerpfad) ===');
const logs = []; const origErr = console.error; console.error = (...a) => logs.push(a.map(String).join(' '));
const db2 = openDb(':memory:', randomBytes(32));
const srv = createServer(createApp({ db: db2, geminiKey: 'GEHEIMER-API-KEY-XYZ', fetchImpl: async (url, init) => ({ status: 500, ok: false, text: async () => 'Fehlerdetails vom Anbieter: ECHO-MARKER-123 ' + (init.headers['x-goog-api-key'] || ''), json: async () => ({}) }) }));
await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
const r = await fetch(base + '/api/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: 'AAAA', mime: 'image/jpeg' }) });
console.error = origErr;
console.log('Antwort an Browser:', r.status, JSON.stringify(await r.json()));
console.log('Log-Einträge:', JSON.stringify(logs));
console.log('→ Anbieter-Fehlertext im Log:', logs.some((l) => l.includes('ECHO-MARKER')), '| API-Schlüssel im Log, falls der Anbieter ihn zurückspiegelt:', logs.some((l) => l.includes('GEHEIMER-API-KEY')));
srv.close();

process.exit(0);
