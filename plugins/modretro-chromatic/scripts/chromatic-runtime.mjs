/** Authenticate the embedded vendor files. No discovery, execution or downloads. */
import { createHash } from "node:crypto";
import { accessSync, closeSync, constants, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliDecompressSync, constants as zlibConstants } from "node:zlib";

export const CHROMATIC_VERSION = "1.2.1";
export const CHROMATIC_ROOT = "third-party/chromatic-cli";
export const CHROMATIC_TARGETS = Object.freeze({
  "darwin-arm64": "darwin-arm64/bin/chromatic-cli",
  "darwin-x64": "darwin-x64/bin/chromatic-cli",
  "linux-arm64-gnu": "linux-arm64-gnu/bin/chromatic-cli",
  "linux-x64-gnu": "linux-x64-gnu/bin/chromatic-cli",
  "win32-arm64": "win32-arm64/bin/chromatic-cli.exe",
  "win32-x64": "win32-x64/bin/chromatic-cli.exe",
});
export const CHROMATIC_MEMBERS = Object.freeze(Object.fromEntries([
  ["NOTICE.md", 1622, "b36d5bcafacb1d4d5a147e64aa87a04c1160c684fe266c25582166537188a893", 0o644],
  ["PROVENANCE.json", 14693, "f691ae561c92ee18029fe196ee9508be4b1b04e4bc061376271a1a907b3cfd43", 0o644],
  ["SBOM.json", 23337, "2eb5aa0dccd244ad32b1653ad4b7e39a2254b3b529aa94a1e581fd4fcb8a5ed0", 0o644],
  ["darwin-arm64/THIRD_PARTY_NOTICES.txt", 1596953, "b3b23000848c1b98e87730b536a9a029ecb17e2ce0d77d8a7e8c19226d571aa7", 0o644],
  ["darwin-arm64/bin/chromatic-cli", 12997184, "37257304b250634c586b0061e6f75dc1bec6ebaa57da1b9937106fa1fd370c70", 0o755],
  ["darwin-x64/THIRD_PARTY_NOTICES.txt", 1596952, "39a847c252406ece8d979455ce1ee061e0bab80357107b25003c01b78db2ab11", 0o644],
  ["darwin-x64/bin/chromatic-cli", 14260892, "4b09e5c0ec0ac0837f1419548aa4a87b8638870a6213b8c9c39b50ac5c8ad0d1", 0o755],
  ["linux-arm64-gnu/THIRD_PARTY_NOTICES.txt", 1560649, "3e31321f07fabffd543e4fdea00c1efdbaf8fe09ae39a14fded8e91d88d4a7f1", 0o644],
  ["linux-arm64-gnu/bin/chromatic-cli", 13374504, "5b5921c0847d965ba9875a5d3db03784193c1a7c377f60bdaa68ccdbfee0958e", 0o755],
  ["linux-x64-gnu/THIRD_PARTY_NOTICES.txt", 1560648, "b17f7e5af481f97ec642aad4ff9f221026758da28e88581ca671f604d69a334b", 0o644],
  ["linux-x64-gnu/bin/chromatic-cli", 14770920, "2791460d17ccb9c16b6d4f0072c01cd49104ea93cb6479ef697b05167a07e6a5", 0o755],
  ["win32-arm64/THIRD_PARTY_NOTICES.txt", 1736104, "318b0cb065a3c872662dcf43cb889b7fcd5518c0c2514bc5b69df2b95a179896", 0o644],
  ["win32-arm64/bin/chromatic-cli.exe", 18366976, "7ad15877071b74d1099608e35bb0364607fcf4f0d9dafbcfdc53097e0dce5e56", 0o644],
  ["win32-x64/THIRD_PARTY_NOTICES.txt", 1736100, "c767650bf16d087dd332f24394d7c3ec3a7f4c9bf13b281db69b7b6fdf1c125f", 0o644],
  ["win32-x64/bin/chromatic-cli.exe", 18786816, "eeddc76b11933d09564570dfc521d13251c6d4048d8190242fdd29e7fe81e51f", 0o644],
].map(([name, size, sha256, mode]) => [name, Object.freeze({ size, sha256, mode })])));
export const CHROMATIC_FILES = Object.freeze(Object.fromEntries(
  Object.entries(CHROMATIC_MEMBERS).map(([name, member]) => [name, member.sha256]),
));
export const CHROMATIC_REQUIRED_PATHS = Object.freeze([
  "scripts/chromatic.mjs", "scripts/chromatic-runtime.mjs",
  ...Object.keys(CHROMATIC_FILES).map((name) => `${CHROMATIC_ROOT}/${name}`),
]);
// This fixed-order stream changes storage, not any supplier executable bytes.
export const CHROMATIC_PACKED = Object.freeze({
  format: "brotli-concat-v1", member: "executables.br",
  source: "assets/chromatic-cli/1.2.1.br",
  size: 15452255, sha256: "73c7da79cd50f7b60dcb90b7f2cbea54f04607a77cdb484baccd2aeac1d66176",
  mode: 0o644, decodedSize: 92557292, windowBytes: 134217728,
  targets: Object.freeze(Object.keys(CHROMATIC_TARGETS)),
});
// V2 keeps the old stream readable and adds independently decoded resources.
export const CHROMATIC_PACKED_V2 = Object.freeze({
  "format": "brotli-concat-v2",
  "member": "executables-v2.br",
  "source": "assets/chromatic-cli/1.2.1-v2.br",
  "size": 15419258,
  "sha256": "fd6a1b542a510f3ee1e047e83d31e1ad96bd4580fe7c59fbc558befba778beae",
  "mode": 420,
  "decodedSize": 92557292,
  "windowBytes": 134217728,
  "targets": [
    "darwin-arm64",
    "linux-arm64-gnu",
    "win32-arm64",
    "darwin-x64",
    "linux-x64-gnu",
    "win32-x64"
  ]
});
Object.freeze(CHROMATIC_PACKED_V2.targets);
export const CHROMATIC_NOTICE_PACK = Object.freeze({
  "member": "notices.br",
  "source": "assets/chromatic-cli/notices-1.2.1.br",
  "size": 24102,
  "sha256": "92e4592cfc2d53ea03aec32b358d1d5d290f2b7702bc6abf4f82d17936c7bb4f",
  "mode": 420,
  "decodedSize": 9787406,
  "windowBytes": 134217728
});
export const CHROMATIC_ARTWORK_PACK = Object.freeze({
  "member": "images.br",
  "source": "assets/chromatic-cli/artwork-v1.br",
  "size": 1088764,
  "sha256": "706479c13dc462355eb4184951d4a58fef9edc3ed47a875a33cbbf7b29e0618d",
  "mode": 420,
  "decodedSize": 1240408,
  "windowBytes": 134217728
});
export const CHROMATIC_ARTWORK_MEMBERS = Object.freeze(Object.fromEntries(Object.entries({
  "chromatic-bubblegum.webp": {
    "size": 148700,
    "sha256": "ac3ccc1a73bcb80f54bebcb8faa8d83c8e703f47b621c37e2c0a8a49f4758873",
    "mode": 420
  },
  "chromatic-cloud.webp": {
    "size": 147432,
    "sha256": "e4a9080466a23208e019007b2ffe516ffa7a42cdc1ac92d78d0904d5edabf7dd",
    "mode": 420
  },
  "chromatic-codex.webp": {
    "size": 147612,
    "sha256": "fc485392a920aee5b546aca91b92fcf6cef1f87ac389171f9f5510ed978670c0",
    "mode": 420
  },
  "chromatic-inferno.webp": {
    "size": 171008,
    "sha256": "3607a9393e0dcf57ed3775639ed6aad1ca5298d085e1234963169ff52f0b5aab",
    "mode": 420
  },
  "chromatic-leaf.webp": {
    "size": 153560,
    "sha256": "0ac4e6bf8f0e6d4006f84c446daf72ba3b25f3d1e55fbe5b342686c490e1b50b",
    "mode": 420
  },
  "chromatic-midnight.webp": {
    "size": 154918,
    "sha256": "32d6e4e4af68baa5de7de76dd11fcf340a48a6be37ad985c6a9586a1228bc03d",
    "mode": 420
  },
  "chromatic-volt.webp": {
    "size": 165532,
    "sha256": "ae2223bb23fc32b1f53a55b54ed80c437301cd62d79590686341c8752529971b",
    "mode": 420
  },
  "chromatic-wave.webp": {
    "size": 151646,
    "sha256": "572803bae96f0d73a2585b92040730d355af797f342e8768766a167e5fbba8c4",
    "mode": 420
  }
}).map(([name, pin]) => [name, Object.freeze(pin)])));
export const CHROMATIC_STORAGE_SOURCES = Object.freeze([CHROMATIC_PACKED.source, CHROMATIC_PACKED_V2.source, CHROMATIC_NOTICE_PACK.source, CHROMATIC_ARTWORK_PACK.source]);

