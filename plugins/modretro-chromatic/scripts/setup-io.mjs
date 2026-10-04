/** I/O for explicitly selected setup operations. Never called by passive doctor. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createInflateRaw } from "node:zlib";

export const SETUP_IO_LIMITS = Object.freeze({ archiveBytes: 512 * 1024 * 1024, entries: 32768, extractedBytes: 2 * 1024 * 1024 * 1024, directoryBytes: 64 * 1024 * 1024, fileBytes: 512 * 1024 * 1024 });
const HTTPS_HOSTS = new Set(["github.com", "codeload.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "registry.npmjs.org", "nodejs.org"]);
const WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const key = (filename) => process.platform === "win32" ? filename.toLowerCase() : filename;
const progress = (context, event) => { context.onProgress?.(event); };

export class SetupIoError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "SetupIoError";
    this.code = code;
    this.details = details;
  }
}

export function checkSetupAbort(signal) {
  if (signal?.aborted) throw new SetupIoError("ABORT_ERR", "Setup was cancelled; completed components and owned partial files are preserved.", {}, signal.reason);
}

function within(root, filename) {
  const relative = path.relative(key(path.resolve(root)), key(path.resolve(filename)));
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

async function metadata(filename) {
  try { return await lstat(filename); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

/** A parent-held lock/root marker grants ownership; this helper checks path confinement. */
export async function assertOwnedPath(root, filename, { allowMissing = false } = {}) {
  if (!path.isAbsolute(root) || !path.isAbsolute(filename) || !within(root, filename)) throw new SetupIoError("UNSAFE_PATH", "Setup write path must remain inside its explicit owned root.", { root, path: filename });
  const resolvedRoot = path.resolve(root);
  const rootEntry = await metadata(resolvedRoot);
  if (!rootEntry?.isDirectory() || rootEntry.isSymbolicLink() || key(await realpath(resolvedRoot)) !== key(resolvedRoot)) throw new SetupIoError("UNSAFE_PATH", "The owned setup root must be a real directory, without links or junctions.", { root });
  let current = resolvedRoot;
  for (const component of path.relative(resolvedRoot, path.resolve(filename)).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const entry = await metadata(current);
    if (!entry) {
      if (allowMissing) return path.resolve(filename);
      throw new SetupIoError("MISSING_PATH", "Required setup path is missing.", { path: current });
    }
    if (entry.isSymbolicLink() || key(await realpath(current)) !== key(current)) throw new SetupIoError("UNSAFE_PATH", "Setup paths cannot traverse a symbolic link or junction.", { path: current });
  }
  return path.resolve(filename);
}

export async function ensureOwnedDirectory(root, filename) {
  await assertOwnedPath(root, filename, { allowMissing: true });
  let current = path.resolve(root);
  for (const component of path.relative(current, path.resolve(filename)).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const entry = await metadata(current);
    if (!entry) await mkdir(current, { mode: 0o700 });
    else if (!entry.isDirectory() || entry.isSymbolicLink()) throw new SetupIoError("UNSAFE_PATH", "A setup directory is occupied by a non-directory or link.", { path: current });
    await assertOwnedPath(root, current);
  }
  return path.resolve(filename);
}

export async function setupSha256File(filename, maximumBytes = SETUP_IO_LIMITS.archiveBytes) {
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) throw new SetupIoError("INVALID_FILE", "Setup requires a bounded regular file.", { path: filename });
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new SetupIoError("FILE_CHANGED", "A setup input changed while opening.", { path: filename });
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > maximumBytes) throw new SetupIoError("SIZE_LIMIT", "Setup input exceeds its size limit."); hash.update(chunk); }
    const after = await handle.stat();
    if (bytes !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new SetupIoError("FILE_CHANGED", "A setup input changed while reading.", { path: filename });
    return { sha256: hash.digest("hex"), bytes };
  } finally { await handle.close(); }
}

function trustedUrl(value) {
  const selected = new URL(value);
  if (selected.protocol !== "https:" || selected.username || selected.password || (selected.port && selected.port !== "443") || !HTTPS_HOSTS.has(selected.hostname)) throw new SetupIoError("UNTRUSTED_DOWNLOAD", "Setup refused a non-official HTTPS download or redirect.", { origin: selected.origin });
  return selected;
}

async function quarantine(context, filename, reason) {
  const destinationRoot = await ensureOwnedDirectory(context.setupRoot, path.join(context.setupRoot, "quarantine", "downloads"));
  await assertOwnedPath(context.setupRoot, filename);
  const destination = path.join(destinationRoot, path.basename(filename) + "." + randomUUID() + "." + reason);
  await rename(filename, destination);
  progress(context, { phase: "download-quarantined", path: destination, reason });
  return destination;
}

