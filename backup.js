// Sicherung und Wiederherstellung der Datenbank (nur Dateiebene, Inhalte bleiben verschlüsselt).
// Eine Sicherung besteht aus zwei Dateien: <name>.db (konsistente Kopie per VACUUM INTO) und <name>.json (Prüfsumme, Schema, Zeilenzahlen,
// Schlüsselkennung). Der Schlüssel selbst ist NIE enthalten und muss getrennt aufbewahrt werden.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { keyId } from './crypto.js';
import { openDb, MIGRATIONS } from './db.js';

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const CURRENT_SCHEMA = MIGRATIONS.at(-1).version;

function rowCounts(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    const n = (t) => d.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
    return { users: n('users'), settings: n('settings'), foods: n('foods'), meals: n('meals') };
  } finally { d.close(); }
}

/** Sicherung anlegen und sofort prüfen (Entschlüsselung aller Zeilen). Bei Fehler wird nichts zurückgelassen. */
export function createBackup({ dbFile, key, outDir }) {
  if (!existsSync(dbFile)) throw new Error(`Keine Datenbank gefunden: ${dbFile}`);
  mkdirSync(outDir, { recursive: true });
  const name = `enzymate-pro-sicherung-${stamp()}`, file = join(outDir, `${name}.db`), manifestFile = join(outDir, `${name}.json`);
  if (existsSync(file)) throw new Error(`Sicherung existiert bereits: ${file}`);
  const src = openDb(dbFile, key);
  try { src.backupTo(file); } finally { src.close(); }
  try {
    const copy = openDb(file, key);
    const check = copy.verifyAll(), schemaVersion = copy.schemaVersion(); copy.close();
    if (check.failed.length) throw new Error(`Prüfung fehlgeschlagen (${check.failed.length} Zeilen nicht entschlüsselbar). Falscher Schlüssel oder beschädigte Daten.`);
    const manifest = {
      format: 1, app: 'EnzyMate Pro', createdAt: new Date().toISOString(), schemaVersion, keyId: keyId(key),
      rows: rowCounts(file), sha256: sha256(file), sizeBytes: statSync(file).size,
    };
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    return { file, manifestFile, manifest };
  } catch (e) { rmSync(file, { force: true }); rmSync(`${file}-wal`, { force: true }); rmSync(`${file}-shm`, { force: true }); throw e; }
}

/** Prüft eine Sicherung ohne etwas zu verändern (arbeitet auf einer temporären Kopie). */
export function verifyBackup({ file, key, tmpDir }) {
  const manifestFile = file.replace(/\.db$/, '.json');
  if (!existsSync(file)) throw new Error(`Sicherungsdatei fehlt: ${file}`);
  if (!existsSync(manifestFile)) throw new Error(`Manifest fehlt: ${manifestFile} (ohne Manifest wird nicht wiederhergestellt)`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== 1) throw new Error(`Unbekanntes Sicherungsformat: ${manifest.format}`);
  if (sha256(file) !== manifest.sha256) throw new Error('Prüfsumme stimmt nicht: Sicherungsdatei ist beschädigt oder verändert.');
  if (manifest.keyId !== keyId(key)) throw new Error(`Falscher Schlüssel: Die Sicherung wurde mit Schlüsselkennung ${manifest.keyId} erstellt, der vorhandene hat ${keyId(key)}.`);
  if (manifest.schemaVersion > CURRENT_SCHEMA) throw new Error(`Sicherung hat Schema ${manifest.schemaVersion}, diese App kennt nur ${CURRENT_SCHEMA}. Bitte neuere App-Version verwenden.`);
  mkdirSync(tmpDir, { recursive: true });
  const work = mkdtempSync(join(tmpDir, 'pruefung-')), tmp = join(work, basename(file));
  copyFileSync(file, tmp);
  try {
    const db = openDb(tmp, key); const check = db.verifyAll(); db.close();
    if (check.failed.length) throw new Error(`${check.failed.length} Zeilen nicht entschlüsselbar.`);
    return { manifest, ok: check.ok };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/**
 * Sicherung in die Datenbankdatei zurückspielen. Eine vorhandene Datenbank wird nur mit `force` ersetzt und vorher gesichert.
 * Läuft vermutlich der Server (WAL-Datei vorhanden), wird ebenfalls abgebrochen, außer mit `force`.
 */
export function restoreBackup({ file, dbFile, key, force = false }) {
  const dir = dirname(dbFile);
  const verified = verifyBackup({ file, key, tmpDir: join(dir, '.pruefung') });
  rmSync(join(dir, '.pruefung'), { recursive: true, force: true });
  let safety = null;
  if (existsSync(dbFile)) {
    if (!force) throw new Error(`Zieldatenbank existiert: ${dbFile}. Zum Ersetzen --force angeben (die aktuelle wird vorher gesichert).`);
    safety = join(dir, `${basename(dbFile)}.vor-wiederherstellung-${stamp()}.bak`);
    const cur = new DatabaseSync(dbFile); try { cur.prepare('VACUUM INTO ?').run(safety); } finally { cur.close(); }
  } else if (existsSync(`${dbFile}-wal`) && !force) {
    throw new Error(`Reste einer laufenden Datenbank gefunden (${dbFile}-wal). Server beenden oder --force.`);
  }
  const staged = `${dbFile}.wiederherstellung-${process.pid}`;
  copyFileSync(file, staged);
  for (const s of ['-wal', '-shm']) rmSync(dbFile + s, { force: true });
  renameSync(staged, dbFile);
  return { manifest: verified.manifest, rowsVerified: verified.ok, safety };
}
