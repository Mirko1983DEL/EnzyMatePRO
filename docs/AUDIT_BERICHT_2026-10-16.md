# EnzyMate – Technisches Audit, Funktionsprüfung und Entwicklungsbewertung

Stand: 16.10.2026 · Geprüft: Branch `claude/creon-app-redesign-jr0otc`, Commit `f46266a` (Etappe A0) · Sprache: Deutsch

## 0. Vorbemerkungen – bitte zuerst lesen

**Keine Unabhängigkeit.** Dieses Audit hat dasselbe KI-Modell durchgeführt, das den Code geschrieben hat. Das ist keine unabhängige Prüfung. Ich habe mich bemüht, kritisch zu sein, aber ein Käufer wird eine Prüfung durch Dritte (Softwaresicherheit, Medizinproduktrecht, Datenschutz) verlangen. Dieser Bericht ist eine Vorbereitung dafür, kein Ersatz.

**Nichts verändert.** Vor und nach der Prüfung war der Git-Stand sauber (`git status --short` leer). Einzige Neuerung: diese Berichtsdatei. Prüfskripte lagen im Scratchpad der Sitzung (außerhalb des Repos), Tests liefen mit Testdatenbanken in temporären Ordnern oder im Arbeitsspeicher. Es wurden keine Pakete installiert, keine Migrationen auf echten Daten ausgeführt, keine Zugangsdaten verändert.

**Was ich nicht konnte** (steht in den Tabellen jeweils als „nicht prüfbar“): reale Geräte (iPhone, Android), Safari/WebKit (nicht installiert), die echten Dienste Open Food Facts und Gemini (kein freier Netzzugang aus dieser Umgebung, kein API-Schlüssel), Microsoft Excel, Screenreader, reale Fotos von Verpackungen oder Mahlzeiten, die echte Claude-Artifact-Umgebung (nur die Funktion `sample` simuliert).

