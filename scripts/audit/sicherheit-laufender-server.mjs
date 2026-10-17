// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
import { mkdtempSync as __mk } from 'node:fs';
import { tmpdir as __td } from 'node:os';
import { join as __jn } from 'node:path';
const __OUT = process.argv[2] || __mk(__jn(__td(), 'enzymate-audit-'));
// Sicherheitsprüfung am LAUFENDEN, isolierten Server (eigener Prozess, eigene Daten in scratchpad/audit/srvdata)
import { spawn } from 'node:child_process';
import net from 'node:net';
import { statSync, readdirSync, readFileSync } from 'node:fs';
const DIR = __OUT + '/srvdata', PORT = 4555, base = `http://127.0.0.1:${PORT}`;
const run = (token) => new Promise((res) => {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('../../server.js', import.meta.url).pathname], { env: { ...process.env, DATA_DIR: DIR, PORT: String(PORT), ...(token ? { ACCESS_TOKEN: token } : {}) } });
  let log = ''; p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  setTimeout(() => res({ p, get log() { return log; } }), 1500);
});
const J = (p, m = 'GET', b, h = {}) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b && JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
const raw = (txt) => new Promise((res) => { const s = net.connect(PORT, '127.0.0.1'); let d = ''; const t0 = Date.now(); s.on('data', (x) => (d += x)); s.on('error', () => res({ closed: true, ms: Date.now() - t0 })); s.on('close', () => res({ closed: true, data: d.split('\r\n')[0], ms: Date.now() - t0 })); s.write(txt); setTimeout(() => { s.destroy(); res({ hung: true, data: d.split('\r\n')[0], ms: Date.now() - t0 }); }, 3000); });

console.log('=== A) Standardbetrieb OHNE Zugriffscode ===');
let srv = await run();
console.log('Start-Log:', srv.log.trim().split('\n').join(' | '));
const mode = (f) => (statSync(f).mode & 0o777).toString(8);
console.log('Dateirechte: secret.key', mode(DIR + '/secret.key'), '| enzymate-pro.db', mode(DIR + '/enzymate-pro.db'), '| Ordner', mode(DIR));
console.log('API ohne Anmeldung erreichbar:', (await J('/api/state')).s);
await J('/api/patient', 'PUT', { name: 'Audit', lipasePerGramFat: 2000, weightKg: 30 });
// Quervergleich: „einfache“ Browser-Anfrage ohne Vorabfrage (text/plain), wie sie jede fremde Webseite senden dürfte
const r1 = await fetch(base + '/api/meals', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ items: [{ name: 'FREMD-GESCHRIEBEN', grams: 100, per100: { fat: 10 } }], capsules: 1, capsuleSize: 25000 }) });
console.log('POST mit Content-Type text/plain (ohne Header/Token) akzeptiert:', r1.status, '(200 = Server prüft den Typ nicht)');
const r2 = await fetch(base + '/api/state', { headers: { origin: 'http://boese.example' } });
console.log('CORS-Header in Antwort:', r2.headers.get('access-control-allow-origin') || 'keiner (Lesen fremder Seiten wird vom Browser blockiert)');
console.log('Anfrage-Grenze: 150 KB JSON →', (await J('/api/meals', 'POST', { items: [{ name: 'x'.repeat(150000), grams: 1, per100: {} }] })).s);
console.log('Ungültiger Pfad //[ (roher Socket):', JSON.stringify(await raw('GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')));
console.log('Server danach noch erreichbar:', (await J('/api/state')).s);
console.log('Fehlerhafte Anfrage /api/%ZZ:', JSON.stringify(await raw('GET /api/%ZZ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')));
console.log('Log nach diesen Anfragen (Auszug):', srv.log.trim().split('\n').slice(-4).join(' | ').slice(0, 400));
srv.p.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));

console.log('\n=== B) Mit Zugriffscode: Brute-Force-Verhalten ===');
srv = await run('geheimer-testcode-123');
let codes = {}; const t0 = Date.now();
for (let i = 0; i < 300; i++) { const r = await J('/api/state', 'GET', null, { 'x-access-token': 'falsch' + i }); codes[r.s] = (codes[r.s] || 0) + 1; }
console.log(`300 falsche Codes in ${Date.now() - t0} ms →`, JSON.stringify(codes), '(keine Sperre, keine Verzögerung)');
console.log('richtiger Code danach:', (await J('/api/state', 'GET', null, { 'x-access-token': 'geheimer-testcode-123' })).s);
console.log('Zugriffscode im Log?', /geheimer-testcode|falsch\d/.test(srv.log) ? 'JA' : 'nein');
srv.p.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));

console.log('\n=== C) Was steht im Klartext in der Datenbank? ===');
const { DatabaseSync } = await import('node:sqlite');
const d = new DatabaseSync(DIR + '/enzymate-pro.db', { readOnly: true });
for (const t of ['users', 'settings', 'foods', 'meals']) { const cols = d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); console.log(t.padEnd(9), 'Spalten:', cols.join(', '), '| Zeilen:', d.prepare(`SELECT count(*) n FROM ${t}`).get().n); }
console.log('Klartext-Zeitstempel (Beispiel):', d.prepare('SELECT ts FROM meals LIMIT 1').get()?.ts);
const dump = readdirSync(DIR).map((f) => readFileSync(DIR + '/' + f)).map((b) => b.toString('latin1')).join('');
console.log('Klartext-Treffer in allen Dateien: „Audit“:', dump.includes('Audit'), '| „FREMD-GESCHRIEBEN“:', dump.includes('FREMD-GESCHRIEBEN'));
d.close();
