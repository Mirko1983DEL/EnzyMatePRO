import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadKey } from './crypto.js';
import { openDb, DEFAULT_USER } from './db.js';
import { CAPSULE_SIZES, totals, dose, fatExact } from './public/calc.js';
import { lookupBarcode, estimateWithGemini, adviseSnackWithGemini } from './analyze.js';
import { cleanSnackRequest, snackProfile, buildSnackPrompt, normalizeAdvice, fallbackAdvice, SNACK_AGE_GROUPS } from './public/snack.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm' };

const num = (v, min, max) => (v == null || v === '' ? null : Number.isFinite(+v) && +v >= min && +v <= max ? +v : undefined);
const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Strenge Content-Security-Policy: nur eigene Quellen; WebAssembly nur für die lokale Barcode-Bibliothek.
export const CSP = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
const MIN_TS = Date.UTC(2020, 0, 1), MAX_FUTURE_MS = 10 * 60 * 1000; // Mahlzeiten: ab 2020, höchstens 10 Minuten in der Zukunft
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
class BadRequest extends HttpError { constructor(msg) { super(400, msg); } }
const need = (v, msg) => { if (v === undefined) throw new BadRequest(msg); return v; };

export function createApp({ db, accessToken = process.env.ACCESS_TOKEN, geminiKey = process.env.GEMINI_API_KEY,
  geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', fetchImpl = fetch } = {}) {
  // Einfache Drosselung der KI-Aufrufe (schützt das Gratis-Kontingent): max. 10 pro Minute
  const aiCalls = [];
  const aiAllowed = () => { const now = Date.now(); while (aiCalls.length && now - aiCalls[0] > 60000) aiCalls.shift(); if (aiCalls.length >= 10) return false; aiCalls.push(now); return true; };

  // Platzhalter für späteren Login: hier später Session/Token -> user_id auflösen.
  const resolveUser = (req) => {
    if (!accessToken) return DEFAULT_USER;
    const got = Buffer.from(req.headers['x-access-token'] || '');
    const want = Buffer.from(accessToken);
    return got.length === want.length && timingSafeEqual(got, want) ? DEFAULT_USER : null;
  };

  const readJson = async (req, limit = 100_000) => {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > limit) throw new BadRequest('Anfrage zu groß'); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new BadRequest('Ungültiges JSON'); }
  };

  const cleanPer100 = (p = {}) => ({
    fat: need(num(p.fat ?? 0, 0, 100), 'Fett pro 100 g ungültig') ?? 0,
    kcal: need(num(p.kcal ?? 0, 0, 900), 'kcal pro 100 g ungültig') ?? 0,
    carbs: need(num(p.carbs ?? 0, 0, 100), 'Kohlenhydrate pro 100 g ungültig') ?? 0,
    protein: need(num(p.protein ?? 0, 0, 100), 'Eiweiß pro 100 g ungültig') ?? 0,
  });

  async function api(req, url, user) {
    const { pathname: p } = url; const m = req.method;
    if (p === '/api/state' && m === 'GET') {
      const patient = db.getPatient(user), settings = db.getSettings(user);
      if (!patient || !settings) throw new HttpError(404, 'Nutzer unbekannt');
      return { patient, settings, foods: db.listFoods(user), capsuleSizes: CAPSULE_SIZES, ai: !!geminiKey };
    }
    if (p === '/api/patient' && m === 'PUT') {
      const b = await readJson(req);
      const v = {
        name: str(b.name, 60) || 'Patient',
        heightCm: need(num(b.heightCm, 30, 250), 'Größe ungültig'),
        weightKg: need(num(b.weightKg, 2, 300), 'Gewicht ungültig'),
        lipasePerGramFat: need(num(b.lipasePerGramFat, 0, 20000), 'Lipase-Faktor ungültig'),
      };
      // Freiwillige Angaben für den Snack-Kompass: nur gespeichert, wenn ausgefüllt (Profil ohne sie bleibt unverändert).
      if (b.ageGroup in SNACK_AGE_GROUPS) v.ageGroup = b.ageGroup;
      for (const [k, max] of [['allergies', 200], ['preferences', 200], ['dietNotes', 300]]) if (str(b[k], max)) v[k] = str(b[k], max);
      db.setPatient(user, v); return v;
    }
    if (p === '/api/settings' && m === 'PUT') {
      const b = await readJson(req);
      if (!CAPSULE_SIZES.includes(+b.capsuleSize)) throw new BadRequest('Unbekannte Kapselgröße');
      const v = { ...(db.getSettings(user) || {}), capsuleSize: +b.capsuleSize };
      db.setSettings(user, v); return v;
    }
    if (p === '/api/foods' && m === 'POST') {
      const b = await readJson(req);
      const name = str(b.name, 80); if (!name) throw new BadRequest('Name fehlt');
      const v = { name, per100: cleanPer100(b.per100) };
      return { id: db.addFood(user, v), ...v };
    }
    let mm = p.match(/^\/api\/foods\/(\d+)$/);
    if (mm && m === 'DELETE') return { deleted: db.deleteFood(user, +mm[1]) };
    mm = p.match(/^\/api\/barcode\/(\d+)$/);
    if (mm && m === 'GET') { const r = await lookupBarcode(mm[1], { fetchImpl }); if (r.error) throw new HttpError(r.status, r.error); return r; }
    if (p === '/api/estimate' && m === 'POST') {
      const b = await readJson(req, 4_000_000);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(b.mime) || typeof b.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b.image)) throw new BadRequest('Bild ungültig');
      if (!aiAllowed()) throw new HttpError(429, 'Zu viele KI-Anfragen – bitte kurz warten');
      const r = await estimateWithGemini({ base64: b.image, mime: b.mime }, { apiKey: geminiKey, model: geminiModel, fetchImpl });
      if (r.error) throw new HttpError(r.status, r.error); return r;
    }
    if (p === '/api/snack-advice' && m === 'POST') {
      let sreq; try { sreq = cleanSnackRequest(await readJson(req, 20_000)); } catch (e) { throw e instanceof HttpError ? e : new BadRequest(e.message); }
      // Profilangaben kommen vom Server (Quelle der Wahrheit), nicht aus der Anfrage; Name, Maße und Lipase-Faktor gehen nie an die KI.
      const profile = snackProfile(db.getPatient(user));
      const fixed = (notice) => ({ source: 'fallback', notice, options: fallbackAdvice(sreq.wishId, profile) });
      if (!geminiKey) return fixed('Die KI ist nicht eingerichtet. Hier sind feste Hinweise.');
      if (!aiAllowed()) return fixed('Gerade zu viele KI-Anfragen. Hier sind feste Hinweise.');
      const g = await adviseSnackWithGemini({ prompt: buildSnackPrompt(sreq, profile) }, { apiKey: geminiKey, model: geminiModel, fetchImpl });
      if (g.error) return fixed('Die KI ist gerade nicht erreichbar. Hier sind feste Hinweise.');
      const options = normalizeAdvice(g.parsed, profile);
      return options ? { source: 'ai', options } : fixed('Die KI-Antwort war nicht verwendbar. Hier sind feste Hinweise.');
    }
    if (p === '/api/meals' && m === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) throw new BadRequest('from/to (ISO) erforderlich');
      return db.listMeals(user, new Date(from).toISOString(), new Date(to).toISOString());
    }
    if (p === '/api/meals' && m === 'POST') {
      const b = await readJson(req);
      const ts = b.ts ? new Date(b.ts) : new Date();
      if (isNaN(ts)) throw new BadRequest('Zeitpunkt ungültig');
      if (ts.getTime() < MIN_TS || ts.getTime() > Date.now() + MAX_FUTURE_MS) throw new BadRequest('Zeitpunkt außerhalb des zulässigen Bereichs');
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40) throw new BadRequest('Mindestens ein Lebensmittel nötig');
      // Quelle der Wahrheit für den Lipase-Faktor ist das Profil auf dem Server, nicht die Anfrage.
      const patient = db.getPatient(user);
      if (!patient) throw new HttpError(404, 'Nutzer unbekannt');
      const factor = patient.lipasePerGramFat;
      if (!(factor > 0)) throw new BadRequest('Im Profil fehlt der Lipase-Faktor.');
      // Stand-Prüfung: hat der Browser mit einem anderen Faktor gerechnet (Profil inzwischen geändert), wird nichts gespeichert.
      if (b.basedOnFactor != null && Number(b.basedOnFactor) !== factor) throw new HttpError(409, 'Das Profil wurde inzwischen geändert. Bitte das Ergebnis prüfen und erneut speichern.');
      const capsuleSize = +b.capsuleSize;
      if (!CAPSULE_SIZES.includes(capsuleSize)) throw new BadRequest('Kapselgröße ungültig');
      const items = b.items.map((i) => ({
        name: str(i.name, 80) || 'Lebensmittel',
        grams: need(num(i.grams, 0.1, 5000), 'Menge ungültig'),
        per100: cleanPer100(i.per100),
        source: ['manual', 'openfoodfacts', 'ai'].includes(i.source) ? i.source : 'manual',
      }));
      const v = {
        items,
        totals: totals(items),
        capsuleSize,
        capsules: need(num(b.capsules, 0, 50), 'Kapselanzahl ungültig: erlaubt sind 0 bis 50. Bitte Mengen und Werte prüfen.'),
        lipasePerGramFat: factor,
        note: str(b.note, 200),
      };
      // Empfehlung zum Zeitpunkt der Einnahme festhalten (Faktor/Kapselgröße können sich später ändern)
      // Die Dosis wird aus der exakten (ungerundeten) Fettsumme berechnet; totals.fat (0,1 g) dient nur der Anzeige.
      const fatEx = fatExact(items);
      v.fatExact = Math.round(fatEx * 1000) / 1000;
      const rec = dose({ fatGrams: fatEx, lipasePerGramFat: factor, capsuleSize });
      v.recommendedUnits = rec.ok ? rec.units : 0;
      v.recommendedCapsules = rec.ok ? rec.exactCapsules : 0;
      return { id: db.addMeal(user, ts.toISOString(), v), ts: ts.toISOString(), ...v };
    }
    mm = p.match(/^\/api\/meals\/(\d+)$/);
    if (mm && m === 'DELETE') return { deleted: db.deleteMeal(user, +mm[1]) };
    return undefined;
  }

  async function serveStatic(res, pathname) {
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('Nicht gefunden'); }
  }

  return async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', CSP);
    res.setHeader('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    let url;
    try { url = new URL(req.url, 'http://x'); }
    catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Ungültige Anfrage'); return; } // sonst bliebe die Verbindung hängen
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return serveStatic(res, url.pathname);
    }
    res.setHeader('cache-control', 'no-store');
    const send = (code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    try {
      const user = resolveUser(req);
      if (user == null) return send(401, { error: 'Zugriffscode fehlt oder falsch' });
      const out = await api(req, url, user);
      return out === undefined ? send(404, { error: 'Unbekannte Route' }) : send(200, out);
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error(e); return send(500, { error: 'Serverfehler' });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DATA_DIR || join(ROOT, 'data');
  const key = loadKey({ keyFile: join(dataDir, 'secret.key') });
  const db = openDb(join(dataDir, 'enzymate-pro.db'), key);
  const port = +process.env.PORT || 3100;
  if (!process.env.ACCESS_TOKEN) console.warn('[creon] ACCESS_TOKEN nicht gesetzt – API ist ohne Zugriffsschutz! Nur im lokalen/geschützten Netz betreiben.');
  const server = createServer(createApp({ db }));
  server.requestTimeout = 60_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000;
  server.listen(port, () => console.log(`EnzyMate Pro läuft auf http://localhost:${port}`));
  const shutdown = (sig) => {
    console.log(`[enzymate-pro] ${sig}: beende geordnet …`);
    server.close(() => { try { db.close(); } catch { /* bereits geschlossen */ } process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
  process.on('unhandledRejection', (e) => console.error('[enzymate-pro] unbehandelter Fehler:', e));
}
