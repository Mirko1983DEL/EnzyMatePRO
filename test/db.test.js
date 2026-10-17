import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, MIGRATIONS } from '../db.js';
import { Keyring, encrypt as encryptV1, keyId } from '../crypto.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'enzymate-'));
const FROM = '2026-10-15T00:00:00.000Z', TO = '2026-10-16T00:00:00.000Z';

/** Baut eine Datenbank im Zustand VOR den Migrationen (alter Code: Tabellen vorhanden, user_version 0, v1-verschlüsselt). */
function legacyDb(file, key) {
  const d = new DatabaseSync(file);
  d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, enc TEXT NOT NULL);
    CREATE TABLE settings (user_id INTEGER PRIMARY KEY REFERENCES users(id), enc TEXT NOT NULL);
    CREATE TABLE foods (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), enc TEXT NOT NULL);
    CREATE TABLE meals (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), ts TEXT NOT NULL, enc TEXT NOT NULL);`);
  d.prepare('INSERT INTO users VALUES (1, ?)').run(encryptV1(key, { name: 'Marie', lipasePerGramFat: 2000 }));
  d.prepare('INSERT INTO settings VALUES (1, ?)').run(encryptV1(key, { capsuleSize: 35000 }));
  d.prepare('INSERT INTO meals VALUES (1, 1, ?, ?)').run('2026-10-15T08:00:00.000Z', encryptV1(key, { items: [{ name: 'Käse' }], capsules: 2 }));
  d.prepare('INSERT INTO meals VALUES (2, 1, ?, ?)').run('2026-10-15T12:00:00.000Z', encryptV1(key, { items: [{ name: 'Pizza' }], capsules: 3 }));
  d.close();
}

test('Migration: bestehende Datenbank bleibt lesbar, Sicherung entsteht, zweiter Start ändert nichts', () => {
  const dir = tmp(), file = join(dir, 'enzymate-pro.db'), key = randomBytes(32);
  legacyDb(file, key);
  const db = openDb(file, key);
  assert.equal(db.schemaVersion(), MIGRATIONS.at(-1).version);
  assert.equal(db.migration.from, 0);
  assert.ok(db.migration.backup && existsSync(db.migration.backup), 'Sicherung vorhanden');
  assert.equal(db.getPatient(1).name, 'Marie'); assert.equal(db.getSettings(1).capsuleSize, 35000);
  const meals = db.listMeals(1, FROM, TO); assert.equal(meals.length, 2); assert.equal(meals[1].items[0].name, 'Käse');
  // Die Sicherung ist selbst eine lesbare Datenbank mit den alten Daten
  const b = new DatabaseSync(db.migration.backup, { readOnly: true });
  assert.equal(b.prepare('SELECT count(*) n FROM meals').get().n, 2); assert.equal(b.prepare('PRAGMA user_version').get().user_version, 0); b.close();
  db.close();
  const again = openDb(file, key);
  assert.equal(again.migration.backup, null); assert.equal(readdirSync(dir).filter((f) => f.endsWith('.bak')).length, 1);
  again.close();
});

test('Neue Datenbank: keine Sicherung nötig, aktuelles Schema', () => {
  const dir = tmp(), db = openDb(join(dir, 'neu.db'), randomBytes(32));
  assert.equal(db.migration.backup, null); assert.equal(db.schemaVersion(), MIGRATIONS.at(-1).version);
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.bak')).length, 0); db.close();
});

test('Fehlgeschlagene Migration: Rollback, Version unverändert, Sicherung vorhanden', () => {
  const dir = tmp(), file = join(dir, 'x.db'), key = randomBytes(32);
  openDb(file, key).close();                                              // Stand: Version 1 mit Daten
  const bad = [...MIGRATIONS, { version: 99, name: 'kaputt', up(d) { d.exec('CREATE TABLE halb (x)'); throw new Error('Absicht'); } }];
  assert.throws(() => openDb(file, key, { migrations: bad }), /Migration 99 \(kaputt\) fehlgeschlagen: Absicht\. Datenbank unverändert, Sicherung: /);
  const d = new DatabaseSync(file);
  assert.equal(d.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.at(-1).version);
  assert.equal(d.prepare("SELECT count(*) n FROM sqlite_master WHERE name='halb'").get().n, 0, 'halb angelegte Tabelle zurückgerollt');
  d.close(); assert.equal(readdirSync(dir).filter((f) => f.includes('vor-migration')).length, 1);
});

test('Umschlüsselung v1 → v2: Inhalt gleich, danach keine Altwerte, Integritätsprüfung ok', () => {
  const dir = tmp(), file = join(dir, 'c.db'), key = randomBytes(32);
  legacyDb(file, key);
  const db = openDb(file, key);
  assert.deepEqual(db.countLegacy(), { users: 1, settings: 1, foods: 0, meals: 2 });
  const before = db.listMeals(1, FROM, TO);
  assert.deepEqual(db.reencryptLegacy(), { users: 1, settings: 1, foods: 0, meals: 2 });
  assert.deepEqual(db.countLegacy(), { users: 0, settings: 0, foods: 0, meals: 0 });
  assert.deepEqual(db.listMeals(1, FROM, TO), before);
  const v = db.verifyAll(); assert.equal(v.failed.length, 0); assert.equal(v.ok, 4);
  assert.deepEqual(db.reencryptLegacy(), { users: 0, settings: 0, foods: 0, meals: 0 }); // idempotent
  db.close();
});

test('Zeilenbindung: vertauschte, verschobene oder umdatierte Werte werden erkannt', () => {
  const dir = tmp(), file = join(dir, 'a.db'), key = randomBytes(32);
  const db = openDb(file, key);
  db.addMeal(1, '2026-10-15T08:00:00.000Z', { items: [{ name: 'A' }] });
  db.addMeal(1, '2026-10-15T09:00:00.000Z', { items: [{ name: 'B' }] });
  db.close();
  const raw = new DatabaseSync(file);
  const enc = (id) => raw.prepare('SELECT enc FROM meals WHERE id=?').get(id).enc;
  // 1) Werte zweier Mahlzeiten vertauschen
  const e1 = enc(1), e2 = enc(2);
  raw.prepare('UPDATE meals SET enc=? WHERE id=1').run(e2); raw.prepare('UPDATE meals SET enc=? WHERE id=2').run(e1);
  let d = openDb(file, key); assert.throws(() => d.listMeals(1, FROM, TO), /Unsupported state|authenticate/i); assert.equal(d.verifyAll().failed.length, 2); d.close();
  // 2) zurücktauschen: wieder ok
  raw.prepare('UPDATE meals SET enc=? WHERE id=1').run(e1); raw.prepare('UPDATE meals SET enc=? WHERE id=2').run(e2);
  d = openDb(file, key); assert.equal(d.verifyAll().failed.length, 0); d.close();
  // 3) Zeitstempel ändern (Klartextspalte)
  raw.prepare("UPDATE meals SET ts='2026-10-15T20:00:00.000Z' WHERE id=1").run();
  d = openDb(file, key); assert.deepEqual(d.verifyAll().failed.map((f) => f.id), [1]); d.close();
  raw.prepare("UPDATE meals SET ts='2026-10-15T08:00:00.000Z' WHERE id=1").run();
  // 4) Mahlzeit einem anderen Nutzer zuordnen
  raw.exec("INSERT INTO users(id, enc) VALUES (2, 'x')"); raw.prepare('UPDATE meals SET user_id=2 WHERE id=1').run();
  d = openDb(file, key); assert.deepEqual(d.verifyAll().failed.filter((f) => f.table === 'meals').map((f) => f.id), [1]); d.close();
  raw.close();
});

test('Schlüsselbund: Rotation liest alte Werte, schreibt mit dem neuen, falscher Schlüssel scheitert', () => {
  const dir = tmp(), file = join(dir, 'k.db'), A = randomBytes(32), B = randomBytes(32);
  const a = openDb(file, [A]); a.addMeal(1, '2026-10-15T08:00:00.000Z', { items: [{ name: 'alt' }] }); a.close();
  const ab = openDb(file, [B, A]);
  assert.equal(ab.listMeals(1, FROM, TO)[0].items[0].name, 'alt');
  ab.addMeal(1, '2026-10-15T09:00:00.000Z', { items: [{ name: 'neu' }] }); ab.close();
  const raw = new DatabaseSync(file);
  const ids = raw.prepare('SELECT enc FROM meals ORDER BY id').all().map((r) => r.enc.split('.')[1]);
  assert.deepEqual(ids, [keyId(A), keyId(B)]); raw.close();
  const onlyB = openDb(file, [B]);
  assert.throws(() => onlyB.listMeals(1, FROM, TO), /Unbekannte Schlüsselkennung/); onlyB.close();
  assert.throws(() => new Keyring([randomBytes(16)]), /Ungültiger Schlüssel/);
});

test('Datei enthält nach v2-Schreiben keinen Klartext', () => {
  const dir = tmp(), file = join(dir, 'p.db'), db = openDb(file, randomBytes(32));
  db.setPatient(1, { name: 'GeheimerName', weightKg: 35 }); db.addMeal(1, '2026-10-15T08:00:00.000Z', { items: [{ name: 'Geheimgericht' }] }); db.close();
  for (const f of readdirSync(dir)) { const buf = readFileSync(join(dir, f)); assert.ok(!buf.includes('GeheimerName') && !buf.includes('Geheimgericht'), f); }
});
