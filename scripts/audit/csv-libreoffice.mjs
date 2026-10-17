// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md.
// Erzeugt einen Bericht-CSV mit kniffligen Namen, öffnet ihn mit LibreOffice (Filter: Semikolon, UTF-8, Sprache Deutsch)
// und zeigt, wie die Zellen erkannt wurden. Ersetzt NICHT den Test in echtem Excel.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { toCsv } from '../../public/report.js';

const dir = process.argv[2] || mkdtempSync(join(tmpdir(), 'enzymate-csv-'));
mkdirSync(dir, { recursive: true });
const m = (name, fat, kcal, caps, src) => ({ ts: new Date(2026, 9, 15, 8, 5).toISOString(), items: [{ name, grams: 250, per100: { fat }, source: src }], totals: { fat, kcal, carbs: 12.5, protein: 3.25 }, capsules: caps, capsuleSize: 25000, lipasePerGramFat: 2000, recommendedUnits: fat * 2000 });
const csvFile = join(dir, 'bericht.csv');
writeFileSync(csvFile, toCsv([m('Käsespätzle; mit "Zwiebeln"', 31.25, 650, 3, 'manual'), m('=HYPERLINK("http://böse")', 12.5, 300, 1, 'ai'), m('Müsli – Größe 100g', 7.5, 180, 0, 'openfoodfacts')]));
console.log('CSV erzeugt:', csvFile);
const has = (c, a) => spawnSync(c, a, { encoding: 'utf8' }).status === 0;
if (!has('soffice', ['--version']) || !has('unzip', ['-v'])) { console.log('NICHT PRÜFBAR: LibreOffice (soffice) oder unzip fehlt.'); process.exit(0); }
const conv = spawnSync('soffice', ['--headless', '--norestore', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--infilter=CSV:59,34,76,1,,1031', '--outdir', join(dir, 'out'), csvFile], { encoding: 'utf8', timeout: 120000 });
const xlsx = join(dir, 'out', 'bericht.xlsx');
if (!existsSync(xlsx)) { console.log('Konvertierung fehlgeschlagen:', conv.stderr?.slice(0, 300)); process.exit(1); }
const unz = (f) => spawnSync('unzip', ['-p', xlsx, f], { encoding: 'utf8' }).stdout;
const dec = (t) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strings = [...unz('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map((x) => dec([...x[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join('')));
const rows = [...unz('xl/worksheets/sheet1.xml').matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map((c) => {
  const t = /t="(\w+)"/.exec(c[1])?.[1], v = /<v>(.*?)<\/v>/s.exec(c[2] || '')?.[1], f = /<f/.test(c[2] || '');
  return `${f ? 'F:' : ''}${t === 's' ? 'S' : 'Z'}:${t === 's' ? strings[+v] : v}`;
}));
console.log('Zeilen:', rows.length, '| Spalten in Zeile 1:', rows[0].length);
for (const r of rows) console.log(r.join(' | '));
console.log('\nLegende: S = als Text, Z = als Zahl erkannt, F = enthält Formel.');
process.exit(0);
