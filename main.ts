// news-image-20261126 -- "Thursday 26 November 2026 in one picture".
// Hand-drawn, from scratch: a raster canvas, a hand-written 5x7 stroke font,
// vector pictograms and a hand-written PNG encoder. Node 22 stdlib only,
// no network, no external assets, fully deterministic.
//
// Layout (1024x1024 newspaper front page):
//   masthead -> day-in-numbers strip -> 3 hero panels (refinery / rocket /
//   tariffs) -> 4x3 grid of pictured stories -> world map with numbered pins
//   -> ALSO ON list (20 more stories) -> DATE CHECK footer.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// PNG encoder (hand-written: CRC32 + zlib deflate from the stdlib).
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: plain RGB buffer with filled-shape primitives.
// ---------------------------------------------------------------------------

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 3;
        this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
      }
    }
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.fillRect(x, y, w, t, c);
    this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c);
    this.fillRect(x + w - t, y, t, h, c);
  }
  hline(x0: number, x1: number, y: number, c: RGB, t = 1): void {
    this.fillRect(Math.min(x0, x1), y, Math.abs(x1 - x0), t, c);
  }
  vline(x: number, y0: number, y1: number, c: RGB, t = 1): void {
    this.fillRect(x, Math.min(y0, y1), t, Math.abs(y1 - y0), c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const r = Math.floor(t / 2);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (dx * i) / steps);
      const y = Math.round(y0 + (dy * i) / steps);
      this.fillRect(x - r, y - r, t, t, c);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      this.fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }
  ring(cx: number, cy: number, r: number, c: RGB, t = 2): void {
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      this.fillRect(Math.round(cx + Math.cos(rad) * r) - 1, Math.round(cy + Math.sin(rad) * r) - 1, t, t, c);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = -ry; y <= ry; y++) {
      const half = Math.floor(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
      this.fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }
  // Filled polygon (scanline).
  poly(pts: Array<[number, number]>, c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]), 1, c);
      }
    }
  }
  // Vertical gradient made of horizontal bands.
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB): void {
    for (let yy = 0; yy < h; yy++) {
      const f = yy / Math.max(1, h - 1);
      const c: RGB = [
        Math.round(top[0] + (bottom[0] - top[0]) * f),
        Math.round(top[1] + (bottom[1] - top[1]) * f),
        Math.round(top[2] + (bottom[2] - top[2]) * f),
      ];
      this.fillRect(x, y + yy, w, 1, c);
    }
  }
}

// Palette.
const PAPER: RGB = [247, 242, 231];
const INK: RGB = [24, 24, 28];
const RED: RGB = [139, 26, 26];
const NAVY: RGB = [18, 38, 66];
const GOLD: RGB = [198, 142, 26];
const TEAL: RGB = [14, 110, 110];
const GREEN: RGB = [26, 120, 58];
const SKY: RGB = [188, 214, 232];
const LAND: RGB = [196, 178, 128];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [90, 88, 84];
const LIGHT: RGB = [232, 226, 212];

