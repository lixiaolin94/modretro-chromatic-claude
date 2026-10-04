import { readFileSync } from "node:fs";

// Shared by passive doctor, setup planning, and explicit installation. These are
// compatibility requirements; installVersion pins new installations separately.
export const DEPENDENCY_CATALOG = Object.freeze({
  node: { requiredVersion: "22", versionPolicy: "minimum", installVersion: "24.15.0", source: "https://nodejs.org/download/release/v24.15.0/SHASUMS256.txt" },
  runtime: { requiredVersion: "package", versionPolicy: "package", source: "packaged runtime and reviewed public-registry lock" },
  cli: { requiredVersion: "4.3.2", versionPolicy: "exact", installVersion: "4.3.2", commit: "ccb891b2670134ba8237416772eea4ed09d34e1e", gbvmCommit: "bd6f41cc5e05cbe6601dcc7f8e2db89bed527fe3", source: "https://github.com/chrismaltby/gb-studio" },
  gbdk: { requiredVersion: "4.5.0", versionPolicy: "exact", installVersion: "4.5.0", source: "https://github.com/gbdk-2020/gbdk-2020/releases/tag/4.5.0" },
  python: { requiredVersion: "3.13", versionPolicy: "minor", installVersion: "3.13.12", source: "uv-managed CPython (python-build-standalone)" },
  pyboy: { requiredVersion: "2.7.0", versionPolicy: "exact", installVersion: "2.7.0", source: "https://pypi.org/project/pyboy/2.7.0/" },
  pillow: { requiredVersion: ">=11,<13", versionPolicy: "range", installVersion: "12.3.0", source: "https://pypi.org/project/pillow/12.3.0/" },
  desktop: { requiredVersion: "4.3.2", versionPolicy: "exact", installVersion: "4.3.2", source: "https://github.com/chrismaltby/gb-studio/releases/tag/v4.3.2", optional: true },
  uv: { requiredVersion: "0.12.6", versionPolicy: "exact", installVersion: "0.12.6", source: "https://github.com/astral-sh/uv/releases/tag/0.12.6", installerOnly: true },
});

export const SUPPORTED_SETUP_PLATFORMS = Object.freeze(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);

export const NODE_RELEASES = Object.freeze(Object.fromEntries(
  readFileSync(new URL("./node-releases.tsv", import.meta.url), "utf8").trim().split(/\r?\n/u).slice(1).map((line) => {
    const [platform, version, archive, sha256, url] = line.split("\t");
    if (!SUPPORTED_SETUP_PLATFORMS.includes(platform) || version !== DEPENDENCY_CATALOG.node.installVersion || !/^[a-f0-9]{64}$/u.test(sha256) || !url.startsWith("https://nodejs.org/")) throw new Error("Invalid packaged Node release catalog");
    return [platform, { version, archive, sha256, url }];
  }),
));

const uv = (archive, sha256) => ({ version: DEPENDENCY_CATALOG.uv.installVersion, archive, sha256, url: `https://github.com/astral-sh/uv/releases/download/${DEPENDENCY_CATALOG.uv.installVersion}/${archive}` });
export const UV_RELEASES = Object.freeze({
  "darwin-arm64": uv("uv-aarch64-apple-darwin.tar.gz", "14b459d51ea2e71eeba28c45a268c922bdf8607fc6455e3f40b4e082895d160d"),
  "darwin-x64": uv("uv-x86_64-apple-darwin.tar.gz", "2a26ea71bbeff1c7e12c2cc40245c96a041deff276bc921e7038e304d5d3e04c"),
  "linux-arm64": uv("uv-aarch64-unknown-linux-gnu.tar.gz", "d58030acd26159499ac82f32da12d1b3c12a3a1bfc414232d9082070c03e128d"),
  "linux-x64": uv("uv-x86_64-unknown-linux-gnu.tar.gz", "8681d8921e7d520fb368991dcf5f9c1905b80f5bf2a265a0ed085c8d8e342477"),
  "win32-x64": uv("uv-x86_64-pc-windows-msvc.zip", "df7cb9f243eae1621400d4fcf5b1b3d90f20e264ece91b64deb3b0078abca6ef"),
});