const commonMembers = ["NOTICE.md", "PROVENANCE.json", "SBOM.json"];
function validatedTarget(target) {
  if (typeof target !== "string" || !Object.hasOwn(CHROMATIC_TARGETS, target)) {
    throw new Error("bundledChromaticTarget must be an exact supported Chromatic target.");
  }
  return target;
}

/** Absence keeps the universal bundle; a declared target is never inferred. */
export function chromaticTargetFromManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The Chromatic package manifest must be an object.");
  }
  for (const name of ["bundledChromatic", "bundledChromaticTarget", "bundledChromaticFormat"]) {
    if (name in manifest && !Object.hasOwn(manifest, name)) {
      throw new Error(`The Chromatic package manifest must declare its own ${name}.`);
    }
  }
  if (Object.hasOwn(manifest, "bundledChromatic") && manifest.bundledChromatic !== CHROMATIC_VERSION) {
    throw new Error(`Unsupported bundled Chromatic release; expected ${CHROMATIC_VERSION}.`);
  }
  if (!Object.hasOwn(manifest, "bundledChromaticTarget")) return undefined;
  if (manifest.bundledChromatic !== CHROMATIC_VERSION) {
    throw new Error(`bundledChromaticTarget requires bundledChromatic ${CHROMATIC_VERSION}.`);
  }
  return validatedTarget(manifest.bundledChromaticTarget);
}

