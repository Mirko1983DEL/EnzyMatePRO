// Browser-Tests zum Paket „Fehler, die die Dosis verfälschen können“. Open Food Facts und Gemini sind NACHGEBAUT (Mock).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { openDb } from '../db.js';
import { createApp } from '../server.js';
import { ean13Png } from './helpers/ean.js';
import { plainPhoto } from './helpers/png.js';

let chromium; try { ({ chromium } = await import('playwright-core')); } catch { /* wird gemeldet */ }
let browser, skipReason = ''; const closers = [];
before(async () => {
  if (!chromium) { skipReason = 'playwright-core nicht installiert (npm install)'; return; }
  try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) }); }
  catch (e) { skipReason = `Chromium nicht startbar: ${String(e.message).split('\n')[0]}`; }
});
after(async () => { for (const c of closers) await c(); await browser?.close(); });

const json = (s, b) => ({ status: s, ok: s < 400, json: async () => b, text: async () => JSON.stringify(b) });
const mockFetch = ({ geminiItems, offNutriments } = {}) => async (url) => {
  if (String(url).includes('openfoodfacts')) return json(200, { status: 1, product: { product_name: 'Testprodukt', brands: 'Mock', serving_quantity: 100, nutriments: offNutriments ?? { fat_100g: 7.5, 'energy-kcal_100g': 160, carbohydrates_100g: 15, proteins_100g: 8 } } });
  if (String(url).includes('generativelanguage')) return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: geminiItems ?? [] }) }] } }] });
  return json(404, {});
};
async function startApp(opts = {}, geminiKey = '') {
  const db = openDb(':memory:', randomBytes(32)), srv = createServer(createApp({ db, geminiKey, fetchImpl: mockFetch(opts) }));
  await new Promise((r) => srv.listen(0, r)); closers.push(() => { srv.closeAllConnections?.(); srv.close(); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const api = (p, m = 'GET', b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }).then((r) => r.json());
  await api('/api/patient', 'PUT', { name: 'Marie', weightKg: 35, lipasePerGramFat: 2000 });
  const meals = () => { const t = Date.now(); return api(`/api/meals?from=${new Date(t - 864e5).toISOString()}&to=${new Date(t + 864e5).toISOString()}`); };
  return { base, api, meals };
}
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(), problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return { ctx, page, problems };
}
const toastHas = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('toast').textContent), re.source, { timeout: 8000 });
const manual = async (page, name, grams, fat) => { await page.click(await page.isVisible('#manualBtn') ? '#manualBtn' : '#addBtn'); await page.fill('#fName', name); await page.fill('#fGrams', String(grams)); await page.fill('#fFat', String(fat)); await page.click('#itemOk'); };
const png = (buffer) => ({ name: 'foto.png', mimeType: 'image/png', buffer });
const GEMINI = [
  { name: 'Soße', grams: 100, kcalPer100: 200, carbsPer100: 4, proteinPer100: 2 },                                   // Fett fehlt
  { name: 'Wundermahl', grams: 300, fatPer100: 40, kcalPer100: 120, carbsPer100: 60, proteinPer100: 30 },           // unmöglich
  { name: 'Spaghetti', grams: 250, fatPer100: 1.5, kcalPer100: 150, carbsPer100: 30, proteinPer100: 5 },            // stimmig
];

