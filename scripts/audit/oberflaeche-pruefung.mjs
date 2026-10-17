// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
import { mkdtempSync as __mk } from 'node:fs';
import { tmpdir as __td } from 'node:os';
import { join as __jn } from 'node:path';
const __OUT = process.argv[2] || __mk(__jn(__td(), 'enzymate-audit-'));
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDb } from '../../db.js';
import { createApp } from '../../server.js';
import { ean13Png } from '../../test/helpers/ean.js';
const OUT = __OUT;
const json = (s, b) => ({ status: s, ok: s < 400, json: async () => b, text: async () => JSON.stringify(b) });
const EVIL = '<img src=x onerror="window.__xss=1">Böse<script>window.__xss=2</script>';
const off = async () => json(200, { status: 1, product: { product_name: EVIL, brands: '"><svg onload=window.__xss=3>', serving_quantity: 100, nutriments: { fat_100g: 5 } } });
async function start() { const db = openDb(':memory:', randomBytes(32)); const srv = createServer(createApp({ db, fetchImpl: off })); await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const api = (p, m = 'GET', b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }).then((r) => r.json());
  await api('/api/patient', 'PUT', { name: 'Marie', weightKg: 35, heightCm: 140, lipasePerGramFat: 2000 }); return { base, api, srv }; }
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const mk = async (o = {}) => { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, ...o }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text())); return { ctx, page, errs }; };
const section = (t) => console.log(`\n===== ${t} =====`);
const txt = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());

section('1) Mehrfach-Mahlzeit: App-Anzeige gegen unabhängige Nachrechnung');
{ const { base, api } = await start(); const { page, errs } = await mk();
  await page.goto(base); await page.waitForSelector('#manualBtn');
  const add = async (n, g, f, k, c, p) => { await page.click(await page.isVisible('#manualBtn') ? '#manualBtn' : '#addBtn'); await page.fill('#fName', n); await page.fill('#fGrams', g); await page.fill('#fFat', f); await page.click('#itemDlg summary'); await page.fill('#fKcal', k); await page.fill('#fCarbs', c); await page.fill('#fProt', p); await page.click('#itemOk'); };
  await add('Nudeln', '250', '1.5', '150', '30', '5'); await add('Sahnesoße', '100', '18', '200', '4', '2'); await add('Käse', '20', '30', '400', '1', '25');
  console.log('Einträge in der Liste:', await page.locator('#items li').count());
  const exactFat = 250 * 1.5 / 100 + 100 * 18 / 100 + 20 * 30 / 100, exactUnits = exactFat * 2000;
  console.log(`Unabhängig: Fett exakt ${exactFat} g → ${exactUnits} E → ${(exactUnits / 25000).toFixed(3)} Kapseln → gerundet ${Math.round(exactUnits / 25000)}`);
  await page.click('#detailsBtn'); await page.waitForSelector('#detailsDlg[open]');
  console.log('App zeigt (Details):', await txt(page, '#detailsBody')); console.log('Kapseln groß angezeigt:', await txt(page, '#capCount'));
  await page.keyboard.press('Escape');
  await page.click('#items li:nth-child(2)'); await page.fill('#fGrams', '150'); await page.click('#itemOk');
  const exactFat2 = 250 * 1.5 / 100 + 150 * 18 / 100 + 20 * 30 / 100;
  console.log(`Nach Bearbeiten (Soße 150 g): unabhängig Fett ${exactFat2} g → ${exactFat2 * 2000} E → ${(exactFat2 * 2000 / 25000).toFixed(3)} → ${Math.round(exactFat2 * 2000 / 25000)} Kapseln | App: ${await txt(page, '#capCount')} Kapseln`);
  await page.click('#saveMeal'); await page.waitForSelector('#toast.show');
  const now = Date.now(), list = await api(`/api/meals?from=${new Date(now - 864e5).toISOString()}&to=${new Date(now + 864e5).toISOString()}`);
  const m = list[0]; console.log('Gespeichert:', JSON.stringify({ fat: m.totals.fat, kcal: m.totals.kcal, carbs: m.totals.carbs, protein: m.totals.protein, capsules: m.capsules, recommendedUnits: m.recommendedUnits, recommendedCapsules: m.recommendedCapsules, factor: m.lipasePerGramFat, items: m.items.map((i) => `${i.name} ${i.grams} g`) }));
  console.log(`Unabhängige Soll-Werte: Fett ${exactFat2}, kcal ${250 * 1.5 + 150 * 2 + 20 * 4}, KH ${(250 * 30 + 150 * 4 + 20 * 1) / 100}, Eiweiß ${(250 * 5 + 150 * 2 + 20 * 25) / 100}, empfohlene E exakt ${exactFat2 * 2000}`);
  await page.reload(); await page.waitForSelector('#manualBtn'); console.log('Nach Neuladen: Startseite leer (Mahlzeit nicht vorausgefüllt):', await page.isVisible('#empty'), '| Fehler:', JSON.stringify(errs)); }