/** Authenticate complete files only; never reuse a .partial or retain a corrupt cache hit. */
export async function downloadArchive(release, context, { fetchImpl = globalThis.fetch, timeoutMs = 20 * 60_000, maximumBytes = SETUP_IO_LIMITS.archiveBytes, attempts = 2 } = {}) {
  checkSetupAbort(context.signal);
  if (!release || !/^[a-f0-9]{64}$/u.test(release.sha256) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(release.archive)) throw new SetupIoError("INVALID_RELEASE", "Setup download requires a pinned SHA-256 and safe archive basename.");
  trustedUrl(release.url);
  const cache = await ensureOwnedDirectory(context.setupRoot, path.join(context.setupRoot, "downloads"));
  const destination = path.join(cache, release.sha256 + "-" + release.archive);
  await assertOwnedPath(context.setupRoot, destination, { allowMissing: true });
  const quarantined = [];
  if (await metadata(destination)) {
    const cached = await lstat(destination);
    if (!cached.isFile() || cached.isSymbolicLink()) throw new SetupIoError("UNSAFE_PATH", "The owned archive cache contains a non-file entry.", { path: destination });
    const existing = cached.size <= maximumBytes ? await setupSha256File(destination, maximumBytes) : undefined;
    if (existing?.sha256 === release.sha256) return { path: destination, ...existing, source: release.url, reused: true, quarantined };
    try { quarantined.push(await quarantine(context, destination, "checksum-mismatch")); }
    catch (cleanupError) {
      const mismatch = new SetupIoError("CHECKSUM_MISMATCH", "The cached archive does not match its packaged SHA-256 or size limit.", { source: release.url, expected: release.sha256, actual: existing?.sha256 });
      throw new SetupIoError(mismatch.code, mismatch.message, {
        ...mismatch.details, cachePath: destination, quarantined, quarantineConfirmed: false, retryStopped: true,
        quarantineError: { code: cleanupError.code ?? "QUARANTINE_FAILED", message: String(cleanupError.message ?? cleanupError) },
      }, mismatch);
    }
  }
  let lastError;
  for (let attempt = 1; attempt <= Math.min(Math.max(attempts, 1), 3); attempt++) {
    checkSetupAbort(context.signal);
    const partial = destination + "." + randomUUID() + ".partial";
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("Download timeout")), timeoutMs);
    timer.unref?.();
    const signal = context.signal ? AbortSignal.any([context.signal, timeout.signal]) : timeout.signal;
    try {
      let url = trustedUrl(release.url);
      let response;
      for (let redirects = 0; redirects < 8; redirects++) {
        checkSetupAbort(signal);
        response = await fetchImpl(url, { redirect: "manual", signal, headers: { "Accept-Encoding": "identity" } });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new SetupIoError("DOWNLOAD_FAILED", "Official download redirected without a destination.");
        url = trustedUrl(new URL(location, url));
        response = undefined;
      }
      if (!response?.ok || !response.body) throw new SetupIoError("DOWNLOAD_FAILED", "Official archive download failed.", { source: release.url, status: response?.status ?? "redirect-limit", attempt });
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) { await response.body.cancel(); throw new SetupIoError("SIZE_LIMIT", "The official archive exceeds its download size limit."); }
      let bytes = 0;
      const hash = createHash("sha256");
      const bounded = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > maximumBytes) callback(new SetupIoError("SIZE_LIMIT", "The official archive exceeds its download size limit.")); else { hash.update(chunk); callback(null, chunk); } } });
      progress(context, { phase: "download-start", source: release.url, attempt });
      await pipeline(Readable.fromWeb(response.body), bounded, createWriteStream(partial, { flags: "wx", mode: 0o600 }), { signal });
      const sha256 = hash.digest("hex");
      if (sha256 !== release.sha256) throw new SetupIoError("CHECKSUM_MISMATCH", "The downloaded archive does not match its packaged SHA-256.", { source: release.url, expected: release.sha256, actual: sha256 });
      await assertOwnedPath(context.setupRoot, partial);
      await assertOwnedPath(context.setupRoot, destination, { allowMissing: true });
      if (await metadata(destination)) throw new SetupIoError("DESTINATION_EXISTS", "Setup cache changed during its locked download.", { path: destination });
      await rename(partial, destination);
      progress(context, { phase: "download-complete", source: release.url, sha256, bytes });
      return { path: destination, sha256, bytes, source: release.url, reused: false, quarantined };
    } catch (error) {
      let quarantineError;
      try { if (await metadata(partial)) quarantined.push(await quarantine(context, partial, "incomplete")); }
      catch (cleanupError) { quarantineError = { code: cleanupError.code ?? "QUARANTINE_FAILED", message: String(cleanupError.message ?? cleanupError) }; }
      const cancelled = context.signal?.aborted;
      const timedOut = timeout.signal.aborted;
      const code = cancelled ? "ABORT_ERR" : timedOut ? "DOWNLOAD_TIMEOUT" : error.code ?? "DOWNLOAD_FAILED";
      const message = cancelled
        ? (quarantineError ? "Setup download was cancelled; quarantine could not be confirmed. Inspect the recorded partial path." : "Setup download was cancelled; any partial file was quarantined.")
        : timedOut ? "The official archive download exceeded its time limit." : error.message ?? "Archive download failed.";
      const failure = new SetupIoError(code, message, {
        ...(error.details ?? {}), source: release.url, attempt, partialPath: partial, quarantined,
        ...(timedOut ? { timeoutMs } : {}),
        ...(quarantineError ? { quarantineError, quarantineConfirmed: false, retryStopped: true } : {}),
      }, error);
      // An unconfirmed quarantine is never a reason to retry or replace the
      // original failure. Keep the failed operation and cleanup error separate.
      if (cancelled || quarantineError) throw failure;
      lastError = failure;
      if (["UNTRUSTED_DOWNLOAD", "SIZE_LIMIT", "UNSAFE_PATH", "DESTINATION_EXISTS"].includes(code)) break;
      progress(context, { phase: "download-failed", source: release.url, attempt, code });
    } finally { clearTimeout(timer); }
  }
  throw new SetupIoError(lastError?.code ?? "DOWNLOAD_FAILED", lastError?.message ?? "Archive download failed.", { ...(lastError?.details ?? {}), quarantined }, lastError);
}