test('KI-Einträge mit Hinweisen: markiert, Fett leer, Speichern erst nach Prüfung, Ergebnis stimmt', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp({ geminiItems: GEMINI }, 'KEY'); const { page, problems, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await page.setInputFiles('#photo', png(plainPhoto())); await page.waitForSelector('#failDlg[open]', { timeout: 20000 });
  await page.click('#failAi'); await page.waitForSelector('#aiDlg[open]'); await page.click('#aiDlg button[value=ok]');
  await page.waitForFunction(() => document.querySelectorAll('#items li').length === 3, null, { timeout: 15000 });
  assert.equal(await page.locator('#items .tag.review').count(), 2);
  assert.match(await page.textContent('#scanMsg'), /2 Einträge sind markiert/);
  await page.click('#saveMeal'); await toastHas(page, /markierten Einträge/);
  await page.waitForSelector('#itemDlg[open]');
  assert.match(await page.textContent('#itemIssues'), /Fettwert fehlt/); assert.equal(await page.inputValue('#fFat'), '', 'fehlendes Fett bleibt leer');
  await page.click('#itemOk'); assert.equal(await page.isVisible('#itemDlg[open]'), true, 'ohne Fettwert lässt sich der Eintrag nicht übernehmen');
  await page.fill('#fFat', '18'); await page.click('#itemOk'); await page.waitForFunction(() => !document.querySelector('#itemDlg[open]'));
  assert.equal(await page.locator('#items .tag.review').count(), 1);
  await page.click('#saveMeal'); await page.waitForSelector('#itemDlg[open]');
  assert.match(await page.textContent('#itemIssues'), /mehr als 100 g/); assert.match(await page.textContent('#itemIssues'), /Kalorien passen nicht/);
  await page.fill('#fFat', '10'); await page.fill('#fCarbs', '20'); await page.fill('#fProt', '5'); await page.fill('#fKcal', '190'); await page.click('#itemOk');
  await page.waitForFunction(() => !document.querySelector('#itemDlg[open]'));
  assert.equal(await page.locator('#items .tag.review').count(), 0);
  await page.click('#saveMeal'); await toastHas(page, /Gespeichert/);
  const [m] = await app.meals();
  assert.equal(m.totals.fat, 51.8); assert.equal(m.fatExact, 51.75);                                         // 18 + 30 + 3,75 g
  assert.equal(m.recommendedUnits, 103500);                                                                   // 51,75 g × 2000, nicht aus 51,8 g
  assert.ok(m.items.every((i) => !('issues' in i) && !('needsReview' in i)), 'Hinweisfelder werden nicht gespeichert');
  assert.deepEqual(problems, []); await ctx.close();
});

test('Open-Food-Facts-Produkt ohne Fettangabe: markiert und nicht speicherbar, bis Fett eingetragen ist', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp({ offNutriments: { 'energy-kcal_100g': 100, carbohydrates_100g: 10, proteins_100g: 5 } }); const { page, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await page.setInputFiles('#photo', png(ean13Png('4006381333931'))); await page.waitForSelector('#items li', { timeout: 20000 });
  assert.equal(await page.locator('#items .tag.review').count(), 1);
  await page.click('#saveMeal'); await toastHas(page, /markierten Einträge/); await page.waitForSelector('#itemDlg[open]');
  assert.equal(await page.inputValue('#fFat'), ''); await page.fill('#fFat', '5'); await page.click('#itemOk');
  await page.click('#saveMeal'); await toastHas(page, /Gespeichert/);
  const [m] = await app.meals(); assert.equal(m.items[0].source, 'openfoodfacts'); assert.equal(m.items[0].per100.fat, 5);
  await ctx.close();
});

test('Fehlermeldungen sind deutsch und verständlich (kein „Failed to fetch“, kein JSON-Fehlertext)', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); const { page, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn'); await manual(page, 'Pizza', 250, 12);
  const text = () => page.textContent('#toast');
  await ctx.setOffline(true); await page.click('#saveMeal'); await toastHas(page, /Keine Verbindung zum Server/);
  assert.match(await text(), /Eingaben bleiben erhalten/); await ctx.setOffline(false);
  await page.route('**/api/meals', (r) => r.fulfill({ status: 500, contentType: 'text/html', body: '<html>Interner Fehler</html>' }));
  await page.waitForTimeout(2600); await page.click('#saveMeal'); await toastHas(page, /Der Server hat gerade ein Problem \(Fehler 500\)/);
  await page.unroute('**/api/meals'); await page.route('**/api/meals', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'kaputt' }));
  await page.waitForTimeout(2600); await page.click('#saveMeal'); await toastHas(page, /nicht lesbar/);
  assert.ok(!/Failed to fetch|Unexpected token|JSON/.test(await text()));
  assert.equal(await page.locator('#items li').count(), 1, 'Eingabe bleibt erhalten'); await ctx.close();
});

