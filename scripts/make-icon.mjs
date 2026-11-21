#!/usr/bin/env node
// Draws the Visual Git app icon and writes:
//   packaging/visualgit.ico   (Windows Start Menu / shortcut icon, 16–256 px)
//   packaging/visualgit.png   (512 px, for Linux desktops and docs)
//   public/favicon.svg        (browser tab icon)
// No dependencies: shapes are rendered from distance fields with 4×4 supersampling,
// so every size gets clean anti-aliased edges. Run: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- Design (in a 256 × 256 box) ----
   A paper tile with a transit-map junction: the blue main line runs top to
   bottom, a red line branches off at 45°, runs alongside, and joins back in.
   The yellow station on the red line marks "you are here". The ink outline
   keeps the tile visible on both light and dark Start Menus. */
const C = {
  paper: [246, 242, 231],
  ink: [24, 26, 33],
  blue: [38, 99, 205],
  red: [222, 61, 50],
  yellow: [246, 203, 36],
  white: [255, 255, 255]
};
const TILE = { x0: 10, y0: 10, x1: 246, y1: 246, r: 54 };
const EDGE = 9; // ink outline width of the tile
const LINE = 14; // half-width of a track
const BX = 102; // main line
const RX = 154; // branch, 52 to the right: 45° bends drop 52
const DROP = RX - BX;
const TOP = 54; // where the branch leaves
const BOTTOM = 202; // where it joins back
const BLUE = [[BX, 44], [BX, 212]];
const RED = [[BX, TOP], [RX, TOP + DROP], [RX, BOTTOM - DROP], [BX, BOTTOM]];
const STATIONS = [
  { x: BX, y: TOP, fill: C.white },
  { x: BX, y: BOTTOM, fill: C.white },
  { x: RX, y: (TOP + BOTTOM) / 2, fill: C.yellow }
];
const STATION_R = 13;
const RING = 8;

function sdRoundRect(x, y, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(x, y, [ax, ay], [bx, by]) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
}

function sdPolyline(x, y, points) {
  let d = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) d = Math.min(d, sdSegment(x, y, points[i], points[i + 1]));
  return d;
}

/** Colour of one sample point (painter's order), or null when outside the tile. */
function sample(x, y) {
  const edge = sdRoundRect(x, y, TILE);
  if (edge > 0) return null;
  if (edge > -EDGE) return C.ink;
  let color = C.paper;
  if (sdPolyline(x, y, RED) <= LINE) color = C.red;
  if (sdPolyline(x, y, BLUE) <= LINE) color = C.blue;
  for (const station of STATIONS) {
    const d = Math.hypot(x - station.x, y - station.y);
    if (d <= STATION_R + RING) color = d <= STATION_R ? station.fill : C.ink;
  }
  return color;
}

function render(size) {
  const ss = 4;
  const scale = 256 / size;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const color = sample((px + (sx + 0.5) / ss) * scale, (py + (sy + 0.5) / ss) * scale);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        pixels[i] = Math.round(r / a);
        pixels[i + 1] = Math.round(g / a);
        pixels[i + 2] = Math.round(b / a);
      }
      pixels[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return pixels;
}

/* ---- PNG and ICO encoding ---- */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/* ---- SVG twin for the browser tab ---- */
function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function svg() {
  const pts = (points) => points.map(([x, y]) => `${x} ${y}`).join(" L");
  const stations = STATIONS.map(
    (s) =>
      `<circle cx="${s.x}" cy="${s.y}" r="${STATION_R + RING / 2}" fill="${hex(s.fill)}" stroke="${hex(C.ink)}" stroke-width="${RING}"/>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<rect x="${TILE.x0 + EDGE / 2}" y="${TILE.y0 + EDGE / 2}" width="${TILE.x1 - TILE.x0 - EDGE}" height="${TILE.y1 - TILE.y0 - EDGE}" rx="${TILE.r - EDGE / 2}" fill="${hex(C.paper)}" stroke="${hex(C.ink)}" stroke-width="${EDGE}"/>
<g fill="none" stroke-width="${LINE * 2}" stroke-linecap="round" stroke-linejoin="round">
<path d="M${pts(RED)}" stroke="${hex(C.red)}"/>
<path d="M${pts(BLUE)}" stroke="${hex(C.blue)}"/>
</g>
${stations}
</svg>
`;
}

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const images = icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }));

mkdirSync(path.join(root, "packaging"), { recursive: true });
mkdirSync(path.join(root, "public"), { recursive: true });
writeFileSync(path.join(root, "packaging", "visualgit.ico"), encodeIco(images));
writeFileSync(path.join(root, "packaging", "visualgit.png"), encodePng(512, render(512)));
writeFileSync(path.join(root, "public", "favicon.svg"), svg());
console.log(`Wrote packaging/visualgit.ico (${icoSizes.join(", ")} px), packaging/visualgit.png, public/favicon.svg`);
