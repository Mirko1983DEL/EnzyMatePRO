# Testen

## Automatische Tests (`npm test`)
Laufen ohne Internet und ohne Schlüssel. Open Food Facts und Gemini sind **nachgebaut (Mock)**. Sie belegen die eigene Logik (Berechnung, Datenbank, Verschlüsselung, Sicherung, Oberfläche, Produktbezeichnung), **nicht**, dass die echten Dienste so antworten wie der Nachbau. Die Browser-Tests brauchen Chromium (`CHROMIUM_PATH` oder ein Playwright-Chromium); ohne Browser werden sie übersprungen. In der CI (`.github/workflows/test.yml`) ist das ein Fehler.

| Datei | Inhalt |
|---|---|
| `test/app.test.js` | API-Routen, Zugriffscode, Mahlzeiten, Auswertungen, Mock von Open Food Facts/Gemini |
| `test/db.test.js` | Datenbank, Migrationen, Umschlüsselung |
| `test/security.test.js`, `quality.test.js` | Sicherheit, Plausibilitätsprüfung, Dosis-Genauigkeit |
| `test/backup.test.js` | Sicherung und Wiederherstellung |
| `test/branding.test.js` | Produktname, Trennung von EnzyMate |
| `test/ui*.test.js` | Browser-Tests (Hell/Dunkel, schmale Breite, Scan-Ablauf, Bericht) |

## Echte Dienste (`npm run test:live`)
Braucht Internet, für Gemini zusätzlich `GEMINI_API_KEY` und ein Foto (`-- --photo bild.jpg`). Wird **nicht** automatisch ausgeführt. Nur ein dokumentierter Lauf dieses Befehls belegt „live getestet“. Bisher wurde er für EnzyMate Pro nicht ausgeführt.

## CI
`.github/workflows/test.yml` führt `npm test` bei jedem Push auf `main` und bei Pull Requests aus. Die Datei wurde noch nicht in GitHub Actions ausgeführt; ein erster Lauf kann Anpassungen nötig machen (z. B. Chromium-Installation).

## Nicht abgedeckt
Medizinische Richtigkeit der Dosierung (die App ist nicht validiert), echte Geräte (iPhone-Safari), Lasttests, Barrierefreiheits-Prüfung durch Menschen.
