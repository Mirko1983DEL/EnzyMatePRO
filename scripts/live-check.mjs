// LIVE-Integrationsprüfung gegen ECHTE Dienste. Läuft nur auf ausdrücklichen Aufruf: npm run test:live
//   node scripts/live-check.mjs [--barcodes 3017620422003,5449000000996] [--photo pfad/zum/foto.jpg]
// Benötigt Internetzugang. Für Gemini zusätzlich GEMINI_API_KEY (und optional GEMINI_MODEL) und ein Foto.
// Schreibt einen Bericht nach test-results/live-<Zeit>.json. Ein erfolgreicher Lauf ist der einzige Beleg
// für „Live getestet“. Die automatischen Tests im Repo verwenden ausschließlich nachgebaute Antworten.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { lookupBarcode, estimateWithGemini } from '../analyze.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const barcodes = (arg('--barcodes') || '3017620422003,5449000000996').split(',').map((s) => s.trim()).filter(Boolean); // bekannte Markenprodukte (Ergebnis ohne Gewähr)
const photo = arg('--photo');
const results = [], started = new Date();
console.log('=== LIVE-PRÜFUNG: echte Dienste, echter Netzverkehr ===\n');

for (const code of barcodes) {
  const t = Date.now();
  const r = await lookupBarcode(code);
  const entry = { check: 'openfoodfacts', barcode: code, ms: Date.now() - t };
  if (r.error) Object.assign(entry, { status: 'fehler', detail: r.error });
  else if (!r.found) Object.assign(entry, { status: 'nicht_gefunden' });
  else Object.assign(entry, { status: r.complete ? 'ok' : 'unvollstaendig', name: r.name, per100: r.per100, servingGrams: r.servingGrams });
  results.push(entry);
  console.log(`Open Food Facts ${code}: ${entry.status}${entry.name ? ` – ${entry.name} (Fett ${entry.per100.fat} g/100 g)` : ''}${entry.detail ? ` – ${entry.detail}` : ''} [${entry.ms} ms]`);
}

if (process.env.GEMINI_API_KEY && photo) {
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extname(photo).toLowerCase()];
  if (!mime) { console.error('Foto muss .jpg, .png oder .webp sein.'); process.exit(2); }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', t = Date.now();
  const r = await estimateWithGemini({ base64: readFileSync(photo).toString('base64'), mime }, { apiKey: process.env.GEMINI_API_KEY, model });
  const entry = { check: 'gemini', model, photo, ms: Date.now() - t, status: r.error ? 'fehler' : 'ok', detail: r.error, items: r.items };
  results.push(entry);
  console.log(`Gemini (${model}): ${entry.status}${r.error ? ` – ${r.error}` : ''}`);
  for (const i of r.items || []) console.log(`   ${i.name}: ${i.grams} g, Fett ${i.per100.fat} g/100 g`);
} else {
  console.log('Gemini: übersprungen (GEMINI_API_KEY und --photo nötig).');
}

mkdirSync('test-results', { recursive: true });
const file = `test-results/live-${started.toISOString().replace(/[-:T]/g, '').slice(0, 14)}.json`;
writeFileSync(file, JSON.stringify({ startedAt: started.toISOString(), node: process.version, results }, null, 2));
console.log(`\nBericht: ${file}`);
const ran = results.length, bad = results.filter((r) => r.status === 'fehler').length;
if (!ran) process.exit(2);
console.log(bad ? `\n${bad} von ${ran} Prüfungen fehlgeschlagen (Netz, Schlüssel oder Dienst).` : `\nAlle ${ran} Prüfungen ohne Fehler abgeschlossen.`);
process.exit(bad ? 1 : 0);
