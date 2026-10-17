# Kopie-Bericht EnzyMate → EnzyMate Pro

## Herkunft
- Dieses Repository: `Mirko1983DEL/enzymatepro` (privat laut Anlage durch den Nutzer; Sichtbarkeit von Claude nicht geprüft). Der Produktname bleibt „EnzyMate Pro"; technische Namen im Code (`enzymate-pro`) sind davon unabhängig.
- Die Historie enthält zusätzlich den automatischen GitHub-„Initial commit" (nur eine Titel-README), per Merge übernommen.
- Quelle: `mirko1983del/cf`, Branch `claude/creon-app-redesign-jr0otc` (einziger Branch), Commit `79b9e0039b31c8ccb34654b64c6b6b1dd7779ea2` (17.10.2026).
- Kopie per `git archive` (ohne Historie), frischer Start in diesem Repository. Das Original wurde nicht verändert (Git-Status dort: sauber).
- Nicht übernommen: Git-Historie. Es gab keine Datenbanken, Schlüssel oder `.env`-Dateien im Original.

## Geänderte Dateien (alle übrigen sind byte-identisch)
| Datei | Änderung |
|---|---|
| `package.json` | Name `enzymate-pro` |
| `server.js` | Port-Standard 3100, DB-Datei `enzymate-pro.db`, Anzeigename/Logpräfix |
| `crypto.js` | Schlüssel-Variable `ENZYMATE_PRO_KEY` statt `CREON_KEY`, Logtext (Verschlüsselungslogik unverändert) |
| `analyze.js` | User-Agent `EnzyMatePro/1.0` |
| `public/index.html`, `manifest.webmanifest`, `app.js`, `report.js` | Produktname, Titel, Manifest, Berichtstext, CSV-Dateiname `enzymate-pro-kreon_…` |
| `public/api.js`, `app.js`, `tools/demo-api.js`, `tools/build-demo.mjs` | localStorage-Schlüssel `enzymatePro…` |
| `scripts/migrate-encryption.mjs`, `scripts/audit/sicherheit-laufender-server.mjs`, `test/db.test.js` | Variablen-/DB-Dateiname |
| `demo/index.html` | mit `tools/build-demo.mjs` neu erzeugt |
| `README.md`, `.gitignore`, `.env.example` | Pro-Hinweise; `.gitignore` erweitert (`*.db`, `secret.key`, `.env.*`) |
| `docs/` | Dieser Bericht und der Entwicklungsplan; die drei übernommenen Dokumente sind unverändert und beschreiben noch den Stand „EnzyMate" |

**Unverändert:** `public/calc.js` (Berechnung), `db.js` (Schema, Migrationen), `public/estimate.js`, `scan.js`, Tests (außer Dateiname in `db.test.js`), Logo und Symbole (vorerst das EnzyMate-Branding).

## Trennung
Eigener Port (3100), eigener Datenordner im Projektverzeichnis, eigener DB-Dateiname, eigene Schlüssel-Variable (`CREON_KEY` wird ignoriert), eigene localStorage-Schlüssel. Ein Zugriff auf Daten von EnzyMate setzt voraus, dass jemand `DATA_DIR` und `ENZYMATE_PRO_KEY` ausdrücklich darauf zeigen lässt. Das verhindert die App nicht technisch.

## Tests
| | Original (79b9e00) | Pro |
|---|---|---|
| `npm test` | 52 bestanden, 0 fehlgeschlagen, 0 übersprungen | 52 bestanden, 0 fehlgeschlagen, 0 übersprungen |

Alles Mock-Tests: Open Food Facts und Gemini sind nachgebaut. **Echte Dienste wurden nicht getestet** (`npm run test:live` braucht Internet und `GEMINI_API_KEY`). Die Browser-Tests laufen mit Chromium. Ein Test prüft die neue Produktbezeichnung nicht gezielt; die Strings wurden per Suche und in der neu erzeugten Demo kontrolliert.

## Offene Punkte
- Keine LICENSE-Datei; Lizenztexte von `public/vendor/` nicht geprüft.
- Alte Hinweise in `docs/` (EnzyMate, `CREON_KEY`) bewusst nicht umgeschrieben.
- Die Claude-Artifact-Demo von Pro ist eine separate Datei `demo/index.html`; sie muss von dir selbst als eigenes Artifact angelegt werden.
