#!/usr/bin/env python3
"""Register a lean, prepared ModRetro Chromatic plugin source without installing it.

The cached source contains only reviewed npm distribution files. Its generated
MCP configuration points to the separately prepared runtime and toolchain.
Personal marketplace updates use Codex's official plugin-creator helper; an
explicit, brand-new workspace marketplace can use the documented public format.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PLUGIN_NAME = "modretro-chromatic"
DEFAULT_CATEGORY = "Productivity"
CHECKOUT_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=CHECKOUT_ROOT,
        help="Distributable plugin checkout; defaults to this script's checkout.",
    )
    parser.add_argument("--runtime-root", type=Path, help="Stable prepared MCP runtime; defaults to --source.")
    parser.add_argument("--toolchain-root", type=Path, help="Existing toolchain owner; defaults to the selected runtime.")
    parser.add_argument("--payload-root", type=Path, help="Immutable payload storage; defaults to <source>/artifacts/plugin-payloads.")
    parser.add_argument("--marketplace-root", type=Path, help="Explicit workspace marketplace root; never writes another user's profile.")
    parser.add_argument("--marketplace-name", help="Name for a new explicit workspace marketplace; existing names cannot be changed.")
    parser.add_argument("--confirm-user-profile", type=Path, help="On Windows, confirm the current desktop-user profile from that user's own terminal.")
    parser.add_argument("--json", action="store_true", help="Print the verified/planned registration and desktop-user handoff as JSON.")
    parser.add_argument(
        "--replace-link",
        action="store_true",
        help="Replace an existing plugin symlink; never replaces a real file or directory.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate prerequisites and describe changes without changing payloads or registration.",
    )
    parser.add_argument(
        "--platform",
        choices=("auto", "windows", "posix"),
        default="auto",
        help=argparse.SUPPRESS,
    )
    return parser.parse_args()


def read_object(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read {label} at {path}: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{label} at {path} must contain a JSON object.")
    return payload


def load_official_helper(user_home: Path) -> Any:
    configured_home = os.environ.get("CODEX_HOME")
    codex_root = (
        Path(configured_home).expanduser()
        if configured_home is not None and configured_home.strip()
        else user_home / ".codex"
    )
    helper_path = (
        codex_root
        / "skills"
        / ".system"
        / "plugin-creator"
        / "scripts"
        / "create_basic_plugin.py"
    )
    if not helper_path.is_file():
        raise FileNotFoundError(f"Official Codex plugin-creator helper not found: {helper_path}")

    spec = importlib.util.spec_from_file_location("codex_plugin_creator", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load official plugin-creator helper: {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def existing_marketplace_entry(
    marketplace_path: Path, *, default_name: str = "personal", requested_name: str | None = None
) -> tuple[str, bool]:
    if not marketplace_path.exists():
        return requested_name or default_name, False

    payload = read_object(marketplace_path, "Personal marketplace")
    marketplace_name = payload.get("name")
    if not isinstance(marketplace_name, str) or not marketplace_name.strip():
        raise ValueError(f"Personal marketplace at {marketplace_path} needs a nonempty name.")
    if requested_name is not None and requested_name != marketplace_name:
        raise ValueError(f"Marketplace already uses name {marketplace_name!r}; refusing to rename it.")

    entries = payload.get("plugins", [])
    if not isinstance(entries, list):
        raise ValueError(f"Personal marketplace at {marketplace_path} needs a plugins array.")

    matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("name") == PLUGIN_NAME]
    if len(matches) > 1:
        raise ValueError(f"Personal marketplace contains duplicate entries for {PLUGIN_NAME}.")
    if matches:
        expected_source = {"source": "local", "path": f"./plugins/{PLUGIN_NAME}"}
        if matches[0].get("source") != expected_source:
            raise ValueError(
                f"Existing {PLUGIN_NAME} marketplace entry points elsewhere; "
                "resolve that existing entry explicitly instead of overwriting it."
            )
        return marketplace_name, True

    return marketplace_name, False


def validate_source(source: Path, runtime_root: Path) -> None:
    manifest_path = source / ".codex-plugin" / "plugin.json"
    manifest = read_object(manifest_path, "Plugin manifest")
    if manifest.get("name") != PLUGIN_NAME:
        raise ValueError(f"Plugin manifest must declare name {PLUGIN_NAME!r}: {manifest_path}")

    required_paths = {
        "MCP configuration": source / ".mcp.json",
        "portable MCP launcher": source / "scripts" / "start-mcp.mjs",
        "package allowlist": source / "package.json",
        "compiled MCP server": runtime_root / "dist" / "server.js",
        "installed MCP SDK": runtime_root / "node_modules" / "@modelcontextprotocol" / "sdk",
        "Python emulator worker": source / "scripts" / "emulator_worker.py",
    }
    missing = [
        f"{label}: {required_path}"
        for label, required_path in required_paths.items()
        if not required_path.exists()
    ]
    if missing:
        raise ValueError(
            "Plugin runtime is incomplete; run npm install and npm run build first:\n  "
            + "\n  ".join(missing)
        )


def is_directory_junction(candidate: Path) -> bool:
    inspect_junction = getattr(candidate, "is_junction", None)
    if inspect_junction is not None:
        return bool(inspect_junction())
    try:
        details = candidate.lstat()
    except FileNotFoundError:
        return False
    mount_point_tag = getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", 0xA0000003)
    return getattr(details, "st_reparse_tag", None) == mount_point_tag


def is_reparse_point(candidate: Path) -> bool:
    try:
        attributes = getattr(candidate.lstat(), "st_file_attributes", 0)
    except FileNotFoundError:
        return False
    return bool(attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def is_directory_link(candidate: Path) -> bool:
    return candidate.is_symlink() or is_directory_junction(candidate)


def validate_registration_locations(user_home: Path, marketplace_path: Path) -> None:
    for candidate in (
        user_home / "plugins",
        user_home / ".agents",
        user_home / ".agents" / "plugins",
    ):
        if not (candidate.exists() or candidate.is_symlink() or is_reparse_point(candidate)):
            continue
        if is_directory_link(candidate) or is_reparse_point(candidate):
            raise ValueError(f"Refusing linked registration directory: {candidate}")
        if not candidate.is_dir():
            raise ValueError(f"User-profile registration path is not a directory: {candidate}")
        if not candidate.resolve(strict=True).is_relative_to(user_home):
            raise ValueError(f"User-profile registration directory escapes its owner: {candidate}")

    if marketplace_path.is_symlink() or is_reparse_point(marketplace_path):
        raise ValueError(f"Refusing linked marketplace file: {marketplace_path}")


def trusted_node_executable(rejected_roots: list[Path]) -> Path:
    executable_name = "node.exe" if os.name == "nt" else "node"

    for directory in os.environ.get("PATH", os.defpath).split(os.pathsep):
        if not directory:
            continue
        candidate_directory = Path(directory.strip('"'))
        if not candidate_directory.is_absolute():
            continue
        try:
            resolved_directory = candidate_directory.resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        if not resolved_directory.is_dir() or any(resolved_directory.is_relative_to(root) for root in rejected_roots):
            continue

        executable = resolved_directory / executable_name
        if not executable.is_file() or not os.access(executable, os.X_OK):
            continue
        try:
            resolved_executable = executable.resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        if not any(resolved_executable.is_relative_to(root) for root in rejected_roots):
            return resolved_executable

    raise FileNotFoundError(
        "Plugin registration requires an installed Node.js executable "
        "in a trusted absolute PATH directory."
    )


def executable_rejected_roots(source: Path, runtime_root: Path, toolchain_root: Path, user_home: Path) -> list[Path]:
    roots = {source, runtime_root, toolchain_root}
    for selected in list(roots):
        local = selected / ".local"
        if local.exists():
            roots.add(local.resolve(strict=True).parent)
    for name in ("GB_STUDIO_WORKSPACE_ROOT", "GB_STUDIO_PROJECT_ROOT"):
        configured = os.environ.get(name, "").strip()
        if configured:
            selected = Path(configured).expanduser().resolve(strict=False)
            roots.add(selected.parent if selected.is_file() else selected)
    current = Path.cwd().resolve(strict=True)
    if current != user_home and current != Path(current.anchor):
        roots.add(current)
    return list(roots)


def remove_directory_link(candidate: Path) -> None:
    if candidate.is_symlink():
        candidate.unlink()
    elif is_directory_junction(candidate):
        candidate.rmdir()
    else:
        raise ValueError(f"Refusing to remove existing non-link plugin path: {candidate}")


def create_windows_junction(source: Path, destination: Path, node: Path, user_home: Path) -> None:
    node_program = (
        'const fs = require("node:fs"); '
        'const path = require("node:path"); '
        'const [source, destination] = process.argv.slice(1); '
        'if (process.argv.length !== 3 || !path.isAbsolute(source) || '
        '!path.isAbsolute(destination)) throw new Error("Expected absolute junction paths"); '
        'fs.symlinkSync(source, destination, "junction");'
    )
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in {"NODE_OPTIONS", "NODE_PATH"}
    }
    result = subprocess.run(
        [str(node), "-e", node_program, str(source), str(destination)],
        check=False,
        cwd=user_home,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode:
        explanation = result.stderr.strip() or result.stdout.strip() or "unknown Node.js error"
        raise RuntimeError(f"Could not create user-level plugin directory junction: {explanation}")

    if not is_directory_link(destination):
        raise RuntimeError(f"Node.js did not create a verifiable plugin directory junction: {destination}")
    try:
        actual_target = destination.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise RuntimeError(f"Created plugin directory junction cannot be resolved: {destination}") from error
    if actual_target != source:
        raise RuntimeError(
            f"Created plugin directory junction points to {actual_target}, not the selected checkout {source}."
        )


def windows_token_profile() -> Path:
    """Read the current process token's profile, never search other user profiles."""
    if os.name != "nt":
        # The private --platform override is for portable filesystem fixtures.
        return Path(os.environ.get("USERPROFILE", str(Path.home()))).resolve(strict=True)

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    userenv = ctypes.WinDLL("userenv", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    advapi32.OpenProcessToken.argtypes = (wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE))
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    userenv.GetUserProfileDirectoryW.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
    userenv.GetUserProfileDirectoryW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise ValueError("Could not verify the current Windows user token; use an explicit --marketplace-root handoff.")
    try:
        length = wintypes.DWORD(0)
        userenv.GetUserProfileDirectoryW(token, None, ctypes.byref(length))
        if length.value < 2 or length.value > 32768:
            raise ValueError("Could not verify the current Windows profile; use an explicit --marketplace-root handoff.")
        buffer = ctypes.create_unicode_buffer(length.value)
        if not userenv.GetUserProfileDirectoryW(token, buffer, ctypes.byref(length)):
            raise ValueError("Could not verify the current Windows profile; use an explicit --marketplace-root handoff.")
        return Path(buffer.value).resolve(strict=True)
    finally:
        kernel32.CloseHandle(token)


