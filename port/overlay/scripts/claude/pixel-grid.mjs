#!/usr/bin/env node
/**
 * Text pixel grids <-> PNG for exact, reviewable pixel art authored by Claude.
 *
 * Claude has no built-in image generator, but it can write and edit text
 * precisely. A `.pxg` file stores one character per native pixel plus an
 * explicit palette, so every pixel is deliberate, diffable and editable with
 * ordinary text edits. This helper renders it to a native 1x PNG (for
 * `graphics_analyze` / `asset_import`), an enlarged preview with an optional
 * 8x8 tile grid (for visual review with the Read tool), and checks Game Boy
 * source-colour and tile constraints. It can also convert an existing PNG back
 * into a `.pxg` so existing art can be edited exactly.
 *
 * Dependency-free: Node's zlib only.
 *
 *   node pixel-grid.mjs render  hero.pxg [--out hero.png] [--preview hero@8x.png] [--scale 8] [--no-grid]
 *   node pixel-grid.mjs extract hero.png [--out hero.pxg] [--profile sprite] [--frame-width 16]
 *   node pixel-grid.mjs check   hero.png [--profile sprite|background|color|free]
 *   node pixel-grid.mjs template sprite|background [--width 16] [--height 16]
 *
 * .pxg format:
 *
 *   # comments start with '#'
 *   profile: sprite                 (sprite | background | color | free)
 *   palette:
 *     . #65ff00                     (one character, then #rrggbb or "transparent")
 *     K #071821
 *     M #86c06c
 *     W #e0f8cf
 *   ---
 *   @frame down                     (optional; frames are laid out left to right)
 *   ....KKKKKKKK....
 *   ...
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const SPRITE_SHADES = { "#071821": "K", "#86c06c": "M", "#e0f8cf": "W", "#65ff00": "." };
const BACKGROUND_SHADES = { "#071821": "K", "#306850": "D", "#86c06c": "M", "#e0f8cf": "W" };
const PROFILES = {
  sprite: { colors: Object.keys(SPRITE_SHADES), tileMultiple: 8, note: "native game sprite source: #071821/#86c06c/#e0f8cf plus #65ff00 transparent marker" },
  background: { colors: Object.keys(BACKGROUND_SHADES), tileMultiple: 8, note: "manual-palette background: exactly the four GB source shades" },
  color: { colors: null, tileMultiple: 8, note: "automatic-palette colour art: <= 4 RGB555 colours per 8x8 tile, <= 8 palette families" },
  free: { colors: null, tileMultiple: 1, note: "no Game Boy checks" },
};
const EXTRA_SYMBOLS = "abcdefghijklmnopqrstuvwxyzABCEFGHIJLNOPQRSTUVXYZ0123456789$%&*+=?";

function fail(message) { throw new Error(message); }

function parseArgs(argv) {
  const [command, input, ...rest] = argv;
  const options = { command, input };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--no-grid") options.noGrid = true;
    else if (arg.startsWith("--")) options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[++i];
    else fail(`Unexpected argument: ${arg}`);
  }
  return options;
}

const hex = (r, g, b) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
const rgb555 = (color) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) >> 3);
  return `${r},${g},${b}`;
};

// ---------- .pxg ----------

function parsePxg(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const separator = lines.findIndex((line) => line.trim() === "---");
  if (separator < 0) fail("Missing '---' line between the header and the pixel grid.");
  let profile = "free";
  const palette = new Map();
  let inPalette = false;
  for (const raw of lines.slice(0, separator)) {
    if (raw.trim().startsWith("#")) continue;
    const line = raw.replace(/\s+#(?![0-9a-fA-F]{6}\b).*$/, "").trimEnd();
    if (!line.trim()) continue;
    const header = line.match(/^(\w+):\s*(.*)$/);
    if (header) {
      inPalette = header[1] === "palette";
      if (header[1] === "profile") profile = header[2].trim();
      continue;
    }
    if (!inPalette) continue;
    const entry = line.trim().match(/^(\S)\s+(#[0-9a-fA-F]{6}|transparent)$/);
    if (!entry) fail(`Bad palette entry: "${line.trim()}" (expected "<char> #rrggbb" or "<char> transparent")`);
    if (entry[1] === "#" || entry[1] === "@") fail("'#' and '@' cannot be palette characters.");
    if (palette.has(entry[1])) fail(`Palette character '${entry[1]}' is defined twice.`);
    palette.set(entry[1], entry[2].toLowerCase());
  }
  if (!PROFILES[profile]) fail(`Unknown profile '${profile}'.`);
  if (!palette.size) fail("The palette is empty.");

  const frames = [];
  let current = null;
  lines.slice(separator + 1).forEach((raw, index) => {
    const line = raw.trimEnd();
    const lineNumber = separator + 2 + index;
    if (!line.trim()) return;
    const frame = line.match(/^@frame\s*(.*)$/);
    if (frame) {
      current = { name: frame[1].trim() || `frame${frames.length}`, rows: [], line: lineNumber };
      frames.push(current);
      return;
    }
    if (!current) {
      current = { name: "frame0", rows: [], line: lineNumber };
      frames.push(current);
    }
    for (const [column, char] of [...line].entries()) {
      if (!palette.has(char)) fail(`Line ${lineNumber}, column ${column + 1}: '${char}' is not in the palette.`);
    }
    current.rows.push({ text: [...line], line: lineNumber });
  });
  if (!frames.length) fail("The grid is empty.");
  const height = frames[0].rows.length;
  for (const frame of frames) {
    if (frame.rows.length !== height) fail(`Frame '${frame.name}' has ${frame.rows.length} rows; expected ${height}.`);
    const width = frame.rows[0].text.length;
    for (const row of frame.rows) {
      if (row.text.length !== width) fail(`Line ${row.line}: ${row.text.length} pixels wide; frame '${frame.name}' rows are ${width} wide.`);
    }
    frame.width = width;
  }
  const width = frames.reduce((sum, frame) => sum + frame.width, 0);
  const pixels = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (const frame of frames) row.push(...frame.rows[y].text.map((char) => palette.get(char)));
    pixels.push(row);
  }
  return { profile, palette, frames, width, height, pixels };
}

function formatPxg({ profile, pixels, frameWidth }) {
  const colors = [...new Set(pixels.flat())];
  const symbols = new Map();
  const preferred = { ...BACKGROUND_SHADES, ...SPRITE_SHADES, transparent: "," };
  if (profile === "background") Object.assign(preferred, BACKGROUND_SHADES);
  const pool = [...EXTRA_SYMBOLS];
  for (const color of colors) {
    const wanted = preferred[color];
    if (wanted && ![...symbols.values()].includes(wanted)) symbols.set(color, wanted);
  }
  for (const color of colors) {
    if (symbols.has(color)) continue;
    const next = pool.find((char) => ![...symbols.values()].includes(char));
    if (!next) fail(`Too many distinct colours (${colors.length}) to express as a text grid.`);
    symbols.set(color, next);
  }
  const width = pixels[0].length;
  const step = frameWidth && width % frameWidth === 0 && width > frameWidth ? frameWidth : width;
  const out = [`profile: ${profile}`, "palette:"];
  for (const [color, char] of symbols) out.push(`  ${char} ${color}`);
  out.push("---");
  for (let x0 = 0; x0 < width; x0 += step) {
    if (step !== width) out.push(`@frame ${x0 / step}`);
    for (const row of pixels) out.push(row.slice(x0, x0 + step).map((color) => symbols.get(color)).join(""));
  }
  return `${out.join("\n")}\n`;
}

// ---------- PNG ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** pixels: rows of "#rrggbb" | "transparent". */
function encodePng(pixels, scale = 1, grid = false) {
  const height = pixels.length * scale;
  const width = pixels[0].length * scale;
  const alpha = pixels.some((row) => row.includes("transparent"));
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * channels + 1);
    raw[offset] = 0;
    for (let x = 0; x < width; x++) {
      let color = pixels[Math.floor(y / scale)][Math.floor(x / scale)];
      let a = 255;
      if (color === "transparent") {
        // Checkerboard in previews; real transparency in native output.
        if (scale > 1) color = ((Math.floor(x / (scale / 2 || 1)) + Math.floor(y / (scale / 2 || 1))) % 2) ? "#d8d8d8" : "#f4f4f4";
        else { color = "#000000"; a = 0; }
      }
      let [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
      if (grid && scale >= 4) {
        const tileLine = x % (8 * scale) === 0 || y % (8 * scale) === 0;
        const pixelLine = x % scale === 0 || y % scale === 0;
        if (tileLine) [r, g, b] = [255, 0, 170];
        else if (pixelLine && scale >= 6) [r, g, b] = [r, g, b].map((v) => Math.round(v * 0.82));
      }
      const p = offset + 1 + x * channels;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
      if (alpha) raw[p + 3] = scale > 1 ? 255 : a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = alpha ? 6 : 2; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) fail("Not a PNG file.");
  let offset = 8;
  let ihdr; let palette; let trns; const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") ihdr = data;
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8]; const colorType = ihdr[9];
  if (ihdr[12] !== 0) fail("Interlaced PNGs are not supported; re-save without interlacing.");
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!samples) fail(`Unsupported PNG colour type ${colorType}.`);
  const bitsPerPixel = samples * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const data = inflateSync(Buffer.concat(idat));
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = data[start];
    const line = Buffer.from(data.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? line[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[i] = (line[i] + add) & 0xff;
    }
    previous = line;
    const sample = (index) => {
      if (depth === 8) return line[index];
      if (depth === 16) return line[index * 2];
      const perByte = 8 / depth;
      const byte = line[Math.floor(index / perByte)];
      const shift = 8 - depth * ((index % perByte) + 1);
      return (byte >> shift) & ((1 << depth) - 1);
    };
    const scaleSample = (v) => (depth >= 8 || colorType === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
    const row = [];
    for (let x = 0; x < width; x++) {
      let r; let g; let b; let a = 255;
      if (colorType === 3) {
        const index = sample(x);
        [r, g, b] = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]];
        if (trns && index < trns.length) a = trns[index];
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = scaleSample(sample(x * samples));
        if (colorType === 4) a = sample(x * samples + 1);
      } else {
        [r, g, b] = [0, 1, 2].map((c) => sample(x * samples + c));
        if (colorType === 6) a = sample(x * samples + 3);
      }
      row.push(a === 0 ? "transparent" : hex(r, g, b));
    }
    rows.push(row);
  }
  return rows;
}