export function chromaticFormatFromManifest(manifest) {
  const target = chromaticTargetFromManifest(manifest);
  if (!Object.hasOwn(manifest, "bundledChromaticFormat")) return undefined;
  if (![CHROMATIC_PACKED.format, CHROMATIC_PACKED_V2.format].includes(manifest.bundledChromaticFormat) || target !== undefined
      || manifest.bundledChromatic !== CHROMATIC_VERSION) {
    throw new Error("The packed Chromatic format requires the exact universal bundled release.");
  }
  return manifest.bundledChromaticFormat;
}

function executablePack(format) {
  if (format === CHROMATIC_PACKED.format) return CHROMATIC_PACKED;
  if (format === CHROMATIC_PACKED_V2.format) return CHROMATIC_PACKED_V2;
  throw new Error("Unsupported packed Chromatic selection.");
}

function selectedMemberNames(target, format) {
  if (format !== undefined) {
    executablePack(format);
    if (target !== undefined) throw new Error("Unsupported packed Chromatic selection.");
    if (format === CHROMATIC_PACKED_V2.format) return [...commonMembers, CHROMATIC_PACKED_V2.member, CHROMATIC_NOTICE_PACK.member];
    return [...Object.keys(CHROMATIC_FILES).filter((name) => !Object.values(CHROMATIC_TARGETS).includes(name)), CHROMATIC_PACKED.member];
  }
  if (target === undefined) return Object.keys(CHROMATIC_FILES);
  validatedTarget(target);
  return [...commonMembers, `${target}/THIRD_PARTY_NOTICES.txt`, CHROMATIC_TARGETS[target]];
}

/** Packaging selection only; it need not match the packaging host. */
export function chromaticRequiredPaths(target, format) {
  if (target === undefined && format === undefined) return CHROMATIC_REQUIRED_PATHS;
  return Object.freeze([
    "scripts/chromatic.mjs", "scripts/chromatic-runtime.mjs",
    ...selectedMemberNames(target, format).map((name) => `${CHROMATIC_ROOT}/${name}`),
    ...(format === CHROMATIC_PACKED_V2.format ? [`assets/devices/${CHROMATIC_ARTWORK_PACK.member}`] : []),
  ]);
}
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const same = (a, b) => ["dev", "ino", "size", "mode", "nlink", "uid", "gid", "mtimeMs", "ctimeMs"].every((key) => a[key] === b[key]);
// The largest 1.2.1 executable is 18,786,816 bytes. Admit only exact pinned
// members below 24 MiB; size, digest, type and mode checks remain mandatory.
const MAX_MEMBER_BYTES = 24 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const executableMembers = new Set(Object.values(CHROMATIC_TARGETS));
const allowedModes = (name, member, platform) => platform === "win32" && executableMembers.has(name)
  ? [0o644, 0o755] : [member.mode];