// ---------------------------------------------------------------------------
// Font: hand-drawn 5x7 bitmap glyphs, each row a 5-bit number.
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30],
  C: [15, 16, 16, 16, 16, 16, 15], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [15, 16, 16, 23, 17, 17, 14], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 25, 21, 19, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 19, 21, 25, 17, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31], '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [14, 16, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 4, 4, 4],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 1, 14],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 0, 4],
  ',': [0, 0, 0, 0, 0, 4, 8], ':': [0, 0, 4, 0, 0, 0, 4],
  ';': [0, 0, 4, 0, 0, 4, 8], '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4], "'": [4, 4, 0, 0, 0, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0], '-': [0, 0, 0, 14, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  '%': [25, 26, 2, 4, 8, 22, 19], '$': [4, 15, 21, 14, 5, 30, 4],
  '/': [1, 1, 2, 4, 8, 8, 16], '&': [12, 18, 20, 4, 21, 18, 13],
  '+': [0, 4, 4, 31, 4, 4, 0], '=': [0, 0, 31, 0, 31, 0, 0],
  '*': [0, 10, 4, 14, 4, 10, 0], '\u00b7': [0, 0, 0, 4, 0, 0, 0],
  '\u00b0': [14, 17, 14, 0, 0, 0, 0], '\u2014': [0, 0, 0, 31, 0, 0, 0],
  '\u2191': [4, 14, 31, 4, 4, 4, 4], '\u2193': [4, 4, 4, 4, 31, 14, 4],
  '\u2192': [0, 4, 2, 31, 2, 4, 0],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['?'];
    for (let r = 0; r < 7; r++) {
      const bits = g[r];
      for (let col = 0; col < 5; col++) {
        if (bits & (16 >> col)) cv.fillRect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(cv: Canvas, s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(cv, s, cx - Math.floor(textWidth(s, scale) / 2), y, scale, c);
}

// Greedy word wrap; returns lines that fit maxW pixels at the given scale.
function wrap(s: string, maxW: number, scale: number): string[] {
  const words = s.toUpperCase().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur === '' ? w : cur + ' ' + w;
    if (textWidth(trial, scale) <= maxW || cur === '') {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

function drawPara(cv: Canvas, s: string, x: number, y: number, maxW: number, scale: number, c: RGB, maxLines = 99, lineGap = 2): number {
  const lines = wrap(s, maxW, scale).slice(0, maxLines);
  for (let i = 0; i < lines.length; i++) {
    drawText(cv, lines[i], x, y + i * (7 * scale + lineGap), scale, c);
  }
  return y + lines.length * (7 * scale + lineGap);
}

// ---------------------------------------------------------------------------
// Illustrations.
// ---------------------------------------------------------------------------

// Hero 1: dusk refinery scene inside (x, y, w, h).
function drawRefinery(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [250, 176, 92], [214, 96, 44]);
  // Sun low over the plant.
  cv.circle(x + Math.floor(w * 0.72), y + Math.floor(h * 0.42), 26, [255, 226, 150]);
  cv.circle(x + Math.floor(w * 0.72), y + Math.floor(h * 0.42), 18, [255, 240, 190]);
  // Distant skyline.
  cv.fillRect(x, y + h - 58, w, 58, [96, 48, 40]);
  // Ground.
  cv.fillRect(x, y + h - 26, w, 26, [52, 30, 26]);
  const base = y + h - 26;
  const dark: RGB = [38, 22, 18];
  // Storage tanks (cylinders).
  for (const tx of [0.06, 0.24, 0.44]) {
    const txp = x + Math.floor(w * tx);
    cv.fillRect(txp, base - 46, 62, 46, dark);
    cv.ellipse(txp + 31, base - 46, 31, 7, [58, 34, 26]);
    cv.fillRect(txp + 4, base - 40, 54, 2, [120, 84, 60]);
  }
  // Distillation towers.
  for (const tx of [0.62, 0.76]) {
    const txp = x + Math.floor(w * tx);
    cv.fillRect(txp, base - 108, 26, 108, dark);
    cv.poly([[txp, base - 108], [txp + 26, base - 108], [txp + 13, base - 126]], dark);
    for (let i = 0; i < 4; i++) cv.fillRect(txp - 4, base - 92 + i * 22, 34, 3, [120, 84, 60]);
  }
  // Flare stack with flame.
  const fx = x + Math.floor(w * 0.9);
  cv.fillRect(fx, base - 118, 10, 118, dark);
  cv.poly([[fx - 6, base - 118], [fx + 16, base - 118], [fx + 5, base - 134]], [255, 190, 60]);
  cv.poly([[fx - 1, base - 118], [fx + 11, base - 118], [fx + 5, base - 126]], [255, 236, 150]);
  // Pipes.
  cv.fillRect(x + 40, base - 18, 380, 5, [70, 44, 34]);
  cv.fillRect(x + 40, base - 30, 5, 30, [70, 44, 34]);
  // Smoke puffs.
  cv.circle(x + Math.floor(w * 0.2), y + 26, 9, [240, 226, 210]);
  cv.circle(x + Math.floor(w * 0.28), y + 18, 7, [240, 226, 210]);
  cv.circle(x + Math.floor(w * 0.36), y + 28, 8, [240, 226, 210]);
  // Oil barrel.
  cv.fillRect(x + 14, base - 34, 26, 34, [24, 24, 28]);
  cv.fillRect(x + 14, base - 26, 26, 3, GOLD);
  cv.fillRect(x + 14, base - 12, 26, 3, GOLD);
}

// Hero 2: rocket climbing to a space station inside (x, y, w, h).
function drawRocket(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [10, 18, 44], [30, 64, 120]);
  // Stars.
  const stars: Array<[number, number]> = [[0.08, 0.2], [0.2, 0.1], [0.35, 0.28], [0.5, 0.12], [0.62, 0.3], [0.78, 0.14], [0.9, 0.3], [0.15, 0.55], [0.42, 0.5], [0.95, 0.55], [0.05, 0.75], [0.68, 0.62]];
  for (const s of stars) cv.fillRect(x + Math.floor(w * s[0]), y + Math.floor(h * s[1]), 3, 3, WHITE);
  // Earth arc at the bottom: only the top cap of the ellipse, clipped to
  // this box, so it never spills over the text below.
  const ecx = x + Math.floor(w * 0.5);
  const ecy = y + h + 58;
  const erx = Math.floor(w * 0.62);
  const ery = 66;
  for (let yy = y + h - 10; yy < y + h; yy++) {
    const dy = yy - ecy;
    const half = Math.floor(erx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ery * ery))));
    cv.fillRect(ecx - half, yy, half * 2 + 1, 1, [38, 110, 170]);
  }
  // Space station: core + solar panels.
  const sx = x + Math.floor(w * 0.62);
  const sy = y + 26;
  cv.fillRect(sx - 74, sy + 8, 34, 7, [150, 170, 205]);
  cv.fillRect(sx + 40, sy + 8, 34, 7, [150, 170, 205]);
  cv.fillRect(sx - 40, sy, 80, 22, [210, 220, 235]);
  cv.fillRect(sx - 40, sy + 6, 80, 2, [140, 150, 170]);
  cv.circle(sx - 48, sy + 11, 6, [230, 235, 240]);
  // Rocket.
  const rx = x + Math.floor(w * 0.24);
  const ry = y + h - 66;
  cv.poly([[rx - 16, ry + 46], [rx + 16, ry + 46], [rx + 8, ry + 10], [rx, ry - 12], [rx - 8, ry + 10]], WHITE);
  cv.poly([[rx - 16, ry + 46], [rx - 30, ry + 62], [rx - 16, ry + 56]], RED);
  cv.poly([[rx + 16, ry + 46], [rx + 30, ry + 62], [rx + 16, ry + 56]], RED);
  cv.circle(rx, ry + 16, 6, [90, 180, 230]);
  cv.ring(rx, ry + 16, 6, NAVY, 2);
  cv.poly([[rx - 7, ry + 46], [rx + 7, ry + 46], [rx + 3, ry + 66], [rx - 3, ry + 66]], [255, 190, 60]);
  cv.poly([[rx - 4, ry + 46], [rx + 4, ry + 46], [rx, ry + 58]], [255, 236, 150]);
}

