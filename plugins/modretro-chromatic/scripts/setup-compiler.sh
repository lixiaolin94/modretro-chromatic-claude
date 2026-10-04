#!/usr/bin/env bash
set -euo pipefail

# Do not let an unrelated project inject shell startup files, Node preloads,
# Python imports, or uv configuration into the trusted toolchain bootstrap.
unset BASH_ENV ENV NODE_OPTIONS NODE_PATH \
  UV_PROJECT UV_WORKING_DIR UV_CONFIG_FILE UV_ENV_FILE VIRTUAL_ENV \
  PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE PYTHONWARNINGS

setup_gbs_version="4.3.2"
setup_gbs_commit="ccb891b2670134ba8237416772eea4ed09d34e1e"
setup_gbvm_commit="bd6f41cc5e05cbe6601dcc7f8e2db89bed527fe3"
setup_gbdk_version="4.5.0"
setup_with_cli=false
setup_with_desktop=false
setup_desktop_requested=false
setup_headless=false
setup_use_existing=false
setup_dry_run=false
setup_help=false

usage() {
  printf 'Usage: %s [--headless] [--with-cli] [--with-desktop] [--use-existing] [--dry-run]\n' "$0"
  printf '  macOS defaults to the verified desktop editor and GBDK.\n'
  printf '  Linux defaults to headless official project compilation and GBDK.\n'
  printf '  --use-existing verifies an installed official CLI and GBDK without modifying them.\n'
  printf '  --dry-run prints an unverified plan without running tools.\n'
  printf '  For installed plugins, use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.\n'
}

for setup_argument in "$@"; do
  case "$setup_argument" in
    --headless) setup_headless=true; setup_with_cli=true ;;
    --with-cli) setup_with_cli=true ;;
    --with-desktop) setup_with_desktop=true; setup_desktop_requested=true ;;
    --use-existing) setup_use_existing=true ;;
    --dry-run) setup_dry_run=true ;;
    --help|-h) setup_help=true ;;
    *) printf 'Unknown ModRetro Chromatic setup option: %s\n' "$setup_argument" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$setup_headless" == true && "$setup_with_desktop" == true ]]; then
  printf '%s\n' '--headless and --with-desktop cannot be combined.' >&2
  exit 2
fi
if [[ "$setup_help" == true ]]; then usage; exit 0; fi
if [[ "$setup_dry_run" == true ]]; then
  setup_plan_script_directory="${BASH_SOURCE[0]%/*}"
  if [[ "$setup_plan_script_directory" == "${BASH_SOURCE[0]}" ]]; then setup_plan_script_directory=.; fi
  setup_plan_root="${GB_STUDIO_TOOLCHAIN_ROOT:-$setup_plan_script_directory/..}"
  setup_plan_action='verify/reuse or prepare'
  if [[ "$setup_use_existing" == true ]]; then setup_plan_action='verify existing'; fi
  printf '%s\n' '[dry-run] Plan only; no tools were run and dependency health is unverified.'
  printf '[dry-run] Dependency destination (lexical, not verified): %s/.local\n' "$setup_plan_root"
  printf '[dry-run] Would %s GBDK %s.\n' \
    "$setup_plan_action" "$setup_gbdk_version"
  if [[ "$setup_with_cli" == true || "$OSTYPE" == linux* || "$setup_use_existing" == true ]]; then
    printf '[dry-run] Official GB Studio %s CLI; setup may need Git, Node.js and Corepack.\n' "$setup_gbs_version"
  fi
  if [[ "$setup_with_desktop" == true || ( "$OSTYPE" == darwin* && "$setup_headless" == false && "$setup_use_existing" == false ) ]]; then
    printf '[dry-run] Optional GB Studio %s desktop editor.\n' "$setup_gbs_version"
  fi
  printf '%s\n' '[dry-run] Installed plugins should use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.'
  exit 0
fi

setup_script_directory="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
setup_plugin_root="$(cd -P -- "${setup_script_directory}/.." && pwd -P)"

