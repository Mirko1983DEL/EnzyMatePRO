// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
// Gezielte Prüfung rund um die Sommerzeit-Umstellung (Europa: 25.10.2026, 03:00 → 02:00)
import { rangeFor, elapsedDays, summarize } from '../../public/calc.js';
import { buildReport, dayKey } from '../../public/report.js';
const out = [];
const wk = rangeFor('week', new Date(2026, 9, 25, 12));          // Sonntag der Umstellung
out.push(['Woche um Umstellung', wk.from.toString().slice(0, 33), '→', wk.to.toString().slice(0, 33), 'Stunden:', (wk.to - wk.from) / 36e5]);
const mo = rangeFor('month', new Date(2026, 9, 15));
out.push(['Monat Oktober Stunden', (mo.to - mo.from) / 36e5, '(31×24=744 ohne Umstellung)']);
out.push(['elapsedDays Woche (heute So 25.10. 23:00)', elapsedDays(wk.from, wk.to, new Date(2026, 9, 25, 23, 0))]);
const m = (d, h) => ({ ts: new Date(2026, 9, d, h, 30).toISOString(), items: [{ name: 'x', grams: 100, per100: { fat: 10 } }], totals: { fat: 10, kcal: 100, carbs: 0, protein: 0 }, capsules: 1, capsuleSize: 25000, lipasePerGramFat: 2000, recommendedUnits: 20000 });
const rep = buildReport({ meals: [m(25, 0), m(25, 2), m(25, 23), m(26, 0)], range: wk, patient: {}, now: new Date(2026, 9, 27) });
out.push(['Tage im Bericht', rep.days.map((d) => d.key).join(' '), '| Mahlzeiten je Tag:', rep.days.map((d) => d.meals).join(',')]);
for (const o of out) console.log(...o);