// Hero 3: tariff bar chart inside (x, y, w, h).
function drawTariffs(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [250, 244, 228]);
  const base = y + h - 26;
  cv.hline(x + 10, x + w - 10, base, INK, 2);
  const bars: Array<[string, number, RGB]> = [
    ['JAPAN', 46, [150, 60, 60]],
    ['CHINA', 62, [180, 40, 40]],
    ['EU', 52, [150, 60, 60]],
    ['TAIWAN', 38, TEAL],
  ];
  const bw = 52;
  const gap = Math.floor((w - 20 - bars.length * bw) / (bars.length + 1));
  bars.forEach((b, i) => {
    const bx = x + 10 + gap + i * (bw + gap);
    const bh = Math.floor((b[1] / 70) * (h - 40));
    cv.fillRect(bx, base - bh, bw, bh, b[2]);
    cv.fillRect(bx, base - bh, bw, 3, [255, 255, 255]);
    drawTextCentered(cv, b[0], bx + bw / 2, base + 6, 1, INK);
  });
  // 15% callout over the Taiwan bar.
  const tx = x + 10 + gap + 3 * (bw + gap);
  cv.fillRect(tx - 14, y + 8, 96, 26, RED);
  drawText(cv, '15% MAX', tx - 7, y + 15, 2, WHITE);
  const bhT = Math.floor((38 / 70) * (h - 40));
  cv.line(tx + 22, y + 34, tx + 26, base - bhT, RED, 2);
}

