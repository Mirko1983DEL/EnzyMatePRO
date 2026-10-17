# EnzyMate – Bestandsaufnahme und Entwicklungsplan

Stand: 15.10.2026 · Grundlage: tatsächlicher Code im Branch `claude/creon-app-redesign-jr0otc` (Commit `9a3dfa9`).
**In diesem Schritt wurde kein Code verändert**, nur dieses Dokument ergänzt.

## Fortschritt

### Etappe A0 – abgeschlossen am 15.10.2026

| Paket | Stand | automatisiert getestet | praktisch getestet | ungetestet |
|---|---|---|---|---|
| A0.1 Migrationen mit Sicherung und Rollback | umgesetzt | ja (4 Tests) | ja (Altdatenbank per Skript) | echte Produktivdaten gibt es nicht |
| A0.2 Test-Infrastruktur: 8 Browser-Tests im Repo, `test:live`, `migrate:encryption` | umgesetzt | ja (38 Tests insgesamt) | `test:live` lief, **konnte aber keinen Dienst erreichen** (kein Netz); Umschlüsselung lief an Testdatenbank | **Live-Aufrufe von Open Food Facts/Gemini weiterhin ungetestet**; iPhone |
| A0.3 Faktor aus dem Profil, Stand-Prüfung (409), feste Kapselgrößen | umgesetzt | ja (API + Browser) | ja (Headless) | |
| A0.4 Verschlüsselung v2 (Zeilenbindung, Schlüsselkennung), Umschlüsselung nur auf Befehl | umgesetzt | ja (Vertauschen/Umdatieren/Rotation/Klartext) | ja (Skript) | Schlüsselrotation im Betrieb |
| A0.5 Härtung: CSP ohne `unsafe-inline`, Header, Zeitgrenzen, 405, Server-Timeouts, geordnetes Beenden, Nutzer unbekannt → 404 | umgesetzt | ja (Header, Pfade, `ts`, Nutzer) | ja (SIGTERM → Exit 0; CSP im Browser ohne Verstöße) | Lastverhalten, Reverse-Proxy/HTTPS |

Bewusst **nicht** automatisch geändert: bestehende Daten werden nicht umgeschlüsselt; die Berechnungsformel ist unverändert. Aus Abschnitt D sind damit **behoben**: 1 (Faktor vom Browser), 2 (Verschlüsselung ohne Zeilenbindung), 4 (Migrationen). **Teilweise behoben**: 5 (CSP, Zeitgrenzen, Timeouts, unbekannter Nutzer sind erledigt; Begrenzung von Anmeldeversuchen und nutzerbezogene Drosselung folgen mit den Konten in Etappe C). **Offen**: 3 (Schlüssel liegt neben der Datenbank), 6 (Konten), 7 (Demo unverschlüsselt), 8–12 (Datenschutz, Medizin, Qualität).

---

## 0. Wie ich geprüft habe, und was die Statuswörter bedeuten

Gelesen und geprüft: `server.js`, `db.js`, `crypto.js`, `analyze.js`, `public/*.js`, `public/index.html`, `public/style.css`, `tools/*`, `test/app.test.js`, `package.json`. Ausgeführt: die vorhandenen 17 Tests (alle bestanden). Nicht ausgeführt: alles, was echte Netzdienste, API-Schlüssel, ein iPhone oder einen Server braucht (hier nicht vorhanden).

| Status | Bedeutung |
|---|---|
| **implementiert** | Code ist vorhanden |
| **automatisiert getestet** | Ein Test im Repo prüft es. Bei externen Diensten **nur mit nachgebauten Antworten (Mock)**, das ist kein Live-Test |
| **praktisch getestet** | Von mir real ausgeführt (hier: Headless-Chromium mit 390 px Breite) oder vom Nutzer berichtet |
| **ungetestet** | Weder noch |

