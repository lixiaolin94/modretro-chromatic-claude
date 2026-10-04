export type ChromaticTarget = "darwin-arm64" | "darwin-x64" | "linux-arm64-gnu" | "linux-x64-gnu" | "win32-arm64" | "win32-x64";
export const CHROMATIC_VERSION: "1.2.1";
export const CHROMATIC_ROOT: "third-party/chromatic-cli";
export const CHROMATIC_TARGETS: Readonly<Record<ChromaticTarget, string>>;
export const CHROMATIC_MEMBERS: Readonly<Record<string, { readonly size: number; readonly sha256: string; readonly mode: number }>>;
export const CHROMATIC_FILES: Readonly<Record<string, string>>;
export const CHROMATIC_REQUIRED_PATHS: readonly string[];
export type ChromaticFormat = "brotli-concat-v1" | "brotli-concat-v2";
export const CHROMATIC_PACKED: Readonly<{ format: ChromaticFormat; member: string; source: string; size: number; sha256: string; mode: number; decodedSize: number; windowBytes: number }>;
export const CHROMATIC_PACKED_V2: typeof CHROMATIC_PACKED;
export const CHROMATIC_NOTICE_PACK: Omit<typeof CHROMATIC_PACKED, "format">;
export const CHROMATIC_ARTWORK_PACK: Omit<typeof CHROMATIC_PACKED, "format">;
export const CHROMATIC_ARTWORK_MEMBERS: typeof CHROMATIC_MEMBERS;
export const CHROMATIC_STORAGE_SOURCES: readonly string[];
export interface ChromaticTargetOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  glibcVersion?: string;
}
export function chromaticDiskMode(mode: number, platform?: NodeJS.Platform): number;
export function chromaticTargetFromManifest(manifest: unknown): ChromaticTarget | undefined;
export function chromaticFormatFromManifest(manifest: unknown): ChromaticFormat | undefined;
export function chromaticRequiredPaths(target?: ChromaticTarget, format?: ChromaticFormat): readonly string[];
export function decodeChromaticExecutables(bytes: Buffer, format?: ChromaticFormat): Map<ChromaticTarget, Buffer>;
export function decodeChromaticNotices(bytes: Buffer): Map<ChromaticTarget, Buffer>;
export function decodeDeviceArtwork(bytes: Buffer): Map<string, Buffer>;
export function readChromaticPackageFormat(root?: string): ChromaticFormat | undefined;
export function readChromaticNotices(target: ChromaticTarget, options?: { root?: string }): Buffer;
export function readPackedDeviceArtwork(directory: string): Map<string, Buffer>;
export function materializeChromaticExecutable(target: ChromaticTarget, bytes: Buffer, options?: { cacheRoot?: string; notices?: Buffer }): string;
export function selectChromaticTarget(options?: ChromaticTargetOptions): ChromaticTarget;
export function requireChromaticHostTarget(target: ChromaticTarget | undefined, options?: ChromaticTargetOptions): ChromaticTarget | undefined;
export function verifyChromaticRecords(records: readonly {
  path: string; mode: number; contents?: Buffer; bytes?: Buffer;
}[], options?: { platform?: NodeJS.Platform; target?: ChromaticTarget; format?: ChromaticFormat }): void;
export function verifyChromaticBundle(root?: string, options?: { target?: ChromaticTarget; format?: ChromaticFormat }): {
  version: string; files: string[];
};
export function resolveChromaticRuntime(options?: ChromaticTargetOptions & { root?: string }): {
  version: string; files: string[]; platform: ChromaticTarget; executable: string;
};
