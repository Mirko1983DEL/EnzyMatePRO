# EnzyMate – Funktionsbeschreibung (Stand: 14.10.2026)

Dieses Dokument beschreibt den **tatsächlichen Ist-Zustand** der App „EnzyMate" (Arbeitstitel früher „Kreon Tracker"), damit man mit einem anderen KI-Assistenten über Erweiterungen sprechen kann. Wo etwas nicht getestet oder nicht gesichert ist, steht das ausdrücklich dabei (Kennzeichnung: **[ungetestet]**, **[Annahme]**, **[offen]**).

---

## 0. Hinweise an den Assistenten, der dieses Dokument liest

- Es geht um eine private App für **eine Patientin (Marie)** mit Bauchspeicheldrüsen-Insuffizienz, die zu den Mahlzeiten Pankreasenzyme (Kreon) einnimmt. Der Nutzer ist ein Angehöriger / Laie, kein Entwickler und kein Arzt.
- **Bitte keine medizinischen Dosierungsangaben, Grenzwerte oder Leitlinien erfinden.** Der Lipase-Faktor wird von der behandelnden Ärztin / dem Arzt festgelegt und in der App nur eingetragen. Wenn du etwas nicht sicher weißt, sag es.
- Die App ist ein **Rechen- und Protokollhilfsmittel**, keine ärztliche Dosierung. Ob sie rechtlich als Medizinprodukt gelten könnte, ist **[offen]** und nicht geprüft.
- Der Nutzer wünscht nüchterne, realistische Darstellung ohne Schönfärberei.

---

## 1. Zweck in einem Satz

Essen fotografieren/scannen oder eintippen → die App berechnet aus der Fettmenge und dem Lipase-Faktor, wie viele Kreon-Kapseln der gewählten Größe zu nehmen sind → jede bestätigte Einnahme wird mit Nährwerten und empfohlener Dosis gespeichert → Auswertung über Tag/Woche/Monat/frei wählbaren Zeitraum.

---

## 2. Aktueller Stand auf einen Blick

| Bereich | Stand |
|---|---|
| Dosisberechnung | umgesetzt, durch automatische Tests abgedeckt |
| Mahlzeiten speichern + Verlauf/Auswertung | umgesetzt, getestet |
| Verschlüsselte Datenbank (Server-Version) | umgesetzt, getestet (Roundtrip, Manipulationserkennung, kein Klartext in Datei) |
| Barcode-Erkennung im Browser | umgesetzt; mit einem selbst erzeugten, sauberen EAN-13-Bild getestet; echte Fotos von Verpackungen **[ungetestet]** |
| Open Food Facts (Barcode → Nährwerte) | umgesetzt; nur mit nachgebauten Antworten getestet, **nie gegen den echten Dienst** |
| KI-Schätzung per Foto (Gemini, Server-Version) | umgesetzt; nur mit nachgebauten Antworten getestet, **nie mit echtem Schlüssel** |
| KI-Schätzung in der Demo (Claude über Artifact-Funktion) | umgesetzt; nur mit nachgebauter Funktion getestet, **echter Aufruf ungetestet** |
| Bericht/Export für das Arztgespräch | umgesetzt (Kennzahlen, 2 Diagramme, Tabelle, CSV, Druck/PDF, Text kopieren); Logik durch Tests abgedeckt; **Auswahl der Kennzahlen nicht ärztlich abgestimmt**; Teilen/Speichern auf dem iPhone **[ungetestet]** |
| Login | **nicht vorhanden** (nur vorbereitet) |
| Server / Hosting / HTTPS | **noch kein Server**; nichts ist öffentlich betrieben |
| Auf einem echten iPhone getestet | **nein**; nur Headless-Chromium mit 390 px Breite (Hell/Dunkel) |

