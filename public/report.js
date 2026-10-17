// Bericht für das Arztgespräch: reine Funktionen (Kennzahlen, CSV, Text, Diagramme als SVG).
// Grundlage sind ausschließlich die gespeicherten Mahlzeiten; nicht gespeicherte Tage/Mahlzeiten fließen nicht ein.
import { recommendedUnits } from './calc.js';

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const r1 = (v) => Math.round(v * 10) / 10;
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

/**
 * Kennzahlen über einen Zeitraum [range.from, range.to).
 * Durchschnitte beziehen sich nur auf Tage MIT gespeicherten Einträgen (sonst würden nicht erfasste Tage den Wert verfälschen).
 */
export function buildReport({ meals, range, patient, now = new Date() }) {
  const sorted = [...meals].sort((a, b) => a.ts.localeCompare(b.ts));
  const last = new Date(Math.min(range.to.getTime() - 1, now.getTime()));
  const days = [], byKey = new Map();
  const addDay = (d) => { const e = { key: dayKey(d), date: new Date(d), meals: 0, fat: 0, kcal: 0, carbs: 0, protein: 0, capsules: 0, unitsTaken: 0, unitsRec: 0 }; byKey.set(e.key, e); days.push(e); return e; };
  for (const d = new Date(range.from); d <= last; d.setDate(d.getDate() + 1)) addDay(d);
  if (!days.length) addDay(range.from);

  for (const m of sorted) {
    const d = new Date(m.ts), e = byKey.get(dayKey(d)) || addDay(d);
    e.meals++; e.fat += m.totals.fat; e.kcal += m.totals.kcal; e.carbs += m.totals.carbs; e.protein += m.totals.protein;
    e.capsules += m.capsules; e.unitsTaken += m.capsules * m.capsuleSize; e.unitsRec += recommendedUnits(m);
  }
  days.sort((a, b) => a.key.localeCompare(b.key));

  const total = { meals: sorted.length, fat: r1(sum(days, (d) => d.fat)), kcal: Math.round(sum(days, (d) => d.kcal)), carbs: r1(sum(days, (d) => d.carbs)), protein: r1(sum(days, (d) => d.protein)),
    capsules: sum(days, (d) => d.capsules), unitsTaken: sum(days, (d) => d.unitsTaken), unitsRec: sum(days, (d) => d.unitsRec) };
  const entryDays = days.filter((d) => d.meals > 0).length;
  const per = (v) => (entryDays ? v / entryDays : null);
  const avg = entryDays ? { fat: r1(per(total.fat)), kcal: Math.round(per(total.kcal)), carbs: r1(per(total.carbs)), protein: r1(per(total.protein)), capsules: r1(per(total.capsules)), unitsTaken: Math.round(per(total.unitsTaken)) } : null;

  const fatMeals = sorted.filter((m) => m.totals.fat > 0);
  const fatSum = sum(fatMeals, (m) => m.totals.fat), takenOnFat = sum(fatMeals, (m) => m.capsules * m.capsuleSize);
  const ratio = (m) => (recommendedUnits(m) > 0 ? (m.capsules * m.capsuleSize) / recommendedUnits(m) : null);
  const items = sorted.flatMap((m) => m.items);

  return {
    days, entryDays, dayCount: days.length, total, avg,
    dosePerGramFat: fatSum > 0 ? Math.round(takenOnFat / fatSum) : null,        // tatsächlich genommene E pro g Fett
    factorProfile: patient?.lipasePerGramFat ?? null,
    coverage: total.unitsRec > 0 ? Math.round((total.unitsTaken / total.unitsRec) * 100) : null, // genommen / empfohlen in %
    unitsPerKgDay: patient?.weightKg > 0 && avg ? Math.round(avg.unitsTaken / patient.weightKg) : null,
    noKreon: fatMeals.filter((m) => m.capsules === 0).length,                    // Mahlzeiten mit Fett, aber ohne Kreon
    low: fatMeals.filter((m) => m.capsules > 0 && ratio(m) !== null && ratio(m) < 0.75).length,
    high: fatMeals.filter((m) => ratio(m) !== null && ratio(m) > 1.5).length,
    aiItems: items.filter((i) => i.source === 'ai').length, itemCount: items.length,
    meals: sorted,
  };
}