function archiveName(name) {
  if (typeof name !== "string" || !name || name.length > 4096 || /[\\:<>"|?*\u0000-\u001f]/u.test(name) || name.startsWith("/")) throw new SetupIoError("UNSAFE_ARCHIVE", "Archive contains an unsafe path.", { path: name });
  const normalized = name.replace(/\/$/u, "");
  const parts = normalized.split("/");
  if (parts.length > 128 || parts.some((part) => !part || part === "." || part === ".." || part.length > 255 || /[. ]$/u.test(part) || WINDOWS_NAME.test(part))) throw new SetupIoError("UNSAFE_ARCHIVE", "Archive contains an unsafe path component.", { path: name });
  return normalized;
}

function completeManifest(manifest, limits) {
  const paths = new Map();
  let extractedBytes = 0;
  for (const entry of manifest) {
    entry.path = archiveName(entry.path);
    const identity = entry.path.toLowerCase();
    if (paths.has(identity)) throw new SetupIoError("UNSAFE_ARCHIVE", "Archive contains duplicate or case-aliased paths.", { path: entry.path });
    paths.set(identity, entry.directory);
    extractedBytes += entry.size;
    if (entry.size > limits.fileBytes || extractedBytes > limits.extractedBytes || paths.size > limits.entries) throw new SetupIoError("SIZE_LIMIT", "Archive exceeds its extraction limits.");
  }
  for (const entry of manifest) {
    const parts = entry.path.toLowerCase().split("/");
    for (let count = 1; count < parts.length; count++) if (paths.get(parts.slice(0, count).join("/")) === false) throw new SetupIoError("UNSAFE_ARCHIVE", "Archive uses a file as a directory.", { path: entry.path });
  }
  if (!manifest.length) throw new SetupIoError("UNSAFE_ARCHIVE", "Archive is empty.");
  return { entries: manifest.length, extractedBytes, manifest };
}

class StreamReader {
  constructor(stream, signal) { this.iterator = stream[Symbol.asyncIterator](); this.buffer = Buffer.alloc(0); this.offset = 0; this.signal = signal; }
  async read(size, optional = false) {
    checkSetupAbort(this.signal);
    const chunks = [];
    let remaining = size;
    while (remaining) {
      if (this.offset === this.buffer.length) {
        const next = await this.iterator.next();
        if (next.done) { if (optional && remaining === size) return undefined; throw new SetupIoError("INVALID_ARCHIVE", "Archive ended inside an entry."); }
        this.buffer = next.value; this.offset = 0;
      }
      const count = Math.min(remaining, this.buffer.length - this.offset);
      chunks.push(this.buffer.subarray(this.offset, this.offset + count));
      this.offset += count; remaining -= count;
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size);
  }
}

const textField = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0)));
function tarNumber(bytes) {
  const value = bytes.toString("ascii").replace(/\0.*$/su, "").trim();
  if (!/^[0-7]*$/u.test(value)) throw new SetupIoError("INVALID_ARCHIVE", "Unsupported TAR numeric field.");
  const number = value ? parseInt(value, 8) : 0;
  if (!Number.isSafeInteger(number) || number < 0) throw new SetupIoError("SIZE_LIMIT", "TAR numeric field exceeds limits.");
  return number;
}

function paxValues(bytes) {
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const rawLength = bytes.subarray(offset, space).toString("ascii");
    if (space < 0 || !/^[1-9]\d*$/u.test(rawLength)) throw new SetupIoError("INVALID_ARCHIVE", "Malformed TAR extended header.");
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < space - offset + 3 || offset + length > bytes.length || bytes[offset + length - 1] !== 10) throw new SetupIoError("INVALID_ARCHIVE", "Malformed TAR extended-header length.");
    const record = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(space + 1, offset + length - 1));
    const equal = record.indexOf("=");
    if (equal < 1) throw new SetupIoError("INVALID_ARCHIVE", "Malformed TAR extended-header value.");
    const name = record.slice(0, equal);
    if (!["path", "mtime", "atime", "ctime", "comment", "uid", "gid", "uname", "gname"].includes(name)) throw new SetupIoError("UNSAFE_ARCHIVE", "Unsupported TAR extended-header semantics.", { field: name });
    values[name] = record.slice(equal + 1);
    offset += length;
  }
  return values;
}

