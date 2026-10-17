// Von Server (Gemini) und Demo (Claude im Artifact) gemeinsam genutzt: Prompt und Prüfung der KI-Antwort.
const n = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);
const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const PROMPT = `Du bist Ernährungsassistent. Analysiere das Foto einer Mahlzeit.
Gib jedes erkennbare Lebensmittel/Bestandteil als eigenen Eintrag zurück (z. B. "Spaghetti" und "Sahnesoße" getrennt).
Schätze für jeden Eintrag die sichtbare Portionsmenge in Gramm (zubereitet/gegart) und die Nährwerte pro 100 g des zubereiteten Lebensmittels:
Fett, Kilokalorien, Kohlenhydrate, Eiweiß. Sei bei Fett realistisch (verstecktes Fett in Soßen, Öl, Käse, Frittiertem beachten).
Wenn kein Essen erkennbar ist, gib eine leere Liste zurück. Namen auf Deutsch. Antworte nur im vorgegebenen JSON-Format.`;

/** Zusatz für Anbieter ohne Schema-Zwang (Demo): gewünschtes JSON-Format. */
export const JSON_FORMAT_HINT = `Antworte ausschließlich mit JSON ohne weiteren Text, genau in dieser Form:
{"items":[{"name":"Spaghetti","grams":250,"fatPer100":1.5,"kcalPer100":150,"carbsPer100":30,"proteinPer100":5}]}`;

/**
 * Technische Plausibilitätsprüfung für Nährwerte je 100 g (KEINE medizinische Bewertung).
 * Liefert Hinweis-Codes; die Werte selbst werden hier nicht verändert. Wer einen Eintrag mit Hinweisen übernimmt,
 * muss ihn vorher ansehen und bestätigen.
 *   fat_missing    Fettwert fehlt oder war keine Zahl (Rechenwert 0 wäre eine stille Unterdosierung)
 *   grams_missing  Menge fehlt (100 g angenommen)
 *   sum_over_100   Fett + Kohlenhydrate + Eiweiß > 100 g je 100 g (physikalisch nicht möglich; 1 g Toleranz)
 *   kcal_mismatch  Kalorien weichen stark vom Rechenwert 9·Fett + 4·Kohlenhydrate + 4·Eiweiß ab
 *                  (Schwelle: mehr als 60 kcal UND mehr als 35 % Abweichung; Ballaststoffe/Alkohol machen kleine Abweichungen normal)
 *   clamped        Wert lag außerhalb des möglichen Bereichs und wurde begrenzt
 */
export const ISSUE_TEXT = {
  fat_missing: 'Der Fettwert fehlt oder war keine Zahl. Bitte eintragen.',
  grams_missing: 'Die Menge fehlt, es wurden 100 g angenommen. Bitte prüfen.',
  sum_over_100: 'Fett, Kohlenhydrate und Eiweiß ergeben zusammen mehr als 100 g je 100 g. Das ist nicht möglich. Bitte prüfen.',
  kcal_mismatch: 'Die Kalorien passen nicht zu Fett, Kohlenhydraten und Eiweiß. Bitte prüfen.',
  clamped: 'Ein Wert lag außerhalb des möglichen Bereichs und wurde begrenzt. Bitte prüfen.',
};
export function plausibilityIssues(per100, { fatKnown = true, gramsKnown = true, clamped = false } = {}) {
  const issues = [];
  if (!fatKnown) issues.push('fat_missing');
  if (!gramsKnown) issues.push('grams_missing');
  const f = Number(per100?.fat) || 0, c = Number(per100?.carbs) || 0, p = Number(per100?.protein) || 0, k = Number(per100?.kcal) || 0;
  if (f + c + p > 101) issues.push('sum_over_100');
  const est = 9 * f + 4 * c + 4 * p;
  if (k > 0 && est > 0 && Math.abs(k - est) > 60 && Math.abs(k - est) / est > 0.35) issues.push('kcal_mismatch');
  if (clamped) issues.push('clamped');
  return issues;
}

/** Prüft und begrenzt die KI-Antwort. Fehlende Werte werden markiert (needsReview), nicht stillschweigend zu 0. */
export function normalizeEstimate(parsed) {
  return (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 15).map((i) => {
    const raw = { grams: n(i.grams), fat: n(i.fatPer100), kcal: n(i.kcalPer100), carbs: n(i.carbsPer100), protein: n(i.proteinPer100) };
    const out = (v, lo, hi) => v !== null && (v < lo || v > hi);
    const clamped = out(raw.grams, 1, 2000) || out(raw.fat, 0, 100) || out(raw.kcal, 0, 900) || out(raw.carbs, 0, 100) || out(raw.protein, 0, 100);
    const per100 = {
      fat: round1(clamp(raw.fat ?? 0, 0, 100)), kcal: Math.round(clamp(raw.kcal ?? 0, 0, 900)),
      carbs: round1(clamp(raw.carbs ?? 0, 0, 100)), protein: round1(clamp(raw.protein ?? 0, 0, 100)),
    };
    const issues = plausibilityIssues(per100, { fatKnown: raw.fat !== null, gramsKnown: raw.grams !== null, clamped });
    return { name: String(i.name || 'Lebensmittel').slice(0, 80), grams: round1(clamp(raw.grams ?? 100, 1, 2000)), per100, source: 'ai', issues, needsReview: issues.length > 0 };
  });
}
