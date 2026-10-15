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
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
}

function draw(size, { inset = 0, maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const pine = [22, 74, 58];
  const deep = [14, 48, 38];
  const cream = [243, 239, 230];
  const copper = [196, 106, 58];
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * (maskable ? 0.28 : 0.34);
  const ring = size * 0.045;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const dx = Math.abs(nx - 0.5) * size;
      const dy = Math.abs(ny - 0.5) * size;
      const box = Math.max(dx, dy) - (size / 2 - size * 0.18 - inset);
      const corner = Math.hypot(Math.max(dx - (size / 2 - size * 0.18 - inset - size * 0.18), 0), Math.max(dy - (size / 2 - size * 0.18 - inset - size * 0.18), 0));
      const outside = Math.max(box, 0) === 0 ? box : corner - size * 0.18;
      const cover = maskable ? 1 : Math.max(0, Math.min(1, 0.8 - outside));
      const dist = Math.hypot(x - cx, y - cy);
      const ringBand = Math.max(0, 1 - Math.abs(dist - radius) / ring);
      const dot = Math.max(0, 1 - Math.hypot(x - cx, y - cy * 0 + (y - cy)) / (size * 0.055));
      let color = mix(deep, pine, ny);
      color = mix(color, cream, Math.min(1, ringBand));
      color = mix(color, copper, Math.min(1, dot));
      const alpha = Math.round(cover * 255);
      const i = (y * size + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = alpha;
    }
  }
  return png(size, size, pixels);
}

const dir = join(import.meta.dirname, '..', 'icons');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'apple-touch-icon.png'), draw(180));
writeFileSync(join(dir, 'icon-192.png'), draw(192));
writeFileSync(join(dir, 'icon-512.png'), draw(512));
writeFileSync(join(dir, 'icon-maskable-512.png'), draw(512, { maskable: true }));
console.log('icons written');