test('Anzeige und Empfehlung widersprechen sich nicht; exakte Fettsumme sichtbar', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); const { page, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn');
  await manual(page, 'Test', 187, 10);                                       // 18,7 g Fett → 37.400 E → 1,496 Kapseln
  await page.waitForFunction(() => document.getElementById('capCount').textContent === '1');
  await page.click('#detailsBtn'); await page.waitForSelector('#detailsDlg[open]');
  const d = (await page.textContent('#detailsBody')).replace(/\s+/g, ' ');
  assert.match(d, /Fett gesamt18,7 g/); assert.match(d, /Benötigt37\.400 E/); assert.match(d, /Rechnerisch1,49 Kapseln/); assert.doesNotMatch(d, /1,5 Kapseln/);
  await page.keyboard.press('Escape'); await page.click('#items li'); await page.fill('#fGrams', '333'); await page.fill('#fFat', '7.5'); await page.click('#itemOk');
  await page.click('#detailsBtn'); await page.waitForSelector('#detailsDlg[open]');
  const d2 = (await page.textContent('#detailsBody')).replace(/\s+/g, ' ');
  assert.match(d2, /Fett gesamt24,975 g/); assert.match(d2, /Benötigt49\.950 E/); await ctx.close();
});

test('Extrem große Mahlzeit: Hinweis in der Oberfläche und verständliche Meldung beim Speichern', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); const { page, ctx } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn'); await manual(page, 'Extrem', 5000, 100);
  await page.waitForFunction(() => Number(document.getElementById('capCount').textContent) > 50);
  assert.match(await page.textContent('#detailsBtn'), /Abweichung/);
  await page.click('#detailsBtn'); await page.waitForSelector('#detailsDlg[open]'); assert.match(await page.textContent('#detailsWarn'), /Mehr als 50 Kapseln/); await page.keyboard.press('Escape');
  await page.click('#saveMeal'); await toastHas(page, /erlaubt sind 0 bis 50/);
  assert.equal((await app.meals()).length, 0); await ctx.close();
});

test('Ladeanzeige: Kapsel erscheint erst bei langsamer Antwort, dreht sich und verschwindet danach', async (t) => {
  if (!browser) return t.skip(skipReason);
  const app = await startApp(); const { page, ctx, problems } = await newPage();
  await page.goto(app.base); await page.waitForSelector('#manualBtn'); await manual(page, 'Pizza', 250, 12);
  const shown = () => page.evaluate(() => document.getElementById('loader').matches(':popover-open'));
  await page.route('**/api/meals', async (r) => { await new Promise((x) => setTimeout(x, 900)); r.continue(); });
  await page.click('#saveMeal');
  await page.waitForFunction(() => document.getElementById('loader').matches(':popover-open'), null, { timeout: 2000 });
  const box = await page.locator('#loader .pill').boundingBox(), vp = page.viewportSize();
  assert.ok(Math.abs(box.x + box.width / 2 - vp.width / 2) < 2 && Math.abs(box.y + box.height / 2 - vp.height / 2) < 2, 'mittig');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#loader .pill')).animationName), 'none', 'dreht sich');
  await toastHas(page, /Gespeichert/); assert.equal(await shown(), false, 'danach ausgeblendet');
  await page.unroute('**/api/meals'); await manual(page, 'Brot', 50, 1); await page.click('#saveMeal'); await toastHas(page, /Gespeichert/);
  assert.deepEqual(problems, []); await ctx.close();
});
