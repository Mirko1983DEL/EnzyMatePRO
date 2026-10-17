// SQLite-Persistenz. Alle Inhalte stehen verschlüsselt im Feld `enc`;
// nur IDs und der Zeitstempel einer Mahlzeit liegen im Klartext (Indexierung/Bereichsabfragen).
// Jede Tabelle trägt user_id -> Mehrbenutzer/Login später ohne Schema-Umbau.
// Schemaänderungen laufen ausschließlich über MIGRATIONS (PRAGMA user_version), mit Sicherung vorher.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Keyring } from './crypto.js';

export const DEFAULT_USER = 1;
export const DEFAULTS = {
  patient: { name: 'Marie', heightCm: null, weightKg: null, lipasePerGramFat: null },
  settings: { capsuleSize: 25000 },
};

/** Nummerierte, nie nachträglich geänderte Schritte. Neue Änderungen = neuer Eintrag mit höherer Version. */
export const MIGRATIONS = [
  {
    version: 1, name: 'Basisschema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users    (id INTEGER PRIMARY KEY, enc TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (user_id INTEGER PRIMARY KEY REFERENCES users(id), enc TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS foods    (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), enc TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meals    (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), ts TEXT NOT NULL, enc TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS meals_user_ts ON meals(user_id, ts);
      `);
    },
  },
];

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

/**
 * Führt ausstehende Migrationen aus. Vor dem ersten Schritt wird – wenn die Datei schon Tabellen enthält –
 * eine konsistente Sicherungskopie neben die Datenbank gelegt. Jeder Schritt läuft in einer Transaktion:
 * bei einem Fehler bleibt die Datenbank unverändert.
 */
export function migrate(db, path, migrations = MIGRATIONS) {
  const version = () => db.prepare('PRAGMA user_version').get().user_version;
  const from = version();
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (!pending.length) return { from, to: from, backup: null };
  const to = pending[pending.length - 1].version;
  const hasTables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n > 0;
  let backup = null;
  if (path !== ':memory:' && hasTables) {
    backup = `${path}.vor-migration-${from}-zu-${to}-${stamp()}.bak`;
    db.prepare('VACUUM INTO ?').run(backup);
  }
  for (const m of pending) {
    db.exec('BEGIN');
    try { m.up(db); db.exec(`PRAGMA user_version = ${m.version}`); db.exec('COMMIT'); }
    catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) fehlgeschlagen: ${e.message}. Datenbank unverändert${backup ? `, Sicherung: ${backup}` : ''}.`);
    }
  }
  return { from, to: version(), backup };
}

// Zusatzdaten (AAD) je Zeile: bindet den verschlüsselten Wert an Tabelle, Nutzer, Zeile (Mahlzeit: auch Zeitstempel).
const aad = {
  users: (id) => `users|${id}`,
  settings: (u) => `settings|${u}`,
  foods: (u, id) => `foods|${u}|${id}`,
  meals: (u, id, ts) => `meals|${u}|${id}|${ts}`,
};

