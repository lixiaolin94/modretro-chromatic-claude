import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Stats } from "node:fs";
import type { ChromaticTargetOptions } from "./chromatic-runtime.mjs";

export interface ChromaticErrorFields {
  name: string;
  message: string;
  code?: string | number;
  errno?: string | number;
  syscall?: string;
  path?: string;
}
export interface ChromaticProcessBoundary { code: number | null; signal: string | null; at: string }
export interface ChromaticStream {
  text: string;
  bytes: number;
  retainedBytes: number;
  truncated: boolean;
  endObserved: boolean;
  closeObserved: boolean;
  utf8Valid: boolean;
  error?: ChromaticErrorFields;
}
export interface ChromaticProcessResult {
  command: string;
  args: string[];
  version: string;
  target: string;
  startedAt: string;
  pid?: number;
  spawn?: { at: string; pid?: number };
  error?: ChromaticErrorFields;
  exit?: ChromaticProcessBoundary;
  close: ChromaticProcessBoundary;
  stdout: ChromaticStream;
  stderr: ChromaticStream;
  interruptions: string[];
  observationErrors: ChromaticErrorFields[];
  observationCounts?: { failedCallbacks: number; skippedCallbacks: number };
  elevation?: { method: "polkit" | "windows-run-as"; operationId: string; requestedExecutable: string; requestedArgs: string[]; sha256?: string; outputScope: string; note: string };
}
export interface ChromaticProcessEvent { type: string; [key: string]: unknown }
export class ChromaticNotStartedError extends Error {
  readonly code: string;
  constructor(error: unknown);
}
export interface ChromaticRunOptions extends ChromaticTargetOptions {
  root?: string;
  spawnChild?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  signalSource?: EventEmitter;
  resolveElevationExecutable?: (platform: string, environment: NodeJS.ProcessEnv) => string;
  operationId?: string;
}
export function systemElevationExecutable(platform: string, environment: NodeJS.ProcessEnv, filesystem?: {
  lstat?: (filename: string) => Pick<Stats, "isSymbolicLink" | "isFile" | "isDirectory" | "nlink" | "uid" | "mode">;
  realpath?: (filename: string) => string;
}): string;
export function chromaticInvocation(runtime: { executable: string; platform: string }, args: string[], options?: {
  platform?: string; environment?: NodeJS.ProcessEnv; operationId?: string;
  resolveElevationExecutable?: (platform: string, environment: NodeJS.ProcessEnv) => string;
}): { command: string; args: string[]; environment: NodeJS.ProcessEnv; elevation?: NonNullable<ChromaticProcessResult["elevation"]> };
export const CHROMATIC_STREAM_LIMIT: number;
export const CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS: number;
export const CHROMATIC_LIVE_MIN_DURATION_SECONDS: number;
export const CHROMATIC_LIVE_MAX_DURATION_SECONDS: number;
export function validateChromaticArguments(args: string[]): string[];
export function runChromatic(args: string[], options?: ChromaticRunOptions): Promise<{
  code: number | null; signal: string | null; pid?: number; interruptions: string[];
}>;
export function runChromaticCaptured(args: string[], options?: ChromaticRunOptions & {
  onEvent?: (event: ChromaticProcessEvent) => void;
  onOutput?: (stream: "stdout" | "stderr", bytes: Buffer) => void;
}): Promise<ChromaticProcessResult>;