// Small pictogram icons, drawn in a ~30x30 box at (x, y).
function drawIcon(cv: Canvas, kind: string, x: number, y: number): void {
  if (kind === 'planet') {
    cv.circle(x + 15, y + 15, 11, [190, 120, 70]);
    cv.circle(x + 12, y + 12, 4, [150, 90, 50]);
    cv.line(x + 2, y + 20, x + 28, y + 10, GOLD, 2);
  } else if (kind === 'down') {
    cv.fillRect(x + 2, y + 24, 26, 2, INK);
    cv.fillRect(x + 2, y + 4, 2, 22, INK);
    cv.line(x + 4, y + 8, x + 12, y + 14, RED, 3);
    cv.line(x + 12, y + 14, x + 19, y + 10, RED, 3);
    cv.line(x + 19, y + 10, x + 27, y + 22, RED, 3);
    cv.poly([[x + 23, y + 20], [x + 28, y + 25], [x + 22, y + 26]], RED);
  } else if (kind === 'up') {
    cv.fillRect(x + 2, y + 24, 26, 2, INK);
    cv.fillRect(x + 2, y + 4, 2, 22, INK);
    cv.line(x + 4, y + 20, x + 12, y + 12, GREEN, 3);
    cv.line(x + 12, y + 12, x + 19, y + 16, GREEN, 3);
    cv.line(x + 19, y + 16, x + 27, y + 6, GREEN, 3);
    cv.poly([[x + 22, y + 4], [x + 28, y + 5], [x + 24, y + 11]], GREEN);
  } else if (kind === 'flame') {
    cv.poly([[x + 15, y + 1], [x + 24, y + 14], [x + 21, y + 24], [x + 9, y + 24], [x + 6, y + 14]], [240, 120, 30]);
    cv.poly([[x + 15, y + 12], [x + 20, y + 20], [x + 10, y + 20]], [255, 210, 80]);
  } else if (kind === 'jet') {
    cv.poly([[x + 15, y + 2], [x + 20, y + 14], [x + 18, y + 24], [x + 12, y + 24], [x + 10, y + 14]], [90, 100, 120]);
    cv.poly([[x + 10, y + 14], [x + 2, y + 24], [x + 10, y + 20]], [90, 100, 120]);
    cv.poly([[x + 20, y + 14], [x + 28, y + 24], [x + 20, y + 20]], [90, 100, 120]);
    cv.poly([[x + 13, y + 24], [x + 17, y + 24], [x + 15, y + 29]], [255, 150, 40]);
  } else if (kind === 'dove') {
    cv.circle(x + 15, y + 15, 14, [205, 225, 240]);
    cv.ellipse(x + 15, y + 16, 11, 7, WHITE);
    cv.circle(x + 24, y + 10, 5, WHITE);
    cv.poly([[x + 26, y + 8], [x + 30, y + 10], [x + 26, y + 12]], GOLD);
    cv.poly([[x + 6, y + 12], [x + 16, y + 6], [x + 18, y + 13]], [200, 210, 220]);
    cv.line(x + 12, y + 20, x + 8, y + 26, WHITE, 2);
  } else if (kind === 'coins') {
    cv.fillRect(x + 6, y + 20, 18, 5, GOLD);
    cv.fillRect(x + 8, y + 14, 18, 5, [220, 170, 60]);
    cv.fillRect(x + 6, y + 8, 18, 5, GOLD);
    drawText(cv, '$', x + 11, y + 7, 1, INK);
    cv.line(x + 22, y + 2, x + 26, y + 8, RED, 2);
  } else if (kind === 'oil') {
    cv.poly([[x + 15, y + 2], [x + 24, y + 16], [x + 24, y + 22], [x + 6, y + 22], [x + 6, y + 16]], [30, 30, 34]);
    cv.circle(x + 15, y + 20, 8, [30, 30, 34]);
    drawText(cv, '$', x + 12, y + 16, 1, GOLD);
  } else if (kind === 'bank') {
    cv.poly([[x + 2, y + 10], [x + 15, y + 2], [x + 28, y + 10]], NAVY);
    cv.fillRect(x + 4, y + 12, 22, 3, NAVY);
    for (const cx of [7, 13, 19, 25]) cv.fillRect(x + cx, y + 16, 2, 8, NAVY);
    cv.fillRect(x + 4, y + 25, 22, 3, NAVY);
  } else if (kind === 'shirt') {
    cv.poly([[x + 9, y + 4], [x + 21, y + 4], [x + 21, y + 26], [x + 9, y + 26]], TEAL);
    cv.poly([[x + 9, y + 4], [x + 2, y + 10], [x + 8, y + 14]], TEAL);
    cv.poly([[x + 21, y + 4], [x + 28, y + 10], [x + 22, y + 14]], TEAL);
    cv.fillRect(x + 12, y + 4, 6, 3, WHITE);
  } else if (kind === 'flag') {
    cv.fillRect(x + 6, y + 2, 2, 26, INK);
    cv.fillRect(x + 8, y + 3, 18, 11, RED);
    cv.fillRect(x + 8, y + 3, 18, 4, WHITE);
    cv.fillRect(x + 8, y + 10, 18, 4, WHITE);
  } else if (kind === 'scroll') {
    cv.fillRect(x + 6, y + 6, 18, 18, [240, 230, 200]);
    cv.rect(x + 6, y + 6, 18, 18, INK, 1);
    cv.fillRect(x + 9, y + 10, 12, 1, INK);
    cv.fillRect(x + 9, y + 14, 12, 1, INK);
    cv.fillRect(x + 9, y + 18, 8, 1, INK);
    cv.fillRect(x + 4, y + 4, 3, 22, GOLD);
  }
}

