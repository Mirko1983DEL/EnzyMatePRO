// Sicherung prüfen/wiederherstellen:
//   npm run restore -- <sicherung.db> --check     nur prüfen, nichts verändern
//   npm run restore -- <sicherung.db> [--force]   zurückspielen (Server vorher beenden!)
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadKey } from '../crypto.js';
import { restoreBackup, verifyBackup } from '../backup.js';

const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('Aufruf: npm run restore -- <sicherung.db> [--check] [--force]'); process.exit(2); }
const dataDir = process.env.DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const keyFile = join(dataDir, 'secret.key');
if (!process.env.ENZYMATE_PRO_KEY && !existsSync(keyFile)) { console.error('Kein Schlüssel gefunden (ENZYMATE_PRO_KEY oder data/secret.key). Es wird bewusst kein neuer erzeugt.'); process.exit(1); }
const key = loadKey({ keyFile });
try {
  if (args.includes('--check')) {
    const r = verifyBackup({ file: resolve(file), key, tmpDir: join(dataDir, '.pruefung') });
    console.log(`Sicherung in Ordnung: ${r.ok} Werte entschlüsselt, Zeilen ${JSON.stringify(r.manifest.rows)}, erstellt ${r.manifest.createdAt}. Nichts verändert.`);
  } else {
    const r = restoreBackup({ file: resolve(file), dbFile: join(dataDir, 'enzymate-pro.db'), key, force: args.includes('--force') });
    console.log(`Wiederhergestellt (${r.rowsVerified} Werte geprüft, Zeilen ${JSON.stringify(r.manifest.rows)}).${r.safety ? `\nVorherige Datenbank gesichert: ${r.safety}` : ''}`);
  }
} catch (e) { console.error('FEHLER:', e.message); process.exit(1); }
