import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db.js';
import { createBackup, verifyBackup, restoreBackup } from '../backup.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'enzymate-bk-'));
const TS = '2026-10-15T08:00:00.000Z', FROM = '2026-10-15T00:00:00.000Z', TO = '2026-10-16T00:00:00.000Z';

function seeded() {
  const dir = tmp(), dbFile = join(dir, 'enzymate-pro.db'), key = randomBytes(32);
  const db = openDb(dbFile, key);
  db.setPatient(1, { name: 'Testperson', lipasePerGramFat: 2000 });
  db.addMeal(1, TS, { items: [{ name: 'Käse' }], capsules: 2 });
  db.addFood(1, { name: 'Brot' });
  db.close();
  return { dir, dbFile, key };
}

test('Sicherung: Datei und Manifest entstehen, Original bleibt unverändert, Schlüssel nicht enthalten', () => {
  const { dir, dbFile, key } = seeded();
  const before = readFileSync(dbFile);
  const r = createBackup({ dbFile, key, outDir: join(dir, 'backups') });
  assert.ok(existsSync(r.file) && existsSync(r.manifestFile));
  assert.deepEqual(r.manifest.rows, { users: 1, settings: 1, foods: 1, meals: 1 });
  assert.equal(r.manifest.keyId.length, 8);
  assert.ok(!readFileSync(r.file).includes(key), 'Schlüssel nicht in der Sicherung');
  assert.ok(!readFileSync(r.manifestFile, 'utf8').includes(key.toString('hex')));
  assert.equal(Buffer.compare(before, readFileSync(dbFile)), 0, 'Original-Datenbankdatei bytegleich');
});

test('Sicherung mit falschem Schlüssel: Fehler, keine Dateien zurückgelassen', () => {
  const { dir, dbFile } = seeded();
  assert.throws(() => createBackup({ dbFile, key: randomBytes(32), outDir: join(dir, 'backups') }), /nicht entschlüsselbar|Prüfung/);
  assert.deepEqual(existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')) : [], []);
});

test('Wiederherstellung: gelöschte Mahlzeit ist wieder da; vorhandene DB nur mit --force und mit Vorabsicherung', () => {
  const { dir, dbFile, key } = seeded();
  const { file } = createBackup({ dbFile, key, outDir: join(dir, 'backups') });
  const db = openDb(dbFile, key); const id = db.listMeals(1, FROM, TO)[0].id; db.deleteMeal(1, id); db.setPatient(1, { name: 'Geändert' }); db.close();
  assert.throws(() => restoreBackup({ file, dbFile, key }), /--force/);
  const r = restoreBackup({ file, dbFile, key, force: true });
  assert.ok(r.safety && existsSync(r.safety), 'aktuelle Datenbank vor dem Ersetzen gesichert');
  const back = openDb(dbFile, key);
  assert.equal(back.getPatient(1).name, 'Testperson'); assert.equal(back.listMeals(1, FROM, TO).length, 1); back.close();
  const old = openDb(r.safety, key); assert.equal(old.getPatient(1).name, 'Geändert'); assert.equal(old.listMeals(1, FROM, TO).length, 0); old.close();
});

test('Wiederherstellung in leeres Verzeichnis (Neuaufbau) funktioniert', () => {
  const { dir, dbFile, key } = seeded();
  const { file } = createBackup({ dbFile, key, outDir: join(dir, 'backups') });
  const target = join(tmp(), 'enzymate-pro.db');
  restoreBackup({ file, dbFile: target, key });
  const db = openDb(target, key); assert.equal(db.listMeals(1, FROM, TO).length, 1); db.close();
});

test('Prüfung erkennt: falschen Schlüssel, veränderte Datei, fehlendes Manifest, zu neues Schema – ohne etwas zu ändern', () => {
  const { dir, dbFile, key } = seeded();
  const { file, manifestFile } = createBackup({ dbFile, key, outDir: join(dir, 'backups') });
  const t = join(dir, 'x');
  assert.throws(() => verifyBackup({ file, key: randomBytes(32), tmpDir: t }), /Falscher Schlüssel/);
  const bad = join(dir, 'bad.db'); copyFileSync(file, bad); copyFileSync(manifestFile, bad.replace(/\.db$/, '.json'));
  const d = new DatabaseSync(bad); d.exec("UPDATE meals SET enc = substr(enc, 1, length(enc)-2) || 'AA'"); d.close();
  assert.throws(() => verifyBackup({ file: bad, key, tmpDir: t }), /Prüfsumme/);
  const nomf = join(dir, 'nomf.db'); copyFileSync(file, nomf);
  assert.throws(() => verifyBackup({ file: nomf, key, tmpDir: t }), /Manifest fehlt/);
  const m = JSON.parse(readFileSync(manifestFile, 'utf8')); m.schemaVersion = 999;
  const newer = join(dir, 'newer.db'); copyFileSync(file, newer); writeFileSync(newer.replace(/\.db$/, '.json'), JSON.stringify(m));
  assert.throws(() => verifyBackup({ file: newer, key, tmpDir: t }), /neuere App-Version/);
  assert.ok(verifyBackup({ file, key, tmpDir: t }).ok > 0);
  assert.deepEqual(existsSync(t) ? readdirSync(t) : [], [], 'keine Prüfreste');
});

test('Datenmanipulation (Werte vertauscht), Manifest-Prüfsumme neu berechnet: Entschlüsselungsprüfung schlägt trotzdem an', async () => {
  const { dir, dbFile, key } = seeded();
  const db = openDb(dbFile, key); db.addMeal(1, '2026-10-15T12:00:00.000Z', { items: [{ name: 'Pizza' }], capsules: 3 }); db.close();
  const { file, manifestFile } = createBackup({ dbFile, key, outDir: join(dir, 'backups') });
  const { createHash } = await import('node:crypto');
  const d = new DatabaseSync(file);
  const [a, b] = d.prepare('SELECT id, enc FROM meals ORDER BY id').all();
  d.prepare('UPDATE meals SET enc=? WHERE id=?').run(b.enc, a.id); d.prepare('UPDATE meals SET enc=? WHERE id=?').run(a.enc, b.id); d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.close();
  const m = JSON.parse(readFileSync(manifestFile, 'utf8')); m.sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(manifestFile, JSON.stringify(m));
  assert.throws(() => verifyBackup({ file, key, tmpDir: join(dir, 'x') }), /nicht entschlüsselbar/);
});