**Hinweis zu Angaben im Auftrag:** Dass die Claude-Fotoanalyse „mit realen Lebensmittelfotos erfolgreich ausprobiert“ wurde, habe ich **nicht selbst beobachtet**. Ich führe es als Angabe des Nutzers (praktisch getestet durch den Nutzer, von mir nicht verifiziert). Ihre Nährwertgenauigkeit ist laut Auftrag nicht validiert; dazu gibt es im Code keinerlei Messung.

---

## A. Was ist bereits vollständig implementiert?

| Funktion | implementiert | automatisiert getestet | praktisch getestet | ungetestet / Anmerkung |
|---|---|---|---|---|
| Dosisberechnung (Fett × Faktor ÷ Kapselgröße, ganze Kapseln) `public/calc.js` | ja | ja (Einheitentests) | ja (Headless-UI) | fachliche Validierung der Rundung offen (siehe D) |
| Kreon-Größen 10.000/25.000/35.000, letzte Wahl gespeichert | ja | ja (API) | ja (Headless) | iPhone |
| Mahlzeit erfassen, speichern, löschen, Verlauf, Zeiträume | ja | ja | ja (Headless) | iPhone |
| Gespeicherte Empfehlung je Mahlzeit (E und exakte Kapseln) und verwendeter Faktor | ja | ja | ja | Faktor kommt vom Browser, nicht vom Server (siehe D) |
| Auswertung/Bericht für Arztgespräch, CSV (DE-Excel-Format), Druck/PDF, Text kopieren | ja | ja (Logik, CSV-Format) | ja (Download, PDF-Erzeugung in Chromium) | Import in echtes Excel, iPhone-Teilen/Druck |
| AES-256-GCM-Feldverschlüsselung, Zufalls-IV, Manipulationserkennung | ja | ja (Roundtrip, Manipulation, kein Klartext in Datei) | – | ohne Zusatzdaten-Bindung, siehe D |
| Zugriffscode (`ACCESS_TOKEN`) mit zeitkonstantem Vergleich | ja | ja | – | |
| Barcode-Erkennung im Browser (nativ oder zxing-wasm) | ja | nein | ja (nur ein selbst erzeugtes, sauberes EAN-13-Bild, Headless) | **echte Fotos, iPhone-Safari, Android: ungetestet** |
| Open-Food-Facts-Abfrage | ja | ja (**nur Mock**) | **nein** | echter Dienst nie aufgerufen |
| Gemini-Foto-Schätzung (Server) | ja | ja (**nur Mock**) | **nein** | Modellname `gemini-flash-lite-latest` ungeprüft; nie mit Schlüssel |
| Claude-Foto-Schätzung in der Demo (Artifact-Funktion `sample`) | ja | nur gegen nachgebaute Funktion | vom Nutzer berichtet (reale Fotos) | Genauigkeit nicht gemessen |
| Antwortprüfung der KI (Werte begrenzen: Fett ≤ 100 g/100 g, Menge 1–2000 g, ≤ 15 Einträge) | ja | ja | – | fängt nur Unmögliches, nicht Falsches |
| Kennzeichnung der Herkunft (KI/OFF) in Liste und Bericht | ja | teilweise | ja | |
| Vorab-Dialog vor KI-Nutzung, KI nie automatisch | ja | – | ja (Headless) | |
| Hell-/Dunkelmodus, Logo, Icons, Manifest | ja | – | ja (Headless) | Home-Bildschirm-Symbol auf iPhone |
| Ein-Datei-Demo (localStorage, unverschlüsselt) | ja | – | ja (Headless, Viewer vom Nutzer genutzt) | |

## B. Was ist teilweise implementiert?