// ---------- checks ----------

function analyze(pixels, profileName) {
  const profile = PROFILES[profileName];
  const height = pixels.length; const width = pixels[0].length;
  const issues = [];
  const used = [...new Set(pixels.flat())];
  if (profile.colors) {
    const illegal = used.filter((color) => !profile.colors.includes(color));
    if (illegal.length) issues.push({ code: "SOURCE_COLOUR", message: `Colours not allowed for ${profileName}: ${illegal.join(", ")} (${profile.note}).` });
  }
  if (profileName === "sprite" && used.includes("transparent")) {
    issues.push({ code: "SPRITE_ALPHA", message: "Sprite uses real alpha; GB Studio sprite sources conventionally use the opaque #65ff00 marker. Keep the project's established convention." });
  }
  if (profile.tileMultiple > 1 && (width % profile.tileMultiple || height % profile.tileMultiple)) {
    issues.push({ code: "DIMENSIONS", message: `${width}x${height} is not a multiple of ${profile.tileMultiple}.` });
  }
  if (profileName === "sprite" && height % 16) issues.push({ code: "SPRITE_HEIGHT", message: "Simple sprite sheets are 16 px tall (16x16 static, 48x16 directional, 96x16 animated)." });
  if (profileName === "background" && (width < 160 || height < 144)) issues.push({ code: "BACKGROUND_SIZE", message: "Backgrounds are at least 160x144 (except UI/avatars)." });

  const tiles = new Set(); const families = new Set(); const overfull = [];
  for (let ty = 0; ty < Math.ceil(height / 8); ty++) {
    for (let tx = 0; tx < Math.ceil(width / 8); tx++) {
      const colors = new Set(); const key = [];
      for (let y = ty * 8; y < Math.min(height, ty * 8 + 8); y++) {
        for (let x = tx * 8; x < Math.min(width, tx * 8 + 8); x++) {
          const c = pixels[y][x];
          key.push(c);
          colors.add(c === "transparent" ? c : rgb555(c));
        }
      }
      tiles.add(key.join(""));
      families.add([...colors].sort().join("|"));
      const limit = profileName === "sprite" ? 4 : 4;
      if (colors.size > limit) overfull.push(`(${tx},${ty})=${colors.size}`);
    }
  }
  if (overfull.length) issues.push({ code: "TILE_COLOURS", message: `${overfull.length} 8x8 tile(s) use more than 4 colours: ${overfull.slice(0, 12).join(" ")}${overfull.length > 12 ? " ..." : ""}` });
  if (profileName === "color" && families.size > 8) {
    issues.push({ code: "PALETTE_FAMILIES", message: `${families.size} distinct per-tile colour sets; a scene has 8 background palette slots. Shared subsets may still pack; confirm with graphics_analyze.` });
  }
  return { width, height, profile: profileName, coloursUsed: used, uniqueTiles8x8: tiles.size, issues, ok: issues.length === 0 };
}