// ---------- CSV (Excel Deutschland: Semikolon, Dezimalkomma, UTF-8 mit BOM) ----------
const SOURCE_LABEL = { ai: 'KI-Schätzung', openfoodfacts: 'Open Food Facts', manual: 'manuell' };
const numDe = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // verhindert Formel-Ausführung in Tabellenprogrammen
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(meals) {
  const head = ['Datum', 'Uhrzeit', 'Lebensmittel', 'Fett (g)', 'kcal', 'Kohlenhydrate (g)', 'Eiweiß (g)', 'Kreon-Kapseln', 'Kapselgröße (E)', 'Lipase genommen (E)', 'Lipase empfohlen (E)', 'Faktor (E/g Fett)', 'Quelle'];
  const rows = [...meals].sort((a, b) => a.ts.localeCompare(b.ts)).map((m) => {
    const d = new Date(m.ts), src = [...new Set(m.items.map((i) => SOURCE_LABEL[i.source] || SOURCE_LABEL.manual))].join(' / ');
    return [`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`, m.items.map((i) => `${i.name} (${numDe(i.grams, 0)} g)`).join(' + '),
      numDe(m.totals.fat), numDe(m.totals.kcal, 0), numDe(m.totals.carbs), numDe(m.totals.protein), m.capsules, m.capsuleSize, m.capsules * m.capsuleSize, recommendedUnits(m), m.lipasePerGramFat, src];
  });
  return '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// ---------- Text (zum Kopieren/Einfügen) ----------
const deNum = (n, d = 0) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: d });
export function toText(rep, patient, label) {
  const L = [];
  L.push(`Kreon-Protokoll (EnzyMate Pro) – ${label}`);
  if (patient?.name) L.push(`${patient.name}${patient.weightKg ? `, ${deNum(patient.weightKg, 1)} kg` : ''}${patient.heightCm ? `, ${deNum(patient.heightCm)} cm` : ''}${rep.factorProfile ? `, Lipase-Faktor ${deNum(rep.factorProfile)} E/g Fett` : ''}`);
  L.push('Grundlage: nur gespeicherte Mahlzeiten; Angaben vom Nutzer, teils geschätzt. Keine ärztliche Dosierung.', '');
  L.push(`Tage mit Einträgen: ${rep.entryDays} von ${rep.dayCount} · Mahlzeiten: ${rep.total.meals}`);
  if (rep.avg) L.push(`Ø pro Tag mit Einträgen: ${deNum(rep.avg.fat, 1)} g Fett, ${deNum(rep.avg.kcal)} kcal, ${deNum(rep.avg.capsules, 1)} Kapseln, ${deNum(rep.avg.unitsTaken)} E${rep.unitsPerKgDay ? ` (${deNum(rep.unitsPerKgDay)} E/kg)` : ''}`);
  if (rep.dosePerGramFat !== null) L.push(`Genommen: ${deNum(rep.dosePerGramFat)} E pro g Fett${rep.factorProfile ? ` (Faktor im Profil: ${deNum(rep.factorProfile)})` : ''}`);
  if (rep.coverage !== null) L.push(`Genommen im Verhältnis zur Empfehlung: ${rep.coverage} %`);
  L.push(`Mahlzeiten mit Fett ohne Kreon: ${rep.noKreon} · unter 75 % der Empfehlung: ${rep.low} · über 150 %: ${rep.high}`);
  if (rep.itemCount) L.push(`Geschätzte Einträge (KI): ${rep.aiItems} von ${rep.itemCount}`);
  L.push('');
  let lastKey = '';
  for (const m of rep.meals) {
    const d = new Date(m.ts), k = dayKey(d);
    if (k !== lastKey) { lastKey = k; L.push(d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })); }
    L.push(`  ${pad(d.getHours())}:${pad(d.getMinutes())}  ${m.items.map((i) => `${i.name} (${deNum(i.grams)} g)`).join(' + ')} – ${deNum(m.totals.fat, 1)} g Fett – ${m.capsules} × Kreon ${deNum(m.capsuleSize)} (${deNum(m.capsules * m.capsuleSize)} E, empfohlen ${deNum(recommendedUnits(m))} E)`);
  }
  return L.join('\n');
}

// ---------- Diagramme (SVG-Text; Farben über CSS-Klassen/Tokens) ----------
const W = 360, H = 190, ML = 50, MR = 6, MT = 10, MB = 26;
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** series: [{ key, cls }] – je Tag ein Balken je Serie. Tage ohne Einträge: Punkt auf der Grundlinie. */
export function barChartSvg(days, series, { unit = '', title = '' } = {}) {
  const max = niceMax(Math.max(0, ...days.flatMap((d) => series.map((s) => d[s.key]))));
  const pw = W - ML - MR, ph = H - MT - MB, slot = pw / days.length, gap = Math.min(3, slot * 0.2);
  const bw = Math.max(1.5, (slot - gap) / series.length);
  const y = (v) => MT + ph - (v / max) * ph;
  const out = [`<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg"><title>${title}</title>`];
  for (let i = 0; i <= 5; i++) {
    const v = (max / 5) * i, yy = y(v);
    out.push(`<line class="grid" x1="${ML}" x2="${W - MR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/>`, `<text class="tick" x="${ML - 5}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${deNum(v, v < 10 && v % 1 ? 1 : 0)}</text>`);
  }
  const step = days.length <= 8 ? 1 : Math.ceil(days.length / 8);
  days.forEach((d, i) => {
    const x0 = ML + i * slot + (slot - series.length * bw) / 2;
    if (d.meals === 0) out.push(`<circle class="none" cx="${(ML + i * slot + slot / 2).toFixed(1)}" cy="${(MT + ph - 3).toFixed(1)}" r="2"/>`);
    series.forEach((s, j) => { const h = (d[s.key] / max) * ph; if (h > 0) out.push(`<rect class="${s.cls}" x="${(x0 + j * bw).toFixed(1)}" y="${y(d[s.key]).toFixed(1)}" width="${(bw - 0.5).toFixed(1)}" height="${h.toFixed(1)}" rx="1"/>`); });
    if (i % step === 0) out.push(`<text class="tick" x="${(ML + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${pad(d.date.getDate())}.${days.length <= 8 ? pad(d.date.getMonth() + 1) + '.' : ''}</text>`);
  });
  if (unit) out.push(`<text class="tick" x="${ML}" y="${MT - 2}" text-anchor="start">${unit}</text>`);
  out.push('</svg>');
  return out.join('');
}