assert_mutable_toolchain() {
  local setup_candidate="$1"
  while [[ -n "$setup_candidate" ]]; do
    if [[ -e "$setup_candidate/.codex-plugin/local-payload.json" || -L "$setup_candidate/.codex-plugin/local-payload.json" ]] ||
      [[ -f "$setup_candidate/.codex-plugin/plugin.json" && "$(<"$setup_candidate/.codex-plugin/plugin.json")" == *+codex.payload.* ]]; then
      printf '%s\n' 'Legacy setup cannot write into an immutable plugin payload or cache. Use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.' >&2
      exit 1
    fi
    [[ "$setup_candidate" != / ]] || break
    setup_candidate="${setup_candidate%/*}"
  done
}

setup_system="$(uname -s)"
setup_architecture="$(uname -m)"

case "${setup_system}:${setup_architecture}" in
  Darwin:arm64|Darwin:aarch64)
    setup_platform="darwin-arm64"
    setup_gbs_asset="gb-studio-mac-apple-silicon.zip"
    setup_gbs_sha="1b5e2c4402350223cf2810bd917a98025d85b350a48e449d1da3bb4486ff91eb"
    setup_gbdk_asset="gbdk-macos-arm64.tar.gz"
    setup_gbdk_sha="289ee60e46c5a2785a21e35533f84a5131ed4a063b21b0dbdedc9a10af15bf78"
    ;;
  Darwin:x86_64|Darwin:amd64)
    setup_platform="darwin-x64"
    setup_gbs_asset="gb-studio-mac-intel.zip"
    setup_gbs_sha="d56a850c7585f22c99b09d9c03af231fd76604a402b1f6c556979e72aefdba7c"
    setup_gbdk_asset="gbdk-macos.tar.gz"
    setup_gbdk_sha="1aa549d12032d8f6509d11923bb28b1a453098f42597feb378e9a42541f8fd89"
    ;;
  Linux:aarch64|Linux:arm64)
    setup_platform="linux-arm64"
    setup_gbs_asset="gb-studio-linux-arm64.AppImage"
    setup_gbs_sha="7249d19b9c1cc4c145f7abe08b6c1dd9518f35a983168356e1258172b713fa7d"
    setup_gbdk_asset="gbdk-linux-arm64.tar.gz"
    setup_gbdk_sha="31eb2235f0fdb60163d0b1e9574a022098d6069cd56606a1daca4478a46e0439"
    ;;
  Linux:x86_64|Linux:amd64)
    setup_platform="linux-x64"
    setup_gbs_asset="gb-studio-linux.AppImage"
    setup_gbs_sha="12f23e878974fbfcb97ac690131567a42c50f267d090a39e2c398e88b86958e0"
    setup_gbdk_asset="gbdk-linux64.tar.gz"
    setup_gbdk_sha="d7857a5f6d135ee4c249043ca26aad9f2ec8ab5d4106d97720d404114f42605c"
    ;;
  *)
    printf 'Unsupported ModRetro Chromatic setup platform: %s %s. Supported platforms are macOS and Linux on x64 or arm64.\n' \
      "$setup_system" "$setup_architecture" >&2
    exit 1
    ;;
esac

if [[ "$setup_system" == Darwin && "$setup_headless" == false ]]; then
  setup_with_desktop=true
elif [[ "$setup_system" == Linux ]]; then
  setup_with_cli=true
fi

setup_toolchain_root="${GB_STUDIO_TOOLCHAIN_ROOT:-$setup_plugin_root}"
if [[ ! -d "$setup_toolchain_root" ]]; then
  printf 'The selected game toolchain root must be an existing directory: %s\n' \
    "$setup_toolchain_root" >&2
  exit 1
fi
setup_toolchain_root="$(cd -P -- "$setup_toolchain_root" && pwd -P)"
if [[ "$setup_use_existing" == false ]]; then assert_mutable_toolchain "$setup_toolchain_root"; fi
# Preserve relative toolchain-root arguments, then run probes and installers
# from the trusted plugin instead of a selected, potentially hostile project.
cd -P -- "$setup_script_directory"
setup_local="$setup_toolchain_root/.local"