// Simplified world map (equirectangular) with numbered pins.
function drawMap(cv: Canvas, x: number, y: number, w: number, h: number, pins: Array<[number, number, number]>): void {
  cv.fillRect(x, y, w, h, SKY);
  const px = (lon: number): number => x + Math.floor(((lon + 168) / 360) * w);
  const py = (lat: number): number => y + Math.floor(((78 - lat) / 136) * h);
  const polyLL = (pts: Array<[number, number]>): void => {
    cv.poly(pts.map((p) => [px(p[0]), py(p[1])] as [number, number]), LAND);
  };
  polyLL([[-168, 66], [-140, 70], [-125, 72], [-110, 68], [-95, 80], [-85, 80], [-75, 72], [-60, 60], [-55, 47], [-70, 42], [-75, 35], [-80, 26], [-90, 21], [-97, 16], [-105, 20], [-117, 33], [-125, 40], [-125, 49], [-140, 60], [-155, 58], [-165, 60]]);
  polyLL([[-55, 60], [-45, 60], [-40, 65], [-30, 68], [-20, 70], [-30, 76], [-55, 76], [-58, 70]]);
  polyLL([[-80, 10], [-75, 5], [-60, 0], [-50, 0], [-35, -8], [-40, -20], [-48, -28], [-58, -38], [-65, -45], [-70, -52], [-73, -40], [-72, -20], [-77, -12], [-80, -3]]);
  polyLL([[-10, 36], [0, 36], [5, 38], [10, 38], [15, 40], [20, 40], [28, 36], [30, 42], [25, 45], [20, 45], [12, 44], [8, 44], [3, 43], [-2, 44], [-5, 48], [-2, 50], [0, 52], [5, 55], [8, 57], [10, 59], [5, 60], [0, 58], [-5, 55], [-8, 52], [-10, 45]]);
  polyLL([[-17, 15], [-15, 25], [-10, 30], [-5, 35], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [32, 20], [35, 15], [40, 11], [43, 12], [48, 11], [51, 10], [44, 0], [40, -10], [35, -20], [32, -28], [28, -33], [20, -35], [15, -28], [12, -18], [13, -10], [9, -1], [9, 4], [-8, 5], [-13, 8], [-17, 12]]);
  polyLL([[30, 42], [35, 36], [40, 36], [45, 30], [50, 29], [55, 26], [58, 25], [60, 25], [65, 25], [70, 20], [75, 15], [77, 8], [80, 10], [85, 20], [88, 22], [92, 16], [95, 15], [98, 10], [100, 8], [103, 2], [105, 9], [108, 12], [110, 20], [115, 23], [120, 25], [122, 30], [125, 35], [127, 40], [130, 42], [135, 44], [140, 45], [142, 50], [140, 55], [135, 60], [130, 65], [125, 70], [120, 72], [110, 74], [100, 76], [90, 75], [80, 73], [70, 72], [60, 69], [50, 68], [40, 65], [35, 60], [30, 55], [30, 48]]);
  polyLL([[113, -22], [114, -30], [115, -35], [120, -34], [125, -32], [130, -32], [135, -35], [140, -38], [145, -38], [150, -37], [153, -32], [150, -25], [146, -20], [142, -15], [140, -12], [135, -12], [132, -11], [130, -13], [126, -14], [122, -17], [118, -20]]);
  for (const p of pins) {
    const cx = px(p[0]);
    const cy = py(p[1]);
    cv.circle(cx, cy, 8, RED);
    cv.ring(cx, cy, 8, WHITE, 2);
    drawText(cv, String(p[2]), cx - 3, cy - 3, 1, WHITE);
  }
}

