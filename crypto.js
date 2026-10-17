// Feldverschlüsselung: AES-256-GCM.
//   v1 (Altformat):  v1.<iv>.<tag>.<ciphertext>                 – ohne Zusatzdaten, nur noch lesbar
//   v2 (aktuell):    v2.<keyId>.<iv>.<tag>.<ciphertext>         – an Zusatzdaten (AAD) gebunden
// AAD = Tabelle|Nutzer|Zeile(|Zeitstempel): ein verschlüsselter Wert lässt sich nicht in eine andere Zeile oder
// zu einem anderen Nutzer kopieren, ohne dass die Entschlüsselung scheitert. Alles base64url.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadKey({ env = process.env.ENZYMATE_PRO_KEY, keyFile }) {
  if (env) {
    const key = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('ENZYMATE_PRO_KEY muss 32 Bytes sein (64 Hex-Zeichen oder Base64).');
    return key;
  }
  if (existsSync(keyFile)) {
    const hex = readFileSync(keyFile, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`Schlüsseldatei ${keyFile} ist beschädigt (erwartet: 64 Hex-Zeichen).`);
    return Buffer.from(hex, 'hex');
  }
  mkdirSync(dirname(keyFile), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  console.warn(`[enzymate-pro] Kein ENZYMATE_PRO_KEY gesetzt – neuer Schlüssel in ${keyFile} erzeugt. Sichere diese Datei getrennt von der Datenbank!`);
  return key;
}

/** Kurze Kennung eines Schlüssels (für spätere Schlüsselrotation); verrät den Schlüssel nicht. */
export const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 8);

const b64 = (b) => b.toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

/** Altes v1-Format (ohne AAD). Nur noch für Tests und die Umschlüsselung vorhanden. */
export function encrypt(key, value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', b64(iv), b64(c.getAuthTag()), b64(ct)].join('.');
}
export function decrypt(key, blob) {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1') throw new Error('Unbekanntes Verschlüsselungsformat');
  const d = createDecipheriv('aes-256-gcm', key, unb64(iv));
  d.setAuthTag(unb64(tag));
  return JSON.parse(Buffer.concat([d.update(unb64(ct)), d.final()]).toString('utf8'));
}

/** Schlüsselbund: der erste Schlüssel schreibt, alle können lesen (Rotation = neuen Schlüssel voranstellen). */
export class Keyring {
  constructor(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    if (!list.length || list.some((k) => !Buffer.isBuffer(k) || k.length !== 32)) throw new Error('Ungültiger Schlüssel (32 Byte erwartet).');
    this.keys = new Map(list.map((k) => [keyId(k), k]));
    this.currentId = keyId(list[0]);
  }
  encrypt(value, aad) {
    if (!aad) throw new Error('AAD fehlt');
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.keys.get(this.currentId), iv);
    c.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    return ['v2', this.currentId, b64(iv), b64(c.getAuthTag()), b64(ct)].join('.');
  }
  isLegacy(blob) { return blob.startsWith('v1.'); }
  decrypt(blob, aad) {
    if (this.isLegacy(blob)) { // v1 wurde mit dem Schlüssel des Betreibers geschrieben: alle Schlüssel probieren
      for (const k of this.keys.values()) { try { return decrypt(k, blob); } catch { /* nächster Schlüssel */ } }
      throw new Error('Entschlüsselung fehlgeschlagen');
    }
    const [v, id, iv, tag, ct] = blob.split('.');
    if (v !== 'v2') throw new Error('Unbekanntes Verschlüsselungsformat');
    const key = this.keys.get(id);
    if (!key) throw new Error('Unbekannte Schlüsselkennung');
    if (!aad) throw new Error('AAD fehlt');
    const d = createDecipheriv('aes-256-gcm', key, unb64(iv));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(unb64(tag));
    return JSON.parse(Buffer.concat([d.update(unb64(ct)), d.final()]).toString('utf8'));
  }
}