export function openDb(path, keyOrKeys, { migrations = MIGRATIONS } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const ring = keyOrKeys instanceof Keyring ? keyOrKeys : new Keyring(keyOrKeys);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const migration = migrate(db, path, migrations);
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  if (!q('SELECT 1 FROM users WHERE id=?').get(DEFAULT_USER)) {
    tx(() => {
      q('INSERT INTO users(id, enc) VALUES (?,?)').run(DEFAULT_USER, ring.encrypt(DEFAULTS.patient, aad.users(DEFAULT_USER)));
      q('INSERT INTO settings(user_id, enc) VALUES (?,?)').run(DEFAULT_USER, ring.encrypt(DEFAULTS.settings, aad.settings(DEFAULT_USER)));
    });
  }

  // Einfügen mit nachträglich gebundener AAD (die Zeilen-ID steht erst nach dem Einfügen fest), atomar.
  const insertBound = (table, userId, cols, vals, makeAad, value) => tx(() => {
    const names = ['user_id', ...cols, 'enc'];
    const id = Number(q(`INSERT INTO ${table}(${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(userId, ...vals, '').lastInsertRowid);
    q(`UPDATE ${table} SET enc=? WHERE id=?`).run(ring.encrypt(value, makeAad(id)), id);
    return id;
  });

  const TABLES = [
    ['users', 'SELECT id, enc FROM users', (r) => aad.users(r.id)],
    ['settings', 'SELECT user_id, enc FROM settings', (r) => aad.settings(r.user_id)],
    ['foods', 'SELECT id, user_id, enc FROM foods', (r) => aad.foods(r.user_id, r.id)],
    ['meals', 'SELECT id, user_id, ts, enc FROM meals', (r) => aad.meals(r.user_id, r.id, r.ts)],
  ];

  return {
    migration,
    schemaVersion: () => q('PRAGMA user_version').get().user_version,
    getPatient: (u) => { const r = q('SELECT enc FROM users WHERE id=?').get(u); return r ? ring.decrypt(r.enc, aad.users(u)) : null; },
    setPatient: (u, v) => q('UPDATE users SET enc=? WHERE id=?').run(ring.encrypt(v, aad.users(u)), u).changes > 0,
    getSettings: (u) => { const r = q('SELECT enc FROM settings WHERE user_id=?').get(u); return r ? ring.decrypt(r.enc, aad.settings(u)) : null; },
    setSettings: (u, v) => q('UPDATE settings SET enc=? WHERE user_id=?').run(ring.encrypt(v, aad.settings(u)), u).changes > 0,
    listFoods: (u) => q('SELECT id, enc FROM foods WHERE user_id=?').all(u).map((r) => ({ id: r.id, ...ring.decrypt(r.enc, aad.foods(u, r.id)) })),
    addFood: (u, v) => insertBound('foods', u, [], [], (id) => aad.foods(u, id), v),
    deleteFood: (u, id) => q('DELETE FROM foods WHERE id=? AND user_id=?').run(id, u).changes > 0,
    listMeals: (u, from, to) =>
      q('SELECT id, ts, enc FROM meals WHERE user_id=? AND ts>=? AND ts<? ORDER BY ts DESC')
        .all(u, from, to).map((r) => ({ id: r.id, ts: r.ts, ...ring.decrypt(r.enc, aad.meals(u, r.id, r.ts)) })),
    addMeal: (u, ts, v) => insertBound('meals', u, ['ts'], [ts], (id) => aad.meals(u, id, ts), v),
    deleteMeal: (u, id) => q('DELETE FROM meals WHERE id=? AND user_id=?').run(id, u).changes > 0,

    /** Konsistente Sicherungskopie (SQLite `VACUUM INTO`), auch bei laufendem Betrieb. Ziel darf noch nicht existieren. */
    backupTo: (file) => { q('VACUUM INTO ?').run(file); return file; },
    /** Zählt Werte im alten v1-Format (ohne Zeilenbindung). */
    countLegacy: () => Object.fromEntries(TABLES.map(([name, sql]) => [name, q(sql).all().filter((r) => ring.isLegacy(r.enc)).length])),
    /** Schreibt alle v1-Werte im neuen v2-Format neu. Atomar; Aufrufer legt vorher eine Sicherung an. */
    reencryptLegacy: () => tx(() => {
      const done = {};
      for (const [name, sql, aadOf] of TABLES) {
        let n = 0;
        for (const r of q(sql).all()) {
          if (!ring.isLegacy(r.enc)) continue;
          const value = ring.decrypt(r.enc, null);
          const where = name === 'settings' ? 'user_id' : 'id';
          q(`UPDATE ${name} SET enc=? WHERE ${where}=?`).run(ring.encrypt(value, aadOf(r)), r[where]); n++;
        }
        done[name] = n;
      }
      return done;
    }),
    /** Entschlüsselt jede Zeile als Integritätsprüfung (Schlüssel, Manipulation, vertauschte Werte). */
    verifyAll: () => {
      const failed = []; let ok = 0;
      for (const [name, sql, aadOf] of TABLES) {
        for (const r of q(sql).all()) {
          try { ring.decrypt(r.enc, aadOf(r)); ok++; } catch (e) { failed.push({ table: name, id: r.id ?? r.user_id, error: e.message }); }
        }
      }
      return { ok, failed };
    },
    close: () => db.close(),
  };
}
