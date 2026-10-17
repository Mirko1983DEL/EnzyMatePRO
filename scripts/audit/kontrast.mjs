// Audit-Skript (Stand 16.10.2026) – siehe scripts/audit/README.md. Verändert keine Projektdateien; schreibt nur in temporäre Ordner.
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../public/style.css', import.meta.url), 'utf8');
const grab = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map((m) => [m[1], m[2].length === 4 ? '#' + [...m[2].slice(1)].map((c) => c + c).join('') : m[2]]));
const light = grab(/:root\{([^}]*)\}/), dark = { ...light, ...grab(/:root\[data-theme=dark\]\{([^}]*)\}/) };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['Haupttext auf Hintergrund', 'ink', 'bg'], ['Haupttext auf Karte', 'ink', 'surface'], ['Grauer Text auf Hintergrund', 'muted', 'bg'], ['Grauer Text auf Karte', 'muted', 'surface'], ['Knopftext auf Akzent', 'accent-ink', 'accent'], ['Akzent-Text (Links) auf Hintergrund', 'accent', 'bg'], ['Akzent-Text auf Karte', 'accent', 'surface'], ['Warnhinweis', 'warn', 'warn-soft'], ['Fehler/Löschen auf Karte', 'danger', 'surface'], ['KI-Marke (Warnfarbe) auf Hinweisfläche', 'warn', 'warn-soft'], ['OFF-Marke (Akzent) auf Akzentfläche', 'accent', 'accent-soft']];
console.log('Kontrast | Hell | Dunkel | WCAG AA normaler Text (≥ 4,5)');
for (const [n, f, b] of pairs) { const l = ratio(light[f], light[b]), d = ratio(dark[f], dark[b]); console.log(`${n.padEnd(40)} ${l.toFixed(2).padStart(5)}  ${d.toFixed(2).padStart(5)}   ${l >= 4.5 ? 'ok' : 'UNTER 4,5'} / ${d >= 4.5 ? 'ok' : 'UNTER 4,5'}`); }
console.log('\nHinweis: kleine Schrift (Marken .7rem, Nebenzeilen .85rem) fällt unter „normaler Text“; Schwelle 4,5. Die Werte gelten für die Tokenfarben, nicht für Bildinhalte.');