section('2) Datumsfilter an Tagesgrenzen (Zeitzone des Tests: UTC)');
{ const { base, api } = await start(); const { page } = await mk();
  const ms = [['2026-10-14T23:59:00Z', 10, 1], ['2026-10-15T00:00:00Z', 20, 1], ['2026-10-15T23:59:59Z', 30, 2], ['2026-10-16T00:00:00Z', 40, 0]];
  for (const [ts, fat, caps] of ms) await api('/api/meals', 'POST', { ts, items: [{ name: 'F' + fat, grams: 100, per100: { fat } }], capsules: caps, capsuleSize: 25000 });
  await page.goto(base); await page.waitForSelector('#manualBtn'); await page.click('#menuBtn'); await page.click('[data-go=history]'); await page.waitForTimeout(500);
  const count = () => page.locator('#meals li:not(.dayhead)').count();
  console.log('Tag 16.10. (heute):', await count(), '(erwartet 1)'); await page.click('#dayPrev'); await page.waitForTimeout(300); console.log('Tag 15.10.:', await count(), '(erwartet 2: 00:00 und 23:59:59)');
  await page.click('#dayPrev'); await page.waitForTimeout(300); console.log('Tag 14.10.:', await count(), '(erwartet 1)');
  await page.click('[data-mode=week]'); await page.waitForTimeout(300); console.log('Woche 12.–18.10.:', await count(), '(erwartet 4)');
  await page.click('[data-mode=custom]'); await page.fill('#rFrom', '2026-10-15'); await page.fill('#rTo', '2026-10-15'); await page.click('#rangeForm button'); await page.waitForTimeout(400); console.log('Frei 15.–15.10.:', await count(), '(erwartet 2) | Label:', await txt(page, '#dayLabel'));
  await page.click('[data-mode=custom]'); await page.fill('#rFrom', '2026-10-16'); await page.fill('#rTo', '2026-10-15'); await page.click('#rangeForm button'); await page.waitForTimeout(300); console.log('Ungültiger Zeitraum (Bis vor Von) → Meldung:', await txt(page, '#toast'));
  await page.keyboard.press('Escape'); await page.click('[data-mode=week]'); await page.waitForTimeout(300);
  section('3) Bericht (Woche) gegen unabhängige Nachrechnung');
  await page.click('#reportBtn'); await page.waitForSelector('.kpi'); const k = await page.locator('.kpi').allTextContents();
  console.log('Bericht zeigt:', k.map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  console.log('Unabhängig: Mahlzeiten 4 · Tage mit Einträgen 3 von 5 (12.–16.10.) · Ø Fett/Tag 33,3 g · Ø Kapseln/Tag 1,3 · Ø Lipase/Tag 33.333 E (952 E/kg bei 35 kg) · pro g Fett 1.000 E/g · genommen/empfohlen 50 % · ohne Kreon 1 · unter 75 %: 1 / über 150 %: 0');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rCsv')]); const csv = readFileSync(await dl.path(), 'utf8'); console.log('CSV-Zeilen:', csv.trim().split('\r\n').length, '(erwartet 5 inkl. Kopf) | Datei:', dl.suggestedFilename());
  await page.emulateMedia({ media: 'print' }); await page.pdf({ path: OUT + '/bericht.pdf', format: 'A4', printBackground: true }); console.log('PDF-Erzeugung (Chromium-Druckvorlage): ok'); }

section('4) Fehlermeldungen bei Netz- und Serverfehlern');
{ const { base, api } = await start(); const { ctx, page } = await mk();
  await page.goto(base); await page.waitForSelector('#manualBtn'); await page.click('#manualBtn'); await page.fill('#fName', 'X'); await page.fill('#fGrams', '100'); await page.fill('#fFat', '10'); await page.click('#itemOk');
  await ctx.setOffline(true); await page.click('#saveMeal'); await page.waitForTimeout(600); console.log('Offline speichern → angezeigte Meldung:', JSON.stringify(await txt(page, '#toast')));
  await ctx.setOffline(false); await page.waitForTimeout(2600);
  await page.route('**/api/meals', (r) => r.fulfill({ status: 500, contentType: 'text/html', body: '<html>Interner Fehler</html>' })); await page.click('#saveMeal'); await page.waitForTimeout(600); console.log('Server liefert 500 (HTML) → Meldung:', JSON.stringify(await txt(page, '#toast')));
  console.log('Eingabe nach Fehler noch vorhanden:', await page.locator('#items li').count() === 1); }

section('5) Schadtext (XSS-Versuch) in Namen, Barcode-Produktnamen, Verlauf, Bericht');
{ const { base, api } = await start(); const { page } = await mk();
  await api('/api/meals', 'POST', { items: [{ name: EVIL, grams: 100, per100: { fat: 5 } }], capsules: 1, capsuleSize: 25000 });
  await page.goto(base); await page.waitForSelector('#manualBtn');
  await page.setInputFiles('#photo', { name: 'e.png', mimeType: 'image/png', buffer: ean13Png('4006381333931') }); await page.waitForSelector('#items li', { timeout: 20000 });
  console.log('Produktname aus „Open Food Facts“ in der Liste als Text:', JSON.stringify((await txt(page, '#items li')).slice(0, 60)));
  await page.click('#menuBtn'); await page.click('[data-go=history]'); await page.waitForSelector('#meals li'); await page.click('#meals li >> nth=0'); await page.waitForTimeout(300); await page.keyboard.press('Escape');
  await page.click('#reportBtn'); await page.waitForSelector('.kpi');
  console.log('window.__xss gesetzt (Skript ausgeführt)?', await page.evaluate(() => window.__xss ?? 'nein'), '| <img>-Elemente aus Nutzertext im DOM:', await page.locator('#reportBody img, #meals img, #items img').count()); }

section('6) Bildschirmgrößen: Überlauf und Bedienflächen');
{ const { base, api } = await start(); await api('/api/meals', 'POST', { items: [{ name: 'Pizza', grams: 250, per100: { fat: 12, kcal: 260 } }], capsules: 2, capsuleSize: 25000 });
  for (const [w, h] of [[320, 568], [360, 740], [390, 844], [768, 1024], [1280, 800]]) { const { page } = await mk({ viewport: { width: w, height: h } });
    const ov = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth); const res = [];
    await page.goto(base); await page.waitForSelector('#manualBtn'); res.push(['Start', await ov()]);
    await page.click('#manualBtn'); await page.fill('#fName', 'Pizza'); await page.fill('#fGrams', '250'); await page.fill('#fFat', '12'); await page.click('#itemOk'); res.push(['Mahlzeit', await ov()]);
    await page.screenshot({ path: `${OUT}/vp-${w}-meal.png` });
    await page.click('#menuBtn'); await page.click('[data-go=history]'); await page.waitForSelector('#meals li'); res.push(['Verlauf', await ov()]); await page.click('#reportBtn'); await page.waitForSelector('.kpi'); res.push(['Bericht', await ov()]);
    await page.screenshot({ path: `${OUT}/vp-${w}-report.png`, fullPage: false });
    console.log(`${w}×${h}: Überlauf (Pixel) ${res.map(([n, v]) => `${n} ${v}`).join(', ')}`); await page.context().close(); }
  const { page } = await mk(); await page.goto(base); await page.waitForSelector('#manualBtn'); await page.click('#manualBtn'); await page.fill('#fName', 'Pizza'); await page.fill('#fGrams', '250'); await page.fill('#fFat', '12'); await page.click('#itemOk');
  const small = await page.evaluate(() => [...document.querySelectorAll('button, a, input:not([type=hidden]), summary, label.btn, [role=radio]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));
  console.log('Bedienelemente < 44 px (Startseite mit Mahlzeit, 390 px):', JSON.stringify(small)); }

section('7) Barrierefreiheit (statisch) und Ladegröße');
{ const { base } = await start(); const { page } = await mk(); let bytes = 0; const files = [];
  page.on('response', async (r) => { try { const n = (await r.body()).length; bytes += n; files.push([r.url().replace(base, ''), n]); } catch {} });
  const t0 = Date.now(); await page.goto(base, { waitUntil: 'load' }); await page.waitForSelector('#manualBtn'); const ms = Date.now() - t0;
  console.log(`Erstladen: ${ms} ms bis Startseite bedienbar (lokal, ohne Netzwerk-Latenz), ${(bytes / 1024).toFixed(0)} KB:`, files.map(([u, n]) => `${u} ${(n / 1024).toFixed(0)}K`).join(', '));
  const a11y = await page.evaluate(() => ({ lang: document.documentElement.lang, zoomGesperrt: /user-scalable=no|maximum-scale=1/.test(document.querySelector('meta[name=viewport]').content),
    inputsOhneLabel: [...document.querySelectorAll('input:not([type=hidden]):not([type=file])')].filter((i) => !i.labels?.length && !i.getAttribute('aria-label')).map((i) => i.id),
    knoepfeOhneName: [...document.querySelectorAll('button')].filter((x) => !(x.textContent.trim() || x.getAttribute('aria-label'))).map((x) => x.id || x.className),
    dialogeOhneName: [...document.querySelectorAll('dialog')].filter((d) => !d.getAttribute('aria-label') && !d.getAttribute('aria-labelledby')).map((d) => d.id),
    bilderOhneAlt: [...document.images].filter((i) => i.getAttribute('alt') === null).map((i) => i.src.slice(-20)), statusRegionen: document.querySelectorAll('[role=status]').length }));
  console.log('Prüfung:', JSON.stringify(a11y)); }
await b.close();

process.exit(0);