def validate_windows_personal_profile(user_home: Path, confirmation: Path | None) -> None:
    known_sandbox_names = {
        "wdagutilityaccount", "systemprofile", "localservice", "networkservice", "localsystem",
    }
    identity_names = [user_home.name, os.environ.get("USERNAME", "")]
    for identity in identity_names:
        normalized = re.sub(r"[^a-z0-9]", "", identity.lower())
        if normalized.startswith("codexsandbox") or normalized in known_sandbox_names:
            raise ValueError(
                "Refusing personal registration from a Windows sandbox/service identity. "
                "Use --marketplace-root <explicit-workspace> and install from the normal desktop-user terminal."
            )
    token_profile = windows_token_profile()
    if os.path.normcase(str(token_profile)) != os.path.normcase(str(user_home)):
        raise ValueError(
            "USERPROFILE does not match the current Windows user token. "
            "Do not target another user's profile; use --marketplace-root <explicit-workspace>."
        )
    if confirmation is None:
        raise ValueError(
            "Windows personal registration needs --confirm-user-profile <current USERPROFILE> "
            "from the normal desktop-user terminal. An agent can prepare an explicit --marketplace-root instead."
        )
    if not confirmation.is_absolute() or confirmation.expanduser().resolve(strict=True) != user_home:
        raise ValueError(
            "The confirmed desktop-user profile does not match the current process profile. "
            "Do not write another user's configuration; use --marketplace-root <explicit-workspace>."
        )