/** Windows does not expose POSIX group/other permission bits faithfully. */
export function chromaticDiskMode(mode, platform = process.platform) {
  return platform === "win32" ? (mode & 0o111 ? 0o755 : 0o644) : mode & 0o777;
}

/** Pure target admission; no external version query, download or PATH fallback. */
export function selectChromaticTarget({ platform = process.platform, arch = process.arch,
  glibcVersion = platform === "linux" ? process.report?.getReport().header?.glibcVersionRuntime : undefined,
} = {}) {
  const target = `${platform}-${arch}${platform === "linux" ? "-gnu" : ""}`;
  if (!Object.hasOwn(CHROMATIC_TARGETS, target)) throw new Error(`No bundled Chromatic CLI is available for ${platform}-${arch}; no fallback is permitted. Other plugin tools remain available.`);
  if (platform === "linux") {
    const version = typeof glibcVersion === "string" && /^(\d+)\.(\d+)(?:\.\d+)*$/u.exec(glibcVersion);
    if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 39)) {
      throw new Error("Bundled Chromatic CLI requires GNU/Linux with glibc 2.39 or newer. musl, an unknown libc, or older glibc is unsupported; no fallback is permitted.");
    }
  }
  return target;
}

/** Universal packages keep unrelated tools available on unsupported hosts. */
export function requireChromaticHostTarget(target, options) {
  if (target === undefined) return undefined;
  validatedTarget(target);
  const host = selectChromaticTarget(options);
  if (target !== host) {
    throw new Error(`The bundled Chromatic target ${target} does not match this host (${host}); no fallback is permitted.`);
  }
  return target;
}

/** Check the actual captured buffers that a preparer will write, not a later read. */
export function verifyChromaticRecords(records, { platform = process.platform, target, format } = {}) {
  const members = new Set(selectedMemberNames(target, format));
  const selected = records.filter((record) => record.path.startsWith(CHROMATIC_ROOT + "/"));
  if (selected.length !== members.size) throw new Error("Captured Chromatic distribution has missing or extra members.");
  const seen = new Set();
  for (const record of selected) {
    const name = record.path.slice(CHROMATIC_ROOT.length + 1);
    const bytes = record.contents ?? record.bytes;
    const member = physicalMember(name, format);
    // Windows may report executable bits for EXEs and omit them for foreign
    // binaries. Only pinned executable members accept both normalized modes;
    // metadata and every POSIX host retain their exact pinned modes.
    if (seen.has(name) || !members.has(name) || !member || !Buffer.isBuffer(bytes) || bytes.length !== member.size || bytes.length > MAX_MEMBER_BYTES ||
        createHash("sha256").update(bytes).digest("hex") !== member.sha256 || !allowedModes(name, member, platform).includes(record.mode)) {
      throw new Error(`Captured Chromatic distribution differs from its pin or mode: ${name}`);
    }
    if (format !== undefined && name === executablePack(format).member) decodeChromaticExecutables(bytes, format);
    if (format === CHROMATIC_PACKED_V2.format && name === CHROMATIC_NOTICE_PACK.member) decodeChromaticNotices(bytes);
    seen.add(name);
  }
  if (format === CHROMATIC_PACKED_V2.format) {
    const artwork = records.filter((record) => record.path === `assets/devices/${CHROMATIC_ARTWORK_PACK.member}`);
    if (artwork.length !== 1 || artwork[0].mode !== CHROMATIC_ARTWORK_PACK.mode) throw new Error("Missing or changed packed device artwork.");
    decodeDeviceArtwork(artwork[0].contents ?? artwork[0].bytes);
  }
}

function physicalMember(name, format) {
  if (format !== undefined && name === executablePack(format).member) return executablePack(format);
  if (format === CHROMATIC_PACKED_V2.format && name === CHROMATIC_NOTICE_PACK.member) return CHROMATIC_NOTICE_PACK;
  return CHROMATIC_MEMBERS[name];
}

/** All storage packs use a fixed reviewed layout, never names or sizes from
 * compressed input. Authenticate before allocating the larger dictionary. */
