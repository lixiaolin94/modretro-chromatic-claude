export type DependencyId = "node" | "runtime" | "cli" | "gbdk" | "python" | "pyboy" | "pillow" | "desktop" | "uv";
export type DependencyTask = "authoring" | "projectBuild" | "cBuild" | "play" | "desktop";
export type DependencyProbe = "cli-version" | "gbdk-version" | "emulator-import";
export type DependencyStatus = "ready" | "missing" | "broken" | "incompatible" | "unsupported";
export interface DependencyRoots {
  packageRoot: string;
  runtimeRoot: string;
  toolchainRoot: string;
  setupRoot: string;
  nodeRoot: string;
}
export interface DetectDependenciesOptions extends Partial<DependencyRoots> {
  resolvedRoots?: Partial<DependencyRoots> & { nodeExecutable?: string };
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  nodeExecutable?: string;
  pythonPath?: string;
  tasks?: DependencyTask[];
  requestedTasks?: DependencyTask[];
}
export interface DependencyComponent {
  id: DependencyId;
  status: DependencyStatus;
  requiredVersion: string;
  detectedVersion?: string;
  path?: string;
  provenance: string;
  detectionEvidence: string[];
  probeStatus: "not-run" | "pass" | "fail";
  nextSteps: string[];
  installerOnly?: boolean;
}
export interface DependencyProbeResult {
  name: DependencyProbe;
  components: DependencyId[];
  status: "pass" | "fail";
  executed: boolean;
  output: string;
  error?: string;
  exitObserved?: boolean;
  cleanupErrors?: string[];
}
export interface DependencyReport {
  schemaVersion: 1;
  mode: "detect" | "probe";
  readinessBasis: "compatible-metadata";
  platform: NodeJS.Platform;
  arch: string;
  roots: DependencyRoots;
  requestedTasks: DependencyTask[];
  components: DependencyComponent[];
  tasks: Record<DependencyTask, { ready: boolean; requiredComponents: DependencyId[] }>;
  ready: boolean;
  nextSteps: string[];
  probeResults?: DependencyProbeResult[];
  probesPassed?: boolean;
}
export const DEPENDENCY_TASKS: readonly DependencyTask[];
export const DEPENDENCY_PROBES: readonly DependencyProbe[];
export function detectDependencies(options?: DetectDependenciesOptions): Promise<DependencyReport>;
export function probeDependencies<T extends DependencyReport>(report: T, options: { probes: DependencyProbe[]; signal?: AbortSignal }): Promise<T & { mode: "probe"; probeResults: DependencyProbeResult[]; probesPassed: boolean }>;
