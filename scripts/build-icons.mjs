import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function mix(a, b, t) {
  return a.map((channel, i) => channel + (b[i] - channel) * t);
}

/*
 * Original Mission Control mark: a cream ring with a copper center on a pine gradient.
 * fullBleed icons (apple-touch-icon, maskable) fill the square; iOS, macOS, and Android apply their own mask,
 * and a transparent corner would otherwise show as black. "any" icons get rounded corners.
 * 4x4 supersampling keeps the edges smooth.
 */
export function draw(size, { fullBleed = false, ringScale = 0.25 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const top = [31, 107, 74];
  const bottom = [16, 58, 45];
  const cream = [243, 239, 230];
  const copper = [204, 112, 62];
  const c = size / 2;
  const corner = size * 0.225;
  const ringR = size * ringScale;
  const ringW = size * 0.052;
  const dotR = size * 0.072;
  const S = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let acc = [0, 0, 0];
      let alpha = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          let inside = true;
          if (!fullBleed) {
            const qx = Math.max(Math.abs(px - c) - (c - corner), 0);
            const qy = Math.max(Math.abs(py - c) - (c - corner), 0);
            inside = Math.hypot(qx, qy) <= corner;
          }
          if (!inside) continue;
          let color = mix(top, bottom, (px + py) / (2 * size));
          const d = Math.hypot(px - c, py - c);
          if (Math.abs(d - ringR) <= ringW / 2) color = cream;
          if (d <= dotR) color = copper;
          acc = acc.map((v, i) => v + color[i]);
          alpha += 1;
        }
      }
      const i = (y * size + x) * 4;
      const n = alpha || 1;
      pixels[i] = Math.round(acc[0] / n);
      pixels[i + 1] = Math.round(acc[1] / n);
      pixels[i + 2] = Math.round(acc[2] / n);
      pixels[i + 3] = Math.round((alpha / (S * S)) * 255);
    }
  }
  return png(size, size, pixels);
}

export function writeIcons(dir = join(import.meta.dirname, '..', 'icons')) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'apple-touch-icon.png'), draw(180, { fullBleed: true }));
  writeFileSync(join(dir, 'icon-192.png'), draw(192));
  writeFileSync(join(dir, 'icon-512.png'), draw(512));
  // Maskable: keep the mark inside the 80% safe circle.
  writeFileSync(join(dir, 'icon-maskable-512.png'), draw(512, { fullBleed: true, ringScale: 0.2 }));
}

// Runs locally and as the Vercel build step (vercel.json buildCommand), so deployed icons always match this file.
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  writeIcons();
  console.log('icons written');
}