- **Mehrbenutzer:** Tabellen tragen `user_id`, aber es gibt nur `DEFAULT_USER = 1`. Die einzige Stelle zur Nutzerauflösung ist `resolveUser()` in `server.js`.
- **Lebensmittel-Bibliothek:** Server-Tabelle `foods` und Routen `/api/foods` existieren, die Oberfläche nutzt sie nicht mehr. Sie speichert weder Favoriten-Markierung, Bestätigung, Portionsgröße noch Verwendungshäufigkeit.
- **Nachvollziehbarkeit des Berechnungsprofils:** je Mahlzeit sind Faktor und Empfehlung gespeichert (gut). Es gibt aber **keine Historie des Profils**, kein Änderungsdatum, keinen Hinweisfeld, keine Schutzfunktion.
- **Barcode:** Foto-basiert; **kein Live-Kamerabild**. Fehlermeldungen unterscheiden nicht zwischen „zu dunkel“, „unscharf“, „kein Code“.
- **Produktdaten:** Name, Nährwerte, Portion werden übernommen, aber **ohne Bestätigungsdialog**, ohne Abrufzeitpunkt, ohne Zwischenspeicher, ohne Quellenangabe/Lizenzhinweis.
- **KI-Qualität:** Plausibilitätsgrenzen vorhanden; **keine** Kennzeichnung unsicherer Bestandteile, keine Rückfrage zur Portion, kein Hinweis auf verstecktes Fett, kein Referenzvergleich.
- **Offline:** nur ein Manifest. Kein Service Worker, kein lokaler Speicher.
- **Tests:** 17 Tests (Logik, API, Verschlüsselung, Mocks). **Die UI-Prüfungen waren Wegwerf-Skripte außerhalb des Repos**, es gibt keinen automatisierten UI-Test im Projekt.

## C. Was fehlt?

Nach den Abschnitten im Auftrag: Rezepte/Vorlagen/Favoriten/Suche/Duplikaterkennung (3) · Live-Barcode, Fehlerklassen, zusätzliche Datenquellen, Produktbestätigung, Produkt-Cache (4) · KI-Unsicherheit, Rückfragen, Referenzvergleich, **KI-Testwerkzeug** (5) · Kindermodus, Elternbereich (6) · Konten, Anmeldung, Sitzungen, Rollen, Brute-Force-Schutz, Wiederherstellung (7) · Profilhistorie, Sperre, Bestätigungsschritt (8) · Offline mit Synchronisation (9) · Beschwerdetagebuch (10) · Bearbeiten und Nachtragen von Mahlzeiten (Etappe B9) · Datenbankmigrationen, Backup/Restore (12) · Dokumentation für Due Diligence (15).

## D. Risiken, die ich im Code erkenne

**Sicherheit und Datenintegrität (aus dem Code belegt):**