async function visitTar(filename, { signal, limits }, visitor) {
  const input = createReadStream(filename, { signal });
  const gunzip = createGunzip();
  let expanded = 0;
  const bounded = new Transform({ transform(chunk, _encoding, callback) { expanded += chunk.length; callback(expanded > limits.extractedBytes + limits.entries * 2048 ? new SetupIoError("SIZE_LIMIT", "Expanded TAR exceeds its bound.") : null, chunk); } });
  // The pending pipeline is always observed, including a validation failure mid-stream.
  const completion = pipeline(input, gunzip, bounded).catch((error) => error);
  const reader = new StreamReader(bounded, signal);
  let pending = {};
  let longName;
  let physicalEntries = 0;
  try {
    for (;;) {
      const header = await reader.read(512, true);
      if (!header) throw new SetupIoError("INVALID_ARCHIVE", "TAR is missing its end marker.");
      if (header.every((byte) => byte === 0)) {
        const second = await reader.read(512);
        if (!second.every((byte) => byte === 0)) throw new SetupIoError("INVALID_ARCHIVE", "TAR contains an invalid end marker.");
        for (;;) { const trailing = await reader.read(512, true); if (!trailing) break; if (!trailing.every((byte) => byte === 0)) throw new SetupIoError("INVALID_ARCHIVE", "TAR contains data after its end marker."); }
        if (Object.keys(pending).length || longName !== undefined) throw new SetupIoError("INVALID_ARCHIVE", "TAR ends with an unapplied extended header.");
        break;
      }
      if (++physicalEntries > limits.entries * 3) throw new SetupIoError("SIZE_LIMIT", "TAR contains too many physical entries.");
      const expectedChecksum = tarNumber(header.subarray(148, 156));
      let checksum = 0;
      for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index];
      if (checksum !== expectedChecksum) throw new SetupIoError("INVALID_ARCHIVE", "TAR header checksum mismatch.");
      const size = tarNumber(header.subarray(124, 136));
      if (size > limits.fileBytes) throw new SetupIoError("SIZE_LIMIT", "TAR member exceeds its size limit.");
      const type = String.fromCharCode(header[156] || 48);
      let file;
      if (["x", "g", "L"].includes(type)) {
        if (size > 65536) throw new SetupIoError("SIZE_LIMIT", "TAR extended header is oversized.");
        const bytes = size ? await reader.read(size) : Buffer.alloc(0);
        if (type === "L") longName = textField(bytes).replace(/\n$/u, "");
        else {
          const values = paxValues(bytes);
          if (type === "g" && values.path !== undefined) throw new SetupIoError("UNSAFE_ARCHIVE", "Global TAR path overrides are unsupported.");
          if (type === "x") pending = { ...pending, ...values };
        }
      } else {
        if (["1", "2", "K"].includes(type)) throw new SetupIoError("UNSUPPORTED_ARCHIVE_LINK", "Archive contains a link; generic setup extraction does not follow links.");
        if (!["0", "5"].includes(type)) throw new SetupIoError("UNSAFE_ARCHIVE", "Archive contains a non-file entry.", { type });
        const prefix = header.subarray(257, 263).toString("ascii").startsWith("ustar") ? textField(header.subarray(345, 500)) : "";
        const name = pending.path ?? longName ?? [prefix, textField(header.subarray(0, 100))].filter(Boolean).join("/");
        const entry = { path: archiveName(name), directory: type === "5", size, mode: tarNumber(header.subarray(100, 108)) & 0o111 ? 0o755 : 0o644 };
        if (entry.directory && size) throw new SetupIoError("INVALID_ARCHIVE", "TAR directory has a payload.");
        pending = {}; longName = undefined;
        file = await visitor(entry);
        try {
          for (let remaining = size; remaining > 0;) {
            const bytes = await reader.read(Math.min(65536, remaining));
            if (file) await writeAll(file, bytes);
            remaining -= bytes.length;
          }
        } finally { await file?.close(); }
      }
      if (size % 512) await reader.read(512 - (size % 512));
    }
    const failure = await completion;
    if (failure instanceof Error) throw failure;
  } finally { input.destroy(); gunzip.destroy(); bounded.destroy(); await completion; }
}

async function writeAll(handle, bytes) {
  for (let offset = 0; offset < bytes.length;) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset); if (!bytesWritten) throw new SetupIoError("WRITE_FAILED", "Setup write did not make progress."); offset += bytesWritten; }
}

export async function inspectTarArchive(filename, { signal, limits = SETUP_IO_LIMITS } = {}) {
  const manifest = [];
  await setupSha256File(filename, limits.archiveBytes);
  await visitTar(filename, { signal, limits }, async (entry) => { manifest.push(entry); if (manifest.length > limits.entries) throw new SetupIoError("SIZE_LIMIT", "Archive has too many entries."); });
  return completeManifest(manifest, limits);
}

async function readAt(handle, count, offset) {
  const bytes = Buffer.alloc(count);
  let read = 0;
  while (read < count) { const result = await handle.read(bytes, read, count - read, offset + read); if (!result.bytesRead) throw new SetupIoError("INVALID_ARCHIVE", "ZIP ended inside an entry."); read += result.bytesRead; }
  return bytes;
}

