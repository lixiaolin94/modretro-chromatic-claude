#!/usr/bin/env node
/**
 * End-to-end check of the generated plugin with a real toolchain:
 * create a blank project -> author a sprite as .pxg -> import it -> place an
 * actor -> official GB Studio build -> rom_inspect -> PyBoy boot + real frame
 * -> official web export + preview URL.
 *
 *   GB_STUDIO_SETUP_ROOT=<prepared root> node port/e2e-build.mjs <plugin-dir> <work-dir>
 *
 * Writes start-frame.png and preview-url.txt into <work-dir>.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startPluginServer } from "./lib/mcp-client.mjs";

const [pluginArg, workArg] = process.argv.slice(2);
if (!pluginArg || !workArg) {
  console.error("Usage: node port/e2e-build.mjs <plugin-dir> <work-dir>");
  process.exit(1);
}
const pluginRoot = path.resolve(pluginArg);
const work = path.resolve(workArg);
mkdirSync(work, { recursive: true });
const projectDir = path.join(work, "RobotDemo");
if (existsSync(projectDir)) throw new Error(`${projectDir} already exists; use a fresh work dir.`);

const server = startPluginServer(pluginRoot, { timeoutMs: 900_000 });
const step = async (label, name, args) => {
  const started = Date.now();
  const result = await server.call(name, args);
  console.log(`${result.isError ? "FAIL" : "ok  "} ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (result.isError) {
    console.log(result.text.slice(0, 2000));
    throw new Error(`${name} failed`);
  }
  return result;
};
const find = (value, key) => {
  if (!value || typeof value !== "object") return undefined;
  if (key in value) return value[key];
  for (const child of Object.values(value)) {
    const found = find(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

try {
  await server.initialize();
  await step("project_create_blank", "project_create_blank", {
    name: "Robot Demo", destinationPath: projectDir, gameType: "TOPDOWN", colorMode: "color", select: true,
  });
  const gbsproj = execFileSync("find", [projectDir, "-maxdepth", "1", "-name", "*.gbsproj"]).toString().trim();
  console.log(`     project: ${gbsproj}`);

  // Author the sprite as a text grid and render it with the Claude helper.
  const helper = path.join(pluginRoot, "scripts", "claude", "pixel-grid.mjs");
  const spriteDir = path.join(projectDir, "assets", "sprites");
  mkdirSync(spriteDir, { recursive: true });
  copyFileSync(path.join(pluginRoot, "skills", "pixel-art", "examples", "robot.pxg"), path.join(work, "robot.pxg"));
  execFileSync("node", [helper, "render", path.join(work, "robot.pxg"), "--out", path.join(spriteDir, "robot.png"), "--preview", path.join(work, "robot@8x.png")]);
  const analysis = await step("graphics_analyze robot.png", "graphics_analyze", { assetPath: "assets/sprites/robot.png", kind: "sprite" });
  console.log(`     ${analysis.text.slice(0, 240).replace(/\s+/g, " ")}`);
  const imported = await step("asset_import sprite (directional)", "asset_import", {
    assetPath: "assets/sprites/robot.png", kind: "sprite", name: "Robot", sprite: { profile: "directional" },
  });
  const spriteId = find(imported.json, "id") ?? find(imported.json, "assetId");
  console.log(`     sprite id: ${spriteId}`);

  const inventory = await step("project_inventory scenes", "project_inventory", { resourceTypes: ["scene"], detail: "summary" });
  const scenes = find(inventory.json, "scenes") ?? [];
  const sceneId = scenes[0]?.id;
  console.log(`     start scene: ${sceneId} (${scenes[0]?.name})`);
  await step("actor_create robot", "actor_create", {
    sceneId, name: "Robot", spriteSheetId: spriteId, x: 9, y: 8, direction: "down", dialogue: "BEEP BOOP! Built with Claude.",
  });

  const built = await step("rom_build (official GB Studio CLI)", "rom_build", {});
  const romPath = find(built.json, "outputPath") ?? find(built.json, "romPath");
  console.log(`     rom: ${romPath}`);
  const inspected = await step("rom_inspect", "rom_inspect", { romPath });
  console.log(`     ${JSON.stringify({ title: find(inspected.json, "title"), cgb: find(inspected.json, "cgb") ?? find(inspected.json, "cgbFlag"), sizeBytes: find(inspected.json, "sizeBytes"), sha256: find(inspected.json, "sha256") })}`);

  await step("emulator_run (PyBoy)", "emulator_run", { romPath, restart: true, initialFrames: 240 });
  const observed = await step("emulator_observe", "emulator_observe", { includeImages: true });
  const image = observed.images[0];
  if (image) {
    writeFileSync(path.join(work, "start-frame.png"), Buffer.from(image.data, "base64"));
    console.log(`     frame saved: ${path.join(work, "start-frame.png")}`);
  } else {
    console.log("     no inline image returned");
  }
  await step("emulator_step (hold A 2 frames)", "emulator_step", { buttons: ["a"], frames: 2, sampleCount: 1 });
  await step("emulator_close", "emulator_close", {});

  const preview = await step("web_preview (official make:web export)", "web_preview", {});
  const url = find(preview.json, "url") ?? (preview.text.match(/https?:\/\/127\.0\.0\.1:\d+\/[^\s"']+/) ?? [])[0];
  console.log(`     preview: ${url}`);
  if (url) writeFileSync(path.join(work, "preview-url.txt"), `${url}\n`);
  console.log("\nE2E OK - leave this process running to keep the preview server alive; Ctrl-C to stop.");
} catch (error) {
  console.error(`E2E FAILED: ${error.message}\n${server.stderr().slice(-1500)}`);
  server.close();
  process.exitCode = 1;
}
