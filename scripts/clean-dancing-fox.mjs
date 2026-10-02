import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const assetDir = fileURLToPath(new URL('../frontend/assets/dancing-fox/', import.meta.url));
const write = process.argv.includes('--write');

function decodePng(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error(`Not a PNG: ${file}`);
  let offset = 8; let width = 0; let height = 0; let bitDepth = 0; let colorType = 0; const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset); offset += 4;
    const type = data.toString('ascii', offset, offset + 4); offset += 4;
    const body = data.subarray(offset, offset + length); offset += length + 4;
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); bitDepth = body[8]; colorType = body[9]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`Unsupported PNG ${bitDepth}/${colorType}: ${file}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = width * 4; const pixels = Buffer.alloc(width * height * 4); let cursor = 0;
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++]; const row = raw.subarray(cursor, cursor + stride); cursor += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride); const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? out[i - 4] : 0; const up = prev ? prev[i] : 0; const upLeft = prev && i >= 4 ? prev[i - 4] : 0;
      out[i] = (row[i] + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upLeft) : 0)) & 255;
    }
  }
  return { width, height, pixels };
}

const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(data) { let c = 0xffffffff; for (const value of data) c = crcTable[(c ^ value) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, body) { const kind = Buffer.from(type, 'ascii'); const chunk = Buffer.alloc(12 + body.length); chunk.writeUInt32BE(body.length, 0); kind.copy(chunk, 4); body.copy(chunk, 8); chunk.writeUInt32BE(crc32(Buffer.concat([kind, body])), body.length + 8); return chunk; }
function encodePng(width, height, pixels) {
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) { const start = y * (width * 4 + 1); scanlines[start] = 0; pixels.copy(scanlines, start + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function cleanImage(image) {
  const { width, height, pixels } = image; const source = Buffer.from(pixels); let removed = 0; let decontaminated = 0;
  const at = (x, y) => (y * width + x) * 4;
  const hasOpaqueWhiteNeighbor = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const i = at(nx, ny); if (source[i + 3] >= 240 && source[i] >= 220 && source[i + 1] >= 220 && source[i + 2] >= 220) return true;
    }
    return false;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = at(x, y); const alpha = source[i + 3]; if (!alpha) continue;
    const r = source[i], g = source[i + 1], b = source[i + 2]; const min = Math.min(r, g, b); const max = Math.max(r, g, b);
    // The source artwork was exported against white. Only touch neutral bright
    // edge pixels; colored fur, outlines and the opaque white details remain intact.
    if (max - min > 24 || min < 145 || alpha === 255) continue;
    const hasCore = hasOpaqueWhiteNeighbor(x, y);
    if (alpha < 200 && !hasCore) { pixels[i + 3] = 0; removed++; continue; }
    const coverage = alpha / 255; const matte = 1 - coverage;
    pixels[i] = Math.max(0, Math.min(255, Math.round((r - 255 * matte) / coverage)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round((g - 255 * matte) / coverage)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round((b - 255 * matte) / coverage)));
    decontaminated++;
  }
  return { removed, decontaminated };
}

const files = fs.readdirSync(assetDir).filter(file => file.endsWith('.png')).sort();
for (const file of files) {
  const fullPath = path.join(assetDir, file); const image = decodePng(fullPath); const result = cleanImage(image);
  if (write) fs.writeFileSync(fullPath, encodePng(image.width, image.height, image.pixels));
  console.log(`${write ? 'cleaned' : 'would clean'} ${file}: removed=${result.removed}, decontaminated=${result.decontaminated}`);
}