1. **Faktor kommt vom Browser.** `POST /api/meals` übernimmt `lipasePerGramFat` aus der Anfrage (`server.js`, Zeile ~107), nicht aus dem serverseitig gespeicherten Profil. Folge: Die „zum Zeitpunkt verwendete Parameter“ sind nicht serverseitig abgesichert; ein Client mit veraltetem Profil schreibt falsche Werte in die Dokumentation. Für spätere Nachvollziehbarkeit (Auftrag 8) und Mehrbenutzerbetrieb muss der Server die Quelle der Wahrheit sein.
2. **Verschlüsselung ohne Zusatzdaten-Bindung (AAD).** AES-GCM verschlüsselt jeden Wert einzeln, bindet ihn aber nicht an Tabelle, Zeile oder Nutzer. Wer Schreibzugriff auf die Datenbankdatei hat, kann verschlüsselte Werte **zwischen Zeilen oder Nutzern vertauschen**, ohne dass die Entschlüsselung scheitert. Ohne Schlüssel kann er Inhalte nicht lesen oder ändern. Verbesserung: AAD aus Tabelle + `user_id` + Zeilen-ID, Format-Version `v2`, Schlüsselkennung für spätere Rotation, Umstellung bestehender Daten per Migration.
3. **Schlüssel liegt standardmäßig neben der Datenbank** (`data/secret.key`). Das schützt nur vor Diebstahl der Datenbankdatei allein, nicht vor Zugriff auf den ganzen Server. Kein Schlüsselwechsel vorgesehen. Der Mahlzeiten-Zeitstempel ist unverschlüsselt (bewusst, dokumentiert).
4. **Keine Schema-Migrationen.** `db.js` nutzt nur `CREATE TABLE IF NOT EXISTS`. Jede Schemaänderung (Rezepte, Profilhistorie, Konten) ohne Migrationsmechanismus würde bestehende Daten gefährden. **Das ist die wichtigste technische Voraussetzung für alles Weitere.**
5. **Wenige Schutzmaßnahmen an der API:** Drosselung nur für KI-Aufrufe (global, nicht je Nutzer); keine Begrenzung von Anmeldeversuchen (es gibt noch keine Anmeldung); der Mahlzeitenzeitpunkt `ts` ist vom Client frei wählbar (auch weit in der Zukunft/Vergangenheit); CSP ohne `frame-ancestors`, `base-uri`, `form-action`, `object-src` und mit `style-src 'unsafe-inline'`; keine Server-Timeouts/kein geordnetes Herunterfahren; `getPatient()` wirft bei unbekanntem Nutzer einen Fehler (500).
6. **Zugriffscode im Browser** (localStorage, Header). Für einen Einzelnutzer-Prototyp ok, für Gesundheitsdaten im Internet nicht ausreichend → Konten (Etappe C), HTTPS zwingend.
7. **Demo:** localStorage unverschlüsselt (bekannt, nur Demo).

**Datenschutz (zu klären, keine Rechtsberatung):**
8. **Fotos an KI-Anbieter:** Laut Suchergebnissen (Sekundärquellen, offizielle Seite war nicht abrufbar) darf Google Eingaben der **kostenlosen** Gemini-Stufe zur Produktverbesserung nutzen. Für Gesundheitsnähe und erst recht für eine Zusammenarbeit mit einem Unternehmen ist das ungeeignet. Es braucht einen Anbieter/Tarif mit vertraglicher Zusage „kein Training“, Auftragsverarbeitungsvertrag und geklärtem Serverstandort. Bei Kindern zusätzlich Einwilligung der Sorgeberechtigten. **[offen]**
9. **Open Food Facts:** Soweit mir bekannt, steht die Datenbank unter der ODbL-Lizenz (Namensnennung, Weitergabe unter gleichen Bedingungen bei abgeleiteten Datenbanken); das berührt einen Produkt-Cache und jede spätere kommerzielle Nutzung. Bitte vor Produktivbetrieb **rechtlich prüfen**. Im Code gibt es noch keine Quellenangabe. **[Lizenztext noch nicht von mir gelesen]**

**Medizinisch/fachlich (siehe Abschnitt 6):**
10. **Falsche Fettschätzung = falsche Kapselzahl.** Unterschätztes Fett führt zu zu wenig, überschätztes zu zu viel Kreon. Die KI-Genauigkeit ist **nicht gemessen**; Prozentwerte für Sicherheit werden bewusst nicht angezeigt.
11. **Rundung:** `Math.round` auf ganze Kapseln, mindestens 1 sobald Fett > 0 (schon bei 0,5 g Fett). Ob das fachlich passt, ist **nicht validiert**. Ich ändere die Regel nicht, sondern markiere sie.
12. **Abweichungshinweis** (unter 75 % / über 150 %) und Bericht-Kennzahlen sind meine Setzungen, nicht ärztlich abgestimmt.

**Produkt/Qualität:**
13. Keine automatisierten UI-Tests, keine Barrierefreiheitsprüfung (Kontraste, Screenreader-Bedienung), kein Performance-Messprotokoll. Positiv: native `<dialog>`, Beschriftungen an Icon-Schaltern, Statusmeldungen mit `role="status"`.
14. Abhängigkeiten: Produktivcode hat **keine** npm-Pakete (Vorteil für Prüfung). Mitgeliefert sind `barcode-detector` 3.2.2 (MIT) und die zxing-wasm-Bibliothek; Lizenz- und Herkunftsliste fehlt noch.

