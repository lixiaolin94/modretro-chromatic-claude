import path from "node:path";
import { pathToFileURL } from "node:url";
/** Keep installation in the packaged setup manager: it owns locks, provenance and cancellation. */
export async function prepareToolchain(packageRoot, components, options = {}) {
    const environment = options.environment ?? process.env;
    const moduleUrl = pathToFileURL(path.join(packageRoot, "scripts/setup.mjs")).href;
    const run = options.run ?? (await import(moduleUrl)).runSetup;
    const args = ["--components", [...new Set(components)].join(","), "--json"];
    const context = { packageRoot, environment, signal: options.signal };
    const plan = await run(["plan", ...args], context);
    const boundRoot = Object.entries(environment).find(([key]) => process.platform === "win32" ? key.toUpperCase() === "GB_STUDIO_TOOLCHAIN_ROOT" : key === "GB_STUDIO_TOOLCHAIN_ROOT")?.[1];
    if (boundRoot && typeof plan.root === "string" && path.resolve(boundRoot) !== path.resolve(plan.root, "toolchain")) {
        return { success: false, stage: "blocked", message: "This session uses a separately configured toolchain. Keep that binding; do not install into a different root or recreate the plugin.", plan };
    }
    if (!plan.canApply)
        return { success: false, stage: "blocked", plan, message: "Game tools could not be prepared. Keep the existing installation and inspect the setup result." };
    const result = await run(["apply", ...args, "--yes"], context);
    return { success: result.status === "complete", stage: result.status === "complete" ? "ready" : "incomplete", result,
        message: result.status === "complete" ? "Game tools are ready. Continue the original build or preview in this session."
            : "Game tool setup did not finish. Completed components are preserved; inspect the failure before any retry." };
}
//# sourceMappingURL=toolchain-prepare.js.map