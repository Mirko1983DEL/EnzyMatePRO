// Browser-Tests (Chromium über playwright-core) gegen die echte Oberfläche und den echten Server.
// Open Food Facts und Gemini sind hier NACHGEBAUT (Mock): diese Tests belegen die Anbindung im Programm,
// nicht den Betrieb mit den echten Diensten. Dafür gibt es `npm run test:live`.
// Fehlt Chromium oder playwright-core, werden die Tests mit Begründung übersprungen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { openDb } from '../db.js';
import { createApp } from '../server.js';
import { ean13Png } from './helpers/ean.js';
import { plainPhoto } from './helpers/png.js';

let chromium; try { ({ chromium } = await import('playwright-core')); } catch { /* wird unten gemeldet */ }
let browser, skipReason = '';
const closers = [];

before(async () => {
  if (!chromium) { skipReason = 'playwright-core nicht installiert (npm install)'; return; }
  try {
    const exe = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    browser = await chromium.launch({ executablePath: exe });
  } catch (e) { skipReason = `Chromium nicht startbar: ${String(e.message).split('\n')[0]}`; }
});
after(async () => { for (const c of closers) await c(); await browser?.close(); });

const json = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });
/** Nachgebaute Außenwelt: Open Food Facts und Gemini. Protokolliert alle Aufrufe in `log`. */
const mockFetch = (log) => async (url) => {
  log.push(String(url));
  if (String(url).includes('openfoodfacts')) return json(200, { status: 1, product: { product_name: 'Testlasagne', brands: 'Mock', serving_quantity: 400, nutriments: { fat_100g: 7.5, 'energy-kcal_100g': 160, carbohydrates_100g: 15, proteins_100g: 8 } } });
  if (String(url).includes('generativelanguage')) return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [
    { name: 'Spaghetti', grams: 250, fatPer100: 1.5, kcalPer100: 150, carbsPer100: 30, proteinPer100: 5 },
    { name: 'Sahnesoße', grams: 100, fatPer100: 18, kcalPer100: 200, carbsPer100: 4, proteinPer100: 2 }] }) }] } }] });
  return json(404, {});
};

async function startApp({ geminiKey = '' } = {}) {
  const log = [], db = openDb(':memory:', randomBytes(32));
  const srv = createServer(createApp({ db, geminiKey, fetchImpl: mockFetch(log) }));
  await new Promise((r) => srv.listen(0, r));
  closers.push(() => { srv.closeAllConnections?.(); srv.close(); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = (p, method = 'GET', body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  return { base, log, api, setProfile: (factor = 2000) => api('/api/patient', 'PUT', { name: 'Marie', weightKg: 35, heightCm: 140, lipasePerGramFat: factor }) };
}

async function newPage({ dark = false, width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', acceptDownloads: true });
  const page = await ctx.newPage(), problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); }); // enthält auch CSP-Verstöße
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => (window.__csp ||= []).push(`${e.violatedDirective} ${e.blockedURI}`)));
  return { page, problems, ctx };
}
const manual = async (page, name, grams, fat) => {
  await page.click('#manualBtn'); await page.fill('#fName', name); await page.fill('#fGrams', String(grams)); await page.fill('#fFat', String(fat)); await page.click('#itemOk');
};
const caps = (page, n) => page.waitForFunction((x) => document.getElementById('capCount').textContent === String(x), n, { timeout: 8000 });
const png = (buffer) => ({ name: 'foto.png', mimeType: 'image/png', buffer });

test('Einrichten, erste Mahlzeit, Kapselzahl und Größenwechsel; Größe bleibt nach Neuladen', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); const { page, problems, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#pFactor');
  assert.equal(await page.textContent('#profileTitle'), 'Einrichten');
  await page.fill('#pFactor', '2000'); await page.click('#profileForm button[type=submit]');
  await manual(page, 'Pizza', 250, 12);                // 30 g Fett × 2000 = 60.000 E
  await caps(page, 2);                                  // 60.000 / 25.000 = 2,4 → 2
  await page.click('#sizeChip'); await page.click('#sizeOpts .opt:nth-child(3)'); await caps(page, 2);   // 35.000: 1,71 → 2
  await page.click('#sizeChip'); await page.click('#sizeOpts .opt:nth-child(1)'); await caps(page, 6);   // 10.000: 6
  await page.reload(); await page.waitForSelector('#sizeLabel');
  assert.equal(await page.textContent('#sizeLabel'), 'Kreon 10.000');
  assert.deepEqual(problems, []); assert.deepEqual(await page.evaluate(() => window.__csp || []), []);
  await ctx.close();
});

test('Speichern, Verlauf, Bericht und CSV-Download mit richtigen Werten', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); await app.setProfile(2000); const { page, problems, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await manual(page, 'Pizza', 250, 12); await caps(page, 2);
  await page.click('#saveMeal'); await page.waitForSelector('#toast.show');
  await page.click('#menuBtn'); await page.click('[data-go=history]'); await page.waitForSelector('#meals li');
  assert.equal(await page.locator('#meals li').count(), 1);
  await page.click('#reportBtn'); await page.waitForSelector('.kpi');
  assert.match(await page.textContent('#reportBody'), /Kreon-Protokoll/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rCsv')]);
  const csv = readFileSync(await dl.path(), 'utf8');
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.equal(csv.split('\r\n')[0].split(';').length, 13);
  assert.match(csv, /"?Pizza \(250 g\)"?;30;0;0;0;2;25000;50000;60000;2000;manuell/);
  assert.deepEqual(problems, []); await ctx.close();
});

