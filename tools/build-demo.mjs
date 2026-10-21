// Baut demo/index.html: die komplette App als EINE Datei, ohne Server (Daten in localStorage).
// Aufruf: node tools/build-demo.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const strip = (src) => src.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');

// Bilder direkt in die Seite einbetten (der Viewer lädt keine Nachbardateien)
const b64 = (f) => readFileSync(new URL('../public/' + f, import.meta.url)).toString('base64');
const inlineImages = (h) => h.replace(/src="(icons\/[^"]+\.png|logo\.webp)"/g, (_, f) => `src="data:image/${f.endsWith('.png') ? 'png' : 'webp'};base64,${b64(f)}"`);
let html = r('public/index.html');
const DEMO_NOTE_SNACK = 'Die Anfrage läuft über dein eigenes Claude-Konto und verbraucht dessen Kontingent; es werden Auswahl, freiwillige Angaben und Namen heute erfasster Lebensmittel an Claude gesendet. Die Vorschläge sind ungenau und keine medizinische Beratung.';
const DEMO_NOTE = 'Die Anfrage läuft über dein eigenes Claude-Konto und verbraucht dessen Kontingent; es wird dazu ein verkleinertes Bild an Claude gesendet. Die Schätzung ist ungenau – Mengen und Fett bitte prüfen.';
html = inlineImages(html);
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).replace(/Google \(Gemini\)/g, 'Claude (dein Konto)').replace(/(<p class="(?:small muted|muted small)" id="aiNote">)[^<]*/g, '$1' + DEMO_NOTE).replace(/(<p class="(?:small muted|muted small)" id="snackNote">)[^<]*/g, '$1' + DEMO_NOTE_SNACK).replace('<!--demobar-->', '<div class="demobar">Demo · Daten nur in diesem Browser, unverschlüsselt</div>');
const css = r('public/style.css');
const js = [strip(r('public/calc.js')), strip(r('public/estimate.js')), strip(r('public/snack.js')), strip(r('public/report.js')), strip(r('tools/demo-api.js')), strip(r('public/scan.js')), strip(r('public/snack-ui.js')), strip(r('public/app.js'))].join('\n;\n');
const lib = r('public/vendor/barcode-detector.js');
const wasm = readFileSync(new URL('../public/vendor/zxing_reader.wasm', import.meta.url)).toString('base64');

// Blob-URLs statt Dateien: der Viewer erlaubt keine Nachlade-Dateien außerhalb der Seite.
const assets = `
globalThis.enzyDemo = true; // Drucken ist im Artifact-Viewer gesperrt; Dateien speichert die Viewer-Funktion "downloads"
globalThis.enzyDownloads = async () => { const d = await window.claude?.use('downloads'); if (!d) throw new Error('Speichern ist in dieser Ansicht nicht verfügbar.'); return d; };
const __lib = ${JSON.stringify(lib)};
const __wasm = '${wasm}';
const __urls = {};
globalThis.creonAssetUrl = (name) => {
  if (__urls[name]) return __urls[name];
  if (name.endsWith('.wasm')) { const b = Uint8Array.from(atob(__wasm), (c) => c.charCodeAt(0)); return (__urls[name] = URL.createObjectURL(new Blob([b], { type: 'application/wasm' }))); }
  return (__urls[name] = URL.createObjectURL(new Blob([__lib], { type: 'text/javascript' })));
};`;

const out = `<title>EnzyMate Pro</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}
</style>
${body}
<script>
${assets}
</script>
<script>
${js}
</script>
`;
mkdirSync(new URL('../demo/', import.meta.url), { recursive: true });
writeFileSync(new URL('../demo/index.html', import.meta.url), out);
console.log('demo/index.html', (out.length / 1e6).toFixed(2), 'MB');