/** Validate central AND local headers before any extraction writes. */
export async function inspectZipArchive(filename, { signal, limits = SETUP_IO_LIMITS } = {}) {
  await setupSha256File(filename, limits.archiveBytes);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = await handle.stat();
    if (metadata.size < 22) throw new SetupIoError("INVALID_ARCHIVE", "ZIP is too short.");
    const tail = await readAt(handle, Math.min(metadata.size, 65557), Math.max(0, metadata.size - 65557));
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
    if (end < 0) throw new SetupIoError("INVALID_ARCHIVE", "ZIP has no valid central-directory trailer.");
    const count = tail.readUInt16LE(end + 10);
    const centralSize = tail.readUInt32LE(end + 12);
    const centralOffset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || count !== tail.readUInt16LE(end + 8) || !count || count > limits.entries || count === 0xffff || centralSize > limits.directoryBytes || centralOffset === 0xffffffff || centralOffset + centralSize !== metadata.size - tail.length + end) throw new SetupIoError("INVALID_ARCHIVE", "ZIP uses an unsupported multi-disk, ZIP64, or oversized layout.");
    const central = await readAt(handle, centralSize, centralOffset);
    const manifest = [];
    const spans = [];
    let offset = 0;
    for (let index = 0; index < count; index++) {
      checkSetupAbort(signal);
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) throw new SetupIoError("INVALID_ARCHIVE", "Malformed ZIP central-directory entry.");
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const crc = central.readUInt32LE(offset + 16);
      const compressedSize = central.readUInt32LE(offset + 20);
      const size = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const next = offset + 46 + nameLength + extraLength + central.readUInt16LE(offset + 32);
      const attributes = central.readUInt32LE(offset + 38);
      const localOffset = central.readUInt32LE(offset + 42);
      const unixType = (attributes >>> 16) & 0o170000;
      if (unixType === 0o120000 || (attributes & 0x400)) throw new SetupIoError("UNSUPPORTED_ARCHIVE_LINK", "ZIP contains a link or reparse point; generic setup extraction does not follow links.");
      if (unixType && unixType !== 0o100000 && unixType !== 0o040000) throw new SetupIoError("UNSAFE_ARCHIVE", "ZIP contains a non-file entry.");
      if (next > central.length || flags & ~0x080e || ![0, 8].includes(method) || central.readUInt16LE(offset + 34) || compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || localOffset + 30 > centralOffset || size > limits.fileBytes) throw new SetupIoError("INVALID_ARCHIVE", "ZIP member uses unsupported encryption, compression, or size semantics.");
      const rawName = central.subarray(offset + 46, offset + 46 + nameLength);
      const name = new TextDecoder("utf-8", { fatal: true }).decode(rawName);
      const directory = name.endsWith("/");
      if ((directory && size) || (!directory && unixType === 0o040000)) throw new SetupIoError("INVALID_ARCHIVE", "ZIP directory metadata disagrees with its path.");
      const local = await readAt(handle, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(26) !== nameLength) throw new SetupIoError("INVALID_ARCHIVE", "ZIP local and central headers disagree.");
      const localName = await readAt(handle, nameLength, localOffset + 30);
      if (!localName.equals(rawName)) throw new SetupIoError("UNSAFE_ARCHIVE", "ZIP local and central paths disagree.");
      const dataOffset = localOffset + 30 + nameLength + local.readUInt16LE(28);
      let dataEnd = dataOffset + compressedSize;
      if (dataEnd > centralOffset) throw new SetupIoError("INVALID_ARCHIVE", "ZIP member data overlaps its central directory.");
      if (flags & 8) {
        const first = await readAt(handle, 4, dataEnd);
        const descriptor = await readAt(handle, first.readUInt32LE(0) === 0x08074b50 ? 16 : 12, dataEnd);
        const start = descriptor.length === 16 ? 4 : 0;
        if (descriptor.readUInt32LE(start) !== crc || descriptor.readUInt32LE(start + 4) !== compressedSize || descriptor.readUInt32LE(start + 8) !== size) throw new SetupIoError("INVALID_ARCHIVE", "ZIP data descriptor disagrees with its central directory.");
        dataEnd += descriptor.length;
      } else if (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressedSize || local.readUInt32LE(22) !== size) throw new SetupIoError("INVALID_ARCHIVE", "ZIP local sizes or checksum disagree with its central directory.");
      if (dataEnd > centralOffset || (method === 0 && compressedSize !== size)) throw new SetupIoError("INVALID_ARCHIVE", "ZIP has invalid payload bounds.");
      spans.push([localOffset, dataEnd]);
      manifest.push({ path: name, directory, size, compressedSize, dataOffset, method, crc, mode: ((attributes >>> 16) & 0o111) ? 0o755 : 0o644 });
      offset = next;
    }
    if (offset !== central.length) throw new SetupIoError("INVALID_ARCHIVE", "ZIP central directory contains trailing entries.");
    spans.sort(([left], [right]) => left - right);
    for (let index = 1; index < spans.length; index++) if (spans[index][0] < spans[index - 1][1]) throw new SetupIoError("UNSAFE_ARCHIVE", "ZIP entries overlap.");
    return completeManifest(manifest, limits);
  } finally { await handle.close(); }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, number) => { let value = number; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function setupCrc32(bytes, previous = 0) { let crc = previous ^ 0xffffffff; for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

async function extractionFile(ownedRoot, destination, entry) {
  const filename = path.join(destination, ...entry.path.split("/"));
  await ensureOwnedDirectory(ownedRoot, entry.directory ? filename : path.dirname(filename));
  if (entry.directory) return undefined;
  await assertOwnedPath(ownedRoot, filename, { allowMissing: true });
  return open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), entry.mode);
}

