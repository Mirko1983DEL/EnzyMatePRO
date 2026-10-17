// Demo-Ersatz für den Server: gleiche Routen wie server.js, Daten nur im Browser (localStorage).
// Unverschlüsselt und nur auf diesem Gerät – nicht für echte Patientendaten gedacht.
const KEY = 'enzymateProDemoV1';
let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY)); } catch { mem = null; }
  mem ||= { patient: { name: 'Marie', heightCm: null, weightKg: null, lipasePerGramFat: null }, settings: { capsuleSize: 25000 }, foods: [], meals: [], seq: 1 };
  return mem;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* Speicher gesperrt: Daten gelten nur für diese Sitzung */ } }
const num = (v, lo, hi, msg) => { if (v == null || v === '') return null; if (!(Number.isFinite(+v) && +v >= lo && +v <= hi)) throw new Error(msg); return +v; };
const per100 = (p = {}) => ({ fat: num(p.fat ?? 0, 0, 100, 'Fett pro 100 g ungültig'), kcal: num(p.kcal ?? 0, 0, 900, 'kcal pro 100 g ungültig'), carbs: num(p.carbs ?? 0, 0, 100, 'Kohlenhydrate ungültig'), protein: num(p.protein ?? 0, 0, 100, 'Eiweiß ungültig') });

// KI in der Demo: Claude über die Artifact-Funktion `sample` (Konto des Betrachters, kein API-Schlüssel nötig).
async function getSample() {
  try {
    const sample = await window.claude?.use('sample');
    const limits = sample && (await sample.limits().catch(() => null));
    return limits?.images ? sample : null;
  } catch { return null; }
}
const SAMPLE_ERRORS = {
  not_granted: 'Zugriff auf Claude wurde nicht erlaubt.', sampling_disabled: 'Claude ist für dieses Konto nicht verfügbar.',
  rate_limited: 'Zu viele Anfragen oder Nutzungslimit erreicht – später erneut versuchen.', image_rejected: 'Das Bild wurde abgelehnt – bitte ein anderes Foto wählen.',
  invalid_json: 'Die KI-Antwort war nicht lesbar – bitte erneut versuchen.', refused: 'Die KI hat dieses Bild abgelehnt.', session_expired: 'Bitte neu anmelden.',
};
async function estimateWithClaude(body) {
  const sample = await getSample();
  if (!sample) throw new Error('KI ist in dieser Ansicht nicht verfügbar.');
  const blob = new Blob([Uint8Array.from(atob(body.image), (c) => c.charCodeAt(0))], { type: body.mime });
  try {
    const out = await sample.json(PROMPT + '\n\n' + JSON_FORMAT_HINT, { images: [blob], modelTier: 'default' });
    return { items: normalizeEstimate(out) };
  } catch (e) { throw new Error(SAMPLE_ERRORS[e?.code] || `KI-Anfrage fehlgeschlagen (${e?.code || 'Fehler'})`); }
}

