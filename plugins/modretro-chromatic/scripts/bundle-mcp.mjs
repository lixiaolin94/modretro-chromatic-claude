/** Release-time bundling only. No package manager or downloads run at startup. */
import { createRequire, builtinModules } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function bundleMcp(sourceRoot) {
  const require = createRequire(import.meta.url);
  const { buildSync } = require("esbuild");
  const options = {
    absWorkingDir: sourceRoot,
    entryPoints: ["dist/server.js"],
    outfile: "dist/server.js",
    allowOverwrite: true,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    metafile: true,
    sourcemap: false,
    // These dependency-free helpers resolve assets relative to their own files.
    external: [path.join(sourceRoot, "scripts", "*")],
    banner: { js: 'import { createRequire as __mcpCreateRequire } from "node:module"; const require = __mcpCreateRequire(import.meta.url);' },
    legalComments: "inline",
    logLevel: "silent",
  };
  const result = buildSync(options);
  const client = buildSync({ ...options, entryPoints: ["scripts/device-client-deps.mjs"], outfile: "scripts/device-client-deps.mjs", external: [] });
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  for (const output of Object.values({ ...result.metafile.outputs, ...client.metafile.outputs })) {
    for (const entry of output.imports) {
      if (entry.external && !builtins.has(entry.path) && !entry.path.startsWith("../scripts/")) {
        throw new Error(`Standalone MCP retained an unbundled dependency: ${entry.path}`);
      }
    }
  }
  if (Object.keys(result.metafile.inputs).some(input => input.startsWith("scripts/"))) {
    throw new Error("Standalone MCP must preserve helper module locations.");
  }
  const packages = new Map();
  for (const input of Object.keys({ ...result.metafile.inputs, ...client.metafile.inputs })) {
    if (!input.includes("node_modules/")) continue;
    let directory = path.dirname(path.resolve(sourceRoot, input));
    let manifest;
    while (directory !== path.dirname(directory)) {
      if (existsSync(path.join(directory, "package.json"))) {
        const candidate = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
        if (candidate.name && candidate.version) { manifest = candidate; break; }
      }
      directory = path.dirname(directory);
    }
    if (!manifest) throw new Error(`Missing dependency manifest for ${input}`);
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;
    const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md", "license.txt", "License", "License.txt"]
      .find(name => existsSync(path.join(directory, name)));
    if (!licenseFile) throw new Error(`Missing bundled dependency license: ${key}`);
    packages.set(key, readFileSync(path.join(directory, licenseFile), "utf8"));
  }
  const notices = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([name, license]) => `## ${name}\n\n${license.trim()}\n`).join("\n");
  return { contents: Buffer.from(result.outputFiles[0].contents), clientContents: Buffer.from(client.outputFiles[0].contents), notices: Buffer.from(`# Bundled JavaScript dependency licenses\n\n${notices}`), packages: [...packages.keys()].sort() };
}