if [[ -L "$setup_local" ]]; then
  if [[ ! -d "$setup_local" ]]; then
    printf 'The game toolchain .local link is broken: %s\n' "$setup_local" >&2
    exit 1
  fi
  setup_local="$(cd -P -- "$setup_local" && pwd -P)"
  if [[ "$(basename -- "$setup_local")" != ".local" ]]; then
    printf 'A linked game toolchain must resolve to an actual .local directory: %s\n' \
      "$setup_local" >&2
    exit 1
  fi
elif [[ -e "$setup_local" && ! -d "$setup_local" ]]; then
  printf 'The game toolchain .local path is not a directory: %s\n' "$setup_local" >&2
  exit 1
fi
if [[ "$setup_use_existing" == false ]]; then assert_mutable_toolchain "$setup_local"; fi

setup_downloads="$setup_local/downloads"
setup_apps="$setup_local/apps"
setup_vendor="$setup_local/vendor/gb-studio"
setup_cli="$setup_vendor/out/cli/gb-studio-cli.js"
setup_gbdk_compiler="$setup_local/gbdk/bin/lcc"
setup_gbdk_version_header="$setup_local/gbdk/include/gbdk/version.h"
setup_gbs_archive="$setup_downloads/$setup_gbs_asset"
setup_gbdk_archive="$setup_downloads/$setup_gbdk_asset"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'ModRetro Chromatic setup requires %s; install it and rerun setup.\n' "$1" >&2
    exit 1
  fi
}

verify_cli() {
  if [[ ! -f "$setup_cli" || -L "$setup_cli" ]]; then
    printf 'The official GB Studio CLI is unavailable at %s\n' "$setup_cli" >&2
    return 1
  fi

  require_command node
  local reported_version
  if ! reported_version="$(node "$setup_cli" --version)"; then
    printf 'The official GB Studio CLI failed its version check: %s\n' "$setup_cli" >&2
    return 1
  fi
  if [[ "$reported_version" != "$setup_gbs_version" && "$reported_version" != "v${setup_gbs_version}" ]]; then
    printf 'The official GB Studio CLI reported %s; expected %s.\n' \
      "$reported_version" "$setup_gbs_version" >&2
    return 1
  fi
}

verify_gbdk() {
  if [[ ! -f "$setup_gbdk_compiler" || ! -x "$setup_gbdk_compiler" ]]; then
    printf 'GBDK %s requires an existing executable compiler: %s\n' \
      "$setup_gbdk_version" "$setup_gbdk_compiler" >&2
    return 1
  fi

  if [[ ! -f "$setup_gbdk_version_header" || -L "$setup_gbdk_version_header" ]]; then
    printf 'The existing GBDK installation lacks its trusted version header: %s\n' \
      "$setup_gbdk_version_header" >&2
    return 1
  fi

  if ! grep -Eq '^[[:space:]]*#[[:space:]]*define[[:space:]]+__GBDK_VERSION[[:space:]]+450([[:space:]]|$)' \
    "$setup_gbdk_version_header"; then
    printf 'The existing GBDK installation does not report the required %s release: %s\n' \
      "$setup_gbdk_version" "$setup_gbdk_version_header" >&2
    return 1
  fi

  if ! "$setup_gbdk_compiler" -v >/dev/null 2>&1; then
    printf 'The existing GBDK compiler could not run its version probe: %s\n' \
      "$setup_gbdk_compiler" >&2
    return 1
  fi
}

verify_existing() {
  verify_gbdk
  verify_cli
}

if [[ "$setup_use_existing" == true ]]; then
  if [[ "$setup_desktop_requested" == true && "$setup_system" == Linux ]]; then
    if [[ ! -f "$setup_apps/$setup_gbs_asset" || ! -x "$setup_apps/$setup_gbs_asset" ]]; then
      printf 'The existing optional Linux desktop editor is unavailable: %s\n' \
        "$setup_apps/$setup_gbs_asset" >&2
      exit 1
    fi
  elif [[ "$setup_desktop_requested" == true && ! -d "$setup_apps/GB Studio.app" ]]; then
    printf 'The existing optional macOS desktop editor is unavailable: %s\n' \
      "$setup_apps/GB Studio.app" >&2
    exit 1
  fi

  verify_existing
  printf 'Verified existing official GB Studio %s CLI: %s\n' "$setup_gbs_version" "$setup_cli"
  printf 'Verified existing GBDK %s compiler: %s\n' "$setup_gbdk_version" "$setup_gbdk_compiler"
  exit 0
