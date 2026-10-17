import { PROMPT, normalizeEstimate } from './public/estimate.js';

// Externe Nährwert-Quellen: Open Food Facts (Barcode) und Gemini (Foto-Schätzung).
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const UA = 'EnzyMatePro/1.0 (private, single user)';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

const n = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);

export async function lookupBarcode(code, { fetchImpl = fetch } = {}) {
  if (!/^\d{8,14}$/.test(code)) return { error: 'Ungültiger Barcode', status: 400 };
  const fields = 'product_name,brands,nutriments,serving_quantity';
  let res;
  try { res = await fetchImpl(`${OFF_URL}${code}.json?fields=${fields}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) }); }
  catch { return { error: 'Open Food Facts nicht erreichbar', status: 502 }; }
  if (res.status === 404) return { found: false };
  if (!res.ok) return { error: 'Open Food Facts nicht erreichbar', status: 502 };
  const data = await res.json();
  const p = data.product;
  if (data.status === 0 || !p) return { found: false };
  const nu = p.nutriments || {};
  const kcal = n(nu['energy-kcal_100g']) ?? (n(nu['energy_100g']) != null ? nu['energy_100g'] / 4.184 : null);
  const fat = n(nu['fat_100g']);
  return {
    found: true,
    name: [p.product_name, p.brands && `(${String(p.brands).split(',')[0]})`].filter(Boolean).join(' ') || `Produkt ${code}`,
    per100: { fat: fat ?? 0, kcal: kcal == null ? 0 : Math.round(kcal), carbs: n(nu['carbohydrates_100g']) ?? 0, protein: n(nu['proteins_100g']) ?? 0 },
    servingGrams: n(p.serving_quantity),
    complete: fat != null, // ohne Fettangabe ist keine Dosisberechnung möglich
    source: 'openfoodfacts',
  };
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, grams: { type: 'NUMBER' }, fatPer100: { type: 'NUMBER' },
      kcalPer100: { type: 'NUMBER' }, carbsPer100: { type: 'NUMBER' }, proteinPer100: { type: 'NUMBER' },
    }, required: ['name', 'grams', 'fatPer100', 'kcalPer100', 'carbsPer100', 'proteinPer100'] } },
  },
  required: ['items'],
};

export async function estimateWithGemini({ base64, mime }, { apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) return { error: 'KI nicht konfiguriert (GEMINI_API_KEY fehlt)', status: 503 };
  let res;
  try {
    res = await fetchImpl(`${GEMINI_URL}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
  } catch { return { error: 'KI nicht erreichbar', status: 502 }; }
  if (res.status === 429) return { error: 'KI-Kontingent aktuell aufgebraucht – später erneut versuchen oder manuell eintragen', status: 429 };
  if (!res.ok) {
    // Fehlertext des Anbieters nur gekürzt und ohne Schlüssel protokollieren (Anbieter könnten Anfragedetails zurückspiegeln).
    const body = (await res.text()).split(apiKey).join('***').slice(0, 160);
    console.error('[gemini]', res.status, body);
    return { error: `KI-Anfrage fehlgeschlagen (${res.status})`, status: 502 };
  }
  let parsed;
  try { parsed = JSON.parse((await res.json()).candidates[0].content.parts[0].text); }
  catch { return { error: 'KI-Antwort nicht lesbar', status: 502 }; }
  return { items: normalizeEstimate(parsed) };
}