def prepare_payload(args: argparse.Namespace, source: Path, runtime_root: Path, node: Path, *, dry_run: bool) -> dict[str, Any]:
    preparer = CHECKOUT_ROOT / "scripts" / "prepare-plugin-payload.mjs"
    if not preparer.is_file():
        raise FileNotFoundError(f"Portable plugin payload preparer not found: {preparer}")
    command = [str(node), str(preparer), "--source", str(source), "--runtime-root", str(runtime_root), "--json"]
    if args.toolchain_root is not None:
        command.extend(("--toolchain-root", str(args.toolchain_root.expanduser().resolve(strict=True))))
    if args.payload_root is not None:
        command.extend(("--output-root", str(args.payload_root.expanduser().absolute())))
    if dry_run:
        command.append("--dry-run")
    environment = {
        key: value for key, value in os.environ.items()
        if key.upper() not in {"NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV"}
    }
    result = subprocess.run(
        command, cwd=source, env=environment, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False, timeout=90,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Lean plugin payload preparation failed.")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Lean plugin payload preparer returned invalid JSON.") from error
    if not isinstance(payload, dict) or payload.get("pluginName") != PLUGIN_NAME or not isinstance(payload.get("payloadPath"), str):
        raise RuntimeError("Lean plugin payload preparer returned an unexpected result.")
    return payload


