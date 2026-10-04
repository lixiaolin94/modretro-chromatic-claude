import { realpathSync, statSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, realpath, rmdir, stat, unlink, } from "node:fs/promises";
import path from "node:path";
import { discoverProject, GameStudioProjectError, inventoryProject, } from "./project.js";
import { ProjectWorldIndex } from "./project-world-index.js";
import { assertSafePlatformPath } from "./platform.js";
import { readWrecklightTemplate } from "./bundled-template.js";
export const BLANK_PROJECT_GAME_TYPES = ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK"];
export const BLANK_PROJECT_COLOR_MODES = ["mono", "mixed", "color"];
const EXCLUDED_TEMPLATE_DIRECTORIES = new Set([
    ".git",
    ".local",
    "artifacts",
    "build",
    "dist",
    "node_modules",
]);
function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function assertWithin(root, candidate) {
    if (!isWithin(root, candidate)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `The project path must remain inside the authorized workspace: ${candidate}`, candidate);
    }
}
function nonEmptyPath(value, label) {
    if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
        throw new GameStudioProjectError("INVALID_INPUT", `${label} must be a non-empty path`);
    }
    return value.trim();
}
function canonicalDirectory(value, label) {
    const requested = path.resolve(nonEmptyPath(value, label));
    try {
        const canonical = realpathSync(requested);
        if (!statSync(canonical).isDirectory()) {
            throw new Error("not a directory");
        }
        return canonical;
    }
    catch (error) {
        throw new GameStudioProjectError("PROJECT_NOT_FOUND", `${label} must identify an existing directory: ${requested}`, requested);
    }
}
function isMissing(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function isExcludedTemplateEntry(name, directory) {
    if (directory)
        return EXCLUDED_TEMPLATE_DIRECTORIES.has(name);
    return (/\.(?:gb|gbc|tmp|temp|swp)$/iu.test(name) ||
        name === ".DS_Store" ||
        name.startsWith(".~") ||
        name.endsWith("~"));
}
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
async function rememberCreatedDirectory(destination, entries) {
    const identity = await lstat(destination);
    if (!identity.isDirectory() || await realpath(destination) !== destination || (await readdir(destination)).length !== 0) {
        throw new GameStudioProjectError("PROJECT_BUSY", "The new project directory changed before copying began; existing entries were preserved.", destination);
    }
    entries.push({ path: destination, identity });
}
/** Check the owned ancestors before writing or removing an entry in a new project. */
async function assertCreatedParents(entries, destination) {
    for (const entry of entries) {
        if (!entry.identity.isDirectory() || !isWithin(entry.path, destination))
            continue;
        const current = await lstat(entry.path);
        if (!current.isDirectory() || !sameIdentity(current, entry.identity) || await realpath(entry.path) !== entry.path) {
            throw new GameStudioProjectError("UNSAFE_SYMLINK", "A project creation directory changed during the operation.", entry.path);
        }
    }
}
async function writeCreatedFile(destination, bytes, entries) {
    await assertCreatedParents(entries, destination);
    // Exclusive creation never truncates a file introduced by another caller.
    const handle = await open(destination, "wx");
    try {
        const entry = { path: destination, identity: await handle.stat() };
        entries.push(entry);
        try {
            await handle.writeFile(bytes);
        }
        finally {
            entry.identity = await handle.stat();
        }
    }
    finally {
        await handle.close();
    }
}
/** Remove only entries this call created; leave concurrent additions or edits intact. */
async function cleanupCreatedEntries(entries) {
    const errors = [];
    for (const entry of [...entries].reverse()) {
        try {
            await assertCreatedParents(entries, entry.path);
            const current = await lstat(entry.path);
            if (!sameIdentity(current, entry.identity) || current.isSymbolicLink() ||
                (entry.identity.isFile() && (current.size !== entry.identity.size || current.mtimeMs !== entry.identity.mtimeMs))) {
                throw new Error("A created entry changed; it was preserved instead of removed.");
            }
            if (entry.identity.isDirectory())
                await rmdir(entry.path);
            else
                await unlink(entry.path);
        }
        catch (error) {
            if (!isMissing(error))
                errors.push(error);
        }
    }
    return errors;
}
async function assertCompleteCreation(entries) {
    for (const entry of entries) {
        await assertCreatedParents(entries, entry.path);
        const current = await lstat(entry.path);
        if (!sameIdentity(current, entry.identity) || current.isSymbolicLink() ||
            (entry.identity.isFile() && (current.size !== entry.identity.size || current.mtimeMs !== entry.identity.mtimeMs))) {
            throw new GameStudioProjectError("PROJECT_BUSY", "A newly created project entry changed during copying.", entry.path);
        }
        if (entry.identity.isDirectory()) {
            const expected = entries.filter((child) => path.dirname(child.path) === entry.path).map((child) => path.basename(child.path)).sort();
            const actual = (await readdir(entry.path)).sort();
            if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
                throw new GameStudioProjectError("PROJECT_BUSY", "Another writer added or removed project entries during creation.", entry.path);
            }
        }
    }
}
async function copyTrustedTemplate(source, destination, descriptorPath, createdEntries, overrides = new Map()) {
    const entries = await readdir(source, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (isExcludedTemplateEntry(entry.name, entry.isDirectory()))
            continue;
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        const details = await lstat(sourcePath);
        if (details.isSymbolicLink()) {
            throw new GameStudioProjectError("UNSAFE_SYMLINK", `The starter template must not contain symbolic links: ${sourcePath}`, sourcePath);
        }
        if (details.isDirectory()) {
            await assertCreatedParents(createdEntries, destinationPath);
            await mkdir(destinationPath);
            await rememberCreatedDirectory(destinationPath, createdEntries);
            await copyTrustedTemplate(sourcePath, destinationPath, descriptorPath, createdEntries, overrides);
        }
        else if (details.isFile()) {
            // Publish the customized descriptor last, after all editable files exist.
            if (sourcePath !== descriptorPath) {
                await writeCreatedFile(destinationPath, overrides.get(sourcePath) ?? await readFile(sourcePath), createdEntries);
            }
        }
        else {
            throw new GameStudioProjectError("INVALID_PROJECT", `The starter template contains an unsupported filesystem entry: ${sourcePath}`, sourcePath);
        }
    }
}
async function blankProjectOverrides(template, configuration) {
    const inventory = await inventoryProject(template);
    const scene = inventory.scenes[0];
    if (inventory.format !== "distributed" || inventory.scenes.length !== 1 || !scene
        || inventory.settings.startSceneId !== scene.id || scene.actors.length || scene.triggers.length
        || Object.entries(scene).some(([key, value]) => /^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/.test(key)
            && (!Array.isArray(value) || value.length > 0))) {
        throw new GameStudioProjectError("INVALID_BLANK_TEMPLATE", "The blank starter must contain one start scene with no actors, triggers or event scripts.");
    }
    const playerSprites = inventory.settings.defaultPlayerSprites;
    const playerId = playerSprites && typeof playerSprites === "object" && !Array.isArray(playerSprites)
        ? playerSprites[configuration.gameType] : undefined;
    const hasAsset = (id, type) => typeof id === "string"
        && inventory.assets.filter((asset) => asset.id === id && asset.type === type && asset.hasMetadata).length === 1;
    if (inventory.diagnostics.some((diagnostic) => diagnostic.severity === "error")
        || !hasAsset(scene.backgroundId, "background") || !hasAsset(playerId, "sprite")
        || !hasAsset(inventory.settings.defaultFontId, "font")) {
        throw new GameStudioProjectError("INVALID_BLANK_TEMPLATE", "The blank starter must provide valid background, player and font resources for the requested game type.");
    }
    const settingsPath = path.join(template, "project", "settings.gbsres");
    const scenePath = path.join(template, scene.resourcePath);
    const { actors: _actors, triggers: _triggers, resourcePath: _resourcePath, ...sceneData } = scene;
    const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    return new Map([
        [settingsPath, json({ ...inventory.settings, defaultSceneTypeId: configuration.gameType, colorMode: configuration.colorMode })],
        [scenePath, json({ ...sceneData, type: configuration.gameType })],
    ]);
}
async function copyCapturedTemplate(files, destination, createdEntries) {
    const directories = new Set([""]);
    for (const [relative, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        if (relative === "project.gbsproj")
            continue; // Customized descriptor is published last.
        const parts = relative.split("/");
        for (let i = 1; i < parts.length; i++) {
            const directory = parts.slice(0, i).join("/");
            if (directories.has(directory))
                continue;
            const target = path.join(destination, directory);
            await assertCreatedParents(createdEntries, target);
            await mkdir(target);
            await rememberCreatedDirectory(target, createdEntries);
            directories.add(directory);
        }
        await writeCreatedFile(path.join(destination, relative), bytes, createdEntries);
    }
}
/** Owns one explicitly authorized workspace and its selected native game project. */
export class ProjectSession {
    runtimeRoot;
    selectedProject;
    selectionGeneration = 0;
    #configuredProject;
    #bundleRoots;
    #templateSourceRoots = new Set();
    #toolchainRoot;
    #isEmulatorActive;
    #isProjectBusy;
    #workspaceRoot;
    #activeOperations = 0;
    #transitioning = false;
    #worldIndex;
    constructor(options = {}) {
        const runtimeRoot = options.runtimeRoot ?? process.env.GB_STUDIO_RUNTIME_ROOT ?? path.resolve(import.meta.dirname, "..");
        this.runtimeRoot = canonicalDirectory(runtimeRoot, "The runtime root");
        const pluginRoot = options.pluginRoot ?? process.env.GB_STUDIO_PLUGIN_ROOT;
        this.#bundleRoots = [...new Set([this.runtimeRoot,
                ...(pluginRoot ? [canonicalDirectory(pluginRoot, "The installed plugin root")] : []),
            ])];
        const explicitWorkspace = options.workspaceRoot ?? process.env.GB_STUDIO_WORKSPACE_ROOT;
        const explicitProject = options.projectRoot ?? process.env.GB_STUDIO_PROJECT_ROOT;
        this.#configuredProject = explicitProject?.trim() || undefined;
        this.#toolchainRoot = options.toolchainRoot;
        this.#isEmulatorActive = options.isEmulatorActive ?? (() => false);
        this.#isProjectBusy = options.isProjectBusy ?? (() => false);
        if (explicitWorkspace?.trim()) {
            this.#workspaceRoot = canonicalDirectory(explicitWorkspace, "The authorized workspace root");
        }
        else if (this.#configuredProject !== undefined) {
            const projectDirectory = this.#configuredProject.toLowerCase().endsWith(".gbsproj")
                ? path.dirname(path.resolve(this.#configuredProject))
                : this.#configuredProject;
            this.#workspaceRoot = canonicalDirectory(projectDirectory, "The configured project root");
        }
    }
    get workspaceRoot() {
        return this.#workspaceRoot;
    }
    /** A build/recording root must not include either immutable sample copy. */
    authorizedOperationRoot(projectRoot = this.selectedProject?.projectRoot) {
        const root = this.#workspaceRoot ?? projectRoot;
        if (root === undefined) {
            throw new GameStudioProjectError("PROJECT_SELECTION_REQUIRED", "No project or workspace is authorized. For a native game project, call project_select with its absolute .gbsproj path. For a standalone ROM or C source, configure GB_STUDIO_WORKSPACE_ROOT to its containing workspace before starting this server. session_status shows the current authorization.");
        }
        const canonical = canonicalDirectory(root, "The operation root");
        if (!this.#overlapsBundledSample(canonical))
            return canonical;
        if (projectRoot !== undefined) {
            const project = canonicalDirectory(projectRoot, "The selected project root");
            if (isWithin(canonical, project) && !this.#overlapsBundledSample(project))
                return project;
        }
        throw this.#bundledSampleError(canonical);
    }
    async initialize() {
        if (this.selectedProject !== undefined)
            return this.selectedProject;
        if (this.#configuredProject === undefined)
            return undefined;
        return this.select({ projectPath: this.#configuredProject, allowStarter: true });
    }
    requireSelectedProject() {
        if (this.selectedProject === undefined) {
            throw new GameStudioProjectError("PROJECT_SELECTION_REQUIRED", "No native game project is selected. Call project_select with the intended .gbsproj path; use an absolute path if no workspace is configured. session_status shows the current selection.");
        }
        return this.selectedProject;
    }
    async discover(projectPath) {
        if (projectPath === undefined)
            return this.requireSelectedProject();
        if (this.#workspaceRoot === undefined) {
            throw new GameStudioProjectError("PROJECT_SELECTION_REQUIRED", "Authorize an exact project with project_select before discovering other projects.");
        }
        return this.#discoverBounded(projectPath, this.#workspaceRoot);
    }
    async select(input) {
        this.#assertCanTransition();
        this.#transitioning = true;
        try {
            const candidate = nonEmptyPath(input.projectPath, "The project path");
            if (this.#workspaceRoot === undefined && !path.isAbsolute(candidate)) {
                throw new GameStudioProjectError("PROJECT_SELECTION_REQUIRED", "The first selected project must be an absolute path when no workspace is configured.", candidate);
            }
            const discovered = this.#workspaceRoot === undefined
                ? await this.#discoverExactProject(candidate)
                : await this.#discoverBounded(candidate, this.#workspaceRoot);
            await this.#assertStarterAllowed(discovered.projectRoot, input.allowStarter === true);
            if (this.#workspaceRoot === undefined) {
                this.#workspaceRoot = discovered.projectRoot;
            }
            const previousIndex = this.#worldIndex;
            this.selectedProject = discovered;
            this.selectionGeneration += 1;
            this.#worldIndex = undefined;
            previousIndex?.dispose();
            return discovered;
        }
        finally {
            this.#transitioning = false;
        }
    }
    create(input) {
        return this.#create(input);
    }
    createBlank(input) {
        return this.#create({ ...input, template: "starter" }, {
            gameType: input.gameType ?? "TOPDOWN",
            colorMode: input.colorMode ?? "color",
        });
    }
    async #create(input, blank) {
        this.#assertCanTransition();
        this.#transitioning = true;
        const createdEntries = [];
        try {
            if (blank && (!BLANK_PROJECT_GAME_TYPES.includes(blank.gameType) || !BLANK_PROJECT_COLOR_MODES.includes(blank.colorMode))) {
                throw new GameStudioProjectError("INVALID_INPUT", "Choose a supported blank-project game type and native color mode.");
            }
            if (input.template !== "starter" && input.template !== "wrecklight") {
                throw new GameStudioProjectError("INVALID_INPUT", "Choose the starter or wrecklight template explicitly.");
            }
            if (typeof input.name !== "string" || input.name.trim().length === 0) {
                throw new GameStudioProjectError("INVALID_INPUT", "The project name must be a non-empty string.");
            }
            if (input.author !== undefined && (typeof input.author !== "string" || input.author.trim().length === 0)) {
                throw new GameStudioProjectError("INVALID_INPUT", "The project author must be a non-empty string when provided.");
            }
            if (input.templateSourcePath !== undefined && (input.template !== "wrecklight"
                || typeof input.templateSourcePath !== "string" || !path.isAbsolute(input.templateSourcePath))) {
                throw new GameStudioProjectError("INVALID_INPUT", "templateSourcePath must be an absolute directory and is only supported for wrecklight.");
            }
            const template = input.templateSourcePath === undefined
                ? path.join(this.runtimeRoot, "examples", input.template) : path.resolve(input.templateSourcePath);
            let templateDetails;
            try {
                templateDetails = await lstat(template);
            }
            catch (error) {
                if (isMissing(error)) {
                    if (input.template === "wrecklight" && input.templateSourcePath === undefined) {
                        throw new GameStudioProjectError("PROJECT_NOT_FOUND", "Wrecklight is not included in this package. Supply templateSourcePath with its matching local source directory.");
                    }
                    throw new GameStudioProjectError("PROJECT_NOT_FOUND", `The trusted ${input.template} template does not exist: ${template}`, template);
                }
                throw error;
            }
            if (templateDetails.isSymbolicLink() || !templateDetails.isDirectory() || await realpath(template) !== template) {
                throw new GameStudioProjectError("UNSAFE_SYMLINK", `The trusted ${input.template} template must be a real directory: ${template}`, template);
            }
            if (input.templateSourcePath !== undefined && this.selectedProject !== undefined
                && (isWithin(template, this.selectedProject.projectRoot) || isWithin(this.selectedProject.projectRoot, template))) {
                throw new GameStudioProjectError("INVALID_INPUT", "The read-only template source must not overlap the currently selected project.", template);
            }
            const captured = input.template === "wrecklight" ? await readWrecklightTemplate(template) : undefined;
            // The explicit path grants this read/copy only, not a wider workspace.
            // Keep the authenticated source protected in this session as well.
            if (input.templateSourcePath !== undefined)
                this.#templateSourceRoots.add(template);
            const overrides = blank ? await blankProjectOverrides(template, blank) : undefined;
            const destination = await this.#resolveNewDestination(input.destinationPath);
            const templateProject = captured === undefined ? await this.#discoverBounded(template, template) : {
                projectPath: path.join(template, "project.gbsproj"),
                descriptor: JSON.parse(captured.get("project.gbsproj").toString("utf8")),
            };
            const descriptor = {
                ...templateProject.descriptor,
                name: input.name.trim(),
                ...(input.author === undefined ? {} : { author: input.author.trim() }),
            };
            try {
                // Claim the exact new directory exclusively. rename() could replace a
                // concurrently created empty directory on some supported filesystems.
                await mkdir(destination);
            }
            catch (error) {
                if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
                    throw new GameStudioProjectError("PROJECT_ALREADY_EXISTS", `The project destination already exists: ${destination}`, destination);
                }
                throw error;
            }
            await rememberCreatedDirectory(destination, createdEntries);
            if (captured === undefined)
                await copyTrustedTemplate(template, destination, templateProject.projectPath, createdEntries, overrides);
            else
                await copyCapturedTemplate(captured, destination, createdEntries);
            await writeCreatedFile(path.join(destination, path.basename(templateProject.projectPath)), `${JSON.stringify(descriptor, null, 2)}\n`, createdEntries);
            await assertCompleteCreation(createdEntries);
            const created = await this.#discoverBounded(destination, this.#workspaceRoot ?? destination);
            // Creating an exact project is an explicit grant for that directory only.
            // Never expose its parent as a temporary or persistent workspace.
            this.#workspaceRoot ??= created.projectRoot;
            if (input.select === true) {
                const previousIndex = this.#worldIndex;
                this.selectedProject = created;
                this.selectionGeneration += 1;
                this.#worldIndex = undefined;
                previousIndex?.dispose();
            }
            return created;
        }
        catch (error) {
            const cleanupErrors = await cleanupCreatedEntries(createdEntries);
            if (cleanupErrors.length > 0) {
                const failure = new GameStudioProjectError(error instanceof GameStudioProjectError ? error.code : "PROJECT_CREATE_FAILED", `${error instanceof Error ? error.message : "Project creation failed"} Cleanup was incomplete; changed or inaccessible entries were preserved.`);
                failure.cause = new AggregateError([error, ...cleanupErrors]);
                throw failure;
            }
            throw error;
        }
        finally {
            this.#transitioning = false;
        }
    }
    beginActivity() {
        if (this.#transitioning) {
            throw new GameStudioProjectError("PROJECT_BUSY", "A project selection transition is already in progress.");
        }
        this.#activeOperations += 1;
        let released = false;
        return () => {
            if (!released) {
                released = true;
                this.#activeOperations -= 1;
            }
        };
    }
    async withActivity(action) {
        const release = this.beginActivity();
        try {
            return await action();
        }
        finally {
            release();
        }
    }
    /** Observe an existing index without selecting a project or starting its bootstrap. */
    indexStats() {
        return this.#worldIndex?.stats() ?? null;
    }
    /** Acquire the transition guard before capturing the selected project or index. */
    async withSelectedProjectAccess(action) {
        const release = this.beginActivity();
        try {
            const project = this.requireSelectedProject();
            const generation = this.selectionGeneration;
            const index = this.#worldIndex ??= new ProjectWorldIndex(project.projectPath, generation, {
                ...(this.#toolchainRoot === undefined ? {} : { toolchainRoot: this.#toolchainRoot }),
            });
            await index.ensureFresh();
            if (this.selectionGeneration !== generation ||
                this.selectedProject?.projectPath !== project.projectPath ||
                this.#worldIndex !== index) {
                throw new GameStudioProjectError("PROJECT_BUSY", "The selected project changed while acquiring indexed project access.");
            }
            return await action(project, index);
        }
        finally {
            release();
        }
    }
    /** Release the process-local watcher without writing into the authored project. */
    close() {
        const index = this.#worldIndex;
        this.#worldIndex = undefined;
        index?.dispose();
    }
    #assertCanTransition() {
        if (this.#transitioning || this.#activeOperations > 0 || this.#isProjectBusy()) {
            throw new GameStudioProjectError("PROJECT_BUSY", "Finish the active project mutation or build before selecting another project.");
        }
        if (this.#isEmulatorActive()) {
            throw new GameStudioProjectError("EMULATOR_ACTIVE", "Close the active emulator before selecting another project.");
        }
    }
    async #assertStarterAllowed(projectRoot, allowed) {
        if (this.#overlapsBundledSample(projectRoot))
            throw this.#bundledSampleError(projectRoot);
        if (allowed)
            return;
        try {
            const starter = await realpath(path.join(this.runtimeRoot, "examples", "starter"));
            if (starter === projectRoot) {
                throw new GameStudioProjectError("STARTER_SELECTION_REQUIRES_OPT_IN", "Selecting the bundled starter requires allowStarter: true.", projectRoot);
            }
        }
        catch (error) {
            if (!isMissing(error))
                throw error;
        }
    }
    #overlapsBundledSample(candidate) {
        return [...this.#templateSourceRoots].some((source) => isWithin(source, candidate) || isWithin(candidate, source))
            || this.#bundleRoots.some((root) => {
                const sample = path.join(root, "examples", "wrecklight");
                return isWithin(sample, candidate) || isWithin(candidate, sample);
            });
    }
    #bundledSampleError(candidate) {
        return new GameStudioProjectError("BUNDLED_TEMPLATE_READ_ONLY", "The bundled Wrecklight sample is read-only. Use project_create with template: wrecklight, then select the editable copy for builds and recordings.", candidate);
    }
    async #discoverExactProject(candidate) {
        const requested = path.resolve(candidate);
        let canonical;
        try {
            canonical = await realpath(requested);
        }
        catch (error) {
            if (isMissing(error)) {
                throw new GameStudioProjectError("PROJECT_NOT_FOUND", `The selected project does not exist: ${requested}`, requested);
            }
            throw error;
        }
        const details = await stat(canonical);
        if (details.isDirectory())
            return this.#discoverBounded(canonical, canonical);
        if (!details.isFile() || !canonical.toLowerCase().endsWith(".gbsproj")) {
            throw new GameStudioProjectError("INVALID_INPUT", "Select a project directory or an exact .gbsproj descriptor.", requested);
        }
        return this.#discoverBounded(canonical, path.dirname(canonical));
    }
    async #discoverBounded(candidate, workspaceRoot) {
        const requested = path.resolve(workspaceRoot, nonEmptyPath(candidate, "The project path"));
        assertWithin(workspaceRoot, requested);
        let canonical;
        try {
            canonical = await realpath(requested);
        }
        catch (error) {
            if (isMissing(error)) {
                throw new GameStudioProjectError("PROJECT_NOT_FOUND", `The selected project does not exist: ${requested}`, requested);
            }
            throw error;
        }
        assertWithin(workspaceRoot, canonical);
        const details = await stat(canonical);
        let descriptor;
        if (details.isFile()) {
            if (!canonical.toLowerCase().endsWith(".gbsproj")) {
                throw new GameStudioProjectError("INVALID_INPUT", `Project descriptors must use the .gbsproj extension: ${canonical}`, canonical);
            }
            descriptor = canonical;
        }
        else if (details.isDirectory()) {
            let directory = canonical;
            while (true) {
                const entries = await readdir(directory, { withFileTypes: true });
                const matches = entries
                    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith(".gbsproj"))
                    .map((entry) => path.join(directory, entry.name))
                    .sort((left, right) => left.localeCompare(right));
                if (matches.length > 1) {
                    throw new GameStudioProjectError("AMBIGUOUS_PROJECT", `More than one .gbsproj file exists in ${directory}; select an explicit descriptor.`, directory);
                }
                if (matches[0] !== undefined) {
                    descriptor = await realpath(matches[0]);
                    assertWithin(workspaceRoot, descriptor);
                    break;
                }
                if (directory === workspaceRoot)
                    break;
                directory = path.dirname(directory);
                assertWithin(workspaceRoot, directory);
            }
        }
        if (descriptor === undefined) {
            throw new GameStudioProjectError("PROJECT_NOT_FOUND", `No .gbsproj project was found within the authorized workspace for ${canonical}`, canonical);
        }
        assertWithin(workspaceRoot, descriptor);
        const discovered = await discoverProject(descriptor);
        assertWithin(workspaceRoot, discovered.projectRoot);
        assertWithin(workspaceRoot, discovered.projectPath);
        return discovered;
    }
    #assertOutsideTemplates(destination) {
        for (const source of this.#templateSourceRoots) {
            if (isWithin(source, destination) || isWithin(destination, source)) {
                throw new GameStudioProjectError("INVALID_INPUT", "The project destination must not overlap its read-only template source.", destination);
            }
        }
        for (const root of this.#bundleRoots) {
            for (const name of ["starter", "wrecklight"]) {
                if (isWithin(path.join(root, "examples", name), destination)) {
                    throw new GameStudioProjectError("INVALID_INPUT", "The project destination must not be inside a bundled template.", destination);
                }
            }
        }
    }
    async #resolveNewDestination(candidate) {
        const workspaceRoot = this.#workspaceRoot;
        const requested = nonEmptyPath(candidate, "The destination path");
        try {
            assertSafePlatformPath(requested);
        }
        catch (error) {
            throw new GameStudioProjectError("INVALID_INPUT", error instanceof Error ? error.message : "The destination path is unsafe.");
        }
        if (workspaceRoot === undefined) {
            if (!path.isAbsolute(requested) || (process.platform === "win32" && !/^[A-Za-z]:[\\/]/u.test(requested))) {
                throw new GameStudioProjectError("PROJECT_SELECTION_REQUIRED", "The first project_create destination must be an absolute path to a new directory under an existing real parent when no workspace is configured.");
            }
            const destination = path.resolve(requested);
            const parent = path.dirname(destination);
            let canonicalParent;
            try {
                canonicalParent = await realpath(parent);
                if (!(await stat(canonicalParent)).isDirectory()) {
                    throw new GameStudioProjectError("INVALID_INPUT", "The project destination parent must be a directory.");
                }
            }
            catch (error) {
                if (isMissing(error)) {
                    throw new GameStudioProjectError("PROJECT_NOT_FOUND", "The first project destination parent must already exist.");
                }
                throw error;
            }
            if (canonicalParent !== parent) {
                throw new GameStudioProjectError("UNSAFE_SYMLINK", "The first project destination must use its canonical parent path, without symbolic-link ancestors.");
            }
            this.#assertOutsideTemplates(destination);
            return destination;
        }
        const destination = path.resolve(workspaceRoot, requested);
        assertWithin(workspaceRoot, destination);
        if (destination === workspaceRoot) {
            throw new GameStudioProjectError("INVALID_INPUT", "The project destination must be a new directory inside the workspace.", destination);
        }
        // Check both immutable copies before creating any missing parent directory.
        this.#assertOutsideTemplates(destination);
        const parent = path.dirname(destination);
        const segments = path.relative(workspaceRoot, parent).split(path.sep).filter(Boolean);
        let current = workspaceRoot;
        for (const segment of segments) {
            current = path.join(current, segment);
            try {
                const details = await lstat(current);
                if (details.isSymbolicLink()) {
                    throw new GameStudioProjectError("UNSAFE_SYMLINK", `Project destination ancestors must not be symbolic links: ${current}`, current);
                }
                if (!details.isDirectory()) {
                    throw new GameStudioProjectError("INVALID_INPUT", `Project destination ancestors must be directories: ${current}`, current);
                }
                const canonical = await realpath(current);
                this.#assertOutsideTemplates(canonical);
                if (canonical !== current) {
                    throw new GameStudioProjectError("UNSAFE_SYMLINK", "Project destination ancestors must use their canonical paths.", current);
                }
            }
            catch (error) {
                if (!isMissing(error))
                    throw error;
                await mkdir(current);
            }
        }
        try {
            await lstat(destination);
            throw new GameStudioProjectError("PROJECT_ALREADY_EXISTS", `The project destination already exists: ${destination}`, destination);
        }
        catch (error) {
            if (!isMissing(error))
                throw error;
        }
        assertWithin(workspaceRoot, await realpath(parent));
        return destination;
    }
}
//# sourceMappingURL=project-session.js.map