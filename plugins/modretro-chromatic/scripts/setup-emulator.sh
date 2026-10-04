#!/usr/bin/env bash
set -euo pipefail

setup_dry_run=false
setup_help=false
usage() {
  printf 'Usage: %s [--dry-run] [--help]\n' "$0"
  printf '%s\n' 'Legacy developer setup for the optional PyBoy environment.' \
    '--dry-run prints an unverified plan without running tools.' \
    'For installed plugins, use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.'
}
for setup_argument in "$@"; do
  case "$setup_argument" in
    --dry-run) setup_dry_run=true ;;
    --help|-h) setup_help=true ;;
    *) printf 'Unknown emulator setup option: %s\n' "$setup_argument" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ "$setup_help" == true ]]; then usage; exit 0; fi
python_version="${GB_STUDIO_PYTHON_VERSION:-3.13}"
if [[ ! "$python_version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  printf 'The requested emulator Python version must be an explicit numeric version: %s\n' "$python_version" >&2
  exit 2
fi
if [[ "$setup_dry_run" == true ]]; then
  # Deliberately use lexical paths and shell builtins: even uname, uv, Python,
  # and the existence of the proposed dependency root are unnecessary to plan.
  setup_plan_script_directory="${BASH_SOURCE[0]%/*}"
  if [[ "$setup_plan_script_directory" == "${BASH_SOURCE[0]}" ]]; then setup_plan_script_directory=.; fi
  setup_plan_root="${GB_STUDIO_TOOLCHAIN_ROOT:-$setup_plan_script_directory/..}"
  printf '%s\n' '[dry-run] Plan only; no tools were run and dependency health is unverified.'
  printf '[dry-run] Would verify/reuse or prepare Python %s, PyBoy 2.7.0, Pillow >=11,<13 at %s/.local/pyboy-venv.\n' \
    "$python_version" "$setup_plan_root"
  printf '%s\n' '[dry-run] Paths are lexical. Apply requires trusted uv if installation or repair is needed; installed plugins should use packaged setup.mjs with an external dependency root.'
  exit 0
fi

# Never let an unrelated project, virtual environment, or Python import path
# influence the plugin-owned interpreter and dependencies.
unset BASH_ENV ENV UV_PROJECT UV_WORKING_DIR UV_CONFIG_FILE UV_ENV_FILE VIRTUAL_ENV \
  PYTHONPATH PYTHONHOME PYTHONSTARTUP PYTHONUSERBASE PYTHONWARNINGS

script_directory="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
plugin_directory="$(cd -P -- "${script_directory}/.." && pwd -P)"

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

toolchain_directory="${GB_STUDIO_TOOLCHAIN_ROOT:-${plugin_directory}}"
if [[ ! -d "${toolchain_directory}" ]]; then
  echo "The selected game toolchain root must be an existing directory: ${toolchain_directory}" >&2
  exit 1
fi
toolchain_directory="$(cd -P -- "${toolchain_directory}" && pwd -P)"
assert_mutable_toolchain "$toolchain_directory"
local_directory="${toolchain_directory}/.local"
runtime_directory="${local_directory}/pyboy-venv"

if [[ -L "${local_directory}" ]]; then
  if [[ ! -d "${local_directory}" ]]; then
    echo "The game toolchain .local link is broken: ${local_directory}" >&2
    echo "Repair the trusted toolchain link before setting up the emulator." >&2
    exit 1
  fi
  local_directory="$(cd -P -- "${local_directory}" && pwd -P)"
  runtime_directory="${local_directory}/pyboy-venv"
elif [[ -e "${local_directory}" && ! -d "${local_directory}" ]]; then
  echo "The game toolchain .local path is not a directory: ${local_directory}" >&2
  exit 1
fi
assert_mutable_toolchain "$local_directory"

if [[ -L "${runtime_directory}" ]]; then
  echo "The existing PyBoy environment must be a real directory, not a symbolic link: ${runtime_directory}" >&2
  echo "Repair or relocate the existing environment manually; setup will not replace it." >&2
  exit 1
fi

environment_exists=false
if [[ -e "${runtime_directory}" ]]; then
  environment_exists=true
  if [[ ! -d "${runtime_directory}" ]]; then
    echo "The existing PyBoy environment path is not a directory: ${runtime_directory}" >&2
    echo "Repair or relocate it manually; setup will not replace it." >&2
    exit 1
  fi

  if [[ ! -f "${runtime_directory}/pyvenv.cfg" || -L "${runtime_directory}/pyvenv.cfg" ]]; then
    echo "The existing PyBoy environment is missing a regular pyvenv.cfg: ${runtime_directory}" >&2
    echo "Repair or relocate it manually; setup will not remove or recreate it." >&2
    exit 1
  fi

  if [[ ! -d "${runtime_directory}/bin" || -L "${runtime_directory}/bin" ]]; then
    echo "The existing PyBoy environment has an invalid bin directory: ${runtime_directory}" >&2
    echo "Repair or relocate it manually; setup will not remove or recreate it." >&2
    exit 1
  fi

  if [[ ! -f "${runtime_directory}/bin/python" || ! -x "${runtime_directory}/bin/python" ]]; then
    echo "The existing PyBoy environment is missing an executable bin/python: ${runtime_directory}" >&2
    echo "Repair or relocate it manually; setup will not remove or recreate it." >&2
    exit 1
  fi
fi

python_executable="${runtime_directory}/bin/python"

# Python and uv must never run from a selected, potentially hostile project.
cd -P -- "${script_directory}"

verify_runtime() {
  "${python_executable}" -I -c '
import sys
import pyboy
import PIL
from importlib.metadata import version

pyboy_version = version("pyboy")
pillow_version = version("Pillow")

if pyboy_version != "2.7.0":
    raise RuntimeError(f"Expected PyBoy 2.7.0, found {pyboy_version}")

try:
    pillow_major = int(pillow_version.split(".", 1)[0])
except (TypeError, ValueError) as error:
    raise RuntimeError(f"Invalid Pillow version: {pillow_version}") from error

if pillow_major not in (11, 12):
    raise RuntimeError(f"Expected Pillow >=11,<13, found {pillow_version}")

print("Python " + sys.version.split()[0])
print("PyBoy " + pyboy_version)
print("Pillow " + pillow_version)
'
}

if [[ "${environment_exists}" == true ]]; then
  if verify_runtime; then
    echo "Verified the optional PyBoy runtime at ${python_executable}"
    exit 0
  fi

  echo "The existing PyBoy runtime requires dependency repair; preserving its virtual environment." >&2
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "The optional emulator setup requires uv: https://docs.astral.sh/uv/" >&2
  exit 1
fi

if [[ "${environment_exists}" == false ]]; then
  requested_python="python${python_version}"
  if resolved_python="$(command -v "${requested_python}" 2>/dev/null)" && [[ "${resolved_python}" == /* ]]; then
    requested_python="${resolved_python}"
  fi

  uv venv \
    --no-project \
    --no-config \
    --directory "${script_directory}" \
    --python "${requested_python}" \
    "${runtime_directory}"
fi

if [[ ! -f "${runtime_directory}/pyvenv.cfg" || ! -f "${python_executable}" || ! -x "${python_executable}" ]]; then
  echo "PyBoy environment creation did not produce a valid virtual environment: ${runtime_directory}" >&2
  echo "Repair or relocate it manually; setup will not remove or recreate it." >&2
  exit 1
fi

uv pip install \
  --no-config \
  --no-sources \
  --directory "${script_directory}" \
  --python "${python_executable}" \
  'pyboy==2.7.0' \
  'pillow>=11,<13'

if ! verify_runtime; then
  echo "The PyBoy environment could not import its required pyboy and Pillow runtimes." >&2
  echo "Repair the existing environment and rerun setup; it was not removed or recreated." >&2
  exit 1
fi

echo "Verified the optional PyBoy runtime at ${python_executable}"