// ---------------------------------------------------------------------------
// Stories: 35 verified for Thursday 26 November 2026.
// ---------------------------------------------------------------------------

interface Pictured {
  n: number;
  icon: string;
  head: string;
  sub: string;
}

const PICTURED: Pictured[] = [
  { n: 1, icon: 'planet', head: 'MERCURY, AT LAST', sub: 'BEPICOLOMBO ARRIVES AFTER AN EIGHT-YEAR JOURNEY' },
  { n: 2, icon: 'down', head: 'TAIWAN SHARES PLUNGE', sub: 'DOWN 1,926.92 PTS TO 38,195.43 AS NT$ WEAKENS PAST 33 PER US$' },
  { n: 3, icon: 'flame', head: 'EGYPT HIGHWAY FIRE', sub: 'AT LEAST 30 KILLED, 25 INJURED AFTER A PETROLEUM TRUCK OVERTURNS' },
  { n: 4, icon: 'jet', head: 'UKRAINE HITS 5 JETS', sub: 'STRIKE ON SAVASLEYKA AIRFIELD AS RUSSIAN DRONES KILL 7 IN UKRAINE' },
  { n: 5, icon: 'dove', head: 'COLOMBIA: 10 YEARS OF PEACE', sub: 'UN WARNS COMMITMENTS FROM THE HISTORIC DEAL REMAIN UNFINISHED' },
  { n: 6, icon: 'coins', head: "VENEZUELA'S $237.5BN DEBT", sub: 'CARACAS REVEALS PUBLIC DEBT AS IT PREPARES HISTORIC RESTRUCTURING' },
  { n: 7, icon: 'oil', head: 'PETROBRAS BETS $122BN', sub: "BRAZIL'S OIL GIANT UNVEILS A HUGE INVESTMENT STRATEGY" },
  { n: 8, icon: 'up', head: 'US SHOPPERS FEEL BETTER', sub: 'CONSUMER CONFIDENCE HITS A NEAR TWO-YEAR HIGH DESPITE INFLATION' },
  { n: 9, icon: 'bank', head: 'FED: MODEST GROWTH', sub: 'BEIGE BOOK SHOWS WAGE GAINS AND PERSISTENT PRICE PRESSURE' },
  { n: 10, icon: 'shirt', head: 'BANGLADESH PAY RISE', sub: 'GARMENT MINIMUM WAGE UP 36% FOR MILLIONS OF WORKERS' },
  { n: 11, icon: 'flag', head: 'PYONGYANG TO SWISS: GO', sub: 'NORTH KOREA ORDERS SWITZERLAND TO CLOSE ITS DIPLOMATIC OFFICE' },
  { n: 12, icon: 'scroll', head: 'INDIA: HUMANS RULE AI WAR', sub: 'CONSTITUTION DAY CALL FOR HUMAN CONTROL OVER AI IN MILITARY OPS' },
];