function decodePack(bytes, pack, layout, copy = false) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== pack.size
      || createHash("sha256").update(bytes).digest("hex") !== pack.sha256) {
    throw new Error(`Packed Chromatic bytes differ from the pinned stream: ${pack.member}`);
  }
  const decoded = brotliDecompressSync(bytes, {
    params: { [zlibConstants.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 1 },
    maxOutputLength: pack.decodedSize, info: true,
  });
  if (decoded.buffer.length !== pack.decodedSize || decoded.engine.bytesWritten !== bytes.length) {
    throw new Error("Packed Chromatic stream has a missing or trailing payload.");
  }
  const members = new Map();
  let offset = 0;
  for (const [name, member] of layout) {
    const contents = decoded.buffer.subarray(offset, offset + member.size);
    if (contents.length !== member.size || member.size > MAX_MEMBER_BYTES
        || createHash("sha256").update(contents).digest("hex") !== member.sha256) {
      throw new Error(`Decoded Chromatic member differs from its original pin: ${name}`);
    }
    members.set(name, copy ? Buffer.from(contents) : contents);
    offset += member.size;
  }
  if (offset !== decoded.buffer.length) throw new Error("Unexpected decoded Chromatic bytes.");
  return members;
}

export function decodeChromaticExecutables(bytes, format = CHROMATIC_PACKED.format) {
  const pack = executablePack(format);
  return decodePack(bytes, pack, pack.targets.map((target) => [target, CHROMATIC_MEMBERS[CHROMATIC_TARGETS[target]]]));
}

export function decodeChromaticNotices(bytes) {
  return decodePack(bytes, CHROMATIC_NOTICE_PACK, Object.keys(CHROMATIC_TARGETS)
    .map((target) => [target, CHROMATIC_MEMBERS[`${target}/THIRD_PARTY_NOTICES.txt`]]), true);
}

export function decodeDeviceArtwork(bytes) {
  return decodePack(bytes, CHROMATIC_ARTWORK_PACK, Object.entries(CHROMATIC_ARTWORK_MEMBERS), true);
}

function readBounded(fd, maximum) {
  const bytes = Buffer.alloc(maximum + 1);
  let length = 0;
  while (length < bytes.length) {
    const count = readSync(fd, bytes, length, bytes.length - length, null);
    if (count === 0) break;
    length += count;
  }
  return bytes.subarray(0, length);
}

function unlinked(filename) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw new Error(`Chromatic runtime path is redirected: ${current}`);
  }
  return absolute;
}

function readStorageFile(filename, maximum, pin) {
  unlinked(filename);
  const before = lstatSync(filename);
  if (!before.isFile() || before.nlink !== 1 || before.size > maximum
      || (typeof process.getuid === "function" && before.uid !== process.getuid())
      || (process.platform !== "win32" && (before.mode & 0o022))
      || (pin && (before.size !== pin.size || chromaticDiskMode(before.mode) !== pin.mode))) {
    throw new Error(`Unsafe or changed Chromatic storage file: ${filename}`);
  }
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!same(before, fstatSync(fd))) throw new Error("Chromatic storage changed while opening.");
    const bytes = readBounded(fd, maximum);
    unlinked(filename);
    if (bytes.length !== before.size || !same(before, fstatSync(fd)) || !same(before, lstatSync(filename))
        || (pin && createHash("sha256").update(bytes).digest("hex") !== pin.sha256)) {
      throw new Error(`Chromatic storage changed or differs from its pin: ${filename}`);
    }
    return bytes;
  } finally { closeSync(fd); }
}

/** Passive storage selection; unlike executable resolution, no host gate or cache. */
export function readChromaticPackageFormat(root = packageRoot) {
  const manifest = JSON.parse(readStorageFile(path.join(root, "package.json"), MAX_MANIFEST_BYTES).toString("utf8"));
  if (manifest.bundledChromatic !== CHROMATIC_VERSION) throw new Error("The package does not declare the bundled Chromatic release.");
  return chromaticFormatFromManifest(manifest);
}

/** Return the complete original notice for an explicit target on any host. */
export function readChromaticNotices(target, { root = packageRoot } = {}) {
  validatedTarget(target);
  const format = readChromaticPackageFormat(root);
  if (format === CHROMATIC_PACKED_V2.format) {
    return decodeChromaticNotices(readStorageFile(path.join(root, CHROMATIC_ROOT, CHROMATIC_NOTICE_PACK.member),
      CHROMATIC_NOTICE_PACK.size, CHROMATIC_NOTICE_PACK)).get(target);
  }
  const name = `${target}/THIRD_PARTY_NOTICES.txt`, pin = CHROMATIC_MEMBERS[name];
  return readStorageFile(path.join(root, CHROMATIC_ROOT, name), pin.size, pin);
}