## E. Größter Nutzen bei geringem Aufwand

1. **Zuletzt gegessen / Favoriten aus gespeicherten Mahlzeiten** (B7): Es fehlt kein neues Datenmodell, die Daten liegen schon vor. Löst direkt „nicht immer wieder fotografieren“.
2. **Mahlzeiten bearbeiten/nachtragen** (B9): wichtig für die Praxis, geringer Aufwand.
3. **Produktbestätigung mit Portionsänderung** (A3): geringer Aufwand, erhöht Zuverlässigkeit spürbar.
4. **Serverseitiger Faktor + Migrationen + AAD** (A0): kaum sichtbar, aber Voraussetzung für fast alles andere.
5. **KI-Testwerkzeug** (A5): kostet mehr, ist aber die Grundlage, um die KI überhaupt belastbar zu bewerten.

---

## 1. Entwicklungsplan

Aufwand: **S** klein (eine Stelle, wenige Tests) · **M** mehrere Dateien + Tests · **L** neues Teilsystem · **XL** Konzept + mehrere Teilsysteme + Freigaben. „Freigabe“ = ich brauche deine Entscheidung, bevor ich es umsetze.

### Etappe A0 – Fundament (von mir ergänzt, weil alles Weitere darauf aufbaut)

| Nr. | Arbeitspaket | Aufwand | Freigabe |
|---|---|---|---|
| A0.1 | **Schema-Migrationen** (Versionstabelle, nummerierte Migrationen, automatische Sicherung der DB-Datei vor jeder Migration) | M | nein |
| A0.2 | **Test-Infrastruktur**: UI-Tests ins Repo (Playwright als Entwicklungs-Abhängigkeit), Live-Integrationstests für OFF/Gemini als **separate, nur auf Wunsch laufende** Skripte | M | **ja** (Entwicklungs-Abhängigkeit) |
| A0.3 | **Server als Quelle für Faktor/Kapselgröße** (Mahlzeit speichert den serverseitigen Stand; Client schickt Lebensmittel und genommene Kapseln) | M | **ja** (Verhaltensänderung der API, Berechnungsformel bleibt unverändert) |
| A0.4 | **Verschlüsselung v2** (AAD, Format-Version, Schlüsselkennung) inkl. Migration vorhandener Daten mit Vorab-Sicherung | M | **ja** (Umschlüsselung bestehender Daten) |
| A0.5 | **Härtung**: strengere CSP-Header, Plausibilitätsgrenzen für `ts`, Server-Timeouts, geordnetes Beenden, Fehler bei unbekanntem Nutzer | S | nein |

### Etappe A – Kernqualität

