# Entwicklungsplan EnzyMate Pro (Entwurf zur Priorisierung)

Grundsatz: Die Berechnung (`public/calc.js`, Faktor aus dem Profil) bleibt unverändert, bis eine gesonderte fachliche Prüfung und Freigabe vorliegt. Der Plan enthält keine Dosierungs- oder Grenzwerte. Aufwände sind nicht geschätzt, weil dafür keine Grundlage vorliegt. Die Reihenfolge ist ein Vorschlag, den du entscheidest.

| Prio | Paket | Begründung / Abhängigkeit |
|---|---|---|
| 1 | **Datenschutz, Backup, Wiederherstellung** (11) | Es gibt bereits Migrations-Sicherungen; ein dokumentierter Export/Import fehlt. Voraussetzung für alles, was Daten ändert. |
| 2 | **Professionelle Tests und Dokumentation** (12) | Test für die Produktbezeichnung, CI, echte Live-Tests getrennt von Mocks. |
| 3 | **Nachträgliches Bearbeiten von Mahlzeiten** (4) | Betrifft gespeicherte Dosis-Werte; erst zu klären: Wird die damalige Empfehlung neu berechnet oder bleibt sie? (fachliche Entscheidung) |
| 4 | **Verbesserte KI-Validierung** (1) | Grundlage existiert (Prüfung der KI-Werte, Commit 76f05a4); Plausibilitätsregeln müssen ohne erfundene Grenzwerte definiert werden. |
| 5 | **Favoriten und wiederverwendbare Mahlzeiten** (3) | Kleiner, geringes Risiko. |
| 6 | **Login und Benutzerkonten** (5) | `resolveUser()` ist vorbereitet. Voraussetzung für 7 und 8. |
| 7 | **Lebensmittel-/Rezeptdatenbank und Nährwertquellen** (2, 10) | Quellen- und Lizenzfragen vorher klären. |
| 8 | **Kinder-/Familienmodus** (6) | Braucht 6; fachlich/rechtlich zu klären. |
| 9 | **Berechnungsprofil, geschützt und nachvollziehbar** (7) | Änderungsprotokoll; Änderungen am Wert selbst nur mit Freigabe. |
| 10 | **Offline-Nutzung mit Synchronisation** (8) | Aufwändig und riskant (Konflikte bei verschlüsselten Daten); nach 6. |
| 11 | **Symptomtagebuch (optional)** (9) | Neue Gesundheitsdaten, Datenschutz neu bewerten. |

Vor jedem Paket: eigener Branch, Tests, deine Freigabe.