fi

if [[ -e "$setup_gbdk_compiler" && ! -x "$setup_gbdk_compiler" ]]; then
  printf 'The existing GBDK compiler is not executable; repair it manually: %s\n' \
    "$setup_gbdk_compiler" >&2
  exit 1
fi

for setup_managed_directory in \
  "$setup_downloads" "$setup_apps" "$setup_local/vendor" "$setup_vendor" \
  "$setup_local/gbdk" "$setup_local/.yarn" "$setup_local/.yarn/global" \
  "$setup_local/.yarn/cache" "$setup_vendor/node_modules"; do
  if [[ -L "$setup_managed_directory" ]]; then
    printf 'A managed game toolchain directory must not be a symbolic link: %s\n' \
      "$setup_managed_directory" >&2
    exit 1
  fi
  if [[ -e "$setup_managed_directory" && ! -d "$setup_managed_directory" ]]; then
    printf 'A managed game toolchain path is not a directory: %s\n' \
      "$setup_managed_directory" >&2
    exit 1
  fi
done

download_and_verify() (
  local archive_path="$1"
  local expected_sha="$2"
  local archive_url="$3"
  local temporary_directory=""
  local quarantine_directory
  local checksum_command

  # Only the unique, mode-0700 directory created by this invocation is removed.
  # Bad old cache files are retained separately for diagnosis, never installed.
  trap 'if [[ -n "$temporary_directory" ]]; then rm -rf -- "$temporary_directory"; fi' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [[ -L "$setup_downloads" || ! -d "$setup_downloads" || ! -O "$setup_downloads" ]]; then
    printf 'Release downloads require an owned real directory: %s\n' "$setup_downloads" >&2
    return 1
  fi

  if [[ -L "$archive_path" ]]; then
    printf 'Refusing a symbolic-link release archive: %s\n' "$archive_path" >&2
    return 1
  fi
  if [[ -e "$archive_path" && ! -f "$archive_path" ]]; then
    printf 'The cached release archive must be a regular file: %s\n' "$archive_path" >&2
    return 1
  fi
  if [[ -e "$archive_path" && ! -O "$archive_path" ]]; then
    printf 'Refusing a release archive owned by another user: %s\n' "$archive_path" >&2
    return 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    checksum_command=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    checksum_command=shasum
  else
    printf '%s\n' 'ModRetro Chromatic setup requires sha256sum or shasum to authenticate official releases.' >&2
    return 1
  fi

  verify_archive() {
    local candidate="$1"
    local archive_bytes
    if [[ -L "$candidate" || ! -f "$candidate" || ! -O "$candidate" ]]; then return 1; fi
    archive_bytes="$(wc -c < "$candidate")"
    if (( archive_bytes > 536870912 )); then return 1; fi
    if [[ "$checksum_command" == sha256sum ]]; then
      printf '%s  %s\n' "$expected_sha" "$candidate" | sha256sum --check --status -
    else
      printf '%s  %s\n' "$expected_sha" "$candidate" | shasum -a 256 -c - >/dev/null
    fi
  }

  if [[ -f "$archive_path" ]]; then
    if verify_archive "$archive_path"; then return 0; fi
    quarantine_directory="$(mktemp -d "$setup_downloads/.rejected.XXXXXX")"
    mv -- "$archive_path" "$quarantine_directory/"
    printf 'Quarantined an invalid cached release archive at %s; retrying a fresh verified download.\n' \
      "$quarantine_directory/${archive_path##*/}" >&2
  fi

  require_command curl
  temporary_directory="$(mktemp -d "$setup_downloads/.download.XXXXXX")"
  local temporary_archive="$temporary_directory/${archive_path##*/}"
  if ! curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --retry 3 --connect-timeout 20 --max-time 1800 --max-filesize 536870912 \
    --output "$temporary_archive" "$archive_url"; then
    printf 'Official release download failed; no partial archive was cached or installed: %s\n' "$archive_url" >&2
    return 1
  fi
  if ! verify_archive "$temporary_archive"; then
    printf 'Official release SHA-256 verification failed; archive was not installed: %s\n' "$archive_path" >&2
    return 1
  fi
  if [[ -L "$setup_downloads" || ! -d "$setup_downloads" || ! -O "$setup_downloads" ]]; then
    printf 'The owned release download directory changed during download: %s\n' "$setup_downloads" >&2
    return 1
  fi
  # Linking into the known directory publishes the verified basename atomically
  # without overwriting an entry (including a link) from a concurrent invocation.
  if ! ln -- "$temporary_archive" "$setup_downloads/"; then
    printf 'The release cache destination changed during download; nothing was overwritten: %s\n' "$archive_path" >&2
    return 1
  fi
)