| Nr. | Arbeitspaket | Aufwand | Freigabe |
|---|---|---|---|
| A1 | Bestandsprüfung | **erledigt (dieses Dokument)** | – |
| A2 | **Barcode zuverlässiger**: EAN-Prüfziffer validieren (Fehlablesungen erkennen), mehrere Skalen/Drehungen versuchen, einfache Qualitätsmessung (zu dunkel/unscharf) mit verständlichen Meldungen, **optionales Live-Kamerabild**; Testkorpus mit selbst erzeugten EAN-13/EAN-8/UPC-A/UPC-E-Bildern **und** realen Fotos | L | Fotos von dir |
| A3 | **Produktdaten**: Bestätigungsdialog (Name, Portion änderbar, Quelle, Abrufzeitpunkt, Vollständigkeit), Meldung bei fehlenden/widersprüchlichen Werten (z. B. Kalorien passen nicht zu Fett/Kohlenhydraten/Eiweiß), Produkt-Zwischenspeicher mit Abrufzeitpunkt, Quellenhinweis; **keine erfundenen Werte** | L | nein (Lizenz siehe A3b) |
| A3b | **Datenquellen-Recherche** (Lizenz, Limits, Kosten) als Bericht; **keine Implementierung ungeklärter kommerzieller Nutzung** | M | **ja** (Auswahl) |
| A4 | **KI-Plausibilität**: erweitertes Antwortformat (unsicher/nicht erkennbar, Portion unklar, Hinweis auf möglicherweise verstecktes Fett), Rückfrage bei fehlender Portionsinfo, feste Plausibilitätsregeln (z. B. Fett + Kohlenhydrate + Eiweiß je 100 g höchstens 100 g, Kalorien-Abgleich), Abgleich mit bestätigten eigenen Produkten/Rezepten und OFF **soweit verfügbar**, Verwerfen/Manuell. **Kein Konfidenzwert**, solange keiner definiert und geprüft ist | L | nein |
| A5 | **KI-Testwerkzeug** (eigene, geschützte Seite): ≥ 50 Testlebensmittel, mehrere Fotos je Eintrag, Referenzgewicht/Referenzfett, gespeicherte Schätzung samt **unveränderter KI-Antwort**, Datum, Modellkennung; absolute/relative Abweichung, systematische Unter-/Überschätzung, Auswertung je Lebensmittelgruppe, CSV-Bericht. Fotos nur lokal, nicht im Git | L–XL | **ja** (Fotos/Datenschutz, siehe Fragen) |
| A6 | Tests erweitern (UI-Smoke-Tests im Repo, Grenzfälle der Berechnung, Validierung) | M | nein |

### Etappe B – Mehr Alltagsnutzen

| Nr. | Arbeitspaket | Aufwand | Freigabe |
|---|---|---|---|
| B6 | **Lebensmittel- und Rezeptdatenbank**: Favoriten, Mahlzeit-Vorlagen, Rezepte (Zutaten × Menge × Nährwerte je 100 g → Gesamt und je Portion), Suche, Duplikaterkennung (Name/Barcode/ähnliche Werte), „bestätigt“ vs. „KI-geschätzt“; Änderungen verändern gespeicherte Einnahmen **nie rückwirkend** (Mahlzeiten speichern bereits Kopien der Werte, das wird per Test abgesichert) | XL | nein |
| B7 | **Zuletzt gegessen / Favoriten** gut erreichbar auf dem Startbildschirm (ohne die Oberfläche zu überladen) | M | nein |
| B8 | **Arztbericht/CSV verbessern**: Parameter zum Einnahmezeitpunkt (Faktor), ISO-Datumsspalte, „Quelle bestätigt?“, Gegentest Excel/LibreOffice-Import; bestehende Funktion bleibt erhalten | S–M | nein |
| B9 | **Mahlzeiten bearbeiten und nachtragen** (mit Änderungsprotokoll) | M | nein |

### Etappe C – Mehrbenutzerfähigkeit

| Nr. | Arbeitspaket | Aufwand | Freigabe |
|---|---|---|---|
| C10 | **Konten und Anmeldung**: Vorschlag Passwort (`scrypt` aus Node, etablierter Algorithmus), später optional Passkeys mit geprüfter Bibliothek (z. B. `@simplewebauthn/server`, MIT) statt eigener Kryptografie; serverseitige Sitzungen (zufällige Token, nur als Hash gespeichert), `HttpOnly`/`Secure`/`SameSite`-Cookies, Geräteliste und Abmeldung je Gerät, Bremse gegen Brute-Force, Wiederherstellungscodes, keine Token in Logs; **Sicherheits- und Migrationstest vor Aktivierung** | XL | **ja** (Verfahren, Wiederherstellung, Hosting/HTTPS) |
| C11 | **Familien-/Kindermodus**: Konto ≠ Patientenprofil (Rollen: Patient, Elternteil, Kind), Darstellungsmodus „EnzyMate Kids“ (große Flächen, klare Texte, keine Belohnung für Medikamenteneinnahme) | L–XL | **ja** (Aufsicht/Bestätigung klinisch offen) |
| C12 | **Geschütztes Berechnungsprofil**: Historie, Änderungsdatum, Hinweis „ärztliche Vorgabe“ (**nur als Nutzereintrag, nicht verifiziert; die App behauptet keine Freigabe**), Bestätigungsschritt, Sperre im Familienmodus, Protokoll | M | nein (Wortlaut abstimmen) |
| C13 | **Berechtigungskonzept** (wer sieht/ändert was) mit Tests zur Trennung der Konten | L | **ja** (Rechte-Matrix) |