def is_owned_plugin_link(plugin_link: Path, already_registered: bool) -> bool:
    target = plugin_link.resolve(strict=False)
    if not target.exists():
        return already_registered
    try:
        return read_object(target / ".codex-plugin" / "plugin.json", "Previous plugin manifest").get("name") == PLUGIN_NAME
    except ValueError:
        return False


def create_plugin_link(target: Path, destination: Path, *, windows: bool, node: Path, root: Path) -> None:
    if windows:
        create_windows_junction(target, destination, node, root)
    else:
        destination.symlink_to(target, target_is_directory=True)


def default_marketplace(name: str) -> dict[str, Any]:
    return {
        "name": name,
        "interface": {"displayName": " ".join(part.capitalize() for part in name.split("-"))},
        "plugins": [{
            "name": PLUGIN_NAME,
            "source": {"source": "local", "path": f"./plugins/{PLUGIN_NAME}"},
            "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
            "category": DEFAULT_CATEGORY,
        }],
    }


def write_marketplace_atomically(marketplace_path: Path, marketplace_name: str, helper: Any | None) -> None:
    """Let the official helper edit a private copy, then publish without lost updates."""
    original = marketplace_path.read_bytes() if marketplace_path.exists() else None
    original_payload = read_object(marketplace_path, "Marketplace") if original is not None else None
    original_mode = stat.S_IMODE(marketplace_path.stat().st_mode) if original is not None else 0o600
    marketplace_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".gb-studio-marketplace-", suffix=".json", dir=marketplace_path.parent)
    temporary = Path(temporary_name)
    os.close(descriptor)
    try:
        if original is not None:
            temporary.write_bytes(original)
        else:
            temporary.unlink()
        if helper is None:
            if original is not None:
                raise RuntimeError("An existing marketplace can only be updated by the official plugin-creator helper.")
            with temporary.open("x", encoding="utf-8") as output:
                output.write(json.dumps(default_marketplace(marketplace_name), indent=2) + "\n")
        else:
            helper.update_marketplace_json(
                marketplace_path=temporary, marketplace_name=marketplace_name,
                plugin_name=PLUGIN_NAME, install_policy=helper.DEFAULT_INSTALL_POLICY,
                auth_policy=helper.DEFAULT_AUTH_POLICY, category=DEFAULT_CATEGORY, force=False,
            )
        proposed = read_object(temporary, "Proposed marketplace")
        proposed_name, registered = existing_marketplace_entry(temporary, requested_name=marketplace_name)
        if proposed_name != marketplace_name or not registered:
            raise RuntimeError("The official marketplace helper did not produce the expected plugin entry.")
        entry = next(item for item in proposed["plugins"] if isinstance(item, dict) and item.get("name") == PLUGIN_NAME)
        if entry.get("policy") != {"installation": "AVAILABLE", "authentication": "ON_INSTALL"} or entry.get("category") != DEFAULT_CATEGORY:
            raise RuntimeError("The new marketplace entry does not use the documented plugin policy format.")
        if original_payload is not None:
            unchanged = dict(proposed)
            unchanged["plugins"] = [item for item in proposed["plugins"] if not (isinstance(item, dict) and item.get("name") == PLUGIN_NAME)]
            normalized_original = dict(original_payload)
            normalized_original.setdefault("plugins", [])
            if unchanged != normalized_original:
                raise RuntimeError("Marketplace helper changed unrelated entries or metadata; refusing to publish it.")
        os.chmod(temporary, original_mode)
        if original is None:
            # Exclusive creation: never overwrite a marketplace created meanwhile.
            if os.name == "nt":
                os.rename(temporary, marketplace_path)  # Windows rename refuses an existing destination.
            else:
                os.link(temporary, marketplace_path)
        else:
            if marketplace_path.read_bytes() != original:
                raise RuntimeError("Marketplace changed during registration; retry after reviewing the concurrent update.")
            os.replace(temporary, marketplace_path)
    finally:
        if temporary.exists():
            temporary.unlink()