if [[ "$setup_with_desktop" == true ]]; then
  if [[ "$setup_system" == Darwin && ! -d "$setup_apps/GB Studio.app" ]]; then
    mkdir -p "$setup_downloads" "$setup_apps"
    download_and_verify "$setup_gbs_archive" "$setup_gbs_sha" \
      "https://github.com/chrismaltby/gb-studio/releases/download/v${setup_gbs_version}/${setup_gbs_asset}"
    require_command ditto
    ditto -x -k "$setup_gbs_archive" "$setup_apps"

    if [[ ! -d "$setup_apps/GB Studio.app" ]]; then
      setup_nested_archive="$setup_apps/gb-studio-main-${setup_platform/-/_}.zip"
      if [[ ! -f "$setup_nested_archive" || -L "$setup_nested_archive" ]]; then
        printf 'The official GB Studio release did not contain the expected macOS application.\n' >&2
        exit 1
      fi
      ditto -x -k "$setup_nested_archive" "$setup_apps"
    fi

    if [[ ! -d "$setup_apps/GB Studio.app" ]]; then
      printf 'The official GB Studio macOS application could not be extracted.\n' >&2
      exit 1
    fi
  elif [[ "$setup_system" == Linux && ! -f "$setup_apps/$setup_gbs_asset" ]]; then
    mkdir -p "$setup_downloads" "$setup_apps"
    download_and_verify "$setup_gbs_archive" "$setup_gbs_sha" \
      "https://github.com/chrismaltby/gb-studio/releases/download/v${setup_gbs_version}/${setup_gbs_asset}"
    cp "$setup_gbs_archive" "$setup_apps/$setup_gbs_asset"
    chmod +x "$setup_apps/$setup_gbs_asset"
  fi
fi

if [[ ! -x "$setup_gbdk_compiler" ]]; then
  mkdir -p "$setup_downloads"
  download_and_verify "$setup_gbdk_archive" "$setup_gbdk_sha" \
    "https://github.com/gbdk-2020/gbdk-2020/releases/download/${setup_gbdk_version}/${setup_gbdk_asset}"
  require_command tar
  tar -xzf "$setup_gbdk_archive" -C "$setup_local"

  if [[ ! -f "$setup_gbdk_compiler" || ! -x "$setup_gbdk_compiler" ]]; then
    printf 'The verified GBDK release did not contain an executable compiler: %s\n' \
      "$setup_gbdk_compiler" >&2
    exit 1
  fi
fi
verify_gbdk