### Etappe D – Professionalisierung

| Nr. | Arbeitspaket | Aufwand | Freigabe |
|---|---|---|---|
| D14 | **Offline**: zuerst **Konzeptdokument** (Sicherheit der lokalen Daten, Synchronisation, Konflikte), danach Umsetzung (Service Worker, verschlüsselte lokale Warteschlange für neue Mahlzeiten, eindeutige IDs gegen Doppelungen, Statusanzeige „synchronisiert / offen“) | XL | **ja** (Konzept) |
| D15 | **Beschwerdetagebuch** (optional, diskret, mit Zuordnung zur Mahlzeit, im Bericht; **keine** Diagnose, **keine** Schlussfolgerung zur Dosis) | M–L | **ja** (Felder ärztlich abstimmen) |
| D16 | **Sicherheitsüberprüfung** (Bedrohungsmodell, Rechte-/Injektionstests, Abhängigkeits- und Lizenzliste, Behebung) | M–L | nein |
| D17 | **Backup/Wiederherstellung** (verschlüsselte Sicherung, Schlüssel getrennt, automatisierter Wiederherstellungstest) | M | nein |
| D18 | **Dokumentation für technische Due Diligence** (Architektur, Datenflüsse, Datenschutz-Folgenabschätzung als Entwurf, Lizenzliste, Risikoliste, Testbericht, offene regulatorische Fragen) | L | nein |

**Abweichungen von deiner Reihenfolge und Gründe:**
- **A0 ist neu**: Migrationen, serverseitige Parameter und AAD müssen vor Rezepten/Konten stehen, sonst riskieren wir Datenverlust oder müssen später umbauen.
- **Offline-Konzept (D14)** fließt früh in die Konto-Entscheidungen (C10) ein, weil lokale Daten und Schlüssel zusammenhängen. Die Umsetzung bleibt in Etappe D.
- **Kindermodus-Oberfläche** hängt von der Rollenstruktur (C11) ab; klinische Fragen zur Aufsicht klären wir **vor** jeder Einnahmeführung.

## 2. Teststrategie (für jede neue Funktion)

Automatisierte Tests, Grenzfälle, Fehlerfälle, mobile Darstellung (Headless-Chromium, 390 px, hell/dunkel), Bestandsdaten-Schutz (Migrationstest mit Kopie einer vorhandenen Datenbank). Mock-Tests werden im Bericht **nie** als Live-Test bezeichnet. Live-Integrationstests für Open Food Facts und die KI liefere ich als eigenes Skript, das **du** mit Netz und Schlüssel ausführst (hier nicht möglich); ich vermerke jeweils, was gelaufen ist.

## 3. Offene medizinische und regulatorische Fragen (vorläufig, an Fachleute)

