# EnzyMate Pro

> Eigenständige Kopie von EnzyMate (Stand: Commit `79b9e00` aus `mirko1983del/cf`, Branch `claude/creon-app-redesign-jr0otc`). Eigene Daten, eigener Schlüssel, eigener Port. **Nicht medizinisch validiert; die Berechnungslogik ist unverändert aus EnzyMate übernommen.** Siehe `docs/KOPIE_BERICHT.md` und `docs/ENTWICKLUNGSPLAN_PRO.md`.

Schlanke Web-App: Kreon-Menge pro Mahlzeit berechnen und Mahlzeiten/Nährwerte protokollieren. Ein Patient, kein Login (vorbereitet).

## Start
```
npm start          # Node >= 22.5, keine Abhängigkeiten
npm test
```
Umgebungsvariablen (Muster siehe `.env.example`; das Original EnzyMate nutzt `ENZYMATE_PRO_KEY`, Pro dagegen `ENZYMATE_PRO_KEY` – bewusst verschieden):

| Variable | Zweck |
|---|---|
| `PORT` | Standard **3100** (EnzyMate: 3000) |
| `DATA_DIR` | Standard `./data` (DB + Schlüsseldatei) |
| `ENZYMATE_PRO_KEY` | 32-Byte-Schlüssel (64 Hex-Zeichen). `openssl rand -hex 32`. Ohne Angabe wird `data/secret.key` (nur in diesem Projektordner) erzeugt. |
| `GEMINI_API_KEY` | Schlüssel für die Foto-Schätzung (Google AI Studio). Ohne ihn ist die KI aus; Barcode-Scan funktioniert trotzdem. |
| `GEMINI_MODEL` | Standard `gemini-flash-lite-latest` (ungeprüft – bei Fehler Modellname in AI Studio nachsehen und hier setzen). |
| `ACCESS_TOKEN` | Optional: gemeinsamer Zugriffscode (Header `x-access-token`). **Auf einem öffentlichen Server unbedingt setzen**, solange es keinen Login gibt. |

## Berechnung
`Lipase-Einheiten = Fett (g) × Lipase-Faktor (E/g Fett)`; `Kapseln = Einheiten ÷ Kapselgröße`, gerundet auf ganze Kapseln (per +/− anpassbar).
Den Faktor legt die behandelnde Ärztin / der behandelnde Arzt fest. Die App ersetzt keine ärztliche Dosierung.

## Scan: Barcode oder KI
1. Foto wird **im Browser** nach einem Barcode (EAN/UPC) durchsucht (eingebauter `BarcodeDetector`, sonst mitgelieferte zxing-Bibliothek in `public/vendor/`, MIT-Lizenz).
2. Barcode gefunden → nur die Nummer geht an die Open-Food-Facts-Datenbank (Nährwerte pro 100 g).
3. Kein Barcode / Produkt unbekannt → die KI (Gemini) **schätzt automatisch** Zutaten, Mengen und Nährwerte, ohne Auswahl. Vor der ersten Nutzung erscheint einmalig ein Hinweis mit Einwilligung (gemerkt im Browser); ohne Einwilligung geht nichts an die KI. Erkennt die KI kein Essen, erscheint das Pop-up „Kein Essen erkannt“ (Neuer Versuch / Abbrechen). Ist die KI nicht eingerichtet, erklärt ein Pop-up das. Einträge sind als „KI-Schätzung“ markiert und per Antippen korrigierbar.
Der API-Schlüssel liegt nur auf dem Server; KI-Aufrufe sind auf 10/Minute begrenzt.

## Verlauf & Auswertung
Jede gespeicherte Mahlzeit enthält Lebensmittel, Nährwerte, genommene Kapseln (Größe × Anzahl) und die **zum Zeitpunkt der Einnahme empfohlene Lipase-Menge**. Der Verlauf summiert für Tag, Woche (Mo–So), Monat oder einen frei gewählten Zeitraum: Nährwerte, Kapseln, Einheiten genommen/empfohlen, Ø pro Tag und Einheiten pro kg.
Die zuletzt gewählte Kreon-Größe bleibt gespeichert; eine neue Mahlzeit startet immer leer.

## Datenschutz / Verschlüsselung
- Format v2: jeder Wert ist an Tabelle, Nutzer und Zeile gebunden (vertauschte Werte werden erkannt). Faktor und Kapselgröße einer Mahlzeit bestimmt der Server aus dem Profil.
- Alle Inhalte (Patientendaten, Lebensmittel, Mahlzeiten, Einstellungen) liegen **feldweise mit AES-256-GCM verschlüsselt** in SQLite. Im Klartext bleiben nur IDs und der Zeitstempel einer Mahlzeit.
- Schlüssel getrennt von der Datenbank aufbewahren (Backup!). Ohne Schlüssel sind die Daten unlesbar.
- Mahlzeiten-Fotos werden nicht gespeichert. Bei KI-Nutzung gehen sie an Google; in der kostenlosen Stufe darf Google Eingaben laut Preisseite zur Produktverbesserung nutzen (nur aus Sekundärquellen belegt, bitte in den aktuellen Google-Bedingungen prüfen).
- **Transportverschlüsselung** (HTTPS) übernimmt ein Reverse-Proxy (z. B. Caddy/nginx); die App selbst spricht nur HTTP.

## Tests, Migrationen, Prüfwerkzeuge
- `npm test`: 52 Tests (Logik, Datenbank, Sicherheit, Plausibilität, 13 Browser-Tests mit Chromium; Open Food Facts und Gemini darin nachgebaut). Für die Browser-Tests `npm install` (Entwicklungs-Abhängigkeit `playwright-core`) und ein Chromium (Pfad per `CHROMIUM_PATH`); ohne beides werden sie mit Begründung übersprungen.
- `npm run test:live`: **echte** Dienste (Open Food Facts; Gemini mit `GEMINI_API_KEY` und `-- --photo bild.jpg`). Nur ein Lauf dieses Befehls belegt „live getestet“.
- Datenbankschema: nummerierte Migrationen (`db.js`), automatische Sicherung vor jeder Migration.
- `npm run migrate:encryption`: Altdaten (Format v1) auf v2 umschlüsseln – nur auf ausdrücklichen Aufruf, mit Sicherung.

## Login später
Alle Tabellen haben `user_id`; `resolveUser()` in `server.js` ist die einzige Stelle, die später durch Sessions/Login ersetzt werden muss.

## Demo (ohne Server)
`node tools/build-demo.mjs` erzeugt `demo/index.html`: die ganze App als eine Datei, Daten nur im Browser (localStorage, **unverschlüsselt**). Open Food Facts ist dort je nach Umgebung nicht erreichbar. Die KI-Schätzung nutzt in der Demo Claude über die Artifact-Funktion `sample` (Konto des Betrachters) statt Gemini.

## Logo und Symbole
`public/logo.webp` (freigestelltes Logo, Startbildschirm) und `public/icons/` (App-Symbol in 64/96/180/192/512 px; `apple-touch-icon.png` ist randlos, die übrigen haben transparente Ecken). Die Ein-Datei-Demo bettet die Bilder per Data-URI ein.

## Bericht & Export
Verlauf → „Bericht“ fasst den gewählten Zeitraum für ein Arztgespräch zusammen (Kennzahlen, Diagramme, Mahlzeitentabelle). Export als Druck/PDF, CSV (Semikolon, Dezimalkomma, UTF-8 mit BOM) oder Text. Grundlage sind nur gespeicherte Mahlzeiten; `public/report.js` enthält die (getestete) Logik.
