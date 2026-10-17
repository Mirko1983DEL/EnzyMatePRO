# Audit-Skripte (Stand 16.10.2026)

Wiederholbare Prüfungen aus dem Audit (`docs/AUDIT_BERICHT_2026-10-16.md`). Sie **verändern keine Projektdateien**: Datenbanken liegen im Arbeitsspeicher oder in temporären Ordnern (Pfad wird, wenn nötig, ausgegeben; als erstes Argument lässt sich ein Ausgabeordner angeben). Sie ersetzen **keine** Prüfung mit echten Diensten, echten Geräten oder durch Dritte.

Aufruf immer aus dem Projektordner: `node --disable-warning=ExperimentalWarning scripts/audit/<datei>.mjs [ausgabeordner]`

| Skript | Prüft | Voraussetzung |
|---|---|---|
| `calc-grenzfaelle.mjs` | Rundung an Grenzen, Fettrundung vor der Dosis, Null-/Extremwerte, Verhalten der KI-Antwortprüfung bei widersprüchlichen Werten | – |
| `zeitzone-sommerzeit.mjs` | Wochen-/Monatsgrenzen und Tageszuordnung rund um die Sommerzeit. Mit `TZ=Europe/Berlin node …` und `TZ=America/Los_Angeles node …` wiederholen | – |
| `sicherheit-laufender-server.mjs` | startet den Server als eigenen Prozess (Port 4555, temporäre Daten): Dateirechte, Zugriff ohne Code, `text/plain`-Schreibzugriff, Anfragegrenze, fehlerhafter Pfad `//[`, Sperre bei falschen Zugriffscodes, Klartext in Datenbankdateien | freier Port 4555 |
| `sicherheit-datenbank-log.mjs` | Trennung zweier Nutzer auf Datenbankebene; was im Log landet, wenn ein KI-Anbieter einen Fehler meldet | – |
| `oberflaeche-pruefung.mjs` | Browser: Mehrfach-Mahlzeit gegen unabhängige Nachrechnung, Datumsfilter, Bericht, CSV, PDF, Fehlermeldungen, Schadtext, Bildschirmgrößen 320–1280 px, Bedienflächen, statische Barrierefreiheit | `npm install` (playwright-core) und Chromium (`CHROMIUM_PATH`) |
| `barcode-robustheit.mjs` | **synthetische** Barcode-Bilder (EAN-13/EAN-8/UPC-A; klein, gedreht, unscharf, verrauscht, kontrastarm, Schattenverlauf) durch die echte Oberfläche; Open Food Facts nachgebaut | wie oben |
| `kontrast.mjs` | WCAG-Kontraste der Farbwerte aus `public/style.css` (hell/dunkel) | – |
| `betrieb-wiederherstellung-menge-zeitzone.mjs` | Wiederherstellung aus Sicherung, Mengentest mit 5.000 Mahlzeiten, Tageszuordnung im Browser für drei Zeitzonen | Chromium |
| `csv-libreoffice.mjs` | CSV-Import in LibreOffice (Semikolon, UTF-8, Deutsch): Spalten, Zahlen/Datum erkannt, Formelschutz | `soffice` und `unzip` |

## Erwartete Ergebnisse (Stand 16.10.2026, Commit nach Etappe A0)

Diese Skripte machen **bekannte Befunde sichtbar**; nach deren Behebung ändern sich die Ausgaben **absichtlich**:
- `calc-grenzfaelle`: die `dose()`-Zeilen zeigen die reine Rechenfunktion (18,7 g → 1,5 gerundet); die Anzeigekorrektur („1,49“) liegt in der Oberfläche. KI-Werte ohne Fett bzw. Summe 130 g/100 g werden jetzt mit `issues`/`needsReview` markiert.
- `sicherheit-laufender-server`: `text/plain`-POST → 200; 300 falsche Codes → 300 × 401 ohne Verzögerung; `//[` → 400 (behoben); Gemini-Fehlerlog ohne Schlüssel; Datenbankdatei 644.
- `oberflaeche-pruefung`: Fehlermeldung offline „Keine Verbindung zum Server…“ (behoben); gespeicherte Empfehlung 73.500 E (behoben); 10 Dialoge ohne Namen.
- `barcode-robustheit`: 11 von 16 erkannt (nicht erkannt: 30°, Unschärfe 4 und 8, Rauschen ±60, Schattenverlauf); UPC-A wird als 13-stelliger Code mit führender 0 geliefert.
- `kontrast`: grauer Text im Hellmodus auf dem Seitenhintergrund 4,45:1 (< 4,5).

Hinweis zu `zeitzone-sommerzeit`: Der 8. Tag (26.10.) in der Ausgabe stammt von einer absichtlich außerhalb des Zeitraums liegenden Testmahlzeit; die API liefert normalerweise nur Mahlzeiten im Zeitraum.

Alle Messwerte sind **synthetisch oder simuliert**, soweit nicht anders vermerkt, und kein Nachweis für reale Geräte oder die echten Dienste (Open Food Facts, Gemini).