/** No extraction begins until the entire archive's entry map passes preflight. */
export async function extractArchive(filename, destination, context, { format, limits = SETUP_IO_LIMITS } = {}) {
  checkSetupAbort(context.signal);
  const kind = format ?? (/\.zip$/iu.test(filename) ? "zip" : /\.(?:tar\.gz|tgz)$/iu.test(filename) ? "tar.gz" : undefined);
  if (!kind) throw new SetupIoError("INVALID_ARCHIVE", "Setup archive format must be ZIP or gzip TAR.");
  await assertOwnedPath(context.setupRoot, filename);
  await assertOwnedPath(context.setupRoot, destination, { allowMissing: true });
  if (await metadata(destination)) throw new SetupIoError("DESTINATION_EXISTS", "Archive extraction requires a fresh, absent destination.", { path: destination });
  const before = await setupSha256File(filename, limits.archiveBytes);
  const options = { signal: context.signal, limits };
  const inspected = kind === "zip" ? await inspectZipArchive(filename, options) : await inspectTarArchive(filename, options);
  await ensureOwnedDirectory(context.setupRoot, path.dirname(destination));
  await mkdir(destination, { mode: 0o700 });
  progress(context, { phase: "extract-start", archive: path.basename(filename), entries: inspected.entries, extractedBytes: inspected.extractedBytes });
  if (kind === "tar.gz") {
    let index = 0;
    await visitTar(filename, options, async (entry) => {
      if (JSON.stringify(entry) !== JSON.stringify(inspected.manifest[index++])) throw new SetupIoError("FILE_CHANGED", "TAR changed after preflight.");
      return extractionFile(context.setupRoot, destination, entry);
    });
    if (index !== inspected.entries) throw new SetupIoError("FILE_CHANGED", "TAR entry count changed after preflight.");
  } else {
    for (const entry of inspected.manifest) {
      checkSetupAbort(context.signal);
      const file = await extractionFile(context.setupRoot, destination, entry);
      if (!file) continue;
      let input;
      let inflate;
      let bounded;
      try {
        let bytes = 0; let crc = 0;
        input = entry.compressedSize ? createReadStream(filename, { start: entry.dataOffset, end: entry.dataOffset + entry.compressedSize - 1, signal: context.signal }) : Readable.from([]);
        bounded = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; crc = setupCrc32(chunk, crc); callback(bytes > entry.size ? new SetupIoError("SIZE_LIMIT", "ZIP inflated beyond its declared size.") : null, chunk); } });
        const stream = entry.method === 8 ? [input, inflate = createInflateRaw(), bounded] : [input, bounded];
        const completion = pipeline(...stream).catch((error) => error);
        try { for await (const chunk of bounded) await writeAll(file, chunk); } finally { input.destroy(); inflate?.destroy(); bounded.destroy(); const error = await completion; if (error instanceof Error) throw error; }
        if (bytes !== entry.size || crc !== entry.crc) throw new SetupIoError("CHECKSUM_MISMATCH", "ZIP member size or CRC does not match its header.", { path: entry.path });
      } finally { input?.destroy(); inflate?.destroy(); bounded?.destroy(); await file.close(); }
    }
  }
  const after = await setupSha256File(filename, limits.archiveBytes);
  if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) throw new SetupIoError("FILE_CHANGED", "Archive changed while extracting.");
  return { path: destination, entries: inspected.entries, extractedBytes: inspected.extractedBytes, archiveSha256: before.sha256 };
}

/** Copy only regular files/directories, never links; destination must not exist. */
export async function copySetupTree(source, destination, context, { sourceRoot = context.setupRoot, limits = SETUP_IO_LIMITS } = {}) {
  await assertOwnedPath(sourceRoot, source);
  await assertOwnedPath(context.setupRoot, destination, { allowMissing: true });
  if (await metadata(destination)) throw new SetupIoError("DESTINATION_EXISTS", "Setup copy requires a fresh destination.", { path: destination });
  const records = [];
  let totalBytes = 0;
  async function visit(current, relative) {
    checkSetupAbort(context.signal);
    await assertOwnedPath(sourceRoot, current);
    const entry = await lstat(current);
    if (!entry.isDirectory() && !entry.isFile()) throw new SetupIoError("UNSAFE_PATH", "Setup copy refuses non-file entries.", { path: current });
    if (relative) archiveName(relative);
    records.push({ relative, directory: entry.isDirectory(), size: entry.size, mode: entry.mode & 0o111 ? 0o755 : 0o644 });
    if (records.length > limits.entries) throw new SetupIoError("SIZE_LIMIT", "Setup tree has too many entries.");
    if (entry.isDirectory()) for (const name of (await readdir(current)).sort()) await visit(path.join(current, name), relative ? relative + "/" + name : name);
    else { totalBytes += entry.size; if (entry.size > limits.fileBytes || totalBytes > limits.extractedBytes) throw new SetupIoError("SIZE_LIMIT", "Setup tree exceeds its copy limits."); }
  }
  await visit(source, "");
  for (const entry of records) {
    checkSetupAbort(context.signal);
    const output = path.join(destination, ...entry.relative.split("/").filter(Boolean));
    if (entry.directory) await ensureOwnedDirectory(context.setupRoot, output);
    else {
      await ensureOwnedDirectory(context.setupRoot, path.dirname(output));
      const input = path.join(source, ...entry.relative.split("/").filter(Boolean));
      await assertOwnedPath(sourceRoot, input);
      const sourceFile = await open(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let outputFile;
      try { outputFile = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), entry.mode); const before = await sourceFile.stat(); let count = 0; for await (const chunk of sourceFile.createReadStream({ autoClose: false })) { count += chunk.length; if (count > entry.size) throw new SetupIoError("FILE_CHANGED", "Setup source changed during copy."); await writeAll(outputFile, chunk); } const after = await sourceFile.stat(); if (count !== entry.size || before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new SetupIoError("FILE_CHANGED", "Setup source changed during copy."); }
      finally { await sourceFile.close(); await outputFile?.close(); }
    }
  }
  return { path: destination, entries: records.length, bytes: totalBytes };
}