test('Barcode-Foto: Erkennung im Browser, Abfrage (Mock) und Herkunftsmarke OFF', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); await app.setProfile(2000); const { page, problems, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await page.setInputFiles('#photo', png(ean13Png('4006381333931')));
  await page.waitForSelector('#items li', { timeout: 20000 });
  const row = await page.textContent('#items li');
  assert.match(row, /Testlasagne/); assert.match(row, /OFF/);
  assert.ok(app.log.some((u) => u.includes('4006381333931')), 'Barcode wurde abgefragt');
  assert.ok(!app.log.some((u) => u.includes('generativelanguage')), 'keine KI beim Barcode-Treffer');
  assert.deepEqual(problems, []); await ctx.close();
});

test('Foto ohne Barcode, KI nicht eingerichtet: Pop-up erklärt es; Abbrechen speichert nichts', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); await app.setProfile(2000); const { page, problems, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await page.setInputFiles('#photo', png(plainPhoto()));
  await page.waitForSelector('#failDlg[open]', { timeout: 20000 });
  assert.equal(await page.locator('#failAi').count(), 0, 'keine Auswahl „KI benutzen“ mehr'); assert.match(await page.textContent('#failMsg'), /nicht eingerichtet/);
  await page.click('#failDlg button[value=no]');
  assert.equal(await page.locator('#items li').count(), 0);
  assert.ok(app.log.length === 0, 'kein Dienst wurde aufgerufen');
  assert.deepEqual(problems, []); await ctx.close();
});

test('KI-Schätzung (Mock): automatisch bei fehlendem Barcode, erst nach einmaliger Einwilligung, Einträge als KI markiert', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp({ geminiKey: 'TESTSCHLUESSEL' }); await app.setProfile(2000); const { page, problems, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await page.setInputFiles('#photo', png(plainPhoto()));
  await page.waitForSelector('#aiDlg[open]', { timeout: 20000 });
  assert.equal(await page.isVisible('#failDlg[open]'), false, 'keine Auswahl zwischen Neuer Versuch und KI');
  assert.ok(!app.log.some((u) => u.includes('generativelanguage')), 'vor der Einwilligung keine KI');
  await page.click('#aiDlg button[value=ok]'); await page.waitForFunction(() => document.querySelectorAll('#items li').length === 2, null, { timeout: 15000 });
  const rows = await page.locator('#items li').allTextContents();
  assert.ok(rows.every((r) => r.includes('KI')), rows.join(' | '));
  assert.ok(app.log.some((u) => u.includes('generativelanguage')));
  assert.deepEqual(problems, []); await ctx.close();
});

test('Profil hat sich geändert: Speichern wird abgelehnt, Ansicht rechnet neu, nichts wird falsch gespeichert', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); await app.setProfile(2000); const { page, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await manual(page, 'Pizza', 250, 12); await caps(page, 2);
  await app.setProfile(3000);                                     // z. B. auf einem anderen Gerät geändert
  await page.click('#saveMeal');
  await page.waitForFunction(() => /inzwischen geändert/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  await caps(page, 4);                                            // 30 g × 3000 / 25.000 = 3,6 → 4
  assert.equal(await page.locator('#items li').count(), 1, 'Eingabe bleibt erhalten');
  const now = Date.now(), list = await app.api(`/api/meals?from=${new Date(now - 864e5).toISOString()}&to=${new Date(now + 864e5).toISOString()}`);
  assert.equal(list.length, 0, 'nichts gespeichert');
  await ctx.close();
});

test('Dunkelmodus, schmale Breite (360 px): kein seitliches Scrollen, keine CSP-Verstöße', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); await app.setProfile(2000); const { page, problems, ctx } = await newPage({ dark: true, width: 360, height: 740 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto(app.base); await page.waitForSelector('#manualBtn'); assert.ok((await overflow()) <= 1, 'Start');
  await manual(page, 'Pizza', 250, 12); await caps(page, 2); assert.ok((await overflow()) <= 1, 'Mahlzeit');
  await page.click('#saveMeal'); await page.waitForSelector('#toast.show');
  await page.click('#menuBtn'); await page.click('[data-go=history]'); await page.waitForSelector('#meals li'); assert.ok((await overflow()) <= 1, 'Verlauf');
  await page.click('#reportBtn'); await page.waitForSelector('.kpi'); assert.ok((await overflow()) <= 1, 'Bericht');
  await page.click('#reportBack'); await page.click('[data-back]'); await page.click('#menuBtn'); await page.click('[data-go=profile]'); assert.ok((await overflow()) <= 1, 'Profil');
  assert.deepEqual(problems, []); assert.deepEqual(await page.evaluate(() => window.__csp || []), []); await ctx.close();
});
