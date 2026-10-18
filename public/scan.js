import { plausibilityIssues } from './estimate.js';
// Foto -> Barcode (lokal im Browser) -> Open Food Facts; ohne Barcode/Treffer -> automatisch KI-Schätzung (nach einmaliger Einwilligung).
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let detectorPromise;
// Standard: Dateien aus vendor/. Die Einzeldatei-Demo setzt globalThis.creonAssetUrl (Blob-URLs).
const assetUrl = (name) => (globalThis.creonAssetUrl ? globalThis.creonAssetUrl(name) : 'vendor/' + name);

function getDetector() {
  detectorPromise ??= (async () => {
    if ('BarcodeDetector' in window) {
      try { return new BarcodeDetector({ formats: FORMATS }); } catch { /* fällt auf Polyfill zurück */ }
    }
    await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = assetUrl('barcode-detector.js'); s.onload = ok; s.onerror = fail; document.head.append(s); });
    BarcodeDetectionAPI.setZXingModuleOverrides({ locateFile: (f) => assetUrl(f) });
    return new BarcodeDetectionAPI.BarcodeDetector({ formats: FORMATS });
  })();
  return detectorPromise;
}

async function toBitmap(file, maxSide) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

async function findBarcode(canvas) {
  try { const r = await (await getDetector()).detect(canvas); return r[0]?.rawValue || null; } catch { return null; }
}

const blobToBase64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

/** Liefert { items, note }, { retry: true } (neues Foto) oder null (abgebrochen). Wirft bei Fehlern. */
export async function scanImage(file, { api, ai, confirmAi, notify, status }) {
  const big = await toBitmap(file, 1600);
  const code = await findBarcode(big);
  if (code) {
    status(`Barcode ${code} gefunden – frage Open Food Facts …`);
    const p = await api('/barcode/' + code);
    if (p.found) {
      const issues = plausibilityIssues(p.per100, { fatKnown: p.complete, gramsKnown: true });
      const item = { name: p.name, grams: p.servingGrams || 100, per100: p.per100, source: 'openfoodfacts', issues, needsReview: issues.length > 0 };
      return { items: [item], note: p.complete
        ? `${p.name}: Nährwerte pro 100 g aus Open Food Facts. Menge ${item.grams} g – bitte anpassen (antippen).`
        : `${p.name}: In Open Food Facts fehlt die Fettangabe – bitte Fett pro 100 g ergänzen (antippen).` };
    }
  }
  // Barcode fehlt/unbekannt: ohne Rückfrage weiter mit der KI. Ist sie nicht eingerichtet, erklärt ein Pop-up das.
  const retryOrStop = (choice) => (choice === 'retry' ? { retry: true } : null);
  if (!ai) {
    return retryOrStop(await notify({ title: 'Kein Barcode erkannt', message: (code ? `Barcode ${code} ist nicht in Open Food Facts.` : 'Auf dem Foto wurde kein Barcode erkannt.') + ' Die KI ist nicht eingerichtet.' }));
  }
  if (!(await confirmAi())) return null;
  status(code ? 'Produkt unbekannt – KI schätzt das Essen …' : 'Kein Barcode – KI schätzt das Essen …');
  const small = await toBitmap(file, 1024);
  const blob = await new Promise((ok) => small.toBlob(ok, 'image/jpeg', 0.8));
  const r = await api('/estimate', 'POST', { image: await blobToBase64(blob), mime: 'image/jpeg' });
  if (!r.items.length) return retryOrStop(await notify({ title: 'Kein Essen erkannt', message: 'Auf dem Foto konnte kein Essen erkannt werden. Bitte neu fotografieren.' }));
  return { items: r.items, note: 'KI-Schätzung – Mengen und Fett bitte prüfen (Eintrag antippen zum Korrigieren).' };
}