if [[ "$setup_with_cli" == true ]]; then
  if [[ ! -f "$setup_cli" ]]; then
    require_command git
    require_command node
    require_command corepack
    mkdir -p "$setup_local/vendor"

    if [[ -L "$setup_vendor/.git" ]]; then
      printf 'The official GB Studio checkout must contain a real git directory: %s\n' \
        "$setup_vendor/.git" >&2
      exit 1
    elif [[ ! -d "$setup_vendor/.git" ]]; then
      if [[ -e "$setup_vendor" ]]; then
        printf 'The existing official GB Studio checkout is invalid; repair it manually: %s\n' \
          "$setup_vendor" >&2
        exit 1
      fi
      git clone --depth 1 --branch "v${setup_gbs_version}" \
        https://github.com/chrismaltby/gb-studio.git "$setup_vendor"
    fi

    (
      cd "$setup_vendor"
      setup_actual_commit="$(git rev-parse HEAD)"
      if [[ "$setup_actual_commit" != "$setup_gbs_commit" ]]; then
        printf 'The official GB Studio checkout has commit %s; expected verified v%s commit %s.\n' \
          "$setup_actual_commit" "$setup_gbs_version" "$setup_gbs_commit" >&2
        exit 1
      fi
      git submodule update --init --depth 1 appData/engine/gbvm
      setup_actual_gbvm_commit="$(git -C appData/engine/gbvm rev-parse HEAD)"
      if [[ "$setup_actual_gbvm_commit" != "$setup_gbvm_commit" ]]; then
        printf 'The official GBVM source has commit %s; expected verified commit %s.\n' \
          "$setup_actual_gbvm_commit" "$setup_gbvm_commit" >&2
        exit 1
      fi

      setup_build_tools="buildTools/$setup_platform/gbdk"
      if [[ -L buildTools || -L "buildTools/$setup_platform" ]]; then
        printf 'The official GB Studio build-tools directories must not be symbolic links: %s\n' \
          "buildTools/$setup_platform" >&2
        exit 1
      elif [[ ! -d "buildTools/$setup_platform" ]]; then
        printf 'The official GB Studio checkout lacks build tools for %s.\n' "$setup_platform" >&2
        exit 1
      fi
      if [[ -L "$setup_build_tools" ]]; then
        printf 'GB Studio build tools require a real GBDK directory, not a symbolic link: %s\n' \
          "$setup_build_tools" >&2
        exit 1
      elif [[ -e "$setup_build_tools" && ! -x "$setup_build_tools/bin/lcc" ]]; then
        printf 'The existing GB Studio build tools are incomplete; repair them manually: %s\n' \
          "$setup_build_tools" >&2
        exit 1
      elif [[ ! -e "$setup_build_tools" ]]; then
        # Upstream's build-tools copier reads symlinks as ordinary files.
        cp -R "$setup_local/gbdk" "$setup_build_tools"
      fi

      # Use one archive cache inside the owned root; do not inherit a second cache.
      env -u YARN_NO_PROXY -u YARN_NPM_MINIMAL_AGE_GATE -u YARN_CACHE_FOLDER \
        YARN_ENABLE_GLOBAL_CACHE=true \
        YARN_GLOBAL_FOLDER="$setup_local/.yarn/global" \
        ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
        corepack yarn install --immutable

      if [[ ! -d node_modules/electron || -L node_modules/electron ]]; then
        printf '%s\n' 'Official GB Studio dependencies did not provide a real Electron package.' >&2
        exit 1
      fi

      # The project CLI runs in Node. Electron's package only requires this
      # metadata string; its desktop binary is never launched or required.
      if [[ -L node_modules/electron/path.txt ]]; then
        printf '%s\n' 'Official GB Studio Electron metadata must be a real file, not a symbolic link.' >&2
        exit 1
      elif [[ -e node_modules/electron/path.txt && ! -f node_modules/electron/path.txt ]]; then
        printf '%s\n' 'Official GB Studio Electron metadata must be a regular file.' >&2
        exit 1
      elif [[ ! -f node_modules/electron/path.txt ]]; then
        printf 'electron' > node_modules/electron/path.txt
      fi

      NO_TYPE_CHECKING=1 node node_modules/webpack/bin/webpack.js \
        --config ./src/apps/gb-studio-cli/webpack.cli.config.js
    )
  fi

  verify_cli
fi

if [[ "$setup_with_desktop" == true && "$setup_system" == Darwin ]]; then
  printf 'GB Studio %s desktop editor: %s\n' "$setup_gbs_version" "$setup_apps/GB Studio.app"
elif [[ "$setup_with_desktop" == true ]]; then
  printf 'GB Studio %s desktop editor: %s\n' "$setup_gbs_version" "$setup_apps/$setup_gbs_asset"
else
  printf '%s\n' 'GB Studio desktop editor: optional; headless project compilation requires no GUI.'
fi
printf 'GBDK %s compiler: %s\n' "$setup_gbdk_version" "$setup_gbdk_compiler"

if [[ -f "$setup_cli" ]]; then
  printf 'Official GB Studio %s CLI: %s\n' "$setup_gbs_version" "$setup_cli"
else
  printf '%s\n' 'Official GB Studio CLI: optional; rerun setup with --with-cli to compile .gbsproj projects.'
fi