function template(kind, width, height) {
  const sprite = kind !== "background";
  const w = Number(width ?? (sprite ? 16 : 160)); const h = Number(height ?? (sprite ? 16 : 144));
  const fill = sprite ? "." : "W";
  const palette = sprite ? SPRITE_SHADES : BACKGROUND_SHADES;
  const lines = [`profile: ${sprite ? "sprite" : "background"}`, "palette:"];
  for (const [color, char] of Object.entries(palette)) lines.push(`  ${char} ${color}`);
  lines.push("---");
  for (let y = 0; y < h; y++) lines.push(fill.repeat(w));
  return `${lines.join("\n")}\n`;
}

function writeNew(file, bytes) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, bytes);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { command, input } = options;
  if (!command || command === "--help" || command === "help") {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0]);
    return;
  }
  if (command === "template") {
    process.stdout.write(template(input, options.width, options.height));
    return;
  }
  if (!input || !existsSync(input)) fail(`Input not found: ${input}`);

  if (command === "render") {
    const art = parsePxg(readFileSync(input, "utf8"));
    const out = options.out ?? input.replace(/\.pxg$/i, "") + ".png";
    writeNew(out, encodePng(art.pixels));
    const scale = Number(options.scale ?? 8);
    const preview = options.preview ?? out.replace(/\.png$/i, `@${scale}x.png`);
    writeNew(preview, encodePng(art.pixels, scale, !options.noGrid));
    console.log(JSON.stringify({
      png: path.resolve(out), preview: path.resolve(preview),
      frames: art.frames.map((frame) => ({ name: frame.name, width: frame.width })),
      ...analyze(art.pixels, art.profile),
    }, null, 2));
    return;
  }
  if (command === "extract") {
    const pixels = decodePng(readFileSync(input));
    const profile = options.profile ?? "free";
    const out = options.out ?? input.replace(/\.png$/i, "") + ".pxg";
    if (existsSync(out)) fail(`Refusing to overwrite ${out}; choose another --out.`);
    writeNew(out, formatPxg({ profile, pixels, frameWidth: options.frameWidth ? Number(options.frameWidth) : undefined }));
    console.log(JSON.stringify({ pxg: path.resolve(out), ...analyze(pixels, profile) }, null, 2));
    return;
  }
  if (command === "check") {
    const pixels = decodePng(readFileSync(input));
    console.log(JSON.stringify(analyze(pixels, options.profile ?? "free"), null, 2));
    return;
  }
  fail(`Unknown command: ${command}`);
}

try { main(); }
catch (error) {
  console.error(`pixel-grid: ${error.message}`);
  process.exitCode = 1;
}
