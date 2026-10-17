// Sicherung anlegen: npm run backup [-- --out ordner]
// Standard-Ziel: <DATA_DIR>/backups. Der Schlüssel wird NICHT mitgesichert.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadKey } from '../crypto.js';
import { createBackup } from '../backup.js';

const dataDir = process.env.DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'data');
const keyFile = join(dataDir, 'secret.key');
if (!process.env.ENZYMATE_PRO_KEY && !existsSync(keyFile)) { console.error('Kein Schlüssel gefunden (ENZYMATE_PRO_KEY oder data/secret.key). Es wird bewusst kein neuer erzeugt.'); process.exit(1); }
const i = process.argv.indexOf('--out'), outDir = i > 0 ? process.argv[i + 1] : join(dataDir, 'backups');
try {
  const r = createBackup({ dbFile: join(dataDir, 'enzymate-pro.db'), key: loadKey({ keyFile }), outDir });
  console.log(`Sicherung angelegt und geprüft: ${r.file}\nManifest: ${r.manifestFile}\nZeilen: ${JSON.stringify(r.manifest.rows)}  Schema: ${r.manifest.schemaVersion}  Schlüsselkennung: ${r.manifest.keyId}`);
  console.log('Hinweis: Der Schlüssel ist nicht enthalten. Ohne ihn ist die Sicherung unbrauchbar – getrennt aufbewahren.');
} catch (e) { console.error('FEHLER:', e.message); process.exit(1); }
