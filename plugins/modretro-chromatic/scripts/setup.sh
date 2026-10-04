#!/bin/sh
# The packaged front door must also work before Node/MCP exists. Dependency
# detection and installation beyond Node belong to the shared setup.mjs manager.
set -eu
unset NODE_OPTIONS NODE_PATH BASH_ENV ENV CDPATH
umask 077

setup_command=doctor
setup_original_command=doctor
setup_root=
setup_components=runtime,build,emulator
setup_probes=
setup_json=false
setup_yes=false
setup_dry_run=false
setup_help=false
setup_seen=' '
setup_child=
setup_lock_owned=false
setup_stage=
setup_node_status=missing
setup_detected_version=
setup_node_checked=false
setup_owner=codex-gb-studio-setup
setup_error=
setup_cleanup_error=
setup_phase=preflight
setup_bootstrap_installed=false
setup_trap_active=false
setup_json_requested=false
setup_passive_doctor=false
for setup_argument in "$@"; do
  if [ "$setup_argument" = --json ]; then setup_json_requested=true; fi
done

fail() { setup_error=$*; if [ "$setup_trap_active" != true ]; then emit_error; fi; exit 1; }
bad_argument() { setup_error=$*; emit_error; exit 64; }
quote_json() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}
quote_shell() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
failure_json() {
  printf '{"schemaVersion":1,"bootstrapOnly":true,"status":"error","error":'; quote_json "$setup_error"
  printf ',"phase":'; quote_json "$setup_phase"
  printf ',"bootstrapInstalled":%s,"stagingPath":' "$setup_bootstrap_installed"
  if [ -n "$setup_stage" ]; then quote_json "$setup_stage"; else printf null; fi
  printf ',"cleanupError":'
  if [ -n "$setup_cleanup_error" ]; then quote_json "$setup_cleanup_error"; else printf null; fi
  printf '}\n'
}
emit_error() {
  if [ "$setup_json_requested" = true ]; then failure_json
  else
    printf 'ModRetro Chromatic setup: %s\n' "$setup_error" >&2
    [ -z "$setup_cleanup_error" ] || printf 'Cleanup: %s\n' "$setup_cleanup_error" >&2
  fi
}
reject_control_characters() {
  case "$1" in *'
'*) bad_argument 'Arguments must not contain control characters.' ;; esac
  if printf '%s' "$1" | LC_ALL=C grep '[[:cntrl:]]' >/dev/null 2>&1; then
    bad_argument 'Arguments must not contain control characters.'
  fi
}
once() {
  case "$setup_seen" in *" $1 "*) bad_argument "Option $1 may only be supplied once." ;; esac
  setup_seen="$setup_seen$1 "
}
validate_csv() {
  csv_value=$1
  csv_kind=$2
  case "$csv_value" in ''|,*|*,|*,,*) bad_argument "$csv_kind must be a nonempty comma-separated list." ;; esac
  csv_seen=' '
  while :; do
    csv_item=${csv_value%%,*}
    case "$csv_kind:$csv_item" in
      components:runtime|components:build|components:emulator|components:desktop) ;;
      probes:cli-version|probes:gbdk-version|probes:emulator-import) ;;
      *) bad_argument "Unknown $csv_kind value: $csv_item" ;;
    esac
    case "$csv_seen" in *" $csv_item "*) bad_argument "Duplicate $csv_kind value: $csv_item" ;; esac
    csv_seen="$csv_seen$csv_item "
    case "$csv_value" in *,*) csv_value=${csv_value#*,} ;; *) break ;; esac
  done
}
parse_arguments() {
  if [ "$#" -gt 0 ]; then
    case "$1" in doctor|plan|apply) setup_command=$1; shift ;; esac
  fi
  setup_original_command=$setup_command
  while [ "$#" -gt 0 ]; do
    reject_control_characters "$1"
    setup_option=$1
    shift
    if [ "$setup_option" = -h ]; then setup_option=--help; fi
    once "$setup_option"
    case "$setup_option" in
      --root|--components|--probes)
        [ "$#" -gt 0 ] || bad_argument "$setup_option requires a value."
        [ -n "$1" ] || bad_argument "$setup_option requires a nonempty value."
        reject_control_characters "$1"
        case "$1" in --*) bad_argument "$setup_option requires a value." ;; esac
        case "$setup_option" in
          --root) setup_root=$1 ;;
          --components) setup_components=$1 ;;
          --probes) setup_probes=$1 ;;
        esac
        shift ;;
      --json) setup_json=true ;;
      --yes) setup_yes=true ;;
      --dry-run) setup_dry_run=true ;;
      --help) setup_help=true ;;
      *) bad_argument "Unknown setup option: $setup_option" ;;
    esac
  done
  validate_csv "$setup_components" components
  [ -z "$setup_probes" ] || validate_csv "$setup_probes" probes
  if [ "$setup_dry_run" = true ]; then setup_command=plan; fi
  if [ -n "$setup_probes" ] && [ "$setup_command" != doctor ]; then
    bad_argument '--probes is available only for doctor, never plan or --dry-run.'
  fi
  if [ "$setup_yes" = true ] && [ "$setup_original_command" != apply ]; then
    bad_argument '--yes is available only for apply.'
  fi
  if [ "$setup_command" = apply ] && [ "$setup_yes" != true ] && [ "$setup_help" != true ]; then
    bad_argument 'apply requires explicit --yes consent. Run plan first.'
  fi
}