def handoff_commands(*, workspace: bool, root: Path, marketplace_name: str) -> list[list[str]]:
    commands = []
    if workspace:
        commands.extend([
            ["codex", "plugin", "marketplace", "add", str(root)],
            ["codex", "plugin", "marketplace", "list", "--json"],
        ])
    commands.extend([
        ["codex", "plugin", "add", f"{PLUGIN_NAME}@{marketplace_name}"],
        ["codex", "plugin", "list", "--marketplace", marketplace_name, "--json"],
    ])
    return commands


def display_command(arguments: list[str], windows: bool) -> str:
    if windows:
        return "& " + " ".join("'" + argument.replace("'", "''") + "'" for argument in arguments)
    return shlex.join(arguments)


def main() -> int:
    args = parse_args()
    # The test override may enable Windows behavior on Unix, never disable
    # native Windows identity and junction safeguards.
    windows = sys.platform == "win32" or args.platform == "windows"
    if windows and os.environ.get("USERPROFILE", "").strip():
        user_home = Path(os.environ["USERPROFILE"]).expanduser().resolve(strict=True)
    else:
        user_home = Path.home().resolve(strict=True)
    if not user_home.is_dir():
        raise ValueError(f"User profile must be an existing directory: {user_home}")

    workspace = args.marketplace_root is not None
    if args.marketplace_name is not None and (not workspace or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", args.marketplace_name)):
        raise ValueError("--marketplace-name is only for an explicit workspace marketplace and must be a lowercase hyphenated name.")
    if windows and not workspace:
        validate_windows_personal_profile(user_home, args.confirm_user_profile)
    if workspace and args.confirm_user_profile is not None:
        raise ValueError("--confirm-user-profile is for personal registration, not an explicit workspace marketplace.")

    root = Path(os.path.abspath(args.marketplace_root.expanduser())) if workspace else user_home
    if workspace:
        # The explicitly selected root can be new, but cannot redirect to another location.
        existing = root
        while not existing.exists() and existing != existing.parent:
            existing = existing.parent
        if existing.is_symlink() or is_reparse_point(existing) or existing.resolve(strict=True) != existing:
            raise ValueError(f"Explicit marketplace root must use a real, unlinked directory: {root}")
        if existing.exists() and not existing.is_dir():
            raise ValueError(f"Explicit marketplace root is not a directory: {root}")

    source = args.source.expanduser().resolve(strict=True)
    if not source.is_dir():
        raise ValueError(f"Plugin source must be a directory: {source}")

    runtime_root = (args.runtime_root or source).expanduser().resolve(strict=True)
    validate_source(source, runtime_root)
    marketplace_path = root / ".agents" / "plugins" / "marketplace.json"
    plugin_link = root / "plugins" / PLUGIN_NAME
    validate_registration_locations(root, marketplace_path)
    marketplace_name, already_registered = existing_marketplace_entry(
        marketplace_path, default_name="modretro-chromatic-local" if workspace else "personal", requested_name=args.marketplace_name,
    )
    helper = None
    if not already_registered:
        try:
            helper = load_official_helper(user_home)
        except FileNotFoundError:
            if not workspace or marketplace_path.exists():
                raise

    configured_toolchain = args.toolchain_root or os.environ.get("GB_STUDIO_TOOLCHAIN_ROOT") or runtime_root
    toolchain_root = Path(configured_toolchain).expanduser().resolve(strict=True)
    node = trusted_node_executable(executable_rejected_roots(source, runtime_root, toolchain_root, user_home))
    payload = prepare_payload(args, source, runtime_root, node, dry_run=True)
    payload_path = Path(payload["payloadPath"])
    plugin_is_link = is_directory_link(plugin_link)
    link_matches = plugin_is_link and plugin_link.resolve(strict=False) == payload_path
    link_exists = plugin_link.exists() or plugin_is_link or is_reparse_point(plugin_link)
    if link_exists and not link_matches:
        if not plugin_is_link:
            raise ValueError(f"Refusing to replace existing non-symlink plugin path: {plugin_link}")
        if not args.replace_link:
            raise ValueError(
                f"Plugin symlink already points to {plugin_link.resolve(strict=False)}; "
                "rerun with --replace-link to select this lean payload."
            )
        if not is_owned_plugin_link(plugin_link, already_registered):
            raise ValueError(f"Refusing to replace an unowned plugin link: {plugin_link}")

    link_description = "user-level directory junction" if windows else "symlink"
    action = "reuse" if link_matches else "replace" if link_exists else "create"
    if not args.dry_run:
        payload = prepare_payload(args, source, runtime_root, node, dry_run=False)
        if Path(payload["payloadPath"]) != payload_path:
            raise RuntimeError("The distributable source changed during registration; review it and rerun registration.")
        root.mkdir(parents=True, exist_ok=True)
        plugin_link.parent.mkdir(parents=True, exist_ok=True)
        validate_registration_locations(root, marketplace_path)
        previous_target = plugin_link.resolve(strict=False) if plugin_is_link else None
        changed_link = False
        try:
            if not link_matches:
                if plugin_is_link:
                    remove_directory_link(plugin_link)
                changed_link = True
                create_plugin_link(payload_path, plugin_link, windows=windows, node=node, root=root)
            if not already_registered:
                write_marketplace_atomically(marketplace_path, marketplace_name, helper)
            verified_name, verified_entry = existing_marketplace_entry(marketplace_path, requested_name=marketplace_name)
            if not verified_entry or verified_name != marketplace_name or plugin_link.resolve(strict=True) != payload_path:
                raise RuntimeError("Registration could not verify the marketplace entry and selected lean payload.")
        except BaseException:
            if changed_link:
                if is_directory_link(plugin_link):
                    remove_directory_link(plugin_link)
                if previous_target is not None:
                    create_plugin_link(previous_target, plugin_link, windows=windows, node=node, root=root)
            raise

    handoff = handoff_commands(workspace=workspace, root=root, marketplace_name=marketplace_name)
    result = {
        "schemaVersion": 1, "pluginName": PLUGIN_NAME, "marketplaceName": marketplace_name,
        "marketplacePath": str(marketplace_path), "marketplaceRoot": str(root), "pluginPath": str(plugin_link),
        "payload": payload, "linkAction": action, "workspaceMarketplace": workspace,
        "registered": not args.dry_run or (already_registered and link_matches), "installed": False,
        "dryRun": args.dry_run, "handoff": handoff,
    }
    if args.json:
        print(json.dumps(result))
    else:
        if args.dry_run:
            print(f"Would {action} {link_description}: {plugin_link} -> {payload_path}")
            print(f"Would {'preserve existing' if already_registered else 'add'} {'workspace' if workspace else 'personal'} marketplace entry: {marketplace_path}")
        else:
            print(f"Registered {PLUGIN_NAME} lean payload: {plugin_link} -> {payload_path}")
            print(f"{'Workspace' if workspace else 'Personal'} marketplace: {marketplace_path}")
        print("Installation has not been performed. In the normal desktop-user terminal, run and verify:")
        for command in handoff:
            print(f"  {display_command(command, windows)}")
        print("Start a new Codex task after the separate installation succeeds.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, OSError, RuntimeError, ValueError) as error:
        print(f"Registration failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
