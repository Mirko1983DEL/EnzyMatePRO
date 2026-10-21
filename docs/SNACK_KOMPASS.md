# Snack-Kompass

Entscheidungshilfe „Ich habe Lust auf …“ auf der Startseite (und über Menü → Snack-Kompass). **Keine medizinische Beratung, keine Dosierung.** Die Enzymmenge entsteht weiterhin ausschließlich in `public/calc.js` aus dem Lipase-Faktor im Profil.

## Ablauf
1. Auswahl (fünf Sätze) oder eigene Eingabe, optional Stimmung und Hunger.
2. Beim ersten Mal einmalige Einwilligung für die KI (`snackAiDlg`, im Browser gemerkt). Ohne Einwilligung, ohne KI, offline oder bei unbrauchbarer Antwort erscheinen **feste Texte**.
3. Pop-up mit drei Optionen: **A** andere Möglichkeit, die auch satt macht · **B** den gewünschten Snack genießen · **C** nachspüren, was gebraucht wird.
4. Bei A/B mit Lebensmittelvorschlag: „In Mahlzeit übernehmen“ legt die Einträge als **KI-Schätzung** (markiert, Plausibilitätsprüfung) in die laufende Mahlzeit. Menge und Fett sind zu prüfen, danach rechnet die App wie immer.

## Dateien
| Datei | Aufgabe |
|---|---|
| `public/snack.js` | Gemeinsame Logik: Auswahl, Anfrageprüfung, Prompt, **Prüfung der KI-Antwort**, feste Ersatztexte (Server, Browser, Demo) |
| `public/snack-ui.js` | Wiederverwendbare Oberfläche `initSnackCompass(deps)` |
| `server.js` | Route `POST /api/snack-advice`; Profil-Felder (freiwillig) |
| `analyze.js` | `callGemini` (gemeinsam mit der Foto-Schätzung – **keine zweite KI-Anbindung**), `adviseSnackWithGemini` |
| `tools/demo-api.js` | Demo: gleiche Route über Claude (`sample`) |

## Sicherheitsregeln und ihre Umsetzung
- **Prompt:** keine Verbote, keine Bewertung „gut/schlecht/gesund/ungesund“, keine Kalorien/Gewicht/Diät/Limits, keine Schuld, keine Belohnung für Verzicht, Hunger nie ignorieren, keine pauschalen Einschränkungen, nichts zu Medikamenten/Enzymen/Dosierung; Wunschtext als reine Daten markiert.
- **Code-Prüfung der Antwort (unabhängig vom Prompt):** Muster für Kalorien, Gewicht, Bewertung, Schuld, Belohnung/Verzicht/Durchhalten, Fettreduktion und Medizin/Dosis in Titel, Text und Lebensmittelnamen. Treffer → Antwort wird nicht angezeigt, feste Texte erscheinen. Allergie-Wörter aus dem Profil in der Antwort → ebenfalls feste Texte. Nur Optionen A, B, C in fester Form; zu C werden keine Lebensmittel übernommen.
- **Datenminimierung:** Profilangaben liest der **Server** aus der verschlüsselten Datenbank. Name, Größe, Gewicht und Lipase-Faktor gehen nie an die KI. Von heute erfassten Mahlzeiten gehen nur Lebensmittelnamen (höchstens 10) mit.
- **Freiwillige Profilangaben:** Altersgruppe, Allergien, Vorlieben, Ernährungshinweise (Freitext). Ernährungshinweise werden nur weitergereicht und nicht geprüft oder ergänzt. Es sind **keine „fachlich bestätigten Vorgaben“ hinterlegt**; die App kennt keine medizinischen Ernährungsregeln.
- Begrenzung 10 KI-Anfragen pro Minute (gemeinsam mit der Foto-Schätzung); darüber hinaus feste Texte.

## Grenzen (ehrlich)
- Die Textprüfung ist eine **Musterliste**: sie fängt bekannte Formulierungen ab, **nicht jede unpassende Antwort**. Auch mit Prüfung ist nicht belegt, dass jede KI-Antwort kindgerecht ist. Vor Nutzung durch Kinder: Antworten mit der **echten KI** ausprobieren und durchsehen (bisher nur mit nachgebauter KI getestet).
- Die Allergie-Prüfung sucht Wörter aus deinem Text; „Milch“ erkennt nicht „Joghurt“. Sie ersetzt keine Sorgfalt bei Allergien.
- Nährwerte der Vorschläge sind KI-Schätzungen.
- Die Einwilligung lässt sich nur über das Löschen der Browserdaten zurücknehmen.
- Die Prüfregeln sind deutsch und wurden nicht von Fachpersonal (Ernährungsberatung/Psychologie) geprüft.