1. Darf/soll die App bei Rundung auf ganze Kapseln **auf-** oder **abrunden**, und gilt „mindestens 1 Kapsel bei Fett > 0“ so? (Ärztin/Apotheker)
2. Ab welcher Fettmenge ist für Snacks/Zwischenmahlzeiten überhaupt eine Dosis vorgesehen? (Ärztin)
3. Wie soll mit der **Tageshöchstmenge** umgegangen werden? Ich zeige keine, weil ich keinen gesicherten Wert habe. Sollen Hinweise erscheinen, und wer legt den Wert fest? (Ärztin/Fachinformation)
4. Welche Kennzahlen brauchen Ärztinnen/Ärzte **wirklich** im Bericht? Meine Auswahl ist nicht abgestimmt.
5. **Kinder:** welches Maß an Aufsicht und Bestätigung bei der Einnahme angemessen ist; ab welchem Alter eigenständige Bedienung; Rolle der Eltern. Ich lege **kein** eigenes Berechnungsschema für Kinder fest.
6. Welche **Beschwerdefelder** sind fachlich sinnvoll, und was darf die App ausdrücklich nicht darstellen?
7. Welche Fehlerbereiche der KI-Fettschätzung sind für die Nutzung vertretbar, und welche Warnungen müssen sichtbar sein?
8. **Regulatorisch:** Könnte eine App, die aus Nahrungsmenge eine Kapselzahl berechnet, als **Medizinprodukt (Software)** gelten? Welche Anforderungen folgen daraus für Entwicklung, Dokumentation und Vertrieb? Ich weiß es nicht sicher; das muss eine Fachperson klären, bevor die App an andere Personen oder ein Unternehmen weitergegeben wird.
9. **Kooperation mit einem Pharmaunternehmen:** Umgang mit Werbe-/Hinweispflichten, Produktbezug („Kreon“ als Markenname im Produktnamen), Haftung, Vertrags- und Datenschutzfragen.
10. **Datenschutz (DSGVO, Gesundheitsdaten, Minderjährige):** Rechtsgrundlage und Einwilligungen, Auftragsverarbeitung mit KI-/Hosting-Anbietern, Löschung/Auskunft/Export, Datenschutz-Folgenabschätzung.
11. **Lizenzen:** Open Food Facts (ODbL), weitere Quellen, mitgelieferte Bibliotheken, Marken-/Logorechte.

## 4. Bevor ich anfange: Entscheidungen von dir

Ich habe jeweils einen Vorschlag; „ok“ genügt.

1. **Soll ich mit A0 beginnen** (Migrationen, serverseitiger Faktor, Verschlüsselung v2, Härtung), bevor ich A2–A6 angehe? *Vorschlag: ja.* Die Umschlüsselung (A0.4) lege ich dir vorher getrennt zur Freigabe vor.
2. **Entwicklungs-Abhängigkeit Playwright** für UI-Tests im Repo (nur für Tests, nicht im Produktivcode)? *Vorschlag: ja.*
3. **Testwerkzeug (A5) und Fotos:** Fotos ausschließlich lokal, nicht ins Git, keine Personen/Dokumente auf den Bildern. Wer fotografiert und wiegt? Referenzfett für zubereitete Gerichte ist selbst unsicher (Packungsangabe/Rezept), das weise ich im Werkzeug aus. *Vorschlag: so.*
4. **KI-Anbieter für den Produktivbetrieb:** Für den Test reicht ein Testbetrieb mit Testfotos. Vor einem echten Einsatz mit Patientenfotos oder einer Kooperation sollte ein Anbieter mit vertraglicher „kein Training“-Zusage gewählt werden. *Vorschlag: jetzt nur Testbetrieb, Entscheidung vor Etappe C.*
5. **Live-Tests:** Bist du bereit, die Live-Testskripte (Open Food Facts, Gemini) auf deinem Rechner oder Server auszuführen und mir die Ausgabe zu schicken? *Ohne das bleiben beide Anbindungen „nur mit Mocks getestet“.*
6. **Kinder-/Familienfunktionen:** Möchtest du die klinischen Fragen (Abschnitt 3, Nr. 5) vor Etappe C mit der Ärztin klären? Bis dahin baue ich nur die technische Rollenstruktur, keine Einnahmeführung.
