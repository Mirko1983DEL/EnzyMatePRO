// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
// Synthetischer Barcode-Robustheitstest (KEINE echten Fotos!): erzeugt Testbilder, schickt sie durch die echte Oberfläche.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openDb } from '../../db.js';
import { createApp } from '../../server.js';
import { grayPng } from '../../test/helpers/png.js';
import { ean13Modules, checkDigit13 } from '../../test/helpers/ean.js';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'], R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const ean8Modules = (c) => { const d = [...c].map(Number); const chk = (10 - ((3 * (d[0] + d[2] + d[4] + d[6]) + (d[1] + d[3] + d[5])) % 10)) % 10; if (chk !== d[7]) throw new Error('EAN-8 Prüfziffer'); return '101' + d.slice(0, 4).map((x) => L[x]).join('') + '01010' + d.slice(4).map((x) => R[x]).join('') + '101'; };
const toPix = (bits, { scale = 4, height = 150, quiet = 11 } = {}) => { const w = (bits.length + 2 * quiet) * scale, h = height + 40, p = new Uint8Array(w * h).fill(255); for (let y = 20; y < 20 + height; y++) for (let x = 0; x < w; x++) { const m = Math.floor(x / scale) - quiet; if (m >= 0 && m < bits.length && bits[m] === '1') p[y * w + x] = 0; } return { p, w, h }; };
const png = ({ p, w, h }) => grayPng(w, h, (x, y) => p[y * w + x]);
const blur = ({ p, w, h }, r) => { const q = new Float32Array(w * h); const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += p[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { q[y * w + x] = s / (2 * r + 1); s += p[y * w + Math.min(w - 1, x + r + 1)] - p[y * w + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += q[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = Math.round(s / (2 * r + 1)); s += q[Math.min(h - 1, y + r + 1) * w + x] - q[Math.max(0, y - r) * w + x]; } } return { p: o, w, h }; };
const rot = ({ p, w, h }, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), W = Math.ceil(Math.abs(w * c) + Math.abs(h * s)), H = Math.ceil(Math.abs(w * s) + Math.abs(h * c)), o = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = x - W / 2, dy = y - H / 2, sx = Math.round(dx * c + dy * s + w / 2), sy = Math.round(-dx * s + dy * c + h / 2); if (sx >= 0 && sx < w && sy >= 0 && sy < h) o[y * W + x] = p[sy * w + sx]; } return { p: o, w: W, h: H }; };
const contrast = ({ p, w, h }, lo, hi) => ({ p: p.map((v) => Math.round(lo + (v / 255) * (hi - lo))), w, h });
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const noise = ({ p, w, h }, amp) => ({ p: p.map((v) => Math.max(0, Math.min(255, Math.round(v + (rnd() - 0.5) * 2 * amp)))), w, h });
const shade = ({ p, w, h }, minF) => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = Math.round(p[y * w + x] * (minF + (1 - minF) * (x / w))); return { p: o, w, h }; };

const EAN = '4006381333931', UPCA = '036000291452', UPCA13 = '0' + UPCA + checkDigit13('0' + UPCA.slice(0, 11)) % 10;   // UPC-A als EAN-13 mit führender 0
const upcA12 = '0' + '36000291452'; const upcCheck = (() => { const d = [...'03600029145'].map(Number); return (10 - ((3 * (d[0] + d[2] + d[4] + d[6] + d[8] + d[10]) + (d[1] + d[3] + d[5] + d[7] + d[9])) % 10)) % 10; })();
const UPC_A = '03600029145' + upcCheck;              // 12-stellig, gültige Prüfziffer
const e13 = toPix(ean13Modules(EAN)), e13s1 = toPix(ean13Modules(EAN), { scale: 1 }), e13s2 = toPix(ean13Modules(EAN), { scale: 2 }), e13nq = toPix(ean13Modules(EAN), { quiet: 0 });
const variants = [
  ['EAN-13 sauber (Maßstab 4)', png(e13), EAN], ['EAN-13 klein (Maßstab 2, ~190 px breit)', png(e13s2), EAN], ['EAN-13 sehr klein (Maßstab 1, ~95 px breit)', png(e13s1), EAN],
  ['EAN-13 ohne Ruhezone', png(e13nq), EAN], ['EAN-13 um 90° gedreht', png(rot(e13, 90)), EAN], ['EAN-13 um 180° gedreht', png(rot(e13, 180)), EAN], ['EAN-13 um 15° gedreht', png(rot(e13, 15)), EAN], ['EAN-13 um 30° gedreht', png(rot(e13, 30)), EAN],
  ['EAN-13 unscharf (Radius 2)', png(blur(e13, 2)), EAN], ['EAN-13 unscharf (Radius 4)', png(blur(e13, 4)), EAN], ['EAN-13 stark unscharf (Radius 8)', png(blur(e13, 8)), EAN],
  ['EAN-13 kontrastarm (100–160)', png(contrast(e13, 100, 160)), EAN], ['EAN-13 Rauschen ±60', png(noise(e13, 60)), EAN], ['EAN-13 Schattenverlauf (30 %→100 %)', png(shade(e13, 0.3)), EAN],
  ['EAN-8 sauber', png(toPix(ean8Modules('96385074'))), '96385074'], ['UPC-A sauber (12-stellig; geliefert als 13-stellige EAN-Form mit führender 0)', png(toPix(ean13Modules('0' + UPC_A))), '0' + UPC_A],
];
const log = []; const db = openDb(':memory:', randomBytes(32));
const fetchImpl = async (u) => { log.push(String(u)); return { status: 200, ok: true, json: async () => ({ status: 1, product: { product_name: 'Testprodukt', nutriments: { fat_100g: 5 } } }), text: async () => '' }; };
const srv = createServer(createApp({ db, fetchImpl })); await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
await fetch(base + '/api/patient', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'T', lipasePerGramFat: 2000 }) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
console.log('Variante'.padEnd(46), 'Ergebnis'.padEnd(34), 'Zeit');
let ok = 0;
for (const [name, buffer, expected] of variants) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); const before = log.length; const t0 = Date.now();
  await page.goto(base); await page.waitForSelector('#manualBtn'); await page.setInputFiles('#photo', { name: 'v.png', mimeType: 'image/png', buffer });
  let res; try { await page.waitForFunction(() => document.querySelector('#items li') || document.querySelector('#failDlg[open]'), null, { timeout: 12000 }); res = (await page.isVisible('#items li')) ? 'erkannt' : 'NICHT erkannt (Auswahl-Dialog)'; } catch { res = 'Zeitüberschreitung'; }
  const got = log.slice(before).map((u) => u.match(/product\/(\d+)\.json/)?.[1]).filter(Boolean)[0];
  if (res === 'erkannt') res += got === expected ? ` · Code stimmt (${got})` : ` · FALSCHER Code ${got} (erwartet ${expected})`; if (res.startsWith('erkannt') && got === expected) ok++;
  console.log(name.padEnd(46), res.padEnd(34), `${Date.now() - t0} ms`); await ctx.close();
}
console.log(`\nKorrekt erkannt: ${ok} von ${variants.length}. Hinweis: Ein UPC-A-Symbol (12 Stellen) kommt als 13-stelliger Code mit führender 0 an (EAN-13-Form); ob Open Food Facts diese Form für UPC-Produkte erwartet, ist ungeprüft. UPC-E wurde nicht getestet.`);
await b.close(); srv.close();