parse_arguments "$@"
if [ "$setup_command" = doctor ] && [ -z "$setup_probes" ]; then
  setup_passive_doctor=true
fi
if [ "$setup_help" = true ]; then
  cat <<'HELP'
Usage: sh scripts/setup.sh [doctor|plan|apply] [options]
  --root ABSOLUTE_PATH       Owned dependency data directory, outside the plugin
  --components LIST         runtime,build,emulator,desktop (default: first three)
  --probes LIST             doctor only: cli-version,gbdk-version,emulator-import
  --json                    Machine-readable report
  --yes                     Required consent for apply downloads and changes
  --dry-run                 Plan only; never install or run component probes
  --help, -h                Show this help without changing anything

doctor and plan do not install. Before Node exists, this launcher reports only
the bootstrap boundary, including the pinned Node source and destination.
Node --version is a bootstrap prerequisite check, not a component smoke probe.
With Node 22+, setup.mjs provides the shared dependency doctor/plan/apply flow.
No profile, PATH, marketplace, installed plugin, or running MCP server is changed.
HELP
  exit 0
fi

setup_script_directory=$(cd -- "$(dirname -- "$0")" && pwd -P)
setup_package_root=$(cd -- "$setup_script_directory/.." && pwd -P)
setup_script="$setup_script_directory/setup.sh"
[ -f "$setup_script_directory/setup.mjs" ] || fail 'The packaged scripts/setup.mjs manager is missing; obtain a complete plugin package.'

case "$(uname -s)" in
  Darwin) setup_os=darwin ;;
  Linux) setup_os=linux ;;
  *) setup_os=unsupported ;;
esac
case "$(uname -m)" in
  arm64|aarch64) setup_arch=arm64 ;;
  x86_64|amd64) setup_arch=x64 ;;
  *) setup_arch=unsupported ;;
esac
setup_platform="$setup_os-$setup_arch"
if [ -z "$setup_root" ] && [ -n "${GB_STUDIO_SETUP_ROOT:-}" ]; then
  setup_root=$GB_STUDIO_SETUP_ROOT
fi
if [ -z "$setup_root" ]; then
  case "$setup_os" in
    darwin) [ -n "${HOME:-}" ] || bad_argument 'Set --root to an absolute owned data directory.'
      setup_root="$HOME/Library/Application Support/modretro-chromatic" ;;
    *) if [ -n "${XDG_DATA_HOME:-}" ]; then setup_root="$XDG_DATA_HOME/modretro-chromatic"
      else [ -n "${HOME:-}" ] || bad_argument 'Set --root to an absolute owned data directory.'
        setup_root="$HOME/.local/share/modretro-chromatic"
      fi ;;
  esac