/** Call only for a declared packed-artwork package. Missing/corrupt packs fail. */
export function readPackedDeviceArtwork(directory) {
  return decodeDeviceArtwork(readStorageFile(path.join(directory, CHROMATIC_ARTWORK_PACK.member),
    CHROMATIC_ARTWORK_PACK.size, CHROMATIC_ARTWORK_PACK));
}

/** Also used by packaging on other hosts; never executes an incompatible binary. */
function inspectChromaticBundle(root, { target, format } = {}, materializePacked = false) {
  const members = new Set(selectedMemberNames(target, format));
  const base = unlinked(path.join(root, CHROMATIC_ROOT));
  const directories = new Set([""]);
  for (const name of members) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
  }
  const found = [];
  let decoded, notices;
  function visit(relative) {
    const filename = unlinked(path.join(base, ...relative.split("/")));
    const before = lstatSync(filename);
    // Plugin installers may recreate source directories with mode 0775. Only
    // packed input may be read from those directories: every byte is pinned,
    // captured in memory, and materialized into the private executable cache.
    // Never execute a file from a writable source directory or relax file modes.
    const writableSourceDirectory = materializePacked && format !== undefined
      && directories.has(relative) && before.isDirectory();
    const forbiddenWriteBits = writableSourceDirectory ? 0o002 : 0o022;
    if ((typeof process.getuid === "function" && before.uid !== process.getuid()) ||
        (process.platform !== "win32" && (before.mode & forbiddenWriteBits))) throw new Error(
          `Unsafe Chromatic runtime ownership or permissions: ${filename} (mode ${(before.mode & 0o7777).toString(8)}, uid ${before.uid}, gid ${before.gid}; expected current-user ownership${typeof process.getuid === "function" ? ` uid ${process.getuid()}` : ""} and no group/other write permission)`);
    if (directories.has(relative)) {
      if (!before.isDirectory()) throw new Error(`Chromatic directory changed type: ${relative}`);
      const entries = readdirSync(filename);
      if (entries.length > members.size) throw new Error(`Unexpected Chromatic runtime entries: ${relative}`);
      for (const name of entries.sort()) visit(relative ? `${relative}/${name}` : name);
    } else {
      const member = physicalMember(relative, format);
      if (!members.has(relative) || !member || !before.isFile() || before.nlink !== 1 || before.size !== member.size || before.size > MAX_MEMBER_BYTES) throw new Error(`Unexpected Chromatic runtime member or size: ${relative}`);
      if (!allowedModes(relative, member, process.platform).includes(chromaticDiskMode(before.mode))) throw new Error(`Chromatic runtime member has an unexpected mode: ${relative}`);
      // A writable source directory could swap a regular file for a FIFO
      // between lstat and open. Do not block before the identity recheck.
      const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const opened = fstatSync(fd);
        if (!same(before, opened)) throw new Error(`Chromatic runtime changed while opening: ${relative}`);
        const bytes = readBounded(fd, member.size);
        if (bytes.length !== before.size || createHash("sha256").update(bytes).digest("hex") !== member.sha256) throw new Error(`Chromatic runtime checksum mismatch: ${relative}`);
        if (!same(opened, fstatSync(fd))) throw new Error(`Chromatic runtime changed while reading: ${relative}`);
        if (format !== undefined && relative === executablePack(format).member) decoded = decodeChromaticExecutables(bytes, format);
        if (format === CHROMATIC_PACKED_V2.format && relative === CHROMATIC_NOTICE_PACK.member) notices = decodeChromaticNotices(bytes);
        found.push(relative);
      } finally { closeSync(fd); }
    }
    unlinked(filename);
    if (!same(before, lstatSync(filename))) throw new Error(`Chromatic runtime changed during verification: ${relative}`);
  }
  visit("");
  if (found.length !== members.size) throw new Error("Chromatic runtime is missing a pinned file.");
  if (format === CHROMATIC_PACKED_V2.format) readPackedDeviceArtwork(path.join(root, "assets", "devices"));
  return { version: CHROMATIC_VERSION, files: found, decoded, notices };
}

/** Passive authentication: decoding never writes into a package or cache. */
export function verifyChromaticBundle(root = packageRoot, options = {}) {
  const { decoded: _decoded, notices: _notices, ...result } = inspectChromaticBundle(root, options);
  return result;
}