const ALSO_ON: string[] = [
  'INDIA ANNOUNCES RS15,000 CRORE PACKAGE FOR NEPAL',
  'SHEIKH HASINA SEEKS RETURN TO BANGLADESH ON DEC 16',
  'FLIPKART CEO TO STEP DOWN IN DECEMBER',
  'AUSTRALIA AND SOLOMON ISLANDS SIGN SECURITY PACT',
  'US UNVEILS F-15EX FIGHTERS AT KADENA, OKINAWA',
  "BBC APPEALS AGAINST TRUMP'S $10BN DEFAMATION SUIT",
  'UN TRIBUNAL DOUBTS SACKING OF PALESTINIAN AID WORKERS',
  'US TIGHTENS REMOTE AI CHIP ACCESS RULES',
  'AI BUBBLE BURST COULD EXCEED DOT-COM CRISIS, ECONOMISTS WARN',
  'CANADA REAFFIRMS ITS INFLATION STRATEGY',
  'BARBADOS SETS FEBRUARY DEADLINE FOR CARIBBEAN AI FRAMEWORK',
  'SWISS TOURIST KILLED IN ELEPHANT ATTACK IN CAMEROON',
  'WOMEN KILLED BY MEN IN IRELAND NEARLY DOUBLE IN 2026',
  'WORLD CHESS CHAMPIONSHIP: GUKESH FACES SINDAROV',
  'IPL 2027 AUCTION DRAWS 1,220 REGISTRATIONS',
  'SOORYAVANSHI SCORES 204 OFF 53 BALLS VS UAE',
  "XI GRAFT PROBE UPENDS CHINA'S PATH TO POWER",
  'RUSSIA LOST NEARLY 500,000 PEOPLE IN UKRAINE WAR',
  'CLOSE-UP IMAGES DUE OF ASTEROID HIT IN DEFENCE TEST',
  'US ATTORNEY GENERAL DODGES NVIDIA PROBE QUESTIONS',
];

// Map pins: [lon, lat, story number] matching the pictured grid.
const PINS: Array<[number, number, number]> = [
  [121, 25, 2], [31, 30, 3], [43, 55, 4], [-74, 5, 5], [-67, 10, 6],
  [-52, -12, 7], [-77, 39, 8], [-100, 37, 9], [90, 24, 10], [126, 39, 11], [77, 28, 12],
];

// ---------------------------------------------------------------------------
// Layout.
// ---------------------------------------------------------------------------