Zwei Lieferformen:
1. **Echte App** (Node-Server + SQLite + Frontend) im Git-Repo `mirko1983del/cf`, Branch `claude/creon-app-redesign-jr0otc`.
2. **Demo** (eine einzelne HTML-Datei, ca. 1,5 MB, ohne Server) als privates Artifact auf claude.ai, Daten nur im Browser.

---

## 3. Technik

- **Backend:** Node.js ≥ 22.5, **keine externen Pakete** (eingebautes `node:sqlite`, `node:http`, `node:crypto`). ca. 160 Zeilen `server.js`.
- **Datenbank:** SQLite (WAL-Modus), Datei `data/creon.db`.
- **Frontend:** reines HTML/CSS/JavaScript (ES-Module), kein Framework, kein Build-Schritt. System-Schrift, Hell-/Dunkelmodus automatisch (`prefers-color-scheme`), `manifest.webmanifest` (zum „Zum Home-Bildschirm"-Hinzufügen). Kein Service Worker, also **keine Offline-Funktion**.
- **Barcode-Bibliothek:** `barcode-detector` 3.2.2 (zxing-wasm, MIT-Lizenz), lokal mitgeliefert (`public/vendor/`, ca. 44 KB JS + 1,1 MB WASM). Es werden keine Dateien von fremden Servern nachgeladen.
- **Tests:** 51 automatische Tests (`npm test`): Verschlüsselung (inkl. Zeilenbindung, Schlüsselwechsel), Datenbankmigrationen (inkl. Sicherung und Rollback), Berechnung, API, Zugriffscode, Klartextfreiheit der DB-Datei, Server-Sicherheit (Header, Pfadzugriffe, Profil-Faktor, Stand-Prüfung), Bericht/CSV Plausibilitätsprüfung der KI-Werte, Fehlertexte und **13 Browser-Tests** (Chromium über `playwright-core`; Open Food Facts und Gemini darin **nachgebaut**). Echte Dienste prüft nur `npm run test:live` (siehe 7a).

Hinweis zur Schreibweise: Das Medikament heißt in der App „Kreon". Einige interne technische Namen tragen noch die alte Schreibweise (Umgebungsvariable `CREON_KEY`, Datei `creon.db`, Browser-Speicherschlüssel `creon…`); sie sind in der Oberfläche nicht sichtbar.

Dateien (Auszug):
```
server.js        HTTP-Server, API-Routen, Validierung, statische Dateien
db.js            SQLite-Schema und verschlüsselte Lese-/Schreibfunktionen
crypto.js        AES-256-GCM, Schlüsselverwaltung
analyze.js       Open Food Facts und Gemini
public/calc.js   Berechnung (rein, ohne I/O; läuft in Browser und Server)
public/estimate.js  Prompt + Prüfung der KI-Antwort (gemeinsam für Server und Demo)
public/scan.js   Foto → Barcode → Open Food Facts / KI
public/app.js    Oberfläche
public/api.js    Browser → Server (echte App)
tools/demo-api.js, tools/build-demo.mjs   baut die Ein-Datei-Demo
```

---

## 4. Funktionen (aus Nutzersicht)

### 4.1 Startbildschirm
- Logo (Kapsel-Figur mit Smartphone und Croissant, im Dunkelmodus auf weißer Kachel), Begrüßung „Hallo <Name>", große Frage „Was gibt es zu essen?".
- Kopfzeile auf allen Seiten: Menü, kleines App-Symbol mit Namen „EnzyMate", Kreon-Größe. App-Symbol auch als Browser-Tab-Symbol, iPhone-Home-Bildschirm-Symbol (`apple-touch-icon`) und im Manifest.
- Zwei Aktionen: **„Foto oder Barcode"** (öffnet Kamera/Fotoauswahl) und **„Manuell eingeben"**.
- Oben links Menü, oben rechts ein Schalter mit der aktuellen **Kreon-Größe**.

### 4.2 Kreon-Größe
- Auswahl: **10.000, 25.000, 35.000** (Lipase-Einheiten pro Kapsel; so vom Nutzer vorgegeben; ob es weitere Größen gibt, ist hier nicht berücksichtigt).
- Die **zuletzt gewählte Größe bleibt gespeichert** (Datenbank bzw. in der Demo localStorage) und gilt auch nach dem Neuladen. Die Mahlzeit selbst startet immer leer.

### 4.3 Mahlzeit zusammenstellen
- Eine Mahlzeit besteht aus **einem oder mehreren Lebensmitteln** (max. 40).
- Pro Lebensmittel: Name, Menge in g, Fett pro 100 g (Pflicht); optional kcal, Kohlenhydrate, Eiweiß je 100 g („Weitere Nährwerte", eingeklappt).
- Einträge sind per Antippen **korrigierbar oder entfernbar**.
- Herkunft eines Eintrags wird klein markiert: „KI" (geschätzt) oder „OFF" (aus Open Food Facts); manuell = keine Marke.
- Es gibt **keine gespeicherte Lebensmittel-Bibliothek** in der Oberfläche (wurde bewusst entfernt; ungenutzte Server-Routen `/api/foods` existieren noch).

### 4.4 Ergebnis
- Große Zahl: **empfohlene Kapselzahl**; mit **+ / −** anpassbar (0–50). Die Anpassung gilt nur für diese Mahlzeit und wird beim nächsten Hinzufügen/Ändern von Lebensmitteln wieder auf die Empfehlung zurückgesetzt.
- Link **„Details zur Berechnung"** öffnet ein Pop-up (siehe 5). Weicht die gewählte Menge stark von der Rechnung ab, wird der Link zu **„Details · Abweichung"** (unauffällig, gelb).
- Fehlt der Lipase-Faktor, steht dort „Lipase-Faktor im Profil eintragen".
- **„Einnahme speichern"** schreibt die Mahlzeit in die Datenbank und leert die Mahlzeit.

### 4.5 Scan: Barcode zuerst, KI nur auf Wunsch
1. Foto wird **im Browser** verkleinert (max. 1600 px) und nach einem Barcode durchsucht (EAN-13, EAN-8, UPC-A, UPC-E). Eingebauter `BarcodeDetector` wenn vorhanden (Chrome/Android), sonst die mitgelieferte zxing-wasm-Bibliothek (z. B. iOS-Safari **[Annahme: dort nicht eingebaut; ungetestet]**).
2. **Barcode gefunden** → nur die Nummer geht an Open Food Facts (Name, Nährwerte pro 100 g, ggf. Portionsgröße; sonst 100 g als Menge). Fehlt dort die Fettangabe, weist die App darauf hin.
3. **Kein Barcode oder Produkt unbekannt** → **in EnzyMate Pro automatisch weiter mit der KI** (nach einmaliger Einwilligung); ist die KI nicht eingerichtet, Pop-up „Kein Barcode erkannt" mit „Neuer Versuch" / „Abbrechen". *(Stand EnzyMate-Original: Auswahlpop-up, KI nie automatisch.)*
4. **„KI benutzen"** → einmaliger Hinweis-Dialog (Foto geht an den KI-Anbieter, keine Patientendaten; Schätzung ist ungenau) → Foto (max. 1024 px, JPEG 80 %) wird gesendet → Antwort als Liste von Bestandteilen (z. B. „Spaghetti" und „Sahnesoße" getrennt) mit geschätzter Menge und Nährwerten pro 100 g.
5. Die Antwort wird **geprüft und begrenzt** (z. B. Fett max. 100 g/100 g, Menge 1–2000 g, max. 15 Einträge). Das fängt nur unmögliche Werte ab, **nicht** plausibel aussehende, aber falsche Schätzungen. Der Nutzer soll Menge und Fett prüfen.
6. **Technische Plausibilitätshinweise (keine medizinische Bewertung):** Fehlt der Fettwert (KI oder Open Food Facts), wird er **nicht mehr stillschweigend als 0 g** übernommen, sondern der Eintrag als „Bitte prüfen" markiert; das Fettfeld bleibt leer und ist Pflicht. Weitere Hinweise: Summe von Fett + Kohlenhydraten + Eiweiß > 101 g pro 100 g; Kalorienangabe weicht um mehr als 60 kcal **und** mehr als 35 % von 9·Fett + 4·KH + 4·Eiweiß ab; Wert wurde auf den Höchstwert begrenzt. Die Schwellen sind eigene technische Annahmen. **Speichern ist erst möglich, nachdem alle markierten Einträge angesehen und übernommen wurden.** Die Genauigkeit der KI-Schätzung selbst ist weiterhin **nicht gemessen**.

### 4.6 Verlauf & Auswertung (Menü → Verlauf)
- Zeitraum: **Tag, Woche (Mo–So), Monat, Frei** (Datumsauswahl), Blättern mit Pfeilen.
- Kopfzeile mit drei Zahlen: Kapseln, Fett (g), kcal.
- Antippen öffnet die **komplette Auswertung** (siehe 5).
- Liste der Mahlzeiten (bei mehreren Tagen nach Tag gruppiert): Lebensmittelnamen, Uhrzeit, Fett, Kapselzahl. Antippen öffnet die Details der Mahlzeit; dort **Löschen** (Zwei-Schritt-Bestätigung). **Mahlzeiten können derzeit nicht bearbeitet werden, nur gelöscht.**

### 4.7 Profil (Menü → Profil)
- Name, Größe (cm), Gewicht (kg), **Lipase-Faktor (Einheiten pro g Fett)**.
- Beim ersten Start öffnet sich das Profil automatisch („Einrichten").
- Größe wird bisher **nicht zur Berechnung verwendet** (nur gespeichert). Gewicht wird nur für die Anzeige „Einheiten pro kg" verwendet.

### 4.8 Bericht & Export (Verlauf → „Bericht")
Gilt für den im Verlauf gewählten Zeitraum. **Grundlage sind ausschließlich gespeicherte Mahlzeiten** (also bestätigt mit „Einnahme speichern"). Ein Scan allein wird nicht erfasst; er kann auch nur ein Näherungswert zum Abwägen gewesen sein. Was nicht gespeichert wurde, fehlt im Bericht, die Richtigkeit der Eingaben liegt beim Nutzer. Das steht auch im Bericht selbst.

Inhalt (Auswahl von mir, **nicht ärztlich abgestimmt**):
- Kopf: Name, Gewicht, Größe, Lipase-Faktor, Zeitraum, Erstellungsdatum.
- Kennzahlen: Tage mit gespeicherten Einträgen (z. B. „6 von 15"), Mahlzeiten, Ø Fett/Kapseln/Lipase/Nährwerte pro Tag, Lipase pro kg, tatsächlich genommene E pro g Fett im Vergleich zum Faktor im Profil, Verhältnis genommen zu empfohlen in %, Mahlzeiten mit Fett ohne Kreon, Mahlzeiten unter 75 % / über 150 % der Empfehlung, Anteil per KI geschätzter Einträge.
- **Durchschnitte nur über Tage mit Einträgen** (sonst würden nicht erfasste Tage den Wert verfälschen).
- Zwei Diagramme (SVG, ohne Bibliothek): Fett pro Tag; genommene gegenüber empfohlenen Lipase-Einheiten pro Tag. Tage ohne Einträge sind als Punkt markiert.
- Tabelle aller Mahlzeiten nach Tagen: Uhrzeit, Lebensmittel mit Menge (KI-Schätzungen markiert), Fett, kcal, Kohlenhydrate, Eiweiß, Kreon (Anzahl × Größe, genommen von empfohlenen E).
- Exportwege: **Drucken/PDF** (A4-Druckansicht, ca. 2 Seiten; in der Demo gesperrt), **CSV** (Semikolon, Dezimalkomma, UTF-8 mit BOM für Excel Deutschland; eine Zeile je Mahlzeit; Schutz gegen Formel-Einschleusung), **Text kopieren**. Auf dem Handy wird CSV über das Teilen-Menü angeboten, sonst als Download. In der Demo speichert die Artifact-Funktion „downloads".
- Eine Auswertung zu Beschwerden (z. B. Stuhl, Schmerzen) fehlt, weil die App sie nicht erfasst.

---

## 5. Berechnungslogik (exakt wie im Code)

```
Fett gesamt (g)      = Σ (Menge_g / 100 × Fett_pro_100g)         (ebenso kcal, KH, Eiweiß; auf 0,1 gerundet)
benötigte Einheiten  = Fett gesamt (ungerundet) × Lipase-Faktor     (gerundet auf ganze Einheiten)
rechnerische Kapseln = benötigte Einheiten ÷ Kapselgröße          (2 Nachkommastellen)
empfohlene Kapseln   = auf ganze Zahl gerundet, mindestens 1 wenn Fett > 0, sonst 0
```
- **Dosis aus exakter Fettsumme:** Die Empfehlung wird aus der ungerundeten Fettsumme berechnet, nicht aus dem auf 0,1 g gerundeten Anzeigewert (Server speichert zusätzlich `fatExact`, 3 Nachkommastellen). Früher konnte die Rundung die Empfehlung um bis zu 0,05 g × Faktor Einheiten verschieben (z. B. 73.600 statt 73.500 E); bereits gespeicherte Mahlzeiten bleiben unverändert.
- **Anzeige:** „Rechnerisch" wird abgeschnitten statt gerundet (1,496 → „1,49", nie „1,5"). Fettsumme im Details-Pop-up mit bis zu 3 Nachkommastellen.
- Mehr als 50 Kapseln lassen sich nicht speichern; die App zeigt Hinweis und verständliche Meldung. Fehlertexte sind deutsch.
- Es wird **auf ganze Kapseln gerundet** (kaufmännisch; Regel unverändert, medizinische Frage an den Arzt). Kapseln zu öffnen/teilen ist nicht vorgesehen.
- **Abweichungshinweis** (eigene Wahl, keine medizinische Vorgabe): gewählte Einheiten < 75 % oder > 150 % der benötigten Einheiten.
- **Einheiten pro kg** = Einheiten / Gewicht; im Mehrtageszeitraum = Einheiten ÷ Tage ÷ Gewicht. Nur Anzeige, **keine Warnung bei Überschreitung** (kein gesicherter Grenzwert bekannt).
- **Ø pro Tag:** Summe ÷ Anzahl Kalendertage des Zeitraums **bis heute** (Tage ohne Eintrag zählen mit; mindestens 1 Tag).
- **Der Lipase-Faktor stammt immer aus dem Profil auf dem Server**, nicht aus der Anfrage des Browsers. Hat der Browser mit einem veralteten Faktor gerechnet (Profil inzwischen geändert), lehnt der Server mit 409 ab und nichts wird gespeichert; die Ansicht lädt das Profil neu. Die Berechnungsformel selbst ist unverändert.
- **Gespeichert wird pro Mahlzeit die zum Einnahmezeitpunkt empfohlene Menge** (Einheiten und exakte Kapselzahl) – der Server berechnet sie selbst. Ändert sich später der Faktor, bleibt die damalige Empfehlung erhalten.

Details-Pop-up „Berechnung": Fett gesamt, Lipase-Faktor, benötigt (E), Kapselgröße, rechnerisch, gewählt (inkl. E), Kalorien, Kohlenhydrate, Eiweiß, ggf. Abweichungshinweis.
Auswertungs-Pop-up: Kapseln genommen, Einheiten genommen, Einheiten empfohlen, E/kg und Tag, Nährwertsummen, Ø pro Tag, Anzahl Mahlzeiten.

---

## 6. Daten und Datenbank (echte App)

Tabellen (jede mit `user_id`, damit später mehrere Nutzer möglich sind):

| Tabelle | Klartext-Spalten | Verschlüsselter Inhalt (`enc`) |
|---|---|---|
| `users` | `id` | Name, Größe, Gewicht, Lipase-Faktor |
| `settings` | `user_id` | zuletzt gewählte Kapselgröße |
| `meals` | `id`, `user_id`, **`ts` (Zeitstempel, UTC)** | Lebensmittel (Name, Menge, Nährwerte/100 g, Quelle), Summen, Kapselgröße, genommene Kapseln, Faktor, empfohlene Einheiten und Kapseln, Notiz (bisher ungenutzt) |
| `foods` | `id`, `user_id` | Name + Nährwerte (Routen vorhanden, Oberfläche nutzt sie nicht mehr) |

- Der Zeitstempel bleibt im Klartext, damit Zeiträume abgefragt werden können. Aggregation (Summen) passiert **im Browser**, nicht in SQL.
- Zeitpunkt einer Mahlzeit = Speicherzeitpunkt. Die API akzeptiert ein anderes `ts` (nur ab 01.01.2020 und höchstens 10 Minuten in der Zukunft), die Oberfläche bietet **kein Nachtragen** an. Tages-/Wochengrenzen richten sich nach der **lokalen Zeit des Browsers**.

### API-Routen (JSON, alle unter `/api`)
`GET /state` · `PUT /patient` · `PUT /settings` · `GET/POST /meals`, `DELETE /meals/:id` · `GET /barcode/:nummer` · `POST /estimate` · (`POST /foods`, `DELETE /foods/:id`, ungenutzt)
Kapselgröße nur aus der festen Liste (10.000/25.000/35.000). Validierung u. a.: Größe 30–250 cm, Gewicht 2–300 kg, Faktor 0–20000, Menge 0,1–5000 g, Fett/Kohlenhydrate/Eiweiß 0–100 g je 100 g, kcal 0–900 je 100 g, Kapseln 0–50, Anfragegröße ≤ 100 KB (Foto-Route ≤ 4 MB).

---

## 7. Sicherheit und Datenschutz – nüchtern

- **Feldverschlüsselung** mit AES-256-GCM, Format **v2**: jeder Wert hat einen eigenen Zufalls-IV, eine Schlüsselkennung (für spätere Schlüsselrotation) und ist über Zusatzdaten (AAD) an **Tabelle, Nutzer, Zeile (bei Mahlzeiten auch den Zeitstempel)** gebunden. Vertauschte, verschobene oder umdatierte Werte werden beim Entschlüsseln erkannt. Das alte Format v1 bleibt lesbar; neue und geänderte Werte werden als v2 geschrieben. Bestehende v1-Werte werden **nur auf ausdrücklichen Befehl** umgeschlüsselt (`npm run migrate:encryption`, vorher automatische Sicherung, anschließend Integritätsprüfung). Schlüssel aus Umgebungsvariable `CREON_KEY` oder Datei `data/secret.key`.
- **Grenzen dieser Verschlüsselung:** Die App/der Server kann alles lesen (kein Ende-zu-Ende). Liegt der Schlüssel (Standard) auf demselben Server wie die Datenbank, schützt das vor allem bei Diebstahl **nur der Datenbankdatei**, nicht bei Zugriff auf den ganzen Server. Der Mahlzeiten-Zeitstempel ist unverschlüsselt.
- **HTTPS** macht die App selbst nicht; vorgesehen ist ein Reverse-Proxy (Caddy/nginx) **[noch nicht eingerichtet, kein Server]**.
- **Kein Login.** Optional: gemeinsamer **Zugriffscode** (`ACCESS_TOKEN`, Header `x-access-token`, zeitkonstanter Vergleich). Ohne ihn ist die API offen – nur im geschützten Netz betreiben. `resolveUser()` in `server.js` ist die einzige Stelle, die für einen späteren Login ersetzt werden müsste.
- **Fotos werden nicht gespeichert.** Bei Barcode-Treffer verlässt nur die Nummer das Gerät. Bei KI-Nutzung geht das (verkleinerte) Foto an den KI-Anbieter.
- **Gemini (Server-Version):** API-Schlüssel nur auf dem Server (`GEMINI_API_KEY`). Laut Suchergebnissen (Sekundärquellen, offizielle Seite nicht abrufbar) darf Google Eingaben der **kostenlosen** Stufe zur Produktverbesserung verwenden; bei bezahlter Nutzung nicht. **[bitte in den aktuellen Google-Bedingungen selbst prüfen]**. Kostenlose Kontingentgrenzen sind **[offen]**. Als Modell ist `gemini-flash-lite-latest` voreingestellt, per `GEMINI_MODEL` änderbar – **[ungeprüft, ob der Name aktuell gültig ist]**. Eigene Drosselung: max. 10 KI-Anfragen pro Minute (im Arbeitsspeicher, gilt für alle Nutzer zusammen).
- **Demo:** Daten liegen **unverschlüsselt** im Browser-Speicher (localStorage). Nicht für echte Patientendaten gedacht.
- Sicherheits-Header: strenge Content-Security-Policy (nur eigene Quellen, **ohne** `unsafe-inline`; `wasm-unsafe-eval` nur für die Barcode-Bibliothek; `frame-ancestors`, `object-src`, `base-uri` gesperrt), `X-Frame-Options`, `Permissions-Policy` (Kamera nur für die App), `nosniff`, `no-referrer`. Statische Dateien nur per GET/HEAD. Server mit Zeitgrenzen und geordnetem Beenden (SIGTERM/SIGINT). Texte werden per `textContent` eingefügt (kein HTML aus Daten).

### 7a. Datenbankmigrationen, Sicherung, Prüfwerkzeuge
- **Migrationen** über `PRAGMA user_version`; jeder Schritt in einer Transaktion. Vor dem ersten Schritt auf einer Datei mit Daten entsteht automatisch eine konsistente Sicherung (`creon.db.vor-migration-<alt>-zu-<neu>-<Zeit>.bak`). Schlägt ein Schritt fehl, bleibt die Datenbank unverändert.
- `npm run migrate:encryption [-- --dry-run]`: v1 → v2 mit Sicherung und Integritätsprüfung; erzeugt nie einen neuen Schlüssel.
- `npm run test:live`: echter Aufruf von Open Food Facts (und Gemini mit `GEMINI_API_KEY` und `--photo`), schreibt `test-results/live-<Zeit>.json`. **In der Entwicklungsumgebung ohne Netz nicht erfolgreich gelaufen**; bisher gibt es keinen Live-Beleg.

---

## 8. Demo (Artifact) vs. echte App

| | Echte App | Demo |
|---|---|---|
| Speicherung | verschlüsselte SQLite auf dem Server | `localStorage` im Browser, unverschlüsselt |
| Open Food Facts | über den Server | direkt aus dem Browser; im Artifact-Viewer **sehr wahrscheinlich blockiert** [ungetestet] → Meldung „nicht erreichbar" |
| KI | Gemini über den Server (Schlüssel serverseitig) | **Claude** über die Artifact-Funktion `sample` mit Bild, läuft über das Claude-Konto des Betrachters, mit Einwilligungsabfrage; Antwortzeit laut Dokumentation ca. 5–60 s |
| Nutzer | einer (Login vorbereitet) | einer pro Browser |
| Erzeugung | `npm start` | `node tools/build-demo.mjs` → `demo/index.html` |

---

## 9. Bekannte Lücken und Einschränkungen (ehrlich)

- Kein Server, kein HTTPS, kein Backup-Konzept für Datenbank **und** Schlüssel (ohne Schlüssel sind die Daten unlesbar).
- Kein Login, keine Rollen, kein Mehrpatienten-Betrieb in der Oberfläche (Datenmodell ist vorbereitet).
- Mahlzeiten nicht bearbeitbar, nicht nachtragbar; Notizfeld ohne Oberfläche.
- Export nur als Bericht (Druck/PDF), CSV und Text; keine Erinnerungen, keine Offline-Nutzung, keine Beschwerdeerfassung.
- Keine Warnung bei Überschreitung einer Tageshöchstdosis (kein gesicherter Wert bekannt; bewusst nichts erfunden).
- Körpergröße wird nicht berechnungsrelevant genutzt; keine Gewichtsverlaufs-Erfassung.
- Keine Unterscheidung Hauptmahlzeit/Zwischenmahlzeit.
- Nur Deutsch. Rundung immer auf ganze Kapseln.
- Qualität der KI-Fettschätzung und Abdeckung von Open Food Facts für deutsche Produkte sind **unbekannt**.
- Barcode-Erkennung bei Knitterfolie/Spiegelung/schlechtem Licht **[ungetestet]**; Kamera-Verhalten auf iPhone **[ungetestet]**.
- Ungeprüft: Verhalten auf einem echten Hoster, Lastverhalten, Browser-Kompatibilität jenseits Chromium.

---

## 10. Mögliche Erweiterungen (Ideen zum Besprechen – keine Zusagen)

Nach Nutzen für Marie / Aufwand grob sortiert, **[Einschätzungen sind Annahmen]**:

1. **Mahlzeit nachträglich bearbeiten / mit Uhrzeit nachtragen** (klein; Daten sind schon da).
2. **Bericht für Arztbesuche** (umgesetzt, siehe 4.8). Offen: mit der Ärztin klären, welche Kennzahlen sie wirklich braucht; ggf. Punktdiagramm „genommene E pro g Fett je Mahlzeit".
3. **Weitere Auswertungen** (z. B. Vergleich Wochen, Gewichtsverlauf).
4. **Gemerkte Lieblingsgerichte / Vorlagen** (war früher drin, bewusst entfernt – ggf. anders gelöst, z. B. „zuletzt gegessen").
5. **Erinnerung zur Einnahme** (auf dem iPhone nur eingeschränkt für Web-Apps möglich **[Annahme, nicht geprüft]**).
6. **Login + mehrere Personen** (Datenmodell vorbereitet; Entscheidung nötig: Konten, Passkeys, Familienfreigabe).
7. **Beschwerden/Stuhl-Tagebuch** neben der Einnahme (medizinisch sensibel; mit Ärztin abklären, was sinnvoll dokumentiert wird).
8. **Native iPhone-App oder PWA mit Offline-Modus** (Service Worker; Kamera-Zugriff).
9. **Bessere Nährwertquellen** (weitere Datenbanken, eigene Rezepte mit Zutaten).
10. **Datensicherung und Wiederherstellung** (verschlüsseltes Backup, Schlüsselablage getrennt).
11. **Rechtliche/medizinische Einordnung** (Medizinprodukt? Haftungshinweise?) – **nicht geprüft, vor Weitergabe an Dritte klären**.

### Fragen, die der Nutzer mit dir klären möchte
- Welche dieser Erweiterungen bringen im Alltag am meisten?
- Wie sollten Login/Familienfreigabe aussehen, ohne die App schwer zu machen?
- Welche Hosting-Variante ist für eine private, datenschutzbewusste Nutzung sinnvoll? (Der Nutzer hat noch keinen Server.)
- Welche medizinischen Aspekte sollten vor einer Erweiterung mit der behandelnden Ärztin abgestimmt werden?