fi
reject_control_characters "$setup_root"
case "$setup_root" in /*) ;; *) bad_argument '--root must be an absolute filesystem path.' ;; esac
while [ "${setup_root%/}" != "$setup_root" ]; do setup_root=${setup_root%/}; done
[ -n "$setup_root" ] && [ "$setup_root" != / ] || bad_argument '--root must not be a filesystem root.'
case "$setup_root/" in *'//'*|*'/./'*|*'/../'*) bad_argument '--root must not contain empty, . or .. path components.' ;; esac
case "$setup_root" in
  "$setup_package_root"|"$setup_package_root"/*) bad_argument '--root must be outside the immutable plugin package.' ;;
esac
if [ "$setup_passive_doctor" != true ]; then
  case "$setup_package_root" in "$setup_root"/*) bad_argument '--root must not contain the plugin package.' ;; esac
fi
for setup_cache_root in "${HOME:-}/.codex/plugins/cache" "${HOME:-}/.agents/plugins/cache" "${CODEX_HOME:-${HOME:-}/.codex}/plugins/cache"; do
  case "$setup_root" in "$setup_cache_root"|"$setup_cache_root"/*) bad_argument '--root must be outside the immutable plugin cache.' ;; esac
done

assert_no_links() {
  setup_checked_path=$1
  while [ "$setup_checked_path" != / ] && [ -n "$setup_checked_path" ]; do
    [ ! -L "$setup_checked_path" ] || fail "Refusing symlink path: $setup_checked_path"
    setup_checked_path=${setup_checked_path%/*}
  done
}
assert_directory_path() {
  assert_no_links "$1"
  setup_checked_path=$1
  while [ "$setup_checked_path" != / ] && [ -n "$setup_checked_path" ]; do
    if [ -e "$setup_checked_path" ] && [ ! -d "$setup_checked_path" ]; then
      fail "Expected a directory, not an existing file: $setup_checked_path"
    fi
    setup_checked_path=${setup_checked_path%/*}
  done
}
marker_matches() {
  [ -f "$setup_root/.gb-studio-setup.json" ] && [ ! -L "$setup_root/.gb-studio-setup.json" ] || return 1
  [ "$(wc -c < "$setup_root/.gb-studio-setup.json")" -le 256 ] || return 1
  # Whitespace may separate JSON tokens, but must not change the owner string.
  # This narrow shape is intentional: a Node-less launcher cannot generally
  # parse arbitrary JSON and must not accidentally adopt a different owner.
  setup_marker=$(tr '\r\n' '  ' < "$setup_root/.gb-studio-setup.json")
  marker_schema='"schemaVersion"[[:space:]]*:[[:space:]]*1'
  marker_owner='"owner"[[:space:]]*:[[:space:]]*"codex-gb-studio-setup"'
  printf '%s' "$setup_marker" | grep -E "^[[:space:]]*\\{[[:space:]]*($marker_schema[[:space:]]*,[[:space:]]*$marker_owner|$marker_owner[[:space:]]*,[[:space:]]*$marker_schema)[[:space:]]*\\}[[:space:]]*$" >/dev/null
}
assert_root_ownership() {
  assert_directory_path "$setup_root"
  if [ -e "$setup_root/.gb-studio-setup.json" ] || [ -L "$setup_root/.gb-studio-setup.json" ]; then
    marker_matches || fail "Invalid ownership marker; will not adopt or modify $setup_root"
  elif [ -d "$setup_root" ]; then
    for setup_entry in "$setup_root"/.[!.]* "$setup_root"/..?* "$setup_root"/*; do
      if [ -e "$setup_entry" ] || [ -L "$setup_entry" ]; then
        fail "Existing --root is not empty or setup-owned: $setup_root. Select a new empty directory."
      fi
    done
  fi
}
assert_root_ownership
# On case-insensitive filesystems, spelling alone cannot prove confinement.
# Compare existing directory identities too, without creating the selected root.
setup_guard_cursor=$setup_root
while [ -n "$setup_guard_cursor" ] && [ "$setup_guard_cursor" != / ]; do
  if [ -e "$setup_guard_cursor" ]; then
    if [ "$setup_guard_cursor" -ef "$setup_package_root" ]; then
      bad_argument '--root must be outside the immutable plugin package, including filesystem aliases.'
    fi
    for setup_cache_root in "${HOME:-}/.codex/plugins/cache" "${HOME:-}/.agents/plugins/cache" "${CODEX_HOME:-${HOME:-}/.codex}/plugins/cache"; do
      if [ -e "$setup_cache_root" ] && [ "$setup_guard_cursor" -ef "$setup_cache_root" ]; then
        bad_argument '--root must be outside the immutable plugin cache, including filesystem aliases.'
      fi
    done
  fi
  setup_guard_cursor=${setup_guard_cursor%/*}
done
# A packaged runtime may live inside its owned setup root. Passive doctor only
# reads it; every route that can install or run component probes keeps the fence.
if [ -e "$setup_root" ] && [ "$setup_passive_doctor" != true ]; then
  setup_guard_cursor=$setup_package_root
  while [ -n "$setup_guard_cursor" ] && [ "$setup_guard_cursor" != / ]; do
    [ ! "$setup_guard_cursor" -ef "$setup_root" ] || bad_argument '--root must not contain the plugin package, including filesystem aliases.'
    setup_guard_cursor=${setup_guard_cursor%/*}
  done
fi

setup_node_version=
setup_node_archive=
setup_node_sha=
setup_node_url=
setup_release_count=0
while IFS="$(printf '\t')" read -r release_platform release_version release_archive release_sha release_url release_extra; do
  [ "$release_platform" = "$setup_platform" ] || continue
  setup_release_count=$((setup_release_count + 1))
  [ -z "$release_extra" ] || fail 'Invalid packaged Node release catalog.'
  setup_node_version=$release_version
  setup_node_archive=$release_archive
  setup_node_sha=$release_sha
  setup_node_url=$release_url
done < "$setup_script_directory/node-releases.tsv"
if [ "$setup_release_count" -gt 1 ]; then fail 'Duplicate platform in packaged Node release catalog.'; fi
setup_node_directory=
setup_node_binary=
setup_node_receipt=
if [ "$setup_release_count" -eq 1 ]; then
  case "$setup_node_version" in *[!0-9.]*|'') fail 'Invalid packaged Node version.' ;; esac
  case "$setup_node_sha" in *[!0-9a-f]*|'') fail 'Invalid packaged Node checksum.' ;; esac
  [ "${#setup_node_sha}" -eq 64 ] || fail 'Invalid packaged Node checksum.'
  setup_node_stem="node-v$setup_node_version-$setup_platform"
  [ "$setup_node_archive" = "$setup_node_stem.tar.gz" ] || fail 'Unexpected packaged Node archive name.'
  [ "$setup_node_url" = "https://nodejs.org/download/release/v$setup_node_version/$setup_node_archive" ] || fail 'Unexpected packaged Node download source.'
  setup_node_directory="$setup_root/node/$setup_platform"
  setup_node_binary="$setup_node_directory/$setup_node_stem/bin/node"
  setup_node_receipt="$setup_node_directory/receipt.json"
  assert_directory_path "$setup_node_directory"
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then hash_output=$(sha256sum "$1") || return 1
  elif command -v shasum >/dev/null 2>&1; then hash_output=$(shasum -a 256 "$1") || return 1
  else return 1; fi
  hash_value=${hash_output%% *}
  case "$hash_value" in *[!0-9a-f]*|'') return 1 ;; esac
  [ "${#hash_value}" -eq 64 ] || return 1
  printf '%s' "$hash_value"
}
node_version() {
  # This is the bootstrap runtime check only. Never import Python, invoke the
  # official CLI/GBDK, or run a project just to locate the JavaScript manager.
  setup_node_checked=true
  setup_detected_version=
  setup_checked_version=$(
    "$1" --version 2>/dev/null &
    version_pid=$!
    (
      version_sleep_pid=
      trap 'if [ -n "$version_sleep_pid" ]; then kill -TERM "$version_sleep_pid" 2>/dev/null || :; wait "$version_sleep_pid" 2>/dev/null || :; fi; exit' INT TERM HUP
      sleep 10 & version_sleep_pid=$!
      wait "$version_sleep_pid" || exit
      version_sleep_pid=
      kill -TERM "$version_pid" 2>/dev/null || exit
      sleep 1 & version_sleep_pid=$!
      wait "$version_sleep_pid" || exit
      version_sleep_pid=
      kill -KILL "$version_pid" 2>/dev/null || :
    ) >/dev/null 2>&1 &
    version_timer_pid=$!
    if wait "$version_pid"; then version_status=0; else version_status=$?; fi
    kill -TERM "$version_timer_pid" 2>/dev/null || :
    wait "$version_timer_pid" 2>/dev/null || :
    exit "$version_status"
  ) || return 1
  case "$setup_checked_version" in *'
'*) return 1 ;; esac
  printf '%s\n' "$setup_checked_version" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' >/dev/null || return 1
  setup_checked_major=${setup_checked_version#v}
  setup_checked_major=${setup_checked_major%%.*}
  case "$setup_checked_major" in *[!0-9]*|'') return 1 ;; esac
  setup_detected_version=$setup_checked_version
  [ "$setup_checked_major" -ge 22 ]
}
physical_node_path() {
  physical_node=$1
  physical_links=0
  while :; do
    physical_directory=$(cd -- "$(dirname -- "$physical_node")" 2>/dev/null && pwd -P) || return 1
    physical_node="$physical_directory/${physical_node##*/}"
    [ -L "$physical_node" ] || break
    physical_links=$((physical_links + 1))
    [ "$physical_links" -le 32 ] || return 1
    physical_target=$(readlink "$physical_node") || return 1
    case "$physical_target" in /*) physical_node=$physical_target ;; *) physical_node="$physical_directory/$physical_target" ;; esac
  done
  printf '%s' "$physical_node"
}
managed_receipt_matches() {
  [ -f "$setup_node_receipt" ] && [ -f "$setup_node_binary" ] && [ -x "$setup_node_binary" ] || return 1
  assert_no_links "$setup_node_receipt"
  assert_no_links "$setup_node_binary"
  [ "$(wc -c < "$setup_node_receipt")" -le 8192 ] || return 1
  # The bootstrap has no JSON runtime. Accept only our narrow, generated receipt
  # fields; compare the current executable hash BEFORE executing managed Node.
  for receipt_field in \
    '  "schemaVersion": 1,' \
    '  "owner": "codex-gb-studio-setup",' \
    "  \"platform\": \"$setup_platform\"," \
    "  \"version\": \"$setup_node_version\"," \
    "  \"sourceUrl\": \"$setup_node_url\"," \
    "  \"archiveSha256\": \"$setup_node_sha\"," \
    "  \"executablePath\": $(quote_json "$setup_node_binary"),"; do
    [ "$(grep -F -x -c "$receipt_field" "$setup_node_receipt")" = 1 ] || return 1
  done
  receipt_hash=$(sed -n 's/^  "executableSha256": "\([0-9a-f]*\)",$/\1/p' "$setup_node_receipt")
  [ "${#receipt_hash}" -eq 64 ] || return 1
  actual_hash=$(hash_file "$setup_node_binary") || return 1
  [ "$actual_hash" = "$receipt_hash" ] || return 1
  node_version "$setup_node_binary" && [ "$setup_checked_version" = "v$setup_node_version" ]
}
if [ -n "$setup_node_directory" ] && [ -e "$setup_node_directory" ]; then
  if managed_receipt_matches; then
    exec "$setup_node_binary" "$setup_script_directory/setup.mjs" "$@"
  fi
  setup_node_status=broken
fi

# Search absolute PATH directories only. Never substitute a shell alias, a
# node.cmd wrapper, or a node executable found through a relative PATH entry.
setup_path=${PATH:-}
while :; do
  setup_path_directory=${setup_path%%:*}
  case "$setup_path_directory" in
    /*)
      setup_candidate="$setup_path_directory/node"
      if [ -f "$setup_candidate" ] && [ -x "$setup_candidate" ]; then
        if setup_candidate=$(physical_node_path "$setup_candidate"); then
          setup_candidate_allowed=true
          setup_candidate_cursor=${setup_candidate%/*}
          while [ -n "$setup_candidate_cursor" ] && [ "$setup_candidate_cursor" != / ]; do
            if [ "$setup_candidate_cursor" -ef "$setup_package_root" ] || { [ -e "$setup_root" ] && [ "$setup_candidate_cursor" -ef "$setup_root" ]; }; then
              setup_candidate_allowed=false
              break
            fi
            setup_candidate_cursor=${setup_candidate_cursor%/*}
          done
          if [ -n "$setup_node_binary" ] && [ -f "$setup_node_binary" ] && [ "$setup_candidate" -ef "$setup_node_binary" ]; then setup_candidate_allowed=false; fi
          case "$setup_candidate" in
            "$setup_root"/*|"$setup_package_root"/*) : ;; # Never bypass a failed managed receipt using PATH.
            *)
              if [ "$setup_candidate_allowed" = true ]; then
                if node_version "$setup_candidate"; then exec "$setup_candidate" "$setup_script_directory/setup.mjs" "$@"; fi
                if [ "$setup_node_status" != broken ]; then
                  if [ -n "$setup_detected_version" ]; then setup_node_status=incompatible; else setup_node_status=broken; fi
                fi
              fi ;;
          esac
        fi
      fi ;;
  esac
  case "$setup_path" in *:*) setup_path=${setup_path#*:} ;; *) break ;; esac
done
if [ "$setup_release_count" -eq 0 ]; then setup_node_status=unsupported; fi

print_next_command() {
  printf '/bin/sh '; quote_shell "$setup_script"
  printf ' apply --root '; quote_shell "$setup_root"
  printf ' --components '; quote_shell "$setup_components"
  printf ' --yes'
}
report_bootstrap() {
  if [ "$setup_json" = true ]; then
    printf '{"schemaVersion":1,"bootstrapOnly":true,"command":'; quote_json "$setup_command"
    printf ',"setupRoot":'; quote_json "$setup_root"
    printf ',"selectedComponents":'; quote_json "$setup_components"
    printf ',"runtime":{"status":'; quote_json "$setup_node_status"
    printf ',"requiredVersion":">=22","managedVersion":'; quote_json "$setup_node_version"
    printf ',"detectedVersion":'; quote_json "$setup_detected_version"
    printf ',"platform":'; quote_json "$setup_platform"
    printf ',"sourceUrl":'; quote_json "$setup_node_url"
    printf ',"archiveSha256":'; quote_json "$setup_node_sha"
    printf ',"executablePath":'; quote_json "$setup_node_binary"
    printf '},"bootstrapVersionCheckPerformed":%s,"componentProbesExecuted":[],"requestedProbes":' "$setup_node_checked"; quote_json "$setup_probes"
    printf ',"nextCommand":'
    if [ "$setup_release_count" -eq 1 ]; then
      printf '['; quote_json /bin/sh; printf ','; quote_json "$setup_script"
      printf ',"apply","--root",'; quote_json "$setup_root"
      printf ',"--components",'; quote_json "$setup_components"
      printf ',"--yes"]'
    else printf null; fi
    printf ',"note":'
    if [ "$setup_release_count" -eq 1 ]; then
      quote_json 'Bootstrap only: complete dependency discovery requires Node 22+. No component probe or installation was performed.'
    else
      quote_json 'Bootstrap only: this platform has no packaged Node installer. Supply a supported Node 22+ distribution and rerun doctor. No component probe or installation was performed.'
    fi
    printf '}\n'
  else
    printf 'Node runtime: %s (required >=22; managed %s)\n' "$setup_node_status" "${setup_node_version:-unavailable on this platform}"
    [ -z "$setup_detected_version" ] || printf 'Detected version: %s\n' "$setup_detected_version"
    printf 'Dependency root: %s\n' "$setup_root"
    if [ -n "$setup_node_url" ]; then
      printf 'Official source: %s\nSHA-256: %s\nDestination: %s\n' "$setup_node_url" "$setup_node_sha" "$setup_node_binary"
      printf 'After reviewing the plan, permit setup explicitly:\n  '; print_next_command; printf '\n'
    else
      printf 'This platform has no packaged Node installer. Supply a supported Node 22+ distribution, then rerun doctor.\n'
    fi
    printf 'Bootstrap only: complete dependency discovery requires Node 22+. No component probe or installation was performed.\n'
    if [ "$setup_node_checked" = true ]; then printf 'Only Node --version was used to check the bootstrap prerequisite.\n'; fi
  fi
}
if [ "$setup_command" != apply ]; then
  report_bootstrap
  [ "$setup_command" = plan ] && exit 0
  exit 1
fi
[ "$setup_release_count" -eq 1 ] || { report_bootstrap; exit 1; }
if [ -e "$setup_node_directory" ]; then
  fail "Managed Node is broken or unowned at $setup_node_directory. Preserve it for inspection and select a new empty --root; setup will not overwrite it."
fi
for setup_tool in curl tar mkdir mktemp mv date awk; do
  command -v "$setup_tool" >/dev/null 2>&1 || fail "Node bootstrap requires $setup_tool. Install that OS prerequisite, then rerun the same explicit apply command."
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  fail 'Node bootstrap requires sha256sum or shasum to authenticate the official archive.'
fi

cleanup_lock() {
  [ -z "$setup_cleanup_error" ] || return 1
  if [ "$setup_lock_owned" = true ]; then
    if [ -f "$setup_root/.setup-lock/owner.json" ] && [ ! -L "$setup_root/.setup-lock/owner.json" ] &&
       grep -F -x "{\"schemaVersion\":1,\"pid\":$$,\"startedAt\":\"$setup_started_at\",\"owner\":\"$setup_owner\",\"phase\":\"node-bootstrap\"}" "$setup_root/.setup-lock/owner.json" >/dev/null 2>&1; then
      for setup_lock_entry in "$setup_root/.setup-lock"/.[!.]* "$setup_root/.setup-lock"/..?* "$setup_root/.setup-lock"/*; do
        if { [ -e "$setup_lock_entry" ] || [ -L "$setup_lock_entry" ]; } && [ "$setup_lock_entry" != "$setup_root/.setup-lock/owner.json" ]; then
          setup_cleanup_error='Owned lock directory was changed; retained it and its owner receipt for inspection.'
          return 1
        fi
      done
      if ! rm -f "$setup_root/.setup-lock/owner.json"; then
        setup_cleanup_error='Unable to remove the owned lock receipt; retained it for inspection.'
        return 1
      fi
      if ! rmdir "$setup_root/.setup-lock" 2>/dev/null; then
        setup_cleanup_error='Owned lock directory was changed; retained it for inspection.'
        return 1
      fi
    elif [ ! -e "$setup_root/.setup-lock/owner.json" ] && [ ! -L "$setup_root/.setup-lock/owner.json" ]; then
      # mkdir succeeded, but writing its receipt may have failed or been
      # cancelled. Only our still-empty newly acquired lock can be removed.
      if ! rmdir "$setup_root/.setup-lock" 2>/dev/null; then
        setup_cleanup_error='The newly acquired lock was not empty; retained it for inspection.'
        return 1
      fi
    else
      setup_cleanup_error='Lock ownership changed; retained the lock for inspection.'
      return 1
    fi
    setup_lock_owned=false
  fi
}
on_exit() {
  setup_exit_status=$?
  trap - 0 INT TERM HUP
  setup_trap_active=false
  if ! cleanup_lock; then
    if [ "$setup_exit_status" -eq 0 ]; then setup_exit_status=1; fi
  fi
  if [ "$setup_exit_status" -ne 0 ]; then
    [ -n "$setup_error" ] || setup_error='Node bootstrap failed before handoff to the dependency manager.'
    emit_error
  fi
  if [ "$setup_exit_status" -ne 0 ] && [ -n "$setup_stage" ] && [ -d "$setup_stage" ]; then
    if [ ! -e "$setup_stage/failure.json" ] && [ ! -L "$setup_stage/failure.json" ]; then
      (set -C; failure_json > "$setup_stage/failure.json") 2>/dev/null || :
    fi
    printf 'ModRetro Chromatic setup: failed or cancelled Node staging retained at %s. A retry uses a new staging path; no cached partial archive is reused.\n' "$setup_stage" >&2
  fi
  exit "$setup_exit_status"
}
on_signal() {
  setup_signal_exit=$1
  trap '' INT TERM HUP
  if [ -n "$setup_child" ]; then kill -TERM "$setup_child" 2>/dev/null || :; wait "$setup_child" 2>/dev/null || :; setup_child=; fi
  setup_error='Node bootstrap was cancelled; completed files and partial staging are preserved.'
  exit "$setup_signal_exit"
}
run_child() {
  "$@" &
  setup_child=$!
  if wait "$setup_child"; then setup_child=; return 0
  else setup_child_status=$?; setup_child=; return "$setup_child_status"; fi
}

# This is the first mutating point. All argument, path and source checks above
# are shared by doctor/plan and complete before mkdir, download or installation.
assert_root_ownership
mkdir -p "$setup_root"
assert_directory_path "$setup_root/.setup-lock"
setup_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
setup_trap_active=true
trap on_exit 0
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP
if ! mkdir "$setup_root/.setup-lock" 2>/dev/null; then
  fail "Another setup owns $setup_root/.setup-lock. Inspect its owner.json and wait for that operation. Never remove a live lock; after verifying its process has stopped, remove only the stale lock directory and retry."
fi
setup_lock_owned=true
printf '{"schemaVersion":1,"pid":%s,"startedAt":"%s","owner":"%s","phase":"node-bootstrap"}\n' "$$" "$setup_started_at" "$setup_owner" > "$setup_root/.setup-lock/owner.json"
if [ ! -f "$setup_root/.gb-studio-setup.json" ]; then
  printf '{"schemaVersion":1,"owner":"codex-gb-studio-setup"}\n' > "$setup_root/.setup-lock/root-marker.json"
  mv "$setup_root/.setup-lock/root-marker.json" "$setup_root/.gb-studio-setup.json"
fi
assert_directory_path "$setup_root/.setup-staging"
assert_directory_path "$setup_root/node"
assert_directory_path "$setup_node_directory"
[ ! -e "$setup_node_directory" ] || fail 'The Node destination appeared during setup; it was not overwritten.'
mkdir -p "$setup_root/.setup-staging" "$setup_root/node"
setup_stage=$(mktemp -d "$setup_root/.setup-staging/node-$setup_platform.XXXXXXXX")
setup_phase=download
printf 'ModRetro Chromatic setup: installing authenticated Node %s into %s\n' "$setup_node_version" "$setup_node_directory" >&2
run_child curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --connect-timeout 30 --max-time 900 --max-filesize 268435456 --retry 2 --retry-delay 1 \
  --output "$setup_stage/$setup_node_archive.partial" "$setup_node_url" || fail 'Node download failed. The partial file is retained, not reused on retry.'
setup_phase=archive-validation
download_sha=$(hash_file "$setup_stage/$setup_node_archive.partial") || fail 'Unable to authenticate the Node download.'
[ "$download_sha" = "$setup_node_sha" ] || fail 'Node archive SHA-256 mismatch. The download is quarantined in its unique staging directory; nothing was installed.'
mv "$setup_stage/$setup_node_archive.partial" "$setup_stage/$setup_node_archive"
run_child tar -tf "$setup_stage/$setup_node_archive" > "$setup_stage/archive-members.txt" || fail 'The authenticated Node archive could not be listed.'
awk -v prefix="$setup_node_stem/" '
  index($0, prefix) != 1 || $0 ~ /(^|\/)\.\.(\/|$)/ || $0 ~ /^\// { bad = 1 }
  END { exit bad }
' "$setup_stage/archive-members.txt" || fail 'The Node archive has unexpected extraction paths.'
mkdir "$setup_stage/publish"
setup_phase=extract
run_child tar -xf "$setup_stage/$setup_node_archive" -C "$setup_stage/publish" || fail 'The authenticated Node archive could not be extracted.'
staged_node="$setup_stage/publish/$setup_node_stem/bin/node"
[ -f "$staged_node" ] && [ -x "$staged_node" ] && [ ! -L "$staged_node" ] || fail 'The extracted Node executable is missing or invalid.'
[ -f "$setup_stage/publish/$setup_node_stem/lib/node_modules/npm/bin/npm-cli.js" ] || fail 'The extracted Node distribution is missing its npm CLI.'
setup_phase=runtime-validation
node_version "$staged_node" && [ "$setup_checked_version" = "v$setup_node_version" ] || fail 'The authenticated Node distribution could not run with its pinned version on this host.'
executable_sha=$(hash_file "$staged_node") || fail 'Unable to hash the installed Node executable.'
{
  printf '{\n  "schemaVersion": 1,\n  "owner": "codex-gb-studio-setup",\n'
  printf '  "platform": "%s",\n  "version": "%s",\n' "$setup_platform" "$setup_node_version"
  printf '  "sourceUrl": "%s",\n  "archiveSha256": "%s",\n' "$setup_node_url" "$setup_node_sha"
  printf '  "executablePath": '; quote_json "$setup_node_binary"; printf ',\n'
  printf '  "executableSha256": "%s",\n  "installedAt": "%s"\n}\n' "$executable_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$setup_stage/publish/receipt.json"
[ ! -e "$setup_node_directory" ] && [ ! -L "$setup_node_directory" ] || fail 'The Node destination appeared during setup; it was not overwritten.'
# Promote the version directory and receipt together; a crash cannot leave an
# installed Node directory without its source and executable-hash receipt.
setup_phase=publish
mv "$setup_stage/publish" "$setup_node_directory"
setup_bootstrap_installed=true
setup_phase=receipt-validation
managed_receipt_matches || fail 'The installed Node receipt or executable did not validate.'
if ! cleanup_lock; then fail 'Node bootstrap finished, but owned lock cleanup failed; the dependency manager was not started.'; fi
trap - 0 INT TERM HUP
setup_trap_active=false
exec "$setup_node_binary" "$setup_script_directory/setup.mjs" "$@"