/** Child-specific environment: no user package-manager config, hooks, or injection. */
export async function setupEnvironment(context) {
  const names = ["tmp", "cache", "cache/npm", "cache/node-gyp", "cache/yarn-global", "cache/uv", "config", "config/xdg", "data", "data/xdg", "python", "bin", "uv-tools"];
  for (const name of names) await ensureOwnedDirectory(context.setupRoot, path.join(context.setupRoot, ...name.split("/")));
  // npm refuses loading one physical file at both user and global precedence.
  const userConfig = path.join(context.setupRoot, "config", "empty-user-npmrc");
  const globalConfig = path.join(context.setupRoot, "config", "empty-global-npmrc");
  for (const config of [userConfig, globalConfig]) {
    if (!(await metadata(config))) await writeFile(config, "", { flag: "wx", mode: 0o600 });
    await assertOwnedPath(context.setupRoot, config);
    const configuration = await lstat(config);
    if (!configuration.isFile() || configuration.size !== 0) throw new SetupIoError("UNSAFE_CONFIGURATION", "Owned empty package-manager configuration was modified.", { path: config });
  }
  const original = new Map();
  for (const [name, value] of Object.entries(context.environment ?? process.env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (context.platform === "win32" && original.has(upper) && original.get(upper) !== value) throw new SetupIoError("UNSAFE_CONFIGURATION", "Conflicting Windows environment aliases.", { name: upper });
    original.set(upper, String(value));
  }
  const env = {};
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) if (original.has(name)) env[name] = original.get(name);
  const windows = context.platform === "win32";
  let executables;
  if (windows) {
    const system = original.get("SYSTEMROOT");
    if (!system || !path.isAbsolute(system)) throw new SetupIoError("MISSING_PREREQUISITE", "Windows setup requires an explicit absolute SystemRoot.");
    env.SystemRoot = system; env.WINDIR = system; env.COMSPEC = path.join(system, "System32", "cmd.exe");
    executables = [path.dirname(context.nodeExecutable), path.join(system, "System32"), system];
  } else executables = [path.dirname(context.nodeExecutable), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  Object.assign(env, {
    PATH: executables.join(windows ? ";" : ":"),
    TMP: path.join(context.setupRoot, "tmp"), TEMP: path.join(context.setupRoot, "tmp"), TMPDIR: path.join(context.setupRoot, "tmp"),
    XDG_CACHE_HOME: path.join(context.setupRoot, "cache"), XDG_CONFIG_HOME: path.join(context.setupRoot, "config", "xdg"), XDG_DATA_HOME: path.join(context.setupRoot, "data", "xdg"),
    APPDATA: path.join(context.setupRoot, "config"), LOCALAPPDATA: path.join(context.setupRoot, "cache"),
    npm_config_cache: path.join(context.setupRoot, "cache", "npm"), npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_devdir: path.join(context.setupRoot, "cache", "node-gyp"), npm_config_registry: "https://registry.npmjs.org/", npm_config_audit: "false", npm_config_fund: "false",
    YARN_RC_FILENAME: ".codex-setup-yarnrc.yml", YARN_ENABLE_GLOBAL_CACHE: "true", YARN_GLOBAL_FOLDER: path.join(context.setupRoot, "cache", "yarn-global"), YARN_NODE_LINKER: "node-modules", YARN_NPM_REGISTRY_SERVER: "https://registry.npmjs.org", YARN_ENABLE_TELEMETRY: "0", YARN_CHECKSUM_BEHAVIOR: "throw", YARN_ENABLE_IMMUTABLE_INSTALLS: "true",
    UV_CACHE_DIR: path.join(context.setupRoot, "cache", "uv"), UV_PYTHON_INSTALL_DIR: path.join(context.setupRoot, "python"), UV_PYTHON_BIN_DIR: path.join(context.setupRoot, "bin"), UV_PYTHON_INSTALL_BIN: "0", UV_PYTHON_INSTALL_REGISTRY: "0", UV_TOOL_DIR: path.join(context.setupRoot, "uv-tools"), UV_TOOL_BIN_DIR: path.join(context.setupRoot, "bin"), UV_NO_CONFIG: "1", UV_NO_SOURCES: "1", UV_NO_PROGRESS: "1", UV_LINK_MODE: "copy", UV_PYTHON_PREFERENCE: "only-managed", UV_INDEX_URL: "https://pypi.org/simple",
    PIP_CONFIG_FILE: userConfig, PIP_DISABLE_PIP_VERSION_CHECK: "1", PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONSAFEPATH: "1", ELECTRON_SKIP_BINARY_DOWNLOAD: "1", NO_COLOR: "1", CI: "1",
  });
  return env;
}

async function killTree(child, force, options) {
  if (!child.pid) return;
  if (options.platform !== "win32") {
    const alive = () => { try { process.kill(-child.pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
    const send = (signal) => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
    if (!alive()) return;
    const started = Date.now();
    send(force ? "SIGKILL" : "SIGTERM");
    let escalated = force;
    while (alive()) {
      const elapsed = Date.now() - started;
      if (!escalated && elapsed >= 1500) { send("SIGKILL"); escalated = true; }
      if (elapsed >= 6500) throw new SetupIoError("PROCESS_CLEANUP_UNCONFIRMED", "The owned setup process group is still present after cancellation.", { pid: child.pid });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return;
  }
  const command = path.join(options.env.SystemRoot, "System32", "taskkill.exe");
  await new Promise((resolve, reject) => {
    // Windows has no POSIX group signal. Force the explicitly owned tree rather
    // than relying on GUI close messages that cannot stop headless installers.
    const killer = spawn(command, ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore", env: options.env });
    const timer = setTimeout(() => { killer.kill(); reject(new Error("taskkill did not complete")); }, 5000);
    killer.once("error", (error) => { clearTimeout(timer); reject(error); });
    killer.once("close", (code) => { clearTimeout(timer); if (code === 0 || code === 128) resolve(); else reject(new Error("taskkill exited " + code)); });
  });
}

/** Bounded logs and cancellation of the owned process group, not only its shell. */
export async function runSetupCommand(command, args, options = {}) {
  const { cwd, env, signal, onProgress, timeoutMs = 30 * 60_000, maxOutputBytes = 65536, platform = process.platform, spawnImpl = spawn, terminateTree = killTree } = options;
  checkSetupAbort(signal);
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1024 * 1024 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60 * 60_000) throw new SetupIoError("INVALID_COMMAND", "Setup command output/time limits are invalid.");
  if (!path.isAbsolute(command) || !path.isAbsolute(cwd) || !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new SetupIoError("INVALID_COMMAND", "Setup subprocesses require explicit absolute executable/cwd paths and string arguments.");
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let truncated = false; let primary; let closed = false; let settled = false; let escalation; let cleanupDeadline;
    const cleanupErrors = []; const cleanup = [];
    let child;
    try { child = spawnImpl(command, args, { cwd, env, shell: false, windowsHide: true, detached: platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { reject(new SetupIoError("COMMAND_SPAWN_FAILED", "The selected setup executable could not be started.", { exitObserved: true, execution: "not-started", cleanupErrors: [] }, error)); return; }
    const label = options.label ?? path.basename(command);
    const started = Date.now();
    const capture = (which, chunk) => { const combined = Buffer.concat([which === "stdout" ? stdout : stderr, Buffer.from(chunk)]); if (combined.length > maxOutputBytes) truncated = true; const tail = combined.subarray(Math.max(0, combined.length - maxOutputBytes)); if (which === "stdout") stdout = tail; else stderr = tail; };
    child.stdout?.on("data", (chunk) => capture("stdout", chunk)); child.stderr?.on("data", (chunk) => capture("stderr", chunk));
    const finish = async (code, exitSignal, exitObserved) => {
      if (settled) return; settled = true;
      clearTimeout(timeout); clearInterval(heartbeat); clearTimeout(escalation); clearTimeout(cleanupDeadline); signal?.removeEventListener("abort", abort);
      await Promise.allSettled(cleanup);
      const result = { stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), outputTruncated: truncated, exitCode: code, signal: exitSignal, leaderExitObserved: exitObserved, exitObserved: exitObserved && cleanupErrors.length === 0, pid: child.pid, cleanupErrors, cleanupMechanism: platform === "win32" ? "windows-taskkill-tree" : "unix-process-group" };
      if (primary || code !== 0 || cleanupErrors.length) reject(new SetupIoError(primary?.code ?? (cleanupErrors.length ? "PROCESS_CLEANUP_UNCONFIRMED" : "COMMAND_FAILED"), primary?.message ?? `${label} exited with ${code ?? exitSignal ?? "unknown status"}; cleanup failures: ${cleanupErrors.join("; ")}.`, { ...result, label }, primary));
      else resolve(result);
    };
    const terminate = (force) => { const promise = Promise.resolve().then(() => terminateTree(child, force, { ...options, platform, env })).catch((error) => { cleanupErrors.push(String(error.message ?? error)); try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch (fallback) { cleanupErrors.push(String(fallback.message ?? fallback)); } }); cleanup.push(promise); };
    const stop = (error) => { if (primary || closed) return; primary = error; terminate(false); escalation = setTimeout(() => { if (!closed) terminate(true); }, 1500); cleanupDeadline = setTimeout(() => { if (!closed) void finish(undefined, undefined, false); }, 8000); };
    const abort = () => stop(new SetupIoError("ABORT_ERR", `${label} was cancelled; waiting for owned subprocess cleanup.`));
    const emit = (event) => { try { onProgress?.(event); } catch (error) { stop(new SetupIoError("PROGRESS_FAILED", "Setup progress reporting failed; the owned subprocess is being stopped.", {}, error)); } };
    const timeout = setTimeout(() => stop(new SetupIoError("COMMAND_TIMEOUT", `${label} exceeded its setup time limit.`)), timeoutMs);
    const heartbeat = setInterval(() => emit({ phase: "command-running", label, elapsedMs: Date.now() - started }), 15000);
    timeout.unref?.(); heartbeat.unref?.();
    child.once("error", (error) => {
      if (!child.pid) { primary ??= error; void finish(undefined, undefined, true); }
      else stop(error);
    });
    child.once("close", (code, exitSignal) => {
      closed = true;
      // A normal leader exit must not leave daemonized children in its owned
      // Unix process group. Cancellation already has a group cleanup in flight.
      if (child.pid && cleanup.length === 0 && platform !== "win32") terminate(true);
      void finish(code, exitSignal, true);
    });
    signal?.addEventListener("abort", abort, { once: true });
    emit({ phase: "command-start", label, pid: child.pid });
    if (signal?.aborted) abort();
  });
}

export async function writeSetupJson(root, filename, value) {
  await assertOwnedPath(root, filename, { allowMissing: true });
  await ensureOwnedDirectory(root, path.dirname(filename));
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { path: filename, sha256: digest(Buffer.from(JSON.stringify(value, null, 2) + "\n")) };
}

export async function makeSetupExecutable(root, filename) { await assertOwnedPath(root, filename); if (!(await lstat(filename)).isFile()) throw new SetupIoError("INVALID_FILE", "Expected a regular executable file.", { path: filename }); await chmod(filename, 0o755); }