const gbdk = (archive, sha256) => ({ version: DEPENDENCY_CATALOG.gbdk.installVersion, archive, sha256, url: `https://github.com/gbdk-2020/gbdk-2020/releases/download/4.5.0/${archive}` });
export const GBDK_RELEASES = Object.freeze({
  "darwin-arm64": gbdk("gbdk-macos-arm64.tar.gz", "289ee60e46c5a2785a21e35533f84a5131ed4a063b21b0dbdedc9a10af15bf78"),
  "darwin-x64": gbdk("gbdk-macos.tar.gz", "1aa549d12032d8f6509d11923bb28b1a453098f42597feb378e9a42541f8fd89"),
  "linux-arm64": gbdk("gbdk-linux-arm64.tar.gz", "31eb2235f0fdb60163d0b1e9574a022098d6069cd56606a1daca4478a46e0439"),
  "linux-x64": gbdk("gbdk-linux64.tar.gz", "d7857a5f6d135ee4c249043ca26aad9f2ec8ab5d4106d97720d404114f42605c"),
  "win32-x64": gbdk("gbdk-win64.zip", "266854ce92e3064871c5b28cd3436cc2a6cb136af9e7cf617140108f8c1c5890"),
});

// Commit-addressed upstream archives, inspected and hashed when this catalog was
// prepared. The GBVM submodule is explicit, not an unpinned recursive download.
export const SOURCE_RELEASES = Object.freeze({
  cli: { version: "4.3.2", archive: "gb-studio-ccb891b2670134ba8237416772eea4ed09d34e1e.tar.gz", sha256: "7c4f87129c62a73c754f0caa62a7e90f24681149bd96a3765162f7087824ffcf", url: "https://codeload.github.com/chrismaltby/gb-studio/tar.gz/ccb891b2670134ba8237416772eea4ed09d34e1e" },
  gbvm: { version: "bd6f41cc5e05cbe6601dcc7f8e2db89bed527fe3", archive: "gbvm-bd6f41cc5e05cbe6601dcc7f8e2db89bed527fe3.tar.gz", sha256: "f7875eb66fa4b3d692868ece3a8dadc612d98844b27323e2040978063be7927d", url: "https://codeload.github.com/chrismaltby/gbvm/tar.gz/bd6f41cc5e05cbe6601dcc7f8e2db89bed527fe3" },
  yarn: { version: "4.4.1", archive: "yarn-cli-dist-4.4.1.tgz", sha256: "b73cd0ac4a4543b5eccb030955b40013553a7d1e60f70f4f1eb278fd2b7d707f", executableSha256: "920b4530755296dc2ce8b4351f057d4a26429524fcb2789d277560d94837c27e", url: "https://registry.npmjs.org/@yarnpkg/cli-dist/-/cli-dist-4.4.1.tgz" },
});

const desktop = (archive, sha256) => ({ version: "4.3.2", archive, sha256, url: `https://github.com/chrismaltby/gb-studio/releases/download/v4.3.2/${archive}` });
export const DESKTOP_RELEASES = Object.freeze({
  "darwin-arm64": desktop("gb-studio-mac-apple-silicon.zip", "1b5e2c4402350223cf2810bd917a98025d85b350a48e449d1da3bb4486ff91eb"),
  "darwin-x64": desktop("gb-studio-mac-intel.zip", "d56a850c7585f22c99b09d9c03af231fd76604a402b1f6c556979e72aefdba7c"),
  "linux-arm64": desktop("gb-studio-linux-arm64.AppImage", "7249d19b9c1cc4c145f7abe08b6c1dd9518f35a983168356e1258172b713fa7d"),
  "linux-x64": desktop("gb-studio-linux.AppImage", "12f23e878974fbfcb97ac690131567a42c50f267d090a39e2c398e88b86958e0"),
  "win32-x64": desktop("gb-studio-windows-64bit-standalone.zip", "9afea7d8f3920991c3562fd69fa8a98aed7f29d231aa468bb4dbcf123b60db80"),
});
