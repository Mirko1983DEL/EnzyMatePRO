// EAN-13-Bild (PNG) für Tests: gültige Prüfziffer wird geprüft, Muster nach GS1-Tabellen.
import { grayPng } from './png.js';
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export const checkDigit13 = (first12) => (10 - (first12.split('').reduce((a, c, i) => a + +c * (i % 2 ? 3 : 1), 0) % 10)) % 10;
export function ean13Modules(code) {
  if (!/^\d{13}$/.test(code) || checkDigit13(code.slice(0, 12)) !== +code[12]) throw new Error(`Ungültige EAN-13: ${code}`);
  const d = [...code].map(Number);
  return '101' + [...PARITY[d[0]]].map((p, i) => (p === 'L' ? L : G)[d[i + 1]]).join('') + '01010' + d.slice(7).map((x) => R[x]).join('') + '101';
}
export function ean13Png(code, { scale = 4, height = 150, quiet = 11 } = {}) {
  const bits = ean13Modules(code), w = (bits.length + 2 * quiet) * scale, h = height + 40;
  return grayPng(w, h, (x, y) => { const m = Math.floor(x / scale) - quiet; return y >= 20 && y < 20 + height && m >= 0 && m < bits.length && bits[m] === '1' ? 0 : 255; });
}