**Quellen für Außenfakten** (nur Websuche, Sekundärquellen, nicht verbindlich):
[Gemini-Alias „flash-lite-latest“ (cloudprice.net)](https://cloudprice.net/models/gemini-flash-lite-latest) · [Hinweise zu Aliasen/Pinning (vercel.com)](https://vercel.com/ai-gateway/models/gemini-2.5-flash-lite-preview-09-2025/about) · [Gemini 3.5 Flash-Lite, Google-Cloud-Dokumentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite) · [Kreon 25.000 Beipackzettel (Apotheken Umschau)](https://apotheken-umschau.de/medikamente/beipackzettel/kreon-25000-hartkpsmmagensaftrueberzpellets-4437981.html) · [Kreon 20.000 Beipackzettel (Apotheken Umschau)](https://www.apotheken-umschau.de/medikamente/beipackzettel/kreon-20000-pheurlipase-einheiten-msrhartkaps-14327638.html) · [Infos zu Enzymen (Selbsthilfe)](https://bauchspeicheldruese-pankreas-selbsthilfe.de/wp-content/uploads/2023/03/Infos_zu_Enzymen.pdf)

---

## A. Management-Zusammenfassung – was ist EnzyMate heute wirklich?

EnzyMate ist ein **funktionsfähiger Einzelnutzer-Prototyp**: eine Web-App mit Node-Server, verschlüsselter SQLite-Datenbank, deutschsprachiger Mobiloberfläche (hell/dunkel), Kreon-Dosisberechnung, Mahlzeitenverlauf, Auswertungsbericht (Kennzahlen, zwei Diagramme, CSV, Druck/PDF) sowie Foto-Scan (Barcode im Browser, Open-Food-Facts-Abfrage, KI-Schätzung). Produktivcode ca. **1.500 Zeilen** (Server, Datenbank, Frontend, ohne Tests/Demo/Doku), Tests ca. **560 Zeilen** plus 32 Zeilen Hilfscode. Fast der gesamte Code stammt von Claude; Richtung, Entscheidungen und Bildmaterial kamen vom Nutzer.

**Was nachweislich funktioniert** (von mir ausgeführt): 38 von 38 automatischen Tests; Dosisberechnung und Bericht stimmen mit meiner unabhängigen Nachrechnung überein; Datums-/Zeitzonenlogik; Verschlüsselung inkl. Erkennung vertauschter Werte; Migrationen mit Sicherung; CSV lässt sich in LibreOffice korrekt öffnen; Oberfläche läuft von 320 bis 1280 px Breite ohne seitliches Scrollen; Schadtext wird nicht ausgeführt.

**Was nicht belegt ist:**
- Die Anbindungen an **Open Food Facts** und **Gemini** wurden **nie live** getestet. Alle Tests dazu verwenden nachgebaute Antworten.
- Die **KI-Genauigkeit** ist nicht gemessen. Es gibt keine Referenztests.
- **iPhone-Safari/Android** sind ungetestet; die Barcode-Erkennung wurde nur mit **synthetischen** Bildern geprüft (11 von 16 Varianten erkannt).
- Die **medizinische Eignung** der Berechnung (Rundung, Mindestdosis, Kapselgrößen-Liste) ist nicht validiert.
- **Login, Benutzerverwaltung, Familienmodus, Offline, Beschwerdetagebuch, Rezepte/Favoriten, Mahlzeit bearbeiten** sind **nicht vorhanden**.

**Wichtigste neue Befunde dieses Audits** (alle in D beschrieben und belegt):
1. Liefert die KI keinen gültigen Fettwert, rechnet die App **stillschweigend mit 0 g Fett** (Unterdosierung ohne Warnung).
2. Der Server nimmt Schreibanfragen **ohne Zugriffscode** an und prüft den Anfragetyp nicht; kein Schutz gegen Raten des Zugriffscodes.
3. Ein fehlerhafter Pfad (`//[`) lässt die Verbindung hängen (Fehler im Code, nur durch einen Auffang im Startskript nicht tödlich).
4. Das Fett wird vor der Dosisberechnung auf 0,1 g gerundet (bis zu ±0,05 g × Faktor, bei Faktor 2000 bis zu ±100 E), und die Anzeige „rechnerisch 1,5 Kapseln“ kann „empfohlen 1“ widersprechen.
5. Fehlermeldungen bei Netz-/Serverfehlern sind technisch und englisch („Failed to fetch“).
6. Die Kapselgrößen-Liste (10.000/25.000/35.000) ist nicht gegen die Fachinformation geprüft; Beipackzettel-Portale nennen auch **Kreon 20.000**.

---

## B. Vollständige Funktionsübersicht

Statusklassen nach Vorgabe: **Vollständig implementiert · Teilweise implementiert · Nur vorbereitet · Simuliert · Nicht vorhanden · Nicht prüfbar.** „Simuliert“ kommt im Produktivcode nicht vor (Mocks liegen nur in Tests); Funktionen, deren Live-Betrieb ich nicht prüfen konnte, führe ich als *implementiert* mit Prüfergebnis *nicht prüfbar*. Kürzel für bisherige Tests: **U** = Einheitentest, **A** = API-/Serverintegrationstest, **B** = Browser-Test im Repo (Chromium), **M** = Mock für externe Dienste.

### B1. Server, API, Daten

| Funktion | Beschreibung | Dateien / Module | Status | Bisherige Tests | Ergebnis jetzt | Fehler / Einschränkungen | Fehlt zur Produktionsreife |
|---|---|---|---|---|---|---|---|
| HTTP-Server, statische Dateien | Auslieferung von `public/`, API unter `/api`, Header | `server.js` (`createApp`, `serveStatic`) | Vollständig implementiert | A (Header, Pfade, 405) | Bestanden; Pfadausbruch nicht möglich | **`new URL` außerhalb `try`: Pfad `//[` lässt Verbindung hängen**; läuft über `unhandledRejection`-Auffang weiter | HTTPS/Proxy, Zugriffs-Logging, Health-Check, Ratenbegrenzung allgemein |
| Profil (GET `/api/state`, PUT `/api/patient`) | Name, Größe, Gewicht, Lipase-Faktor | `server.js`, `db.js` | Vollständig implementiert | A | Bestanden | Faktor 0 erlaubt (UI verlangt ≥1); keine Änderungshistorie | Historie, Änderungsgrund, Sperre |
| Einstellungen (PUT `/api/settings`) | zuletzt gewählte Kapselgröße | `server.js` | Vollständig implementiert | A | Bestanden | Liste fest 10.000/25.000/35.000; **20.000 laut Portalen vorhanden, ungeprüft** | Abgleich mit Fachinformation |
| Mahlzeiten (POST/GET/DELETE `/api/meals`) | Speichern mit serverseitiger Summenbildung und Empfehlung; Faktor aus Profil; 409 bei veraltetem Stand | `server.js`, `calc.js` | Vollständig implementiert | A, B | Bestanden | Kein Ändern (PUT fehlt); GET ohne Seitenaufteilung; Extrem-Mahlzeit empfiehlt > 50 Kapseln → Speichern abgelehnt („Kapselanzahl ungültig“) | Bearbeiten, Paginierung, Revisionsprotokoll |
| Lebensmittel-API (`/api/foods`) | Anlegen/Löschen gemerkter Lebensmittel | `server.js`, `db.js`, `tools/demo-api.js` | Nur vorbereitet | keine | Nicht aufgerufen; Oberfläche nutzt sie nicht | Ungenutzte Route und Tabelle | Entfernen oder in Rezeptdatenbank überführen |
| Barcode-API (`/api/barcode/:code`) | Abfrage Open Food Facts v2, Mapping der Nährwerte | `analyze.js` (`lookupBarcode`) | Vollständig implementiert | U/A (M) | **Live nicht prüfbar** (kein Netz); Mock bestanden | Kein Cache, kein Abrufzeitpunkt/keine Quellenangabe gespeichert; Fett fehlt → `complete:false` | Live-Test, Cache, Lizenzhinweis (ODbL, ungeprüft), Fehlerklassen |
| KI-API (`/api/estimate`) | Foto an Gemini, strukturierte Antwort, Begrenzung der Werte | `analyze.js`, `public/estimate.js` | Vollständig implementiert | A (M) | **Live nicht prüfbar**; Mock bestanden | Modellkennung `gemini-flash-lite-latest` = wechselnder Alias, Gültigkeit ungeprüft; **fehlender Fettwert → 0 g**; keine Summenprüfung; Anbieter-Fehlertext im Log | Live-Test, festes Modell, strengere Antwortprüfung, Kontingent/Kosten |
| Zugriffscode | gemeinsamer Code im Header `x-access-token` | `server.js` (`resolveUser`) | Vollständig implementiert | A | Bestanden (401 ohne/falsch) | Standard **ohne** Code; **keine Sperre** (300 falsche Codes in 271 ms); POST mit `text/plain` ohne Code akzeptiert | Konten, Sperre, Pflicht-Code |
| Nutzerauflösung | soll Nutzer je Anfrage bestimmen | `server.js` | Nur vorbereitet | – | Liefert immer Nutzer 1 | Mehrbenutzer über API unmöglich | Sitzungen/Login |
| Schema und Migrationen | `PRAGMA user_version`, Transaktion je Schritt, Sicherung vorher | `db.js` (`migrate`) | Vollständig implementiert | U (4 Tests) | Bestanden | **`node:sqlite` ist experimentell** (Warnung bestätigt) | Produktionsdatenbank-Entscheidung |
| Feldverschlüsselung v2 | AES-256-GCM, Zeilenbindung (AAD), Schlüsselkennung | `crypto.js`, `db.js` | Vollständig implementiert | U | Bestanden; vertauschte/umdatierte Werte erkannt; kein Klartext in Datei | Zeitstempel und IDs im Klartext; Schlüssel standardmäßig neben DB | Schlüsselrotation-Prozess, externe Schlüsselablage |
| Schlüssel laden | `CREON_KEY` oder `data/secret.key` | `crypto.js` (`loadKey`) | Vollständig implementiert | **keine** (Abdeckung: Zeilen 11–26 ungetestet) | Praktisch geprüft: Datei 0600 | DB-Datei 0644, Ordner 0755; keine Rotation | Test, Rechte härten, Rotation |
| Umschlüsselung v1→v2 | Skript mit Probelauf, Sicherung, Integritätsprüfung | `scripts/migrate-encryption.mjs`, `db.js` | Vollständig implementiert | U | Bestanden (Skriptlauf an Testdatei, vorherige Sitzung) | Nur auf Aufruf | – |
| Sicherung/Wiederherstellung | Sicherung vor Migration und per `backupTo` (`VACUUM INTO`) | `db.js` | Teilweise implementiert | U (Sicherung lesbar) | **Wiederherstellungsübung bestanden**: Kopie öffnen, 3/3 Zeilen intakt; falscher Schlüssel → 3 Fehler | Kein Zeitplan, kein Restore-Werkzeug, kein Schlüssel-Backup-Konzept | Automatische Sicherung, Restore-Prozess, Test |

### B2. Berechnung und Auswertung

| Funktion | Beschreibung | Dateien | Status | Bisherige Tests | Ergebnis jetzt | Fehler / Einschränkungen | Fehlt |
|---|---|---|---|---|---|---|---|
| Dosisberechnung | Fett × Faktor ÷ Kapselgröße, ganze Kapseln, mind. 1 bei Fett > 0 | `public/calc.js` (`dose`) | Vollständig implementiert | U, B | Mathematik bestätigt (unabhängig nachgerechnet); Grenzfälle siehe D | Fett vorher auf 0,1 g gerundet (±100 E bei Faktor 2000); Anzeige-Rundung ≠ Entscheidungs-Rundung (18,7 g: gezeigt 1,5, empfohlen 1); `fatGrams` undefined → `ok:true`, Einheiten NaN (nicht erreichbar) | **Medizinische Validierung**, Regeldokumentation |
| Nährwertsummen | Summe je Zutat, 0,1-Rundung | `calc.js` (`totals`) | Vollständig implementiert | U, B | kcal/KH/Eiweiß exakt gleich meiner Rechnung | – | – |
| Manuelle Kapselanpassung, Abweichungshinweis | +/−, Hinweis bei < 75 % oder > 150 % | `public/app.js` | Vollständig implementiert | B (teilweise) | Funktioniert | Schwellen sind eigene Setzung | Ärztliche Abstimmung |
| Gespeicherte Parameter | Faktor, Kapselgröße, empfohlene E je Mahlzeit | `server.js`, `report.js` | Vollständig implementiert | A | Bestanden | Gewicht „aktuell“ gilt rückwirkend für Einheiten/kg; keine Profilhistorie | Profilhistorie |
| Verlauf Tag/Woche/Monat/Frei | Zeiträume, Summen | `app.js`, `calc.js` | Vollständig implementiert | U, B | **Tagesgrenzen 23:59:59/00:00 korrekt**; Wochen-/Monatslogik in 4 Zeitzonen (31/31); Sommerzeit-Woche korrekt | UI-Test nur in einer Zeitzone des Systems; im Browser 3 Zeitzonen geprüft (korrekte Ortszeit-Zuordnung) | – |
| Bericht (Kennzahlen, Diagramme, Tabelle) | 11 Kennzahlen, 2 SVG-Diagramme, Mahlzeitentabelle | `public/report.js`, `app.js` | Vollständig implementiert | U, B | **Alle Kennzahlen stimmen mit unabhängiger Rechnung** (Ø nur über Tage mit Einträgen; leere Tage als Punkt) | Diagramme nicht barrierefrei beschriftet (nur `aria-label`) | Ärztlich abgestimmter Inhalt |
| CSV-Export | Semikolon, Dezimalkomma, UTF-8 mit BOM, Formelschutz | `report.js` (`toCsv`) | Vollständig implementiert | U, B | **In LibreOffice (de) korrekt**: 13 Spalten, Datum/Zeit/Zahlen erkannt, Formelversuch als Text | **Excel nicht geprüft**; Fett/Eiweiß je Mahlzeit auf 0,1 gerundet | Excel-Test, Datumsformat ISO-Spalte |
| Druck/PDF | Druckvorlage (A4), Browser-Druckdialog | `style.css` (`@media print`), `app.js` | Vollständig implementiert | keine | Chromium-PDF: **2 Seiten A4** bei 15 Tagen/10 Mahlzeiten | **iPhone-Safari-Druck ungetestet**; in der Demo gesperrt; kein serverseitiges PDF | Gerätetest, ggf. PDF-Erzeugung |
| Text kopieren | Zusammenfassung in Zwischenablage | `report.js` (`toText`) | Vollständig implementiert | U | Ausgeführt, Inhalt korrekt | Zwischenablage in manchen Umgebungen gesperrt | – |

### B3. Oberfläche und Scan

| Funktion | Beschreibung | Dateien | Status | Bisherige Tests | Ergebnis jetzt | Fehler / Einschränkungen | Fehlt |
|---|---|---|---|---|---|---|---|
| Startseite, Menü, Pop-ups | Ein Hauptbildschirm, Details in Sheets | `index.html`, `app.js`, `style.css` | Vollständig implementiert | B | Bestanden | Alle 10 `<dialog>` **ohne zugänglichen Namen** | `aria-labelledby`, Fokusführung prüfen |
| Mahlzeit mit mehreren Lebensmitteln, Bearbeiten, Entfernen | Eingabe-Pop-up, Antippen zum Korrigieren | `app.js` | Vollständig implementiert | B (Eingabe), keine Löschen-Tests der Zeile | **Mit 3 Zutaten, Bearbeiten, Speichern, Neuladen geprüft** | Nach Neuladen Mahlzeit verloren (bewusst) | – |
| Kreon-Größe wählen/merken | Auswahl-Sheet, serverseitig gespeichert | `app.js`, `server.js` | Vollständig implementiert | B | Bestanden (bleibt nach Neuladen) | siehe Größenliste | – |
| Profilseite | Name, Größe, Gewicht, Faktor | `app.js` | Vollständig implementiert | B | Bestanden | Größe wird nicht berechnungsrelevant genutzt | – |
| Fehlermeldungen | Toasts | `app.js` (`guard`) | Teilweise implementiert | B (einzelne) | **Offline: „Failed to fetch“; HTML-Fehler: „Unexpected token '<' …“** | Technisch, englisch, für Kinder ungeeignet; Eingaben bleiben erhalten | Eigene verständliche Fehlertexte |
| Hell/Dunkel, responsive | `prefers-color-scheme`, Breiten 320–1280 | `style.css` | Vollständig implementiert | B (360 px dunkel) | **Kein Überlauf 320–1280 px**; alle geprüften Bedienelemente ≥ 44 px; Kontrast: **grauer Text hell 4,45:1** (< 4,5) | Kleine Schrift (Marken, Nebenzeilen) | Kontrast anheben, Gerätetest |
| Logo, Symbole, Manifest | Logo, Favicon, `apple-touch-icon` | `public/logo.webp`, `icons/` | Vollständig implementiert | keine | Dateien laden korrekt | iPhone-Home-Bildschirm ungetestet; **Bildrechte/Herkunft nicht dokumentiert** | Rechteklärung |
| Barcode-Erkennung im Browser | nativ oder zxing-wasm; EAN-13/8, UPC-A/E | `public/scan.js`, `vendor/` | Vollständig implementiert | B (1 synthetisches EAN-13) | **Synthetisch 11/16 erkannt** (siehe C); iOS/Android **nicht prüfbar** | `capture="environment"` am Foto-Eingabefeld kann die **Auswahl vorhandener Fotos verhindern** (Annahme, ungetestet); UPC-E ungeprüft; Ursache bei Misserfolg nicht erklärt | Echte Fotos, Gerätetests, Live-Kamera optional |
| Scan-Auswahl bei Fehlschlag | Neuer Versuch / KI / Abbrechen | `app.js`, `scan.js` | Vollständig implementiert | B | Bestanden | Meldung immer „Kein Barcode erkannt“ | Fehlerklassen (dunkel/unscharf) |
| Open-Food-Daten übernehmen | Name/Nährwerte/Portion in die Liste | `scan.js`, `app.js` | Teilweise implementiert | B (M) | Übernahme ohne Bestätigungsdialog; Menge per Antippen änderbar | Kein Abrufzeitpunkt, keine Quellenangabe gespeichert | Bestätigung, Herkunftsdaten |
| KI-Schätzung (Server, Gemini) | siehe B1 | – | Vollständig implementiert | A (M) | **Nicht prüfbar (live)** | siehe B1 | – |
| KI-Schätzung (Demo, Claude) | `sample.json` mit Bild | `tools/demo-api.js` | Vollständig implementiert | B (M, nachgebaute Funktion) | Nutzerbericht: mit realen Fotos erfolgreich (nicht von mir reproduziert) | `modelTier:'default'` – **kein festes Modell**, Antwort bis 5 Min. zwischengespeichert; nur in Claude-Artifacts lauffähig | Messung, festes Modell (ohne Artifacts) |
| KI-Unsicherheit/Plausibilität | Kennzeichnung „KI“, Wertebegrenzung | `estimate.js`, `app.js` | Teilweise implementiert | U | Befund: **Summe Fett+KH+Eiweiß = 130 g/100 g wird nicht beanstandet; kcal-Widerspruch unbeachtet; fehlender Fettwert = 0** | Keine Unsicherheitskennzeichnung, keine Rückfrage | Siehe F |
| KI-Genauigkeitsmessung | Testwerkzeug, Referenzdaten | – | Nicht vorhanden | – | – | Es gibt **keine Messdaten** | Testwerkzeug (Plan A5) |
| Gespeicherte Favoriten/Rezepte/Vorlagen/Produkt-Cache | – | – | Nicht vorhanden | – | – | Nur die ungenutzte Tabelle `foods` | siehe F |

### B4. Weitere geforderte Bereiche

| Funktion | Status | Nachweis (Codeprüfung) | Fehlt |
|---|---|---|---|
| Login, Registrierung, Sitzungen, Rechte | **Nicht vorhanden** | Suche nach `password/session/cookie/login` in `server.js`, `public/*.js`: keine Treffer; nur `resolveUser()` mit festem Nutzer 1 | Gesamtes Konzept |
| Familien-/Kindermodus, Elternbereich | **Nicht vorhanden** | keine Treffer | Rollenmodell, klinische Klärung |
| Offline/Service Worker/Synchronisation | **Nicht vorhanden** | kein `serviceWorker`/`indexedDB`/`caches` in `public/*.js`; nur `manifest.webmanifest` | Konzept und Umsetzung |
| Beschwerdetagebuch | **Nicht vorhanden** | keine Treffer | Felder ärztlich abstimmen |
| Mahlzeit bearbeiten/nachtragen (Oberfläche) | **Nicht vorhanden** | API akzeptiert `ts`, aber keine Änderungsroute, kein UI | B9 |
| Claude-Artifact-Demo | **Vollständig implementiert** (Demo-Zweck) | `tools/build-demo.mjs`, `tools/demo-api.js`; localStorage, **unverschlüsselt**; Open Food Facts im Viewer vermutlich blockiert; Drucken gesperrt | Nicht als Produkt geeignet |
| Test-/Prüfwerkzeuge | **Vollständig implementiert** | `npm test`, `test:live` (nur ohne Netz gelaufen: „nicht erreichbar“), `migrate:encryption` | Live-Läufe |
| Dokumentation | **Teilweise implementiert** | `README.md`, `docs/FUNKTIONSBESCHREIBUNG.md`, `docs/BESTANDSAUFNAHME_UND_PLAN.md` | API-Dokumentation, Bedrohungsmodell, Lizenzliste, Betriebshandbuch |

---

## C. Testbericht

### C1. Automatische Tests (alle ausgeführt)

| Befehl | Ergebnis |
|---|---|
| `npm test` | **38 Tests, 38 bestanden, 0 fehlgeschlagen, 0 übersprungen**, 9,0 s |
| `node --experimental-test-coverage … --test test/*.test.js` | Zeilenabdeckung je Datei: `analyze.js` 100 %, `crypto.js` **80,3 %** (Zeilen 11–26 = `loadKey` ungetestet), `db.js` 100 %, `public/calc.js` 97,0 %, `public/estimate.js` 100 % (Zweige 42,9 %), `public/report.js` 100 %, `server.js` **87,4 %** (ungetestet: Foods-Route, Startblock 175–190). **Der Browser-Code (`app.js`, `scan.js`, `api.js`) wird nicht gemessen** (läuft in Chromium). Die Gesamtzahl „96,7 %“ enthält die Testdateien selbst und ist daher nicht aussagekräftig. |
| `TZ=Europe/Berlin`, `America/Los_Angeles`, `Pacific/Auckland`, `Asia/Kolkata` mit den 31 Logik-/DB-/Sicherheitstests | je **31 von 31 bestanden** (Browser-Tests nicht je Zeitzone) |
| `npm audit`, `npm audit --omit=dev` | **0 Schwachstellen** (gilt nur für `package.json`: es gibt keine Produktivabhängigkeiten, eine Entwicklungsabhängigkeit `playwright-core`) |

### C2. Zusätzliche Prüfungen von mir (Skripte außerhalb des Repos, Ergebnisse unten)

| Prüfung | Ergebnis |
|---|---|
| App startet, Oberfläche lädt | Ja: Erstladen 157 KB, 109 ms lokal (ohne Netzlatenz, nicht aussagekräftig für Mobilfunk) |
| Mehrere Lebensmittel, Bearbeiten, Speichern, Neuladen | Ja. Nudeln 250 g/1,5 + Soße 100→150 g/18 + Käse 20 g/30: unabhängig Fett 36,75 g → 73.500 E → 2,94 → **3 Kapseln**; App zeigt **3**; gespeichert Fett **36,8**, kcal 755, KH 81,2, Eiweiß 20,5 (**= Soll**); **empfohlene Einheiten gespeichert 73.600 statt 73.500** (Rundung) |
| Datumsfilter | Tag 14./15./16.10., Woche, Frei 15.–15.: alle Zahlen wie erwartet (auch 23:59:59 und 00:00); „Bis vor Von“ → verständliche Meldung; Ortszeit-Zuordnung in UTC/Berlin/Los Angeles korrekt (22:30 UTC erscheint in Berlin am Folgetag) |
| Bericht gegen unabhängige Rechnung | Alle 11 Kennzahlen identisch (3 von 5 Tagen, Ø 33,3 g Fett, 1,3 Kapseln, 33.333 E, 952 E/kg, 1.000 E/g, 50 %, 1 Mahlzeit ohne Kreon, 1/0); CSV 5 Zeilen; PDF-Erzeugung ok (2 Seiten A4) |
| Sommerzeit (25.10.2026) | Woche 169 h statt 168 h; Tage und Mahlzeiten korrekt zugeordnet (3 Mahlzeiten am Umstellungstag) |
| CSV in LibreOffice (Filter: Semikolon, UTF-8, Sprache de) | 13 Spalten, Umlaute, Semikolon/Anführungszeichen im Namen intakt, Datum/Zeit/Zahlen erkannt; `=HYPERLINK(…)` als **Text** (kein Formelzugriff). **Excel selbst nicht geprüft.** |
| Barcode (synthetisch, durch die echte Oberfläche, Open Food Facts nachgebaut) | EAN-13 sauber/klein (~190 und ~95 px)/ohne Ruhezone/90°/180°/15°/unscharf (Radius 2)/kontrastarm erkannt; EAN-8 erkannt; UPC-A (als 13-stellig mit führender 0) erkannt und als 13-stelliger Code abgefragt. **Nicht erkannt:** 30° gedreht, unscharf (Radius 4 und 8), Rauschen ±60, Schattenverlauf 30 %→100 %. **11 von 16**. UPC-E: nicht prüfbar (kein Testbildgenerator). Erkennung ~200 ms je Bild. *Ausdrücklich keine Aussage über reale Fotos, Glanz, Falten, iOS/Android.* (Mein erster Auswertungslauf hatte die UPC-A-Erwartung falsch gesetzt; der Code ist korrekt.) |
| Schadtext (`<img onerror>`, `<script>`) in Namen/Produktname | Nicht ausgeführt (`window.__xss` nie gesetzt), nur als Text sichtbar in Liste, Verlauf, Bericht |
| Bildschirmgrößen 320×568, 360×740, 390×844, 768×1024, 1280×800 | Kein seitlicher Überlauf auf Start, Mahlzeit, Verlauf, Bericht. Bedienflächen wurden **nur auf der Mahlzeit-Ansicht bei 390 px** gemessen (alle ≥ 44 px); andere Ansichten nicht |
| Wiederherstellung | Sicherung → Kopie → öffnen: Profil + Mahlzeit intakt, 3/3 Zeilen; falscher Schlüssel → 3 Fehlerzeilen |
| Datenmenge | 5.000 Mahlzeiten (~4 Jahre): Einfügen 1,9 s, Monat lesen 1 ms, **alles** lesen 87 ms (1,6 MB JSON), Bericht über ~1.500 Tage 22 ms |
| Berechnungs-Grenzfälle | siehe D1 |
| Live-Integration | `npm run test:live` (früherer Lauf in dieser Sitzung, Etappe A0; von mir in diesem Audit nicht wiederholt, um keine Dateien im Repo-Ordner zu erzeugen): **„Open Food Facts nicht erreichbar“, Exit 1**. Gemini: übersprungen (kein Schlüssel). **Kein Live-Beleg.** |

### C3. Fehlgeschlagene Tests

Bestehende Tests: **keine Fehlschläge.** Meine zusätzlichen Prüfungen haben die unter D genannten **Fehler und Schwächen** aufgedeckt (z. B. hängende Verbindung bei `//[`, KI-Fett → 0, technische Fehlermeldungen).

### C4. Nicht möglich / Testlücken (nicht geschlossen, kein Code geschrieben)

Reale iPhone-/Android-Geräte und Safari; echte Open-Food-Facts- und Gemini-Aufrufe; reale Barcode-/Mahlzeitenfotos; Excel; Screenreader und Tastaturbedienung; echter Last-/Ausdauertest; Penetrationstest; automatisierte UI-Tests für Löschen einer Mahlzeit und „Text kopieren“; Test für `loadKey`; Abdeckungsmessung des Browsercodes; Tests der Claude-Demo in der echten Artifact-Umgebung.

---

## D. Wichtigste technische Risiken (nach Kritikalität sortiert)

### D1. Medizinische/Qualitätsrisiken der Berechnung (Details)

**Mathematik** (unabhängig nachgerechnet, mit eigenem Skript an `calc.js`):

| Fett | Einheiten | rechnerisch (angezeigt) | empfohlen | Bemerkung |
|---|---|---|---|---|
| 0 g | 0 | 0 | 0 | |
| 0,04 g | 80 | 0 | **1** | Mindestdosis 1 Kapsel (25.000 E für 0,04 g Fett) |
| 0,5 g | 1.000 | 0,04 | **1** | |
| 6,25 g | 12.500 | 0,5 | **1** | halbe Kapsel → aufgerundet |
| 18,7 g | 37.400 | **1,5** (1,496) | **1** | **Anzeige und Empfehlung widersprechen sich** |
| 18,75 g | 37.500 | 1,5 | 2 | |
| 31,25 g | 62.500 | 2,5 | 3 | halbe Kapsel → aufgerundet |

- **Vorzeitige Rundung:** `totals()` rundet das Fett auf 0,1 g, bevor `dose()` rechnet. Beispiel: exakt 24,975 g → 25,0 g → **+50 E**; maximal ±0,05 g × Faktor (**±100 E** bei 2000, ±200 E bei 4000). Nachgemessen im Vollablauf: gespeichert 73.600 statt 73.500 E.
- **Fehlwerte:** Faktor `null`/Kapselgröße 0 → sauber „fehlt“. `fatGrams` `undefined` → `ok:true` mit leerer Einheitenzahl (nicht erreichbar, da Eingaben validiert). Negatives Fett → negative Einheiten (nicht erreichbar).
- **Extremwerte:** 40 Zutaten × 5 kg mit 100 g Fett/100 g → 40.000 Kapseln empfohlen; Speichern wird serverseitig mit „Kapselanzahl ungültig“ abgelehnt (Grenze 50). Kein Absturz, aber irreführende Meldung.
- **Medizinische Eignung nicht validiert:** Rundungsrichtung, Mindestdosis, Abweichungsschwellen 75/150 %, Einheiten pro kg (nutzt aktuelles Gewicht), Kapselgrößenliste. **Ich habe keine Grenzwerte, Dosisempfehlungen oder Leitlinien eingeführt oder bewertet.**
- **Kapselgrößen:** Die App bietet 10.000/25.000/35.000. Beipackzettel-Portale führen Kreon-Stärken 10.000, **20.000** und 25.000 und nennen 35.000 als Ersatz für 40.000 (Sekundärquellen, nicht die Fachinformation). Die Liste muss gegen die aktuelle Fachinformation geprüft werden.

### D2. Risikoliste

| Nr. | Stufe | Risiko | Beleg |
|---|---|---|---|
| R1 | **Kritisch** | **KI-Werte unvalidiert; fehlende/ungültige Fettwerte werden still zu 0 g** (Unterdosierung); Summe Fett+KH+Eiweiß > 100 g/100 g, kcal-Widersprüche und unplausible Werte werden nicht beanstandet; keine Genauigkeitsmessung | `estimate.js` `normalizeEstimate` (`?? 0`); Probelauf: Fett 40+KH 60+Eiweiß 30 und `fatPer100:'hoch'` → 0 |
| R2 | **Kritisch** | **Keine medizinische Validierung, keine regulatorische Einordnung** (Medizinprodukt?), Rundung/Mindestdosis/Kapselliste ungeprüft | D1; keine Dokumente im Repo |
| R3 | **Kritisch** | **Standardbetrieb ohne Zugriffsschutz**: API offen; Schreiben per `text/plain` ohne Header möglich (das Serververhalten ist belegt; dass eine fremde Webseite im selben Netz so Einträge anlegen könnte, folgt daraus, wurde aber **nicht im Browser nachgestellt**); Zugriffscode ohne Sperre (300 Versuche in 271 ms); kein Login, kein HTTPS in der App | Sicherheitsprobe A/B |
| R4 | **Kritisch** | **Datenschutz KI/Dritte**: Fotos gehen an Google (Server-Version) bzw. an das Claude-Konto des Betrachters (Demo); laut Suchergebnissen darf Google Eingaben der kostenlosen Gemini-Stufe zur Produktverbesserung nutzen; Open Food Facts erhält Barcodenummer, IP, Zeitpunkt. Einwilligung nur als einfacher Dialog, keine Auftragsverarbeitung, kein Löschkonzept | `analyze.js`, `app.js`; Hinweis in D |
| R5 | Hoch | **Live-Integrationen nie geprüft**; Modell `gemini-flash-lite-latest` ist laut Drittquellen ein wechselnder Alias (Ergebnis kann sich ohne Ankündigung ändern, Gültigkeit nicht bestätigt; ein Hinweis aus Google-Cloud-Doku zu neueren Modellen sagt, dass benutzerdefinierte Temperatur ignoriert werden kann – Übertragbarkeit ungeklärt) | `analyze.js`; Websuche |
| R6 | Hoch | **`node:sqlite` ist experimentell** („might change at any time“); keine Strategie für Produktionsdatenbank (SQLCipher/PostgreSQL), keine Mehrnutzer-Parallelität getestet | Node-Warnung ausgeführt |
| R7 | Hoch | **Schlüsselverwaltung/Betrieb**: Schlüssel standardmäßig neben der Datenbank; DB-Datei 0644; kein Rotations-/Wiederherstellungsprozess, keine automatische Sicherung, `loadKey` ungetestet; Zeitstempel/Nutzer-ID im Klartext | Rechte-Messung; Abdeckung |
| R8 | Hoch | **Barcode nur synthetisch getestet**; iOS-Safari/Android ungetestet; `capture="environment"` kann Bibliotheksfotos verhindern (Annahme); 5 von 16 Störvarianten scheitern; Fehlermeldung ohne Ursache | Benchmark; `index.html:182` |
| R9 | Hoch | **Herkunft und Rechte**: gebündelte Bibliotheken (`barcode-detector` 3.2.2, `zxing-wasm` 3.1.3, beide MIT; Hashes stimmen mit den npm-Originalen überein) stehen **nicht** in `package.json`; **keine `LICENSE`-Datei**; Herkunft/Rechte von Logo und Icons nicht dokumentiert; Namens-/Markenrecht (Kreon-Anbieter laut Portalen: **Viatris Healthcare GmbH**) und Open-Food-Facts-Lizenz (ODbL, nicht gelesen) ungeprüft | Hash-Vergleich; Dateisuche |
| R10 | Hoch | **Wartbarkeit/Qualitätssicherung**: Browsercode ohne Abdeckungsmessung; `app.js` ist eine Datei mit 351 Zeilen und rund 35 Funktionen/Handlern für alle Seiten; kein Linter, kein Typprüfer, keine CI, kein Container/Deployment | Dateiliste, Coverage |
| R11 | Mittel | Vorzeitige Fettrundung und widersprüchliche Anzeige (D1) | Probelauf |
| R12 | Mittel | **Fehlermeldungen technisch/englisch**, Eingaben bleiben aber erhalten; für Kinder ungeeignet | Prüfung 4 |
| R13 | Mittel | **Ungefangener `new URL`-Fehler**: `GET //[` hängt die Verbindung; ohne den Auffang in `server.js` (nur im Startskript) würde nach Node-Standardverhalten der Prozess beendet (nicht nachgestellt) | rohe Socket-Probe, Log `ERR_INVALID_URL` |
| R14 | Mittel | Anbieter-Fehlertext (bis 300 Zeichen) wird ungefiltert protokolliert; in meiner Simulation erschien auch ein absichtlich zurückgespiegelter Schlüssel im Log (ob echte Anbieter das tun, ist unbekannt) | `analyze.js:59`; Probe E |
| R15 | Mittel | **Barrierefreiheit**: 10 Dialoge ohne zugänglichen Namen; grauer Text im Hellmodus 4,45:1; keine Screenreader-/Tastaturprüfung; Diagramme nur mit Kurzbeschriftung | Prüfung 7; Kontrastberechnung |
| R16 | Mittel | Keine Paginierung; Skalierung bis 5.000 Zeilen unproblematisch (87 ms), darüber ungeprüft | Mengentest |
| R17 | Mittel | **Demo**: Abhängigkeit von Claude Artifacts (`sample`, `downloads`), Modell nicht festgelegt, Daten unverschlüsselt im Browser; Open Food Facts dort vermutlich blockiert | `demo-api.js` |
| R18 | Niedrig | Ungenutzte Route/Tabelle (`foods`), ungenutztes Feld `note`; Konfigurationsname `CREON_KEY` weicht von der Schreibweise „Kreon“ ab | Codesuche |
| R19 | Niedrig | Tageszuordnung folgt der Zeitzone des Geräts (korrekt, aber beim Reisen verschieben sich Tagesgrenzen); Gewicht für Einheiten/kg nur aktuell | UI-Test Zeitzonen |

**Mehrbenutzer-Frage („Könnte ein Nutzer Daten eines anderen sehen?“):** Auf Datenbankebene **nein**: alle Abfragen sind je `user_id` begrenzt, Löschen fremder Zeilen schlägt fehl, Profile/Einstellungen sind getrennt, und die Verschlüsselung bindet Werte an Nutzer und Zeile (Test mit von Hand angelegtem zweiten Nutzer). Über die **API** ist Mehrbenutzerbetrieb derzeit **nicht möglich** (immer Nutzer 1); die Trennung auf HTTP-Ebene ist also **ungetestet, weil nicht vorhanden**. Vor Aktivierung: Rechte-/Isolationstests laut Plan C13.

**Sicherheit – was ich geprüft habe und das gut aussieht:** XSS (Text wird als `textContent` eingefügt; strenge CSP ohne `unsafe-inline`; nichts ausgeführt); Pfadausbruch (7 Varianten abgewehrt); keine Geheimnisse im Verlauf (Suche nach API-Schlüssel-/Privatschlüsselmustern: 0 Treffer; keine Schlüssel- oder Datenbankdatei versioniert); Gemini-Schlüssel im Header `x-goog-api-key`, nicht in der URL; Zugriffscode wird nicht protokolliert; kein CORS-Header (fremde Seiten können Antworten nicht lesen); Klartextsuche in allen Datenbankdateien nach Namen: kein Treffer.

---

## E. Medizinische und regulatorische Fragen (mit Fachleuten zu klären)

*Dies sind offene Fragen, keine Antworten. Ich gebe keine Freigabe und erfinde keine Anforderungen.*

1. **Rundung und Mindestdosis:** Auf- oder abrunden? Gilt „mindestens 1 Kapsel“ bei Fett > 0, ab welcher Fettmenge ist eine Dosis vorgesehen? (Ärztin/Apotheker)
2. **Kapselgrößen:** Welche Kreon-Stärken sind aktuell verkehrsfähig und sollen angeboten werden (laut Portalen u. a. 10.000, 20.000, 25.000, 35.000)? (Fachinformation, Hersteller)
3. **Tageshöchstmenge:** Soll es Hinweise geben, und wer legt Werte fest? Die App zeigt bewusst keine.
4. **Abweichungshinweis (75 %/150 %) und Berichtskennzahlen:** fachlich sinnvoll oder anders? Welche Angaben brauchen Ärztinnen und Ärzte?
5. **KI-Schätzung:** Welche Fehlerbereiche bei Fettmenge/Portion sind vertretbar? Welche Warnungen müssen sichtbar sein? Wer trägt die Verantwortung für die Eingabe?
6. **Kinder/Jugendliche:** Aufsicht, Bestätigung durch Eltern, Altersgrenzen; kein eigenes Berechnungsschema ohne ärztliche Vorgabe.
7. **Beschwerdetagebuch:** Welche Felder sind sinnvoll, was darf nicht abgeleitet werden?
8. **Regulatorik:** Gilt die App als **Medizinproduktesoftware**? Welche Pflichten (Klassifizierung, Dokumentation, klinische Bewertung, Risikomanagement) würden folgen? Ich weiß es nicht; Rechtsberatung/Regulatory-Affairs nötig.
9. **Kooperation mit einem Hersteller:** Marken- und Namensverwendung („Kreon“ in der App), Hinweis-/Werbepflichten, Haftung, Verträge.
10. **Datenschutz (DSGVO, Gesundheitsdaten, Minderjährige):** Rechtsgrundlage, Einwilligungen, Auftragsverarbeitung mit KI-/Hosting-Anbietern, Löschung/Export, Datenschutz-Folgenabschätzung, Serverstandort.
11. **Lizenzen und Rechte:** Open Food Facts (ODbL), gebündelte Bibliotheken, Logo/Icons (Urheber, Nutzungsrechte), Domain/Name „EnzyMate“ (kein Markenrecherche durchgeführt).

---

## F. Die zehn sinnvollsten nächsten Entwicklungsschritte

**Hinweis:** Die Zahlen (1–10) sind **qualitative Einschätzungen von mir**, keine Messwerte. „Aufwand“: 10 = sehr groß. „Risiko“ = Sicherheits-/regulatorisches Risiko der Umsetzung (10 = hoch). „Wirkung auf Qualität“ und „Attraktivität für Hersteller“ (vermutet, **keine Marktkenntnis, keine Preis- oder Interessensaussage**).

Vorher geprüft, ob schon vorhanden: **keine** dieser Funktionen existiert bereits (siehe B).

| Rang | Schritt | Nutzen | Aufwand | Risiko | Qualität | Attraktivität (vermutet) | Abhängigkeit / Begründung |
|---|---|---|---|---|---|---|---|
| 1 | **Fehler beheben, die Dosis verfälschen können**: KI-Antwort strenger prüfen (fehlend ⇒ markieren statt 0; Summenprüfung; Kalorienabgleich), Fettrundung und Anzeige-Konsistenz, verständliche Fehlertexte | 9 | 3 | 3 | 9 | 8 | Kein neues Datenmodell nötig; höchste Sicherheitswirkung |
| 2 | **KI-Genauigkeitsmessung** (Testwerkzeug, ≥ 50 Lebensmittel, Referenzwerte) mit echtem Modell | 9 | 6 | 4 | 9 | 9 | Ohne Messung keine belastbare Aussage zur KI; braucht Fotos, Schlüssel, Netz |
| 3 | **Live-Prüfung von Open Food Facts und Gemini** (`npm run test:live`) und reale Barcodefotos auf iPhone/Android | 8 | 2 | 2 | 8 | 7 | Nur Ausführung auf deinem Gerät/Server nötig |
| 4 | **Sicherer Mindestbetrieb**: Zugriffscode Pflicht, Anfragetyp prüfen, Sperre bei Fehlversuchen, `//[`-Fehler, HTTPS-Betrieb, DB-Rechte | 8 | 3 | 4 | 8 | 8 | Voraussetzung für jede Bereitstellung |
| 5 | **Wiederverwendbare Mahlzeiten** (zuletzt gegessen, Favoriten, Rezepte, bestätigte Produkte) | 9 | 6 | 3 | 7 | 7 | Bestehende Mahlzeiten speichern bereits Kopien der Werte (keine rückwirkende Änderung) |
| 6 | **Nachvollziehbares Berechnungsprofil** (Historie, Änderungsdatum, ärztlicher Hinweis als Nutzereintrag, Bestätigung, Sperre) | 8 | 4 | 4 | 8 | 9 | Server nutzt Faktor bereits aus dem Profil (A0.3) |
| 7 | **Mahlzeit bearbeiten/nachtragen** mit Protokoll | 8 | 4 | 3 | 7 | 6 | Baut auf Migrationen und Zeilenbindung auf |
| 8 | **Benutzerkonten** (Passwort mit `scrypt`, Sitzungen, Sperre, Wiederherstellungscodes) plus Isolationstests | 7 | 8 | 7 | 8 | 9 | Hosting mit HTTPS nötig; Entscheidungen zu Verfahren |
| 9 | **Produktionsdatenbank-Entscheidung** (statt experimentellem `node:sqlite`) und automatisierte Sicherung/Wiederherstellung | 7 | 6 | 5 | 8 | 9 | Beeinflusst Verschlüsselung/Migrationen |
| 10 | **Rechte- und Lizenzpaket** (LICENSE, Drittlizenzen/SBOM, Logo-Rechte, Open-Food-Facts-Lizenz, Markenprüfung) | 6 | 3 | 2 | 6 | 9 | Reine Dokumentation/Klärung, aber Voraussetzung für Prüfung durch Käufer |
| (11) | Kinder-/Familienmodus | 7 | 8 | 8 | 6 | 8 | Erst nach klinischer Klärung und Konten |
| (12) | Offline mit verschlüsseltem lokalen Speicher | 6 | 9 | 8 | 6 | 6 | Konzept zuerst; setzt Konten voraus |
| (13) | Beschwerdetagebuch | 6 | 5 | 6 | 5 | 6 | Felder ärztlich abstimmen |
| (14) | Barrierefreiheit (Dialognamen, Kontrast, Screenreader-Prüfung) | 6 | 3 | 1 | 7 | 6 | kleine Maßnahmen, aber Wirkung auf Zugänglichkeit |

---

## G. Technische Verkaufsreife (Fakten und Einschätzungen getrennt)

**Technische Fakten**
- *Übernehmbar als Codebasis:* `calc.js` (Berechnung), `report.js` (Auswertung/CSV), `db.js`/`crypto.js` (verschlüsselte Datenschicht mit Tests), `server.js`, Oberfläche als Referenz. Keine Produktivabhängigkeiten, MIT-lizenzierte gebündelte Bibliotheken.
- *Ersetzen/absichern:* experimentelles `node:sqlite`; Gemini-Anbindung mit festem Modell und vertraglich geklärtem Datenschutz; Demo-Funktionen (Claude-Artifact) sind **nicht** Teil eines eigenständigen Produkts.
- *Unabhängigkeit von Claude Artifacts:* Die Server-App läuft eigenständig (`npm start`); die Demo ist zwingend an claude.ai gebunden.
- *Eigenständige Bereitstellung:* heute nur per Hand (`npm start` hinter eigenem Proxy); kein Container, keine CI, kein Deployment-Handbuch.
- *Testlage:* 38 automatische Tests, serverseitig gut abgedeckt (87–100 %), Browsercode ohne Messung; **keine** Live-, Geräte-, Last- oder Sicherheitsprüfung durch Dritte; **keine Messdaten zur KI**.
- *Dokumentation:* vorhanden, aber ohne Bedrohungsmodell, API-Beschreibung, Lizenzliste, Betriebs- und Notfallhandbuch.

**Kommerzielle Einschätzungen (meine Annahmen, keine Marktaussagen)**
- Ein Käufer wird wahrscheinlich zuerst nach **medizinischer/regulatorischer Einordnung, Datenschutz und Nachweisen zur Genauigkeit** fragen, nicht nach Oberflächenfunktionen. Das ist eine Vermutung.
- Der derzeitige Prototyp ist als **Demonstration** der Idee tauglich, als geprüftes Produkt nicht.

**Vor einer seriösen technischen Prüfung durch einen Käufer vorzubereiten** (Behauptung einer Freigabe wird nicht gemacht): Lizenz-/Rechteübersicht (Code, Bibliotheken, Logo, Name, Datenquellen); Software-Stückliste; Architektur- und Datenflussdiagramm; Bedrohungsmodell; Datenschutzkonzept inkl. Folgenabschätzungsentwurf; Teststrategie mit Live-/Gerätenachweisen und KI-Messbericht; Betriebs- und Backup-/Restore-Konzept; Risikoliste Medizin/Regulatorik mit Fachleuten; Nachweis, welche Teile von der KI erzeugt wurden und welche Prüfungen Menschen durchgeführt haben.

---

## H. Entwicklungsplan 30/60/90 Tage (Vorschlag, Kapazität und Freigaben vorausgesetzt)

**Tage 1–30: Vertrauen herstellen**
1. Fehler aus R1, R3, R11–R14 beheben (jeweils mit Test); verständliche Fehlertexte; Kontrast.
2. `npm run test:live` ausführen (du), Ergebnisse dokumentieren; Barcode-Tests mit echten Verpackungen auf iPhone und Android (Fotos/Geräte nötig).
3. KI-Messkampagne vorbereiten (≥ 50 Lebensmittel, Referenz Gewicht/Fett) und mit festem Modell durchführen.
4. Fragenkatalog (Abschnitt E) an Ärztin/Apotheker senden; Erstberatung Regulatorik/Datenschutz/Marke einplanen.
5. LICENSE, Drittlizenzliste, Logo-Rechte klären; KI-Anbieter mit „kein Training“-Zusage festlegen.

**Tage 31–60: Alltagsnutzen und Betriebsfähigkeit**
6. Zuletzt gegessen/Favoriten/Rezepte; Produktbestätigung mit Cache; Mahlzeit bearbeiten/nachtragen.
7. Berechnungsprofil mit Historie und Bestätigung.
8. Hosting-Prototyp mit HTTPS, Zugriffsschutz, automatischer Sicherung und getesteter Wiederherstellung; Entscheidung zur Produktionsdatenbank.

**Tage 61–90: Mehrbenutzer und Nachweise**
9. Konten, Sitzungen, Rechte, Isolationstests; Kinder-/Familienstruktur (nur technische Rollen, Einnahmeführung erst nach ärztlicher Klärung).
10. Offline-Konzept (Dokument) und danach Umsetzung nur bei Freigabe; Beschwerdetagebuch nur mit abgestimmten Feldern.
11. Externe Sicherheitsprüfung; Due-Diligence-Paket aus G; kleiner, datenschutzkonformer Pilot.

---

## Anhang: Wichtige Messwerte und Befehle zum Nachvollziehen

- Tests: `npm test` → `# tests 38 / pass 38 / fail 0` (9,0 s; nach dem Dosis-Paket siehe Nachtrag: 51). Abdeckung: `node --disable-warning=ExperimentalWarning --experimental-test-coverage --test test/*.test.js`.
- Zeitzonen: `TZ=Europe/Berlin node --test test/app.test.js test/db.test.js test/security.test.js` (31/31), ebenso `America/Los_Angeles`, `Pacific/Auckland`, `Asia/Kolkata`.
- Abhängigkeiten: `npm audit` → 0 Schwachstellen; Hashes der gebündelten Bibliotheken `e3aa2057178b8ea7…` (JS) und `2ebda08a93eea3ef…` (WASM) gleich den npm-Originalen.
- Dateirechte (Standardlauf): `secret.key` 600, `creon.db` 644, Ordner 755.
- Sicherheitsprobe: POST `text/plain` ohne Code → 200; 300 falsche Codes → 300 × 401 in 271 ms; `GET //[` → keine Antwort (hängt), Log `ERR_INVALID_URL`; `GET /api/%ZZ` → 404.
- Barcode (synthetisch): 11 von 16 erkannt; nicht erkannt: 30°, Unschärfe Radius 4 und 8, Rauschen ±60, Schattenverlauf.
- Datenmenge: 5.000 Mahlzeiten – alles lesen 87 ms.
- Die Prüfskripte liegen seit dem 16.10.2026 dokumentiert unter `scripts/audit/` (Anleitung und erwartete Ergebnisse in `scripts/audit/README.md`); Dritte können die Prüfungen damit wiederholen. Sie wurden nach dem Ablegen erneut ausgeführt; die Ergebnisse entsprechen den Angaben in diesem Bericht.

---

## Nachtrag 16.10.2026: Paket „Fehler, die die Dosis verfälschen können“

Behoben bzw. teilweise behoben (Rundungsregeln und Formel **bewusst unverändert**):
- **KI-Fettwert fehlt → 0 g** (teilweise): Eintrag wird als „Bitte prüfen“ markiert, Fett Pflichtfeld, Speichern erst nach Prüfung; ebenso Open-Food-Facts-Produkte ohne Fett. Neu: technische Plausibilitätshinweise (Summe > 101 g/100 g, Kalorienabweichung, Begrenzung). **Nicht behoben:** die Treffgenauigkeit der KI-Schätzung ist weiterhin ungemessen.
- **Fettrundung vor der Dosis:** Dosis jetzt aus ungerundeter Fettsumme (Test: 333 g × 7,5 g/100 g → 49.950 E; 51,75 g → 103.500 E).
- **Anzeige-Konsistenz:** „Rechnerisch“ abgeschnitten (1,49), exakte Fettsumme sichtbar; Property-Test über 0–250.000 Einheiten.
- **Fehlermeldungen:** offline, 5xx und unlesbare Antworten deutsch und verständlich; > 50 Kapseln mit Hinweis.
- **`GET //[`:** 400 in wenigen ms statt hängender Verbindung.
- **Gemini-Fehlerlog:** Schlüssel wird vor dem Loggen entfernt.

Nachweise: `npm test` → 51 von 51 bestanden (13 Browser-Tests mit nachgebautem Open Food Facts/Gemini); Prüfskripte erneut ausgeführt. Mutationen (Korrekturen testweise entfernt) ließen die neuen Tests fehlschlagen. **Nicht praktisch getestet:** echte Dienste, echte Geräte. In Randfällen kann die Empfehlung um bis zu 0,05 g × Faktor Einheiten von früheren Werten abweichen.
