// Produktbezeichnung und Trennung von EnzyMate (Original). Statische Prüfungen ohne Server und ohne Netz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadKey } from '../crypto.js';
import { buildReport, toText } from '../public/report.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Produktname EnzyMate Pro: Titel, Kopfzeile, Manifest, Paketname, Demo', () => {
  const html = read('public/index.html');
  assert.match(html, /<title>EnzyMate Pro<\/title>/);
  assert.match(html, /class="brand">.*EnzyMate Pro</);
  const mf = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(mf.name, 'EnzyMate Pro'); assert.equal(mf.short_name, 'EnzyMate Pro');
  assert.equal(JSON.parse(read('package.json')).name, 'enzymate-pro');
  assert.match(read('demo/index.html'), /<title>EnzyMate Pro<\/title>/);
});

test('Berichtstext und Medikamentenname: „EnzyMate Pro“ und „Kreon“ (nicht „Creon“) in sichtbaren Texten', () => {
  const rep = buildReport({ meals: [], range: { from: new Date('2026-10-15T00:00:00'), to: new Date('2026-10-16T00:00:00') }, patient: null, now: new Date('2026-10-16T12:00:00') });
  assert.match(toText(rep, null, 'Test').split('\n')[0], /^Kreon-Protokoll \(EnzyMate Pro\)/);
  const visible = read('public/index.html') + read('public/app.js');
  assert.doesNotMatch(visible.replace(/creonAssetUrl/g, ''), /Creon/);
});

test('Trennung: Pro liest den Schlüssel des Originals (CREON_KEY) nicht', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enzymate-sep-')), keyFile = join(dir, 'secret.key');
  const foreign = randomBytes(32).toString('hex');
  const oldCreon = process.env.CREON_KEY, oldPro = process.env.ENZYMATE_PRO_KEY;
  delete process.env.ENZYMATE_PRO_KEY; process.env.CREON_KEY = foreign;
  const warn = console.warn; console.warn = () => {};
  try {
    const key = loadKey({ keyFile });
    assert.notEqual(key.toString('hex'), foreign, 'fremder Schlüssel wurde nicht übernommen');
    assert.ok(existsSync(keyFile), 'stattdessen eigener Schlüssel erzeugt');
  } finally {
    console.warn = warn;
    if (oldCreon === undefined) delete process.env.CREON_KEY; else process.env.CREON_KEY = oldCreon;
    if (oldPro !== undefined) process.env.ENZYMATE_PRO_KEY = oldPro;
  }
});

test('Trennung: eigener Port-Standard, eigene Datenbankdatei, eigene Browser-Speicherschlüssel', () => {
  const server = read('server.js');
  assert.match(server, /\|\| 3100/); assert.match(server, /enzymate-pro\.db/); assert.doesNotMatch(server, /creon\.db/);
  const client = read('public/api.js') + read('public/app.js');
  assert.match(client, /enzymateProToken/); assert.match(client, /enzymateProAiConsent/); assert.doesNotMatch(client, /'creonToken'|'creonAiConsent'/);
});