const CACHE_MARKER = Buffer.from('{"schemaVersion":1,"owner":"modretro-chromatic","purpose":"verified-chromatic-executables"}' + String.fromCharCode(10));
function maybeStat(filename) {
  try { return lstatSync(filename); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
function ownedDirectory(filename, privateMode = false) {
  unlinked(filename);
  const info = lstatSync(filename);
  if (!info.isDirectory() || (typeof process.getuid === "function" && info.uid !== process.getuid())
      || (process.platform !== "win32" && ((info.mode & 0o022) !== 0 || (privateMode && (info.mode & 0o777) !== 0o700)))) {
    throw new Error("Unsafe Chromatic cache directory: " + filename);
  }
  return info;
}
function ensureOwnedDirectory(filename, privateMode = true) {
  let created = false;
  if (!maybeStat(filename)) {
    const parent = path.dirname(filename);
    if (parent === filename) throw new Error("No owned parent for the Chromatic cache.");
    ensureOwnedDirectory(parent, false);
    try { mkdirSync(filename, { mode: 0o700 }); created = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  return { identity: ownedDirectory(filename, privateMode), created };
}
function assertDirectoryIdentity(filename, before) {
  const after = ownedDirectory(filename, true);
  if (!["dev", "ino", "uid", "gid", "mode"].every((key) => before[key] === after[key])) {
    throw new Error("Chromatic cache directory identity changed.");
  }
}
function readCacheFile(filename, size, sha256, mode) {
  unlinked(filename);
  const before = lstatSync(filename);
  if (!before.isFile() || before.nlink !== 1 || before.size !== size || size > MAX_MEMBER_BYTES
      || (typeof process.getuid === "function" && before.uid !== process.getuid())
      || (process.platform !== "win32" && (before.mode & 0o777) !== mode)) {
    throw new Error("Unsafe or partial Chromatic cache file: " + filename);
  }
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!same(before, fstatSync(fd))) throw new Error("Chromatic cache file changed while opening.");
    const bytes = readBounded(fd, size);
    if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== sha256
        || !same(before, fstatSync(fd)) || !same(before, lstatSync(filename))) {
      throw new Error("Chromatic cache file failed verification: " + filename);
    }
    unlinked(filename);
    return before;
  } finally { closeSync(fd); }
}

/** Materialize only for an actual vendor invocation, outside immutable inputs.
 * A corrupt existing cache entry is a refusal, never an overwrite or fallback. */
export function materializeChromaticExecutable(target, bytes, {
  cacheRoot = path.join(os.homedir(), ".modretro-chromatic-runtime"),
  notices,
} = {}) {
  validatedTarget(target);
  const member = CHROMATIC_MEMBERS[CHROMATIC_TARGETS[target]];
  if (!Buffer.isBuffer(bytes) || bytes.length !== member.size
      || createHash("sha256").update(bytes).digest("hex") !== member.sha256) {
    throw new Error("Cannot materialize an unverified Chromatic executable.");
  }
  const noticePin = CHROMATIC_MEMBERS[`${target}/THIRD_PARTY_NOTICES.txt`];
  if (notices !== undefined && (!Buffer.isBuffer(notices) || notices.length !== noticePin.size
      || createHash("sha256").update(notices).digest("hex") !== noticePin.sha256)) {
    throw new Error("Cannot materialize unverified Chromatic notices.");
  }
  const base = path.resolve(cacheRoot);
  const { identity: baseIdentity, created } = ensureOwnedDirectory(base);
  const marker = path.join(base, ".owner.json");
  if (created) {
    let fd;
    try {
      fd = openSync(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      writeFileSync(fd, CACHE_MARKER);
    } catch (error) { if (error.code !== "EEXIST") throw error; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  readCacheFile(marker, CACHE_MARKER.length, createHash("sha256").update(CACHE_MARKER).digest("hex"), 0o600);
  const bundle = path.join(base, notices === undefined ? CHROMATIC_PACKED.sha256 : CHROMATIC_PACKED_V2.sha256);
  const { identity: bundleIdentity } = ensureOwnedDirectory(bundle);
  const directory = path.join(bundle, target + "-" + member.sha256);
  const { identity: directoryIdentity } = ensureOwnedDirectory(directory);
  const executable = path.join(directory, path.basename(CHROMATIC_TARGETS[target]));
  // Make the target notice readable before publishing its executable. Both
  // files use the same no-overwrite, identity-checked promotion path.
  const files = [...(notices === undefined ? [] : [{ filename: path.join(directory, "THIRD_PARTY_NOTICES.txt"), bytes: notices, pin: noticePin }]),
    { filename: executable, bytes, pin: member }];
  for (const file of files) {
    if (!maybeStat(file.filename)) {
      const staging = mkdtempSync(path.join(directory, ".stage-"));
      const stagingIdentity = ownedDirectory(staging, true);
      const temporary = path.join(staging, path.basename(file.filename));
      let temporaryIdentity;
      try {
        const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          temporaryIdentity = fstatSync(fd);
          writeFileSync(fd, file.bytes);
          fchmodSync(fd, file.pin.mode);
        } finally { closeSync(fd); }
        readCacheFile(temporary, file.pin.size, file.pin.sha256, file.pin.mode);
        assertDirectoryIdentity(directory, directoryIdentity);
        try { linkSync(temporary, file.filename); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
      } finally {
        assertDirectoryIdentity(staging, stagingIdentity);
        if (temporaryIdentity) {
          const current = lstatSync(temporary);
          if (current.dev !== temporaryIdentity.dev || current.ino !== temporaryIdentity.ino || current.uid !== temporaryIdentity.uid) {
            throw new Error("Chromatic staging identity changed; refusing cleanup.");
          }
          unlinkSync(temporary);
        }
        rmdirSync(staging);
      }
    }
    // The winning entry (ours or a concurrent producer's) must independently pass.
    readCacheFile(file.filename, file.pin.size, file.pin.sha256, file.pin.mode);
  }
  assertDirectoryIdentity(directory, directoryIdentity);
  assertDirectoryIdentity(bundle, bundleIdentity);
  assertDirectoryIdentity(base, baseIdentity);
  return executable;
}

export function resolveChromaticRuntime(options = {}) {
  if ("target" in options) throw new Error("Chromatic runtime selection comes from package.json; a caller target override is not permitted.");
  const { root = packageRoot, ...targetOptions } = options;
  // Preserve host/libc refusal before any package or native-file access.
  const hostTarget = selectChromaticTarget(targetOptions);
  const filename = unlinked(path.join(root, "package.json"));
  const before = lstatSync(filename);
  if (!before.isFile() || before.nlink !== 1 || before.size <= 0 || before.size > MAX_MANIFEST_BYTES ||
      (typeof process.getuid === "function" && before.uid !== process.getuid()) ||
      (process.platform !== "win32" && (before.mode & 0o022))) {
    throw new Error("Unsafe Chromatic package manifest type, size, ownership or permissions.");
  }
  const fd = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const unchanged = () => {
      unlinked(filename);
      if (!same(before, fstatSync(fd)) || !same(before, lstatSync(filename))) {
        throw new Error("The Chromatic package manifest changed during runtime resolution.");
      }
    };
    unchanged();
    const bytes = readFileSync(fd);
    if (bytes.length !== before.size) throw new Error("The Chromatic package manifest changed while reading.");
    unchanged();
    const manifest = JSON.parse(bytes.toString("utf8"));
    const target = chromaticTargetFromManifest(manifest);
    const format = chromaticFormatFromManifest(manifest);
    if (manifest.bundledChromatic !== CHROMATIC_VERSION) {
      throw new Error(`The package must declare bundledChromatic ${CHROMATIC_VERSION}.`);
    }
    requireChromaticHostTarget(target, targetOptions);
    const { decoded, notices, ...result } = inspectChromaticBundle(root, { target, format }, format !== undefined);
    unchanged();
    const executable = decoded === undefined ? path.join(root, CHROMATIC_ROOT, CHROMATIC_TARGETS[hostTarget])
      : materializeChromaticExecutable(hostTarget, decoded.get(hostTarget), { notices: notices?.get(hostTarget) });
    accessSync(executable, constants.X_OK);
    unchanged();
    return { ...result, platform: hostTarget, executable };
  } finally { closeSync(fd); }
}

// Offline notice access is deliberately separate from the vendor CLI. It does
// not select a host executable, create a cache or contact a device.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--notices") {
      throw new Error(`Usage: node scripts/chromatic-runtime.mjs --notices <${Object.keys(CHROMATIC_TARGETS).join("|")}>`);
    }
    process.stdout.write(readChromaticNotices(process.argv[3]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