export async function api(path, method = 'GET', body) {
  const d = load(); const [p, query = ''] = path.split('?'); const q = new URLSearchParams(query);
  if (p === '/state') return { patient: d.patient, settings: d.settings, foods: d.foods, capsuleSizes: CAPSULE_SIZES, ai: !!(await Promise.race([getSample(), new Promise((r) => setTimeout(() => r(null), 4000))])) };
  if (p === '/patient') {
    d.patient = { name: String(body.name || '').trim().slice(0, 60) || 'Patient', heightCm: num(body.heightCm, 30, 250, 'Größe ungültig'), weightKg: num(body.weightKg, 2, 300, 'Gewicht ungültig'), lipasePerGramFat: num(body.lipasePerGramFat, 0, 20000, 'Lipase-Faktor ungültig') };
    save(); return d.patient;
  }
  if (p === '/settings') { if (!CAPSULE_SIZES.includes(+body.capsuleSize)) throw new Error('Unbekannte Kapselgröße'); d.settings = { ...d.settings, capsuleSize: +body.capsuleSize }; save(); return d.settings; }
  if (p === '/foods' && method === 'POST') { const f = { id: d.seq++, name: String(body.name || '').trim().slice(0, 80), per100: per100(body.per100) }; if (!f.name) throw new Error('Name fehlt'); d.foods.push(f); save(); return f; }
  let m = p.match(/^\/foods\/(\d+)$/);
  if (m && method === 'DELETE') { d.foods = d.foods.filter((f) => f.id !== +m[1]); save(); return { deleted: true }; }
  if (p === '/meals' && method === 'GET') { const from = Date.parse(q.get('from')), to = Date.parse(q.get('to')); return d.meals.filter((x) => Date.parse(x.ts) >= from && Date.parse(x.ts) < to).sort((a, b) => b.ts.localeCompare(a.ts)); }
  if (p === '/meals' && method === 'POST') {
    if (!Array.isArray(body.items) || !body.items.length) throw new Error('Mindestens ein Lebensmittel nötig');
    const factor = d.patient.lipasePerGramFat; // wie auf dem Server: der Faktor kommt aus dem Profil
    if (!(factor > 0)) throw new Error('Im Profil fehlt der Lipase-Faktor.');
    if (body.basedOnFactor != null && Number(body.basedOnFactor) !== factor) throw Object.assign(new Error('Das Profil wurde inzwischen geändert. Bitte das Ergebnis prüfen und erneut speichern.'), { status: 409 });
    if (!CAPSULE_SIZES.includes(+body.capsuleSize)) throw new Error('Kapselgröße ungültig');
    const items = body.items.map((i) => ({ name: String(i.name || 'Lebensmittel').slice(0, 80), grams: num(i.grams, 0.1, 5000, 'Menge ungültig'), per100: per100(i.per100), source: i.source || 'manual' }));
    const meal = { id: d.seq++, ts: new Date().toISOString(), items, totals: totals(items), capsuleSize: +body.capsuleSize, capsules: +body.capsules, lipasePerGramFat: factor, note: '' };
    meal.fatExact = Math.round(fatExact(items) * 1000) / 1000;
    const rec = dose({ fatGrams: fatExact(items), lipasePerGramFat: factor, capsuleSize: meal.capsuleSize });
    meal.recommendedUnits = rec.ok ? rec.units : 0; meal.recommendedCapsules = rec.ok ? rec.exactCapsules : 0;
    d.meals.push(meal); save(); return meal;
  }
  m = p.match(/^\/meals\/(\d+)$/);
  if (m && method === 'DELETE') { d.meals = d.meals.filter((x) => x.id !== +m[1]); save(); return { deleted: true }; }
  m = p.match(/^\/barcode\/(\d{8,14})$/);
  if (m) { // direkt bei Open Food Facts; in manchen Umgebungen vom Browser/Host blockiert
    let r;
    try { r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${m[1]}.json?fields=product_name,brands,nutriments,serving_quantity`); }
    catch { throw new Error('Open Food Facts ist in dieser Demo nicht erreichbar. Mit dem echten Server funktioniert die Abfrage.'); }
    if (!r.ok) return { found: false };
    const j = await r.json(); const pr = j.product; if (!pr) return { found: false };
    const nu = pr.nutriments || {}; const fat = Number.isFinite(+nu.fat_100g) && nu.fat_100g !== '' ? +nu.fat_100g : null;
    const kcal = nu['energy-kcal_100g'] ?? (nu.energy_100g != null ? nu.energy_100g / 4.184 : 0);
    return { found: true, name: [pr.product_name, pr.brands && `(${String(pr.brands).split(',')[0]})`].filter(Boolean).join(' ') || `Produkt ${m[1]}`, per100: { fat: fat ?? 0, kcal: Math.round(+kcal || 0), carbs: +nu.carbohydrates_100g || 0, protein: +nu.proteins_100g || 0 }, servingGrams: +pr.serving_quantity || null, complete: fat != null, source: 'openfoodfacts' };
  }
  if (p === '/estimate') return estimateWithClaude(body);
  throw new Error('Unbekannte Route');
}