function draw(): Canvas {
  const cv = new Canvas(W, H, PAPER);

  // ---- Masthead ------------------------------------------------------------
  cv.fillRect(0, 0, W, 6, RED);
  drawTextCentered(cv, 'THE WORLD IN ONE DAY', 512, 16, 5, INK);
  drawTextCentered(cv, 'THURSDAY 26 NOVEMBER 2026', 512, 58, 3, RED);
  drawText(cv, '35 STORIES', 16, 20, 2, INK);
  drawText(cv, 'ONE DAY, ONE PICTURE', 16, 38, 1, GREY);
  const r7 = '7 REGIONS';
  drawText(cv, r7, W - 16 - textWidth(r7, 2), 20, 2, INK);
  const ac = 'ALL CONFIRMED';
  drawText(cv, ac, W - 16 - textWidth(ac, 1), 38, 1, GREY);
  cv.fillRect(0, 90, W, 2, INK);

  // ---- Day in numbers ------------------------------------------------------
  const nums: Array<[string, string, RGB]> = [
    ['BRENT CRUDE', '$94+ \u2191', RED],
    ['TAIWAN STOCKS', '-1,927 PTS', RED],
    ['EGYPT FIRE', '30 KILLED', INK],
    ['GARMENT WAGE', '+36%', GREEN],
  ];
  nums.forEach((n, i) => {
    const bx = 8 + i * 254;
    cv.fillRect(bx, 96, 246, 44, LIGHT);
    cv.fillRect(bx, 96, 246, 3, n[2]);
    drawText(cv, n[0], bx + 8, 104, 1, GREY);
    drawText(cv, n[1], bx + 8, 116, 2, INK);
  });

  // ---- Hero 1: refinery ----------------------------------------------------
  cv.rect(8, 144, 592, 270, INK, 2);
  drawRefinery(cv, 10, 146, 588, 158);
  drawText(cv, 'MIDDLE EAST - LEAD STORY', 18, 312, 1, RED);
  drawPara(cv, "HOUTHIS CLAIM STRIKE ON SAUDI ARABIA'S BIGGEST REFINERY", 18, 326, 572, 2, INK, 2);
  drawText(cv, "RAS TANURA HIT AND RIYADH'S FINANCIAL DISTRICT TARGETED", 18, 362, 1, INK);
  drawText(cv, 'BRENT CRUDE TOPS $94 A BARREL', 18, 374, 1, INK);
  cv.fillRect(18, 392, 130, 18, GREEN);
  drawText(cv, 'CONFIRMED', 26, 397, 1, WHITE);

  // ---- Hero 2: rocket ------------------------------------------------------
  cv.rect(608, 144, 408, 132, INK, 2);
  drawRocket(cv, 610, 146, 404, 78);
  drawPara(cv, 'FIRST PAKISTANI ASTRONAUT HEADS FOR TIANGONG', 618, 228, 388, 2, INK, 2);
  drawText(cv, 'MUHAMMAD ZEESHAN ALI ABOARD SHENZHOU-24', 618, 262, 1, GREY);

  // ---- Hero 3: tariffs -----------------------------------------------------
  cv.rect(608, 280, 408, 134, INK, 2);
  drawTariffs(cv, 610, 282, 404, 70);
  drawPara(cv, 'TRUMP ANNOUNCES NEW TARIFFS ON JAPAN, CHINA AND THE EU', 618, 356, 388, 2, INK, 2);
  drawText(cv, 'US PROPOSES UP TO 15% ON TAIWAN GOODS IN A SECTION 301 PROBE', 618, 390, 1, GREY);
  drawText(cv, 'TAIPEI SAYS ITS RATE IS THE LOWEST TIER', 618, 400, 1, GREY);

  // ---- Pictured stories grid ----------------------------------------------
  PICTURED.forEach((s, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = 8 + col * 254;
    const y = 422 + row * 90;
    cv.fillRect(x, y, 246, 84, WHITE);
    cv.rect(x, y, 246, 84, [200, 192, 172], 1);
    cv.fillRect(x, y, 18, 18, RED);
    drawText(cv, String(s.n), x + 5, y + 5, 1, WHITE);
    drawIcon(cv, s.icon, x + 4, y + 24);
    drawPara(cv, s.head, x + 40, y + 5, 200, 2, INK, 2);
    drawPara(cv, s.sub, x + 40, y + 42, 200, 1, GREY, 3);
  });

  // ---- World map -----------------------------------------------------------
  cv.rect(8, 696, 1008, 114, INK, 2);
  drawMap(cv, 10, 698, 1004, 110, PINS);
  cv.fillRect(14, 700, 218, 20, PAPER);
  drawText(cv, 'WHERE IT HAPPENED', 18, 705, 2, NAVY);
  cv.fillRect(W - 260, 700, 250, 20, PAPER);
  drawText(cv, 'NUMBERS MATCH THE STORIES ABOVE', W - 256, 705, 1, GREY);

  // ---- Also on -------------------------------------------------------------
  drawText(cv, 'ALSO ON 26 NOVEMBER', 8, 818, 2, RED);
  cv.fillRect(8, 836, 1008, 2, INK);
  ALSO_ON.forEach((item, i) => {
    const col = i < 10 ? 0 : 1;
    const row = i % 10;
    const x = col === 0 ? 8 : 516;
    const y = 844 + row * 15;
    cv.fillRect(x, y + 2, 5, 5, RED);
    drawText(cv, item, x + 12, y, 1, INK);
  });

  // ---- Footer: date check + sources ----------------------------------------
  cv.fillRect(0, 994, W, 2, INK);
  drawText(cv, "DATE CHECK: EUROSTAR LONDON-PARIS STRIKE CANCELLATIONS AND POLAND'S PLANNED UKRAINE-BORDER NO-FLY ZONE WERE REPORTED ON 25 NOVEMBER, SO THEY ARE LEFT OUT ON PURPOSE.", 8, 1000, 1, GREY);
  drawText(cv, 'SOURCES: LIBRE NEWS OF THE WORLD \u00b7 SIMPLELIFE DAILY NEWS \u00b7 SELFSTUDYS \u00b7 JAGRANJOSH \u00b7 ZOTPAPER. ALL STORIES FIRST REPORTED 26 NOVEMBER 2026.', 8, 1010, 1, GREY);

  return cv;
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(draw().px, W, H);
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
