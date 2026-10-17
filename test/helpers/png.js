// Minimaler PNG-Schreiber (8-Bit-Graustufen) für Testbilder, ohne Abhängigkeiten.
import { deflateSync, crc32 } from 'node:zlib';
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
export function grayPng(width, height, pixel) { // pixel(x, y) → 0..255
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixel(x, y); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** Foto ohne Barcode: weicher Farbverlauf mit etwas Rauschen. */
export const plainPhoto = () => grayPng(400, 300, (x, y) => 90 + Math.round((x / 400) * 80) + ((x * 7 + y * 13) % 9));
