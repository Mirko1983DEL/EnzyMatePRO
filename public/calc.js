// Dosisberechnung (rein, ohne I/O – gut testbar; wird auch im Browser verwendet).
export const CAPSULE_SIZES = [10000, 25000, 35000];

/** Summiert Nährwerte aus Items: { grams, per100: { fat, kcal, carbs, protein } } */
export function totals(items) {
  const t = { grams: 0, fat: 0, kcal: 0, carbs: 0, protein: 0 };
  for (const it of items) {
    const f = (Number(it.grams) || 0) / 100;
    t.grams += Number(it.grams) || 0;
    for (const k of ['fat', 'kcal', 'carbs', 'protein']) t[k] += f * (Number(it.per100?.[k]) || 0);
  }
  for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}

/** Fettsumme OHNE Rundung (Grundlage der Dosisberechnung; `totals().fat` ist auf 0,1 g gerundet und nur für die Anzeige). */
export function fatExact(items) {
  let fat = 0;
  for (const it of items) fat += ((Number(it.grams) || 0) / 100) * (Number(it.per100?.fat) || 0);
  return fat;
}

/** Zeigt ein Kapselverhältnis auf `digits` Stellen, schneidet aber ab statt zu runden (1,496 wird nie als „1,50“ gezeigt). */
export function truncated(value, digits = 2) {
  const f = 10 ** digits;
  return Math.floor(value * f + 1e-9) / f;
}

/**
 * Lipase-Einheiten = Fett (g) × Lipase-Faktor (E/g Fett).
 * Kapseln werden auf ganze Kapseln gerundet (mind. 1, sobald Fett > 0).
 */
export function dose({ fatGrams, lipasePerGramFat, capsuleSize }) {
  if (!(lipasePerGramFat > 0) || !(capsuleSize > 0)) return { ok: false, reason: 'Lipase-Faktor oder Kapselgröße fehlt.' };
  const units = Math.round(fatGrams * lipasePerGramFat);
  const exact = units / capsuleSize;
  const capsules = fatGrams > 0 ? Math.max(1, Math.round(exact)) : 0;
  return { ok: true, units, exact, exactCapsules: Math.round(exact * 100) / 100, capsules, givenUnits: capsules * capsuleSize };
}

/** Erwartete Tagessumme an Lipase-Einheiten pro kg (nur Hinweis, keine Verordnung). */
export function unitsPerKg(units, weightKg) {
  return weightKg > 0 ? Math.round(units / weightKg) : null;
}

/** Empfohlene Einheiten einer gespeicherten Mahlzeit (Altbestand ohne Feld: aus Fett × Faktor). */
export function recommendedUnits(m) {
  return m.recommendedUnits ?? Math.round((m.totals?.fat || 0) * (m.lipasePerGramFat || 0));
}

/** Zeitraum [from, to) für Tag/Woche (Mo–So)/Monat um ein Ankerdatum. */
export function rangeFor(mode, anchor) {
  const from = new Date(anchor); from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  if (mode === 'week') { from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to.setTime(from.getTime()); to.setDate(to.getDate() + 7); }
  else if (mode === 'month') { from.setDate(1); to.setTime(from.getTime()); to.setMonth(to.getMonth() + 1); }
  else to.setDate(to.getDate() + 1);
  return { from, to };
}

/** Anzahl Kalendertage im Zeitraum, höchstens bis heute (für Ø pro Tag). */
export function elapsedDays(from, to, now = new Date()) {
  const end = Math.min(to.getTime(), startOfNextDay(now));
  return Math.max(1, Math.round((end - from.getTime()) / 86400000));
}
function startOfNextDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + 1); return x.getTime(); }

/** Summen über Mahlzeiten: Nährwerte, genommene und empfohlene Lipase-Einheiten, Tagesdurchschnitt. */
export function summarize(meals, days = 1) {
  const s = { meals: meals.length, kcal: 0, fat: 0, carbs: 0, protein: 0, capsules: 0, units: 0, recommended: 0, days };
  for (const m of meals) {
    for (const k of ['kcal', 'fat', 'carbs', 'protein']) s[k] += m.totals[k];
    s.capsules += m.capsules; s.units += m.capsules * m.capsuleSize; s.recommended += recommendedUnits(m);
  }
  const r = (v) => Math.round(v * 10) / 10;
  for (const k of ['kcal', 'fat', 'carbs', 'protein']) s[k] = r(s[k]);
  s.perDay = { kcal: Math.round(s.kcal / days), fat: r(s.fat / days), capsules: r(s.capsules / days), units: Math.round(s.units / days) };
  return s;
}
