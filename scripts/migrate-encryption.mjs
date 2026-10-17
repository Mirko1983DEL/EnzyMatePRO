// Schreibt Werte im alten Format (v1) im neuen Format (v2, an die Zeile gebunden) neu.
// Läuft NUR auf ausdrücklichen Aufruf: npm run migrate:encryption [-- --dry-run]
// Vorher entsteht eine Sicherungskopie; danach werden alle Zeilen entschlüsselt (Integritätsprüfung).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKey } from '../crypto.js';
import { openDb } from '../db.js';

const dry = process.argv.includes('--dry-run');
const dataDir = process.env.DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const dbFile = join(dataDir, 'enzymate-pro.db'), keyFile = join(dataDir, 'secret.key');
if (!existsSync(dbFile)) { console.error(`Keine Datenbank gefunden: ${dbFile}`); process.exit(1); }
if (!process.env.ENZYMATE_PRO_KEY && !existsSync(keyFile)) { console.error('Kein Schlüssel gefunden (ENZYMATE_PRO_KEY oder data/secret.key). Es wird bewusst kein neuer erzeugt.'); process.exit(1); }

const db = openDb(dbFile, loadKey({ keyFile }));
if (db.migration.backup) console.log(`Schemamigration ${db.migration.from} → ${db.migration.to}, Sicherung: ${db.migration.backup}`);
const legacy = db.countLegacy(), total = Object.values(legacy).reduce((a, b) => a + b, 0);
console.log('Werte im alten Format:', JSON.stringify(legacy));
if (!total) { const v = db.verifyAll(); console.log(`Nichts umzuschlüsseln. Integritätsprüfung: ${v.ok} ok, ${v.failed.length} fehlerhaft.`); db.close(); process.exit(v.failed.length ? 1 : 0); }
if (dry) { console.log('Probelauf: Es wurden keine Daten verändert. (Beim Öffnen wird das Datenbankschema ggf. auf die aktuelle Version gebracht, siehe Sicherung oben.)'); db.close(); process.exit(0); }

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backup = db.backupTo(`${dbFile}.vor-umschluesselung-${stamp}.bak`);
console.log(`Sicherung angelegt: ${backup}`);
const done = db.reencryptLegacy();
const v = db.verifyAll();
console.log('Umgeschlüsselt:', JSON.stringify(done));
console.log(`Integritätsprüfung: ${v.ok} ok, ${v.failed.length} fehlerhaft.`);
if (v.failed.length) { console.error('FEHLER – bitte Sicherung wiederherstellen:', JSON.stringify(v.failed)); db.close(); process.exit(1); }
db.close();
