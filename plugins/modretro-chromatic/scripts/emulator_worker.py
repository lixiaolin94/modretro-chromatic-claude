#!/usr/bin/env python3
"""Drive an independently installed PyBoy emulator over newline-delimited JSON.

The worker deliberately has no project-local Python dependency: PyBoy remains an
optional, separately installed LGPL runtime. Protocol records are the only bytes
written to stdout; diagnostics and Python logging belong on stderr.
"""

from __future__ import annotations

import argparse
import base64
from collections import deque
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import importlib.resources
import io
import json
import logging
import os
import queue
import signal
import stat
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any


MAX_FRAMES = 3_600
MAX_TIMELINE_ACTIONS = 128
MAX_TIMELINE_CHECKPOINTS = 64
MAX_STEP_SAMPLES = 8
MAX_INSPECTION_BYTES = 256
MAX_OAM_OBJECTS = 40
PROTOCOL_VERSION = 1
GB_HZ = 4_194_304
FRAME_DOTS = 70_224
MAX_RECORDING_BYTES = 512 * 1024 * 1024
MAX_RECORDING_FRAMES = 216_000
MAX_RECORDING_WALL_MS = 3_600_000
MAX_RECENT_FRAMES = 64
MAX_CLIP_FRAMES = 600
MAX_STATE_BYTES = 16 * 1024 * 1024
MAX_RECORDING_EVENTS = 250_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_RECORDING_EVENT_BYTES = 32 * 1024 * 1024
MAX_REVIEW_ACTIONS = 4_096
MAX_REVIEW_IMAGES = 8
MAX_REVIEW_METADATA_BYTES = 2 * 1024 * 1024
MAX_REVIEW_FRAME_RECORDS = MAX_FRAMES + MAX_REVIEW_ACTIONS + 1
RECORDING_RESERVE_BYTES = 16 * 1024
MAX_SIBLING_RECORDINGS = 64
MAX_SIBLING_RESERVED_BYTES = 1024 * 1024 * 1024
MAX_RECORDING_BRANCHES = 64
DEFAULT_RECORDING_LIMITS = {
    "sampleEveryFrames": 4,
    "recentFrameCount": 12,
    "maxBytes": 64 * 1024 * 1024,
    "maxFrames": 36_000,
    "maxWallTimeMs": 900_000,
}
BUTTONS = frozenset({"a", "b", "up", "down", "left", "right", "start", "select"})
MEMORY_REGIONS = {
    "vram": (0x8000, 0x2000),
    "wram": (0xC000, 0x2000),
    "oam": (0xFE00, 0xA0),
    "hram": (0xFF80, 0x7F),
}


def encoded(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf8")


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def bounded_recording_metadata(path: Path, maximum: int) -> bytes:
    # Keep reads bounded even if a file grows after the caller's stat check.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("Recording metadata must be a regular file")
        data = source.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Recording metadata exceeds its byte limit")
    return data


# A persistent worker must identify the implementation it actually loaded, not
# replacement source bytes that happen to appear at the same path later.
WORKER_SHA256 = digest(Path(__file__).read_bytes())


def bounded_integer(value: object, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}")
    return value


def sha256_string(value: object, name: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"{name} must be a lowercase SHA-256 digest")
    return value


def recording_branch_id(value: object) -> str:
    if (not isinstance(value, str) or not 11 <= len(value) <= 100 or not value.startswith("branch-")
            or not value[7:].isascii() or not value[7:].isdigit()):
        raise ValueError("An exact recording branchId is required")
    return value


def recording_prefix_pin(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"eventCount", "eventDigest", "byteLength", "sha256"}:
        raise ValueError("A recording prefix pin requires eventCount, eventDigest, byteLength, and sha256")
    return {
        "eventCount": bounded_integer(value.get("eventCount"), "prefix event count", 1, MAX_RECORDING_EVENTS),
        "eventDigest": sha256_string(value.get("eventDigest"), "prefix event digest"),
        "byteLength": bounded_integer(value.get("byteLength"), "prefix byte length", 1, MAX_RECORDING_BYTES),
        "sha256": sha256_string(value.get("sha256"), "prefix SHA-256"),
    }


def review_options(value: dict[str, Any]) -> dict[str, Any]:
    allowed = {"recordingPath", "sessionId", "branchId", "fromActionIndex", "toActionIndex",
               "fromFrame", "toFrame", "prefixPin", "maxImages"}
    if set(value) - allowed:
        raise ValueError("Unknown recording review options")
    session_id = value.get("sessionId")
    if not isinstance(session_id, str) or len(session_id) != 32 or any(character not in "0123456789abcdef" for character in session_id):
        raise ValueError("Recording review requires an exact sessionId")
    branch_id = recording_branch_id(value.get("branchId"))
    start = bounded_integer(value.get("fromActionIndex"), "fromActionIndex", 0, MAX_SAFE_INTEGER)
    end = bounded_integer(value.get("toActionIndex"), "toActionIndex", 0, MAX_SAFE_INTEGER)
    if not start <= end <= start + MAX_REVIEW_ACTIONS:
        raise ValueError(f"Review requires an ordered interval of at most {MAX_REVIEW_ACTIONS} normalized actions; narrow the interval")
    result = {"sessionId": session_id, "branchId": branch_id, "fromActionIndex": start, "toActionIndex": end,
              "maxImages": bounded_integer(value.get("maxImages", 4), "review image limit", 1, MAX_REVIEW_IMAGES)}
    if ("fromFrame" in value) != ("toFrame" in value):
        raise ValueError("Review frame bounds must be supplied together")
    if "fromFrame" in value:
        start_frame = bounded_integer(value["fromFrame"], "fromFrame", 0, MAX_RECORDING_FRAMES)
        end_frame = bounded_integer(value["toFrame"], "toFrame", 0, MAX_RECORDING_FRAMES)
        if not start_frame <= end_frame <= start_frame + MAX_FRAMES:
            raise ValueError(f"Review requires an ordered interval of at most {MAX_FRAMES} native frames; narrow the interval")
        result.update(fromFrame=start_frame, toFrame=end_frame)
    if "prefixPin" in value:
        result["prefixPin"] = recording_prefix_pin(value["prefixPin"])
    return result


def recording_limits(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ValueError("The recording option must be an object or false")
    unknown = set(value) - (set(DEFAULT_RECORDING_LIMITS) | {"outputPath"})
    if unknown:
        raise ValueError(f"Unknown recording options: {', '.join(sorted(unknown))}")
    bounds = {
        "sampleEveryFrames": (1, MAX_FRAMES),
        "recentFrameCount": (1, MAX_RECENT_FRAMES),
        "maxBytes": (64 * 1024, MAX_RECORDING_BYTES),
        "maxFrames": (1, MAX_RECORDING_FRAMES),
        "maxWallTimeMs": (1, MAX_RECORDING_WALL_MS),
    }
    return {
        key: bounded_integer(value.get(key, default), key, *bounds[key])
        for key, default in DEFAULT_RECORDING_LIMITS.items()
    }


class RecordingLimitError(RuntimeError):
    pass


class SessionCancelled(RuntimeError):
    pass


class RequestValidationError(ValueError):
    """A rejected request has not changed the emulator or its recording."""


class NativeFrameAccountingError(RuntimeError):
    """Only the prefix before an unauthenticated native tick is known."""

    def __init__(self, message: str, *, start_frame: int, confirmed_frame: int,
                 sampled_buttons: set[str]) -> None:
        super().__init__(message)
        self.start_frame = start_frame
        self.confirmed_frame = confirmed_frame
        self.sampled_buttons = sorted(sampled_buttons)
        self.requested_frames: int | None = None


def native_accounting_error(error: BaseException) -> NativeFrameAccountingError | None:
    seen: set[int] = set()
    cause: BaseException | None = error
    while cause is not None and id(cause) not in seen:
        if isinstance(cause, NativeFrameAccountingError):
            return cause
        seen.add(id(cause))
        cause = cause.__cause__ if cause.__cause__ is not None else cause.__context__
    return None


def directory_bytes(root: Path) -> int:
    """Count only regular files; recording directories must never contain links."""
    total = 0
    count = 0
    for directory, subdirectories, files in os.walk(root, followlinks=False):
        for name in subdirectories + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError("Recording files and directories must not be symbolic links")
        for name in files:
            path = Path(directory) / name
            if not path.is_file():
                raise ValueError("Recording artifacts must be regular files")
            total += path.stat().st_size
            count += 1
            if total > MAX_RECORDING_BYTES or count > MAX_RECORDING_EVENTS:
                raise RecordingLimitError("Recording storage exceeds the supported limit")
    return total


def _archive_identity(value: Any) -> tuple[Any, ...]:
    return tuple(getattr(value, key) for key in ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"))


def _archive_owned(value: Any) -> None:
    if not hasattr(os, "getuid") or value.st_uid != os.getuid() or value.st_mode & 0o7022 or stat.S_ISLNK(value.st_mode):
        raise ValueError("Recording archive requires owned paths without special or writable-by-others permission bits")


def _archive_bytes(path: Path, maximum: int) -> bytes:
    before = path.lstat()
    _archive_owned(before)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
        raise ValueError("Invalid archive metadata file")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        if _archive_identity(before) != _archive_identity(os.fstat(descriptor)):
            raise ValueError("Archive metadata identity changed")
        chunks = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(65536, before.st_size + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > before.st_size:
                raise ValueError("Archive metadata grew")
            chunks.append(chunk)
        if size != before.st_size or _archive_identity(before) != _archive_identity(os.fstat(descriptor)) or _archive_identity(before) != _archive_identity(path.lstat()):
            raise ValueError("Archive metadata changed")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def recording_archive_inventory(root: Path, resolve_path: Any) -> dict[str, Any]:
    if resolve_path(str(root), existing=True) != root or root.resolve(strict=True) != root:
        raise ValueError("Archive root is redirected")
    rows = []
    total = 0
    count = 0
    def visit(path: Path) -> None:
        nonlocal total, count
        before = path.lstat()
        _archive_owned(before)
        count += 1
        if count > 20000:
            raise ValueError("Recording member limit exceeded")
        name = "" if path == root else path.relative_to(root).as_posix()
        if stat.S_ISDIR(before.st_mode):
            rows.append([name, "directory", stat.S_IMODE(before.st_mode)])
            for child in sorted(os.listdir(path), key=lambda value: value.encode("utf-8")):
                visit(path / child)
        else:
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                raise ValueError("Recording contains a linked or non-regular member")
            total += before.st_size
            if total > MAX_RECORDING_BYTES:
                raise ValueError("Recording archive byte limit exceeded")
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
            try:
                if _archive_identity(before) != _archive_identity(os.fstat(descriptor)):
                    raise ValueError("Recording member identity changed")
                hashed = hashlib.sha256()
                size = 0
                while True:
                    chunk = os.read(descriptor, 65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > before.st_size:
                        raise ValueError("Recording member grew")
                    hashed.update(chunk)
                if size != before.st_size or _archive_identity(before) != _archive_identity(os.fstat(descriptor)):
                    raise ValueError("Recording member changed")
                rows.append([name, "file", stat.S_IMODE(before.st_mode), size, hashed.hexdigest()])
            finally:
                os.close(descriptor)
        if _archive_identity(before) != _archive_identity(path.lstat()):
            raise ValueError("Recording changed during inventory")
    visit(root)
    for marker in (".gitignore", ".npmignore"):
        if _archive_bytes(root / marker, 2) != b"*\n":
            raise ValueError("Recording package-protection marker differs")
    return {"digest": digest(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")), "bytes": total, "entries": count}


def recording_archive_origin(root: Path, resolve_path: Any) -> Path | None:
    container = root.parent
    archive_root = container.parent
    if root.name != "recording" or archive_root.name != "recording-archives" or archive_root.parent.name != "artifacts":
        return None
    try:
        if str(uuid.UUID(container.name)) != container.name:
            raise ValueError("Invalid archive container identity")
    except (ValueError, AttributeError):
        raise ValueError("Invalid archive container identity") from None
    mapping_path = container / "mapping.json"
    if resolve_path(str(mapping_path), existing=True) != mapping_path or mapping_path.resolve(strict=True) != mapping_path:
        raise ValueError("Archive mapping is redirected")
    raw = _archive_bytes(mapping_path, 4096)
    value = json.loads(raw)
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "originalPath", "archivePath", "sessionId", "manifestSha256", "inventory"} or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or value["archivePath"] != str(root) or not isinstance(value["originalPath"], str):
        raise ValueError("Invalid archive mapping")
    if not isinstance(value["sessionId"], str) or len(value["sessionId"]) != 32 or any(c not in "0123456789abcdef" for c in value["sessionId"]):
        raise ValueError("Invalid archive session identity")
    sha256_string(value["manifestSha256"], "archive manifest")
    original = Path(value["originalPath"])
    if not original.is_absolute() or original.is_relative_to(archive_root) or archive_root.is_relative_to(original) or resolve_path(str(original), existing=True) != original or original.resolve(strict=True) != original:
        raise ValueError("Invalid original recording reference")
    before = original.lstat()
    _archive_owned(before)
    if not stat.S_ISDIR(before.st_mode) or stat.S_IMODE(before.st_mode) != 0o700 or sorted(os.listdir(original)) != [".gitignore", ".npmignore", ".recording-archive.json"]:
        raise ValueError("Archive reference directory differs")
    for marker in (".gitignore", ".npmignore"):
        if _archive_bytes(original / marker, 2) != b"*\n":
            raise ValueError("Archive reference marker differs")
    pointer = original / ".recording-archive.json"
    if stat.S_IMODE(mapping_path.lstat().st_mode) != 0o600 or stat.S_IMODE(pointer.lstat().st_mode) != 0o600 or _archive_bytes(pointer, 4096) != raw:
        raise ValueError("Archive mapping copies differ")
    if recording_archive_inventory(root, resolve_path) != value["inventory"]:
        raise ValueError("Archived recording bytes or modes changed")
    manifest = _archive_bytes(root / "recording.json", 1024 * 1024)
    if digest(manifest) != value["manifestSha256"] or json.loads(manifest).get("sessionId") != value["sessionId"]:
        raise ValueError("Archived recording provenance changed")
    if _archive_identity(before) != _archive_identity(original.lstat()) or _archive_bytes(mapping_path, 4096) != raw or _archive_bytes(pointer, 4096) != raw:
        raise ValueError("Archive mapping changed during reading")
    return original


def artifact_usage(root: Path, resolve_path: Any) -> int:
    total = directory_bytes(root)
    original_root = recording_archive_origin(root, resolve_path)
    ledger = root / "derived.jsonl"
    if ledger.exists():
        if ledger.stat().st_size > 1024 * 1024:
            raise RecordingLimitError("The derived-artifact ledger exceeds its limit")
        for line in bounded_recording_metadata(ledger, 1024 * 1024).splitlines():
            row = json.loads(line)
            path = resolve_path(row.get("path"), existing=False)
            size = bounded_integer(row.get("bytes"), "derived artifact size", 0, MAX_RECORDING_BYTES)
            if not path.is_relative_to(root) and not (original_root is not None and path.is_relative_to(original_root)):
                # Retain reservations even if callers remove an external derived artifact.
                total += size
    return total


class Recording:
    """A small append-only journal. No ROM, source, or user save is copied here."""

    def __init__(
        self, root: Path, *, limits: dict[str, int], rom: dict[str, Any],
        runtime: dict[str, Any], initial_frames: int, resolve_path: Any,
    ) -> None:
        self.root = root
        self.limits = limits
        self.resolve_path = resolve_path
        self.session_id = uuid.uuid4().hex
        self.branch_id = "branch-0001"
        self.status = "recording"
        self.failure: str | None = None
        self.outcome: str | None = None
        self.reason: str | None = None
        self.total_frames = 0
        self.frame = 0
        self.sequence = 0
        self.event_digest = "0" * 64
        self.event_bytes = 0
        self.event_hasher = hashlib.sha256()
        self.committed_frame = 0
        self.committed_branch_id = self.branch_id
        self.committed_action_index = 0
        self.bytes_used = 0
        self.pending_frames = 0
        self.pending_start = 0
        self.pending_source = "manual"
        self.initial_frames = 0
        self.boot_finished = False
        self.rom = rom
        self.runtime = runtime
        self.branches: dict[str, dict[str, Any]] = {
            self.branch_id: {"actions": [], "evidence": [], "frame": 0,
                             "startingCondition": {"type": "clean-boot", "initialFrames": initial_frames, "cgb": rom["cgb"]}}
        }
        self.checkpoints: dict[str, dict[str, Any]] = {}
        self.recent: deque[dict[str, Any]] = deque(maxlen=limits["recentFrameCount"])
        self.root.parent.mkdir(parents=True, exist_ok=True)
        # Bounded retained attempts, without silently deleting someone else's evidence.
        reservations = 0
        siblings = 0
        for entry in self.root.parent.iterdir():
            manifest = entry / "recording.json"
            if entry.is_dir() and not entry.is_symlink() and manifest.is_file() and not manifest.is_symlink():
                try:
                    body = json.loads(manifest.read_bytes())
                    if body.get("kind") == "gb-studio-playtest":
                        siblings += 1
                        reservations += bounded_integer(body.get("limits", {}).get("maxBytes"), "recording reservation", 64 * 1024, MAX_RECORDING_BYTES)
                except (ValueError, OSError, TypeError):
                    raise RecordingLimitError("A neighboring recording has invalid quota metadata")
        if siblings >= MAX_SIBLING_RECORDINGS or reservations + limits["maxBytes"] > MAX_SIBLING_RESERVED_BYTES:
            raise RecordingLimitError("Retained recording quota reached; explicitly archive or remove an old recording")
        self.root.mkdir(mode=0o700, exist_ok=False)
        (self.root / "frames").mkdir(mode=0o700)
        (self.root / "checkpoints").mkdir(mode=0o700)
        # A caller may choose a recording beneath an otherwise packaged source
        # directory. Local evidence must never become git/npm content by accident.
        self.write_new(self.root / ".gitignore", b"*\n")
        self.write_new(self.root / ".npmignore", b"*\n")
        self.header = {
            "schemaVersion": 1, "kind": "gb-studio-playtest", "sessionId": self.session_id,
            "createdAt": datetime.now(timezone.utc).isoformat(), "rom": rom, "runtime": runtime,
            "startingCondition": self.branches[self.branch_id]["startingCondition"], "limits": limits,
        }
        self._write_manifest("recording")
        self.append("header", **{key: value for key, value in self.header.items() if key != "kind"})

    def check_budget(self, additional: int, *, emergency: bool = False) -> None:
        ceiling = self.limits["maxBytes"] - (0 if emergency else RECORDING_RESERVE_BYTES)
        if self.bytes_used + additional > ceiling:
            raise RecordingLimitError("Recording byte limit reached; the attempt was retained")
        if self.sequence >= MAX_RECORDING_EVENTS - (0 if emergency else 4):
            raise RecordingLimitError("Recording event limit reached; the attempt was retained")

    def write_new(self, path: Path, data: bytes, *, emergency: bool = False) -> None:
        self.check_budget(len(data), emergency=emergency)
        canonical = self.resolve_path(str(path), existing=False)
        if canonical != path or not canonical.is_relative_to(self.root):
            raise ValueError("Recording writes must remain inside their original directory")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as output:
            output.write(data)
        self.bytes_used += len(data)

    def append(self, kind: str, *, emergency: bool = False, **body: Any) -> dict[str, Any]:
        if self.status != "recording" and kind != "finish":
            raise RuntimeError("The recording is finalized and immutable")
        row = {"sequence": self.sequence + 1, "previousDigest": self.event_digest,
               "kind": kind, "branchId": self.branch_id, "frame": self.frame, **body}
        row["digest"] = digest(encoded(row))
        data = encoded(row) + b"\n"
        self.check_budget(len(data), emergency=emergency)
        event_path = self.root / "events.jsonl"
        if self.resolve_path(str(event_path), existing=False) != event_path or event_path.is_symlink():
            raise ValueError("The recording event path changed")
        with event_path.open("ab") as output:
            if os.fstat(output.fileno()).st_size != self.event_bytes:
                raise ValueError("The recording event prefix changed before append")
            if output.write(data) != len(data):
                raise OSError("The recording event could not be appended completely")
            output.flush()
            if os.fstat(output.fileno()).st_size != self.event_bytes + len(data):
                raise ValueError("The recording event prefix changed during append")
        self.bytes_used += len(data)
        self.sequence += 1
        self.event_digest = row["digest"]
        # Advance this cursor only after the actual append has completed. It is
        # deliberately not a hash of reserialized events or a manifest snapshot.
        self.event_bytes += len(data)
        self.event_hasher.update(data)
        self.committed_frame = row["frame"]
        self.committed_branch_id = row["branchId"]
        if kind == "action":
            self.committed_action_index = row["actionIndex"]
        elif kind == "branch":
            self.committed_action_index = len(row["prefixActions"])
        return row

    def committed_cursor(self) -> dict[str, Any] | None:
        branch = self.branches.get(self.branch_id)
        if (self.status != "recording" or not self.boot_finished or self.pending_frames
                or branch is None or self.sequence == 0 or self.committed_frame != self.frame
                or self.committed_branch_id != self.branch_id
                or self.committed_action_index != len(branch["actions"])):
            return None
        return {"recordingPath": str(self.root), "sessionId": self.session_id, "branchId": self.branch_id,
                "frame": self.frame, "actionIndex": self.committed_action_index,
                "prefixPin": {"eventCount": self.sequence, "eventDigest": self.event_digest,
                              "byteLength": self.event_bytes, "sha256": self.event_hasher.hexdigest()}}

    def _write_manifest(self, status: str) -> None:
        path = self.root / "recording.json"
        previous_size = path.stat().st_size if path.exists() else 0
        body = {**self.header, **self.snapshot(), "status": status}
        # bytesUsed includes the manifest itself, including the digits of that count.
        for _ in range(4):
            data = encoded(body) + b"\n"
            body["bytesUsed"] = self.bytes_used - previous_size + len(data)
        data = encoded(body) + b"\n"
        self.check_budget(max(0, len(data) - previous_size), emergency=True)
        temporary = self.root / f".recording-{uuid.uuid4().hex}.tmp"
        if self.resolve_path(str(path), existing=False) != path or path.is_symlink():
            raise ValueError("The recording manifest path changed")
        try:
            with temporary.open("xb") as output:
                output.write(data)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
        self.bytes_used += len(data) - previous_size

    def snapshot(self) -> dict[str, Any]:
        result = {
            "recordingPath": str(self.root), "sessionId": self.session_id, "status": self.status,
            "branchId": self.branch_id, "frame": self.frame, "totalFrames": self.total_frames,
            "bytesUsed": self.bytes_used, "limits": self.limits, "eventCount": self.sequence,
            "eventDigest": self.event_digest,
            "branches": [{"branchId": name, "frame": branch["frame"],
                          **({"parentBranchId": branch["parentBranchId"]} if "parentBranchId" in branch else {}),
                          **({"sourceSessionId": branch["sourceSessionId"]} if "sourceSessionId" in branch else {}),
                          **({"checkpointId": branch["checkpointId"]} if "checkpointId" in branch else {})}
                         for name, branch in self.branches.items()],
        }
        if self.failure is not None:
            result["failure"] = self.failure
        if self.outcome is not None:
            result["outcome"] = self.outcome
        if self.reason is not None:
            result["reason"] = self.reason
        return result

    def action(self, action: dict[str, Any], *, start_frame: int | None = None, source: str = "manual", emergency: bool = False) -> None:
        branch = self.branches[self.branch_id]
        index = len(branch["actions"]) + 1
        self.append("action", action=action, actionIndex=index, source=source, emergency=emergency,
                    **({"startFrame": start_frame} if start_frame is not None else {}))
        branch["actions"].append(action)
        branch["frame"] = self.frame

    def flush_steps(self, *, emergency: bool = False) -> None:
        if self.pending_frames:
            frames, start, source = self.pending_frames, self.pending_start, self.pending_source
            self.action({"type": "step", "frames": frames}, start_frame=start, source=source, emergency=emergency)
            self.pending_frames = 0

    def advanced(self, frame: int, *, source: str, initial: bool) -> None:
        if not initial and self.pending_frames and (source != self.pending_source or self.pending_frames >= MAX_FRAMES):
            self.flush_steps()
        self.total_frames += 1
        self.frame = frame
        self.branches[self.branch_id]["frame"] = frame
        if initial:
            self.initial_frames = frame
            return
        if not self.pending_frames:
            self.pending_start = frame - 1
            self.pending_source = source
        self.pending_frames += 1

    def record_frame(self, image: Any, *, reason: str, emergency: bool = False) -> dict[str, Any]:
        self.flush_steps(emergency=emergency)
        branch = self.branches[self.branch_id]
        image = image.convert("RGBA")
        raw_hash = digest(image.tobytes())
        index = len(branch["actions"])
        if branch["evidence"]:
            previous = branch["evidence"][-1]
            if previous["frame"] == self.frame and previous["actionIndex"] == index and previous["rgbaSha256"] == raw_hash:
                return previous
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()
        image_hash = digest(data)
        file = f"frames/{image_hash}.png"
        output = self.root / file
        if emergency:
            # Keep room for a complete failure/footer even if the last image is
            # unusually incompressible. Missing evidence is then reported, never fabricated.
            footer_reserve = len(encoded(self.header)) + len(encoded(self.snapshot())) + 4096
            self.check_budget((0 if output.exists() else len(data)) + footer_reserve + 1024, emergency=True)
        if output.exists():
            if output.is_symlink() or digest(output.read_bytes()) != image_hash:
                raise RuntimeError("A retained recording frame changed")
        else:
            self.write_new(output, data, emergency=emergency)
        row = self.append("frame", file=file, sha256=image_hash, rgbaSha256=raw_hash,
                          width=image.width, height=image.height, actionIndex=index, reason=reason, emergency=emergency)
        evidence = {key: row[key] for key in ("sequence", "branchId", "frame", "sha256", "rgbaSha256", "width", "height", "actionIndex")}
        evidence["path"] = str(output)
        branch["evidence"].append(evidence)
        self.recent.append(evidence)
        return evidence

    def boot_complete(self) -> None:
        if self.boot_finished:
            return
        condition = {"type": "clean-boot", "initialFrames": self.initial_frames, "cgb": self.rom["cgb"]}
        self.branches[self.branch_id]["startingCondition"] = condition
        self.append("boot_complete", startingCondition=condition)
        self.boot_finished = True

    def failure_event(self, message: str, *, method: str = "runtime") -> None:
        if self.status == "recording":
            self.append("failure", message=message[:2000], method=method[:100], emergency=True)

    def finish(self, status: str, *, failure: str | None = None,
               outcome: str | None = None, reason: str | None = None) -> None:
        if self.status != "recording":
            return
        self.flush_steps(emergency=True)
        self.failure = failure[:2000] if failure is not None else None
        self.outcome = outcome
        self.reason = reason
        self.append("finish", status=status, totalFrames=self.total_frames,
                    **({"failure": self.failure} if self.failure is not None else {}),
                    **({"outcome": outcome} if outcome is not None else {}),
                    **({"reason": reason} if reason is not None else {}), emergency=True)
        self.status = status
        self._write_manifest(status)


def normalized_recorded_action(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Recording contains an invalid normalized action")
    if value.get("type") == "step" and set(value) == {"type", "frames"}:
        return {"type": "step", "frames": bounded_integer(value["frames"], "recorded step", 1, MAX_FRAMES)}
    if value.get("type") == "set_buttons" and set(value) == {"type", "buttons"}:
        return {"type": "set_buttons", "buttons": recorded_buttons(value["buttons"])}
    raise ValueError("Recording contains an unsupported normalized action")


def recorded_buttons(value: object) -> list[str]:
    if (not isinstance(value, list) or len(value) > len(BUTTONS)
            or any(not isinstance(button, str) or button not in BUTTONS for button in value)
            or len(set(value)) != len(value)):
        raise ValueError("Recording contains an invalid controller button set")
    return list(value)


class RecordingReviewSelection:
    """Select bounded metadata from read_recording's authenticated event stream.

    This does not read or write a journal, invoke the emulator, or infer physical
    delivery from a normalized action. In particular, a branch's copied prefix
    does not contain the source journal's controller-delivery records.
    """

    def __init__(self, options: dict[str, Any]) -> None:
        self.options = options
        self.session_id = options["sessionId"]
        self.branch_id = options["branchId"]
        self.start = options["fromActionIndex"]
        self.end = options["toActionIndex"]
        self.inputs: list[dict[str, Any]] = []
        self.frames: list[dict[str, Any]] = []
        self.physical_events: list[dict[str, Any]] = []
        self.uncertainties: list[dict[str, Any]] = []
        self.prior_failure: dict[str, Any] | None = None
        self.metadata_bytes = 0
        self.found_branch = False
        self.boot_complete = False
        self.action_count = 0
        self.action_frame = 0
        self.boundaries: dict[int, int] = {}
        self.action_frames: dict[int, int] = {}
        self.normalized_buttons: list[str] = []
        self.initial_buttons: list[str] = []
        self.matched_controllers: set[int] = set()
        self.last_action: dict[str, Any] | None = None
        self.prefix_state: dict[str, Any] | None = None

    def retain(self, destination: list[dict[str, Any]], value: dict[str, Any]) -> None:
        self.metadata_bytes += len(encoded(value)) + 1
        if self.metadata_bytes > MAX_REVIEW_METADATA_BYTES:
            raise ValueError("Review metadata exceeds 2 MiB; narrow the interval")
        destination.append(value)

    def event_identity(self, row: dict[str, Any], event_digest: str) -> dict[str, Any]:
        return {"sessionId": self.session_id, "branchId": self.branch_id,
                "sequence": row["sequence"], "digest": event_digest}

    def begin_branch(self, condition: dict[str, Any], *, imported: bool) -> None:
        if condition.get("type") != "clean-boot":
            raise ValueError("Review requires a supported recorded starting condition")
        self.found_branch = True
        self.boot_complete = imported
        self.action_count = 0
        self.action_frame = bounded_integer(condition.get("initialFrames"), "recorded boot frames", 0, MAX_FRAMES)
        self.boundaries[0] = self.action_frame

    def action(self, action: object, index: int, *, origin: dict[str, Any], source: str,
               frame: int | None = None, start_frame: int | None = None) -> None:
        normalized = normalized_recorded_action(action)
        if index != self.action_count + 1:
            raise ValueError("Review controller action indices are inconsistent")
        start = self.action_frame
        end = start + (normalized["frames"] if normalized["type"] == "step" else 0)
        if end > MAX_RECORDING_FRAMES or (frame is not None and frame != end) or (start_frame is not None and start_frame != start):
            raise ValueError("Review controller action frames are inconsistent")
        self.action_count = index
        self.action_frame = end
        if normalized["type"] == "set_buttons":
            self.normalized_buttons = list(normalized["buttons"])
        if index == self.start:
            self.initial_buttons = list(self.normalized_buttons)
        if index in {self.start, self.end}:
            self.boundaries[index] = end
        if self.start <= index <= self.end:
            self.action_frames[index] = end
        if self.start < index <= self.end:
            self.retain(self.inputs, {"actionIndex": index, "startFrame": start, "frame": end,
                                      "action": normalized, "source": source, "origin": origin})

    def frame(self, item: dict[str, Any], *, origin: dict[str, Any]) -> None:
        index = bounded_integer(item.get("actionIndex"), "recorded frame action index", 0, self.action_count)
        frame = bounded_integer(item.get("frame"), "recorded evidence frame", 0, MAX_RECORDING_FRAMES)
        if not self.start <= index <= self.end:
            return
        if (index > 0 and self.action_frames.get(index) != frame) or (index == 0 and frame > self.boundaries[0]):
            raise ValueError("Recorded review image differs from its normalized action boundary")
        if "fromFrame" in self.options and not self.options["fromFrame"] <= frame <= self.options["toFrame"]:
            return
        if item.get("width") != 160 or item.get("height") != 144:
            raise ValueError("Recorded review images must have native 160x144 dimensions")
        locator = (f"event-{origin['event']['sequence']}" if origin["kind"] == "direct"
                   else f"import-{origin['importEvent']['sequence']}-prefix-{origin['prefixOrdinal']}")
        if len(self.frames) >= MAX_REVIEW_FRAME_RECORDS:
            raise ValueError("Review retained-image metadata exceeds its limit; narrow the interval")
        # Only at most maxImages of these records enter the response metadata.
        # A 3,600-tick step can legitimately create 3,600 normalized actions and
        # frame records; candidate metadata must not count as 3,600 returned PNGs.
        self.frames.append({"sessionId": self.session_id, "branchId": self.branch_id,
                                 "evidenceId": f"{self.session_id}/{self.branch_id}/{locator}",
                                 "sequence": bounded_integer(item.get("sequence"), "recorded frame sequence", 1, MAX_RECORDING_EVENTS),
                                 "frame": frame, "actionIndex": index, "path": item["path"],
                                 "sha256": sha256_string(item.get("sha256"), "recorded PNG SHA-256"),
                                 "rgbaSha256": sha256_string(item.get("rgbaSha256"), "recorded RGBA SHA-256"),
                            "width": 160, "height": 144, "origin": origin})

    def accept(self, row: dict[str, Any], event_digest: str, branches: dict[str, dict[str, Any]]) -> None:
        kind = row["kind"]
        if kind == "header" and row.get("sessionId") != self.session_id:
            raise ValueError("The requested recording sessionId differs from its authenticated header")
        if row.get("branchId") != self.branch_id:
            return
        identity = self.event_identity(row, event_digest)
        if kind == "header":
            self.begin_branch(row["startingCondition"], imported=False)
        elif kind == "boot_complete":
            self.boot_complete = True
            self.action_frame = bounded_integer(row["frame"], "recorded boot frame", 0, MAX_FRAMES)
            self.boundaries[0] = self.action_frame
        elif kind == "branch":
            self.begin_branch(row["startingCondition"], imported=True)
            prefix = row.get("prefixActions")
            if not isinstance(prefix, list):
                raise ValueError("The imported action prefix must be an array")
            source_session = row.get("sourceSessionId")
            source_branch = recording_branch_id(row.get("parentBranchId"))
            if (not isinstance(source_session, str) or len(source_session) != 32
                    or any(character not in "0123456789abcdef" for character in source_session)):
                raise ValueError("The imported recording prefix identity is invalid")
            for ordinal, action in enumerate(prefix, 1):
                self.action(action, ordinal, source="imported-prefix",
                            origin={"kind": "imported-prefix", "importEvent": identity, "prefixOrdinal": ordinal,
                                    "sourceSessionId": source_session, "sourceBranchId": source_branch})
            if self.action_frame != row["frame"]:
                raise ValueError("The imported action prefix does not reach its recorded branch frame")
            for ordinal, item in enumerate(branches[self.branch_id]["evidence"], 1):
                source_branch_id = recording_branch_id(item.get("sourceBranchId", source_branch))
                self.frame(item, origin={"kind": "imported-prefix", "importEvent": identity, "prefixOrdinal": ordinal,
                                         "sourceSessionId": source_session, "sourceBranchId": source_branch_id,
                                         "copiedSequence": item["sequence"]})
        elif kind == "action":
            source = row.get("source", "manual")
            if source not in {"manual", "clock"}:
                raise ValueError("The recorded action has an unsupported input source")
            self.action(row["action"], row["actionIndex"], source=source,
                        origin={"kind": "direct", "event": identity}, frame=row["frame"],
                        start_frame=row.get("startFrame"))
            self.last_action = {"sequence": row["sequence"], "actionIndex": row["actionIndex"],
                                "frame": row["frame"], "action": row["action"]}
        elif kind == "frame":
            self.frame(branches[self.branch_id]["evidence"][-1], origin={"kind": "direct", "event": identity})
        elif kind == "controller":
            releases = recorded_buttons(row.get("releases"))
            presses = recorded_buttons(row.get("presses"))
            active = recorded_buttons(row.get("activeButtons"))
            bounded_integer(row.get("appliesBeforeFrame"), "controller delivery frame", 1, MAX_RECORDING_FRAMES + 1)
            if set(releases) & set(presses) or row.get("appliesBeforeFrame") != row["frame"] + 1:
                raise ValueError("Recorded controller-delivery metadata is inconsistent")
            previous = self.last_action
            associated = (previous is not None and previous["sequence"] == row["sequence"] - 1
                          and previous["frame"] == row["frame"]
                          and previous["action"] == {"type": "set_buttons", "buttons": active})
            action_index = previous["actionIndex"] if associated else None
            if ((action_index is not None and self.start < action_index <= self.end)
                    or (action_index is None and self.start <= self.action_count <= self.end)):
                self.retain(self.physical_events, {"event": identity, "actionIndex": action_index,
                                                  "atActionIndex": self.action_count, "frame": row["frame"],
                                                  "appliesBeforeFrame": row["appliesBeforeFrame"],
                                                  "releases": releases, "presses": presses, "activeButtons": active})
                if action_index is not None:
                    self.matched_controllers.add(action_index)
                else:
                    self.retain(self.uncertainties, {"kind": "unassociated-controller-event", "event": identity,
                                                     "actionIndex": self.action_count, "frame": row["frame"]})
        elif kind == "failure":
            # A partially delivered set_buttons can fail before either journal
            # record is appended. Its unknown edges must not be reconstructed
            # from a later normalized action (or exposed as a raw error log).
            boundary = {"kind": "failure-boundary", "event": identity,
                        "actionIndex": self.action_count, "frame": row["frame"]}
            if self.action_count < self.start:
                self.prior_failure = boundary
            elif self.action_count <= self.end:
                self.retain(self.uncertainties, boundary)

    def freeze(self, branches: dict[str, dict[str, Any]]) -> None:
        branch = branches.get(self.branch_id)
        if branch is None or not self.found_branch:
            raise ValueError("The requested recording branch does not exist in the committed prefix")
        if self.end > self.action_count:
            raise ValueError("The requested action interval exceeds the committed recording prefix")
        if not self.boot_complete and self.action_count == 0:
            self.boundaries[0] = branch["frame"]
        start_frame = self.boundaries[self.start]
        end_frame = self.boundaries[self.end]
        if not start_frame <= end_frame <= start_frame + MAX_FRAMES:
            raise ValueError(f"Review spans more than {MAX_FRAMES} native frames; narrow the interval")
        if "fromFrame" in self.options and (self.options["fromFrame"] != start_frame or self.options["toFrame"] != end_frame):
            raise ValueError("Review frame bounds differ from the normalized action boundaries")
        self.prefix_state = {"fromFrame": start_frame, "toFrame": end_frame,
                             "branchActionCount": self.action_count, "branchFrame": branch["frame"]}


def read_recording(root: Path, resolve_path: Any, *, prefix_pin: dict[str, Any] | None = None,
                   review: RecordingReviewSelection | None = None, check_cancel: Any = None) -> dict[str, Any]:
    if prefix_pin is not None:
        prefix_pin = recording_prefix_pin(prefix_pin)
    manifest_path = root / "recording.json"
    if root.is_symlink() or manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("The recording directory has no valid recording.json")
    if manifest_path.stat().st_size > 1024 * 1024:
        raise ValueError("Recording manifest is too large")
    manifest_bytes = bounded_recording_metadata(manifest_path, 1024 * 1024)
    manifest = json.loads(manifest_bytes)
    if manifest.get("schemaVersion") != 1 or manifest.get("kind") != "gb-studio-playtest":
        raise ValueError("Unsupported playtest recording format")
    if manifest.get("status") not in {"recording", "stopped", "cancelled", "failed", "interrupted"}:
        raise ValueError("Unsupported playtest recording status")
    limits = recording_limits(manifest.get("limits"))
    event_path = root / "events.jsonl"
    if event_path.is_symlink() or not event_path.is_file() or event_path.stat().st_size > limits["maxBytes"]:
        raise ValueError("The recording event log is missing or exceeds its limit")
    observed_event_bytes = event_path.stat().st_size
    if prefix_pin is not None and prefix_pin["byteLength"] > observed_event_bytes:
        raise ValueError("The requested recording prefix is not present")
    branches: dict[str, dict[str, Any]] = {}
    checkpoints: dict[str, dict[str, Any]] = {}
    current = "branch-0001"
    previous = "0" * 64
    sequence = 0
    status = "interrupted"
    truncated_tail = False
    boot_finished = False
    final: dict[str, Any] = {}
    total_frames = 0
    event_hasher = hashlib.sha256()
    event_bytes = 0
    selected_prefix: dict[str, Any] | None = None
    with event_path.open("rb") as events:
        while True:
            if check_cancel is not None:
                check_cancel()
            line = events.readline(MAX_RECORDING_EVENT_BYTES + 1)
            if not line:
                break
            if not line.endswith(b"\n") and manifest.get("status") == "recording" and len(line) <= MAX_RECORDING_EVENT_BYTES:
                truncated_tail = True
                break
            if len(line) > MAX_RECORDING_EVENT_BYTES or not line.endswith(b"\n"):
                raise ValueError("The recording has an incomplete or oversized event")
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("A recording event must be an object")
            claimed = row.pop("digest", None)
            bounded_integer(row.get("sequence"), "recording event sequence", 1, MAX_RECORDING_EVENTS)
            bounded_integer(row.get("frame"), "recording event frame", 0, MAX_RECORDING_FRAMES)
            recording_branch_id(row.get("branchId"))
            if row.get("sequence") != sequence + 1 or row.get("previousDigest") != previous or digest(encoded(row)) != claimed:
                raise ValueError("Recording event integrity check failed")
            sequence += 1
            if sequence > MAX_RECORDING_EVENTS:
                raise ValueError("The recording event count exceeds its limit")
            previous = claimed
            event_hasher.update(line)
            event_bytes += len(line)
            if event_bytes > limits["maxBytes"]:
                raise RecordingLimitError("The recording event log exceeds its byte limit")
            if final:
                raise ValueError("The recording contains events after its final footer")
            kind = row.get("kind")
            if kind == "header":
                if sequence != 1 or row.get("sessionId") != manifest.get("sessionId"):
                    raise ValueError("Recording header identity differs")
                if any(row.get(key) != manifest.get(key) for key in ("rom", "runtime", "limits", "startingCondition")):
                    raise ValueError("Recording manifest differs from its authenticated header")
                branches[current] = {"actions": [], "evidence": [], "frame": 0,
                                     "startingCondition": row["startingCondition"]}
            elif kind == "boot_complete":
                branches[current]["startingCondition"] = row["startingCondition"]
                branches[current]["frame"] = row["frame"]
                total_frames = max(total_frames, row["frame"])
                boot_finished = True
            elif kind == "branch":
                current = row["branchId"]
                if current in branches:
                    raise ValueError("Recording branch identity is duplicated")
                evidence = []
                for item in row["prefixEvidence"]:
                    copy = dict(item)
                    path = resolve_path(str(root / copy.pop("file")), existing=True)
                    if not path.is_relative_to(root):
                        raise ValueError("Imported recorded frames must remain inside their recording")
                    copy["path"] = str(path)
                    evidence.append(copy)
                branches[current] = {"actions": row["prefixActions"], "evidence": evidence,
                                     "frame": row["frame"], "parentBranchId": row["parentBranchId"],
                                     "sourceSessionId": row["sourceSessionId"],
                                     "checkpointId": row["checkpointId"], "startingCondition": row["startingCondition"]}
            elif kind == "action":
                branch = branches[row["branchId"]]
                bounded_integer(row.get("actionIndex"), "recording action index", 1, MAX_SAFE_INTEGER)
                if "startFrame" in row:
                    bounded_integer(row["startFrame"], "recording action start frame", 0, MAX_RECORDING_FRAMES)
                if row.get("actionIndex") != len(branch["actions"]) + 1:
                    raise ValueError("Recording controller action index differs")
                action = normalized_recorded_action(row["action"])
                if action.get("type") == "step":
                    total_frames += bounded_integer(action.get("frames"), "recorded step", 1, MAX_FRAMES)
                branch["actions"].append(action)
                branch["frame"] = row["frame"]
            elif kind == "frame":
                branch = branches[row["branchId"]]
                bounded_integer(row.get("actionIndex"), "recorded frame action index", 0, MAX_SAFE_INTEGER)
                if row.get("actionIndex") != len(branch["actions"]):
                    raise ValueError("Recorded frame has an inconsistent controller action index")
                path = resolve_path(str(root / row["file"]), existing=True)
                if not path.is_relative_to(root):
                    raise ValueError("Recorded frames must remain inside their recording")
                evidence = {key: row[key] for key in ("sequence", "branchId", "frame", "sha256", "rgbaSha256", "width", "height", "actionIndex")}
                evidence["path"] = str(path)
                branch["evidence"].append(evidence)
                branch["frame"] = row["frame"]
                if not boot_finished:
                    # A hard interruption during boot can retain a valid shorter
                    # clean-boot prefix, even before boot_complete was written.
                    total_frames = max(total_frames, row["frame"])
                    branch["startingCondition"] = {**branch["startingCondition"], "initialFrames": row["frame"]}
            elif kind == "finish":
                status = row["status"]
                total_frames = row["totalFrames"]
                final = row
            elif kind == "checkpoint_saved":
                if row.get("checkpointId") in checkpoints:
                    raise ValueError("Checkpoint identity is duplicated in the recording")
                checkpoints[row["checkpointId"]] = row
            elif kind not in {"controller", "pause", "resume", "failure", "capture", "outcome"}:
                raise ValueError("Unsupported recording event kind")
            if review is not None and (prefix_pin is None or sequence <= prefix_pin["eventCount"]):
                review.accept(row, claimed, branches)
            if prefix_pin is not None and sequence == prefix_pin["eventCount"]:
                selected_prefix = {"eventCount": sequence, "eventDigest": previous,
                                   "byteLength": event_bytes, "sha256": event_hasher.hexdigest()}
                if selected_prefix != prefix_pin:
                    raise ValueError("The requested recording prefix failed its byte and event-chain integrity check")
                if review is not None:
                    review.freeze(branches)
                if manifest.get("status") == "recording":
                    # A structural pin names these exact committed bytes, not
                    # the latest journal length. A finalized source is different:
                    # its complete tail must still pass the existing reader.
                    break
    if not branches:
        raise ValueError("Recording header is missing")
    if truncated_tail:
        status = "interrupted"
    if manifest.get("status") != "recording" and (
        manifest.get("eventDigest") != previous or manifest.get("eventCount") != sequence
        or manifest.get("status") != status
    ):
        raise ValueError("Finalized recording integrity check failed")
    if prefix_pin is not None and selected_prefix is None:
        raise ValueError("The requested recording prefix is not present")
    complete_prefix = {"eventCount": sequence, "eventDigest": previous,
                       "byteLength": event_bytes, "sha256": event_hasher.hexdigest()}
    if prefix_pin is None and review is not None:
        review.freeze(branches)
    if manifest_path.is_symlink() or bounded_recording_metadata(manifest_path, 1024 * 1024) != manifest_bytes:
        raise ValueError("The recording manifest changed while it was being read")
    result = {**manifest, "recordingPath": str(root), "status": status,
              "branchId": current, "frame": branches[current]["frame"], "totalFrames": total_frames,
              "eventCount": sequence, "eventDigest": previous, "branchesById": branches,
              "checkpointsById": checkpoints,
              "truncatedTail": truncated_tail,
              "prefixPin": selected_prefix or complete_prefix,
              "sourcePins": {"manifest": {"byteLength": len(manifest_bytes), "sha256": digest(manifest_bytes)},
                             "events": complete_prefix, "observedEventLogBytes": observed_event_bytes,
                             "finalized": manifest.get("status") != "recording",
                             "tailValidation": "finalized-complete" if manifest.get("status") != "recording" else "committed-prefix",
                             "manifestStatus": manifest.get("status")},
              "bytesUsed": artifact_usage(root, resolve_path)}
    if result["bytesUsed"] > limits["maxBytes"]:
        raise RecordingLimitError("The retained recording exceeds its byte limit")
    for key in ("failure", "outcome", "reason"):
        if key in final:
            result[key] = final[key]
    failures = root / "worker-failures.jsonl"
    if failures.exists() and status == "interrupted":
        if failures.is_symlink() or failures.stat().st_size > RECORDING_RESERVE_BYTES:
            raise ValueError("Worker failure record exceeds its limit")
        rows = bounded_recording_metadata(failures, RECORDING_RESERVE_BYTES).splitlines()
        if rows:
            result["failure"] = json.loads(rows[-1]).get("message", "The emulator worker was interrupted")
    result["branches"] = [{"branchId": name, "frame": branch["frame"],
                           **({"parentBranchId": branch["parentBranchId"]} if "parentBranchId" in branch else {}),
                           **({"sourceSessionId": branch["sourceSessionId"]} if "sourceSessionId" in branch else {}),
                           **({"checkpointId": branch["checkpointId"]} if "checkpointId" in branch else {})}
                          for name, branch in branches.items()]
    return result


class TimelineExecutionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        failed_action_index: int,
        start_frame: int,
        frame: int,
        active_buttons: set[str],
        requested_frames: int | None = None,
        applied_buttons: set[str] | None = None,
        sampled_buttons: set[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.failed_action_index = failed_action_index
        self.start_frame = start_frame
        self.frame = frame
        self.active_buttons = sorted(active_buttons)
        self.requested_frames = requested_frames
        self.applied_buttons = None if applied_buttons is None else sorted(applied_buttons)
        self.sampled_buttons = None if sampled_buttons is None else sorted(sampled_buttons)
        self.recording_span: dict[str, Any] | None = None

    def record(self) -> dict[str, Any]:
        return {
            "message": str(self),
            "failedActionIndex": self.failed_action_index,
            "advancedFrames": self.frame - self.start_frame,
            "startFrame": self.start_frame,
            "frame": self.frame,
            "activeButtons": self.active_buttons,
            **({"requestedFrames": self.requested_frames} if self.requested_frames is not None else {}),
            **({"appliedButtons": self.applied_buttons} if self.applied_buttons is not None else {}),
            **({"sampledButtons": self.sampled_buttons} if self.sampled_buttons is not None else {}),
            **({"recordingSpan": self.recording_span} if self.recording_span is not None else {}),
        }


def create_pyboy(rom: bytes, cgb: bool | None) -> Any:
    from pyboy import PyBoy

    options: dict[str, Any] = {"window": "null", "sound_emulated": False}
    if cgb is not None:
        options["cgb"] = cgb
    if cgb is False:
        # PyBoy's default boot ROM follows the cartridge header, independently
        # of its hardware override. Dual-mode ROMs need the DMG handoff too.
        bootrom = importlib.resources.files("pyboy").joinpath("core", "bootrom_dmg.bin")
        if not bootrom.is_file():
            raise RuntimeError("The installed PyBoy runtime is missing its bundled DMG boot ROM; "
                               "repair the emulator runtime before requesting monochrome mode")
        # PyBoy reads the boot ROM during construction. Keep an extracted
        # package resource alive until then, without modifying its bytes.
        with importlib.resources.as_file(bootrom) as bootrom_path:
            return PyBoy(io.BytesIO(rom), bootrom=str(bootrom_path), **options)
    return PyBoy(io.BytesIO(rom), **options)


class EmulatorWorker:
    def __init__(self, project_root: Path, cancel_event: threading.Event | None = None) -> None:
        self.project_root = project_root.resolve(strict=True)
        if not self.project_root.is_dir():
            raise ValueError("The emulator project root must be a directory")

        self.emulator: Any | None = None
        self.rom_path: Path | None = None
        self.cgb = False
        self.frame = 0
        self.active_buttons: set[str] = set()
        self.sampled_buttons: set[str] = set()
        self.controller_dirty = False
        self.rom_bytes: bytes | None = None
        self.rom_sha256: str | None = None
        self.runtime: dict[str, Any] | None = None
        self.recording: Recording | None = None
        self.last_recording_path: Path | None = None
        self.restored_image: Any | None = None
        self.cancel_event = cancel_event or threading.Event()
        self.execution_ns = 0
        # Retained as an invariant for same-runtime state/review helpers. No
        # worker request can start a running clock: all play is explicit stepping.
        self.clock_run_started_ns: int | None = None
        self.total_frames = 0

    @property
    def paused(self) -> bool:
        return self.clock_run_started_ns is None

    def require_paused(self) -> None:
        if not self.paused:
            raise RuntimeError("Exact frame stepping requires a paused emulator; pause it first")

    def require_mutable(self) -> None:
        self.require_emulator()
        if self.recording is not None and self.recording.status != "recording":
            raise RuntimeError("This recording is finalized; restart the ROM before advancing or changing inputs")

    def require_recording(self) -> Recording:
        if self.recording is None:
            raise RuntimeError("No recorded playtest is active; run the ROM with recording: {} first")
        return self.recording

    def clock_snapshot(self) -> dict[str, Any]:
        # Observations do not sample a host clock or change its snapshot. This
        # measures time spent executing native frames, never a paced-play rate.
        return {"mode": "paused" if self.paused else "running", "clockHz": GB_HZ,
                "dotsPerFrame": FRAME_DOTS, "executionWallTimeMs": self.execution_ns / 1_000_000,
                "gameTimeMs": self.frame * FRAME_DOTS * 1000 / GB_HZ}

    def pause_clock(self) -> None:
        self.clock_run_started_ns = None

    def current_image(self) -> Any:
        return self.restored_image if self.restored_image is not None else self.require_emulator().screen.image

    def record_current(self, reason: str) -> dict[str, Any] | None:
        if self.recording is not None and self.recording.status == "recording":
            return self.recording.record_frame(self.current_image(), reason=reason)
        return None

    def resolve_project_path(self, value: object, *, existing: bool) -> Path:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("A non-empty project-relative or absolute path is required")

        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = self.project_root / candidate

        resolved = candidate.resolve(strict=existing)
        if not resolved.is_relative_to(self.project_root):
            raise ValueError("Emulator paths must remain inside the project root")
        return resolved

    def require_emulator(self) -> Any:
        if self.emulator is None:
            raise RuntimeError("No ROM is running; open a ROM before using the emulator")
        return self.emulator

    @staticmethod
    def validate_frames(value: object, *, minimum: int = 1) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Frame counts must be integers")
        if value < minimum or value > MAX_FRAMES:
            raise ValueError(f"Frame counts must be between {minimum} and {MAX_FRAMES}")
        return value

    def advance(self, frames: int, *, source: str = "manual", initial: bool = False) -> None:
        if frames == 0:
            return
        self.require_mutable()
        emulator = self.require_emulator()
        recording = self.recording
        if recording is not None and recording.total_frames + frames > recording.limits["maxFrames"]:
            raise RecordingLimitError("Recording frame limit reached; the attempt was retained")
        start_frame = self.frame
        execution_started_ns = time.monotonic_ns()
        try:
            for _ in range(frames):
                if self.cancel_event.is_set():
                    raise SessionCancelled("The emulator operation was cancelled")
                if recording is not None and self.execution_ns + time.monotonic_ns() - execution_started_ns >= recording.limits["maxWallTimeMs"] * 1_000_000:
                    raise RecordingLimitError("Recording execution wall-time limit reached; the attempt was retained")
                if recording is not None:
                    # Reserve journal capacity before a tick. PNGs are charged
                    # by their encoded size; full storage retains the executed
                    # timeline and explicitly marks unavailable evidence.
                    recording.check_budget(2048)
                try:
                    before = getattr(emulator, "frame_count", None)
                    if isinstance(before, bool) or not isinstance(before, int):
                        raise RuntimeError("The native starting frame counter is unavailable")
                    alive = emulator.tick(1, True)
                    after = getattr(emulator, "frame_count", None)
                except Exception as error:
                    raise NativeFrameAccountingError(
                        f"The native tick failed without authenticated frame accounting: {error}",
                        start_frame=start_frame, confirmed_frame=self.frame, sampled_buttons=self.sampled_buttons,
                    ) from error
                if isinstance(after, bool) or not isinstance(after, int) or after - before != 1:
                    raise NativeFrameAccountingError(
                        "PyBoy did not authenticate exactly one native frame tick",
                        start_frame=start_frame, confirmed_frame=self.frame, sampled_buttons=self.sampled_buttons,
                    )
                self.frame += after - before
                self.total_frames += after - before
                self.sampled_buttons = set(self.active_buttons)
                self.controller_dirty = False
                self.restored_image = None
                if recording is not None:
                    recording.advanced(self.frame, source=source, initial=initial)
                    if recording.total_frames % recording.limits["sampleEveryFrames"] == 0:
                        recording.record_frame(self.current_image(), reason="boot-periodic" if initial else "periodic")
                if not alive:
                    raise RuntimeError("The emulator stopped while advancing frames")
            # The historical clock-source helper may leave an uncommitted
            # prefix in archive regressions. No live request schedules it.
            if recording is not None and not initial and source != "clock":
                recording.record_frame(self.current_image(), reason="step-end")
        finally:
            # Paused/model-thinking time is not execution. Accumulate on both
            # success and partial failure so another call cannot reset the limit.
            self.execution_ns += time.monotonic_ns() - execution_started_ns

    def state(self) -> dict[str, Any]:
        self.require_emulator()
        image = self.current_image()
        return {
            "romPath": str(self.rom_path),
            "frame": self.frame,
            "width": image.width,
            "height": image.height,
            "activeButtons": sorted(self.active_buttons),
            "sampledButtons": sorted(self.sampled_buttons),
            "cgb": self.cgb,
            "romSha256": self.rom_sha256,
            "runtime": self.runtime,
            "paused": self.paused,
            "clock": self.clock_snapshot(),
            **({"recording": self.recording.snapshot()} if self.recording is not None else {}),
        }

    def open(self, params: dict[str, Any]) -> dict[str, Any]:
        rom_path = self.resolve_project_path(params.get("romPath"), existing=True)
        if not rom_path.is_file() or rom_path.suffix.lower() not in {".gb", ".gbc"}:
            raise ValueError("The ROM must be an existing .gb or .gbc file")

        initial_frames = self.validate_frames(params.get("initialFrames", 120), minimum=0)
        cgb = params.get("cgb")
        if cgb is not None and not isinstance(cgb, bool):
            raise ValueError("The cgb option must be a boolean")

        recording_option = params.get("recording", False)
        limits = recording_limits(recording_option) if recording_option is not False else None
        if limits is not None and initial_frames > limits["maxFrames"]:
            raise ValueError("Initial frames exceed the recording frame limit")
        recording_path = None
        if limits is not None:
            recording_path = self.resolve_project_path(recording_option.get("outputPath", f"artifacts/playtests/session-{uuid.uuid4().hex}"), existing=False)
            if recording_path.exists():
                raise ValueError("A recording output directory must be new; existing attempts are never overwritten")
        raw = rom_path.read_bytes()
        rom_sha256 = digest(raw)
        self.stop()
        if self.cancel_event.is_set():
            raise SessionCancelled("The emulator open request was cancelled")

        # Every session is an isolated clean boot. A file-like cartridge never
        # discovers adjacent battery RAM or RTC files, even without recording.
        self.emulator = create_pyboy(raw, cgb)
        self.emulator.set_emulation_speed(0)
        self.rom_path = rom_path
        self.rom_bytes = raw
        self.rom_sha256 = rom_sha256
        self.runtime = {"name": "PyBoy", "version": importlib.metadata.version("pyboy"),
                        "protocolVersion": PROTOCOL_VERSION, "workerSha256": WORKER_SHA256}
        cartridge_mode = raw[0x143:0x144]
        self.cgb = cgb if cgb is not None else cartridge_mode in {b"\x80", b"\xc0"}
        self.frame = 0
        self.total_frames = 0
        self.active_buttons.clear()
        self.sampled_buttons.clear()
        self.controller_dirty = False
        self.restored_image = None
        self.execution_ns = 0
        self.clock_run_started_ns = None
        self.recording = None
        if limits is not None:
            cartridge_type = raw[0x147] if len(raw) > 0x147 else None
            host_clock_rtc = cartridge_type in {0x0F, 0x10}
            self.recording = Recording(recording_path, limits=limits,
                                       rom={"sha256": rom_sha256, "cgb": self.cgb, "cartridgeType": cartridge_type,
                                            "deterministicReplaySupported": not host_clock_rtc,
                                            "knownNondeterminism": ["host-clock-rtc"] if host_clock_rtc else []}, runtime=self.runtime,
                                       initial_frames=initial_frames, resolve_path=self.resolve_project_path)
            self.last_recording_path = recording_path
            self.record_current("boot")
        self.advance(initial_frames, initial=limits is not None)
        if self.recording is not None:
            self.recording.boot_complete()
            self.record_current("boot-complete")
        return self.state()

    def step(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_paused()
        self.advance(self.validate_frames(params.get("frames", 1)))
        return self.state()

    def frame_sample(self) -> dict[str, Any]:
        """Encode the current real framebuffer without capture or journal writes."""
        image = self.current_image().convert("RGBA")
        if image.size != (160, 144):
            raise RuntimeError("The emulator framebuffer must have native 160 x 144 dimensions")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()
        result = {"frame": self.frame, "width": image.width, "height": image.height,
                  "sha256": digest(data), "rgbaSha256": digest(image.tobytes()),
                  "pngBase64": base64.b64encode(data).decode("ascii"),
                  "sampledButtons": sorted(self.sampled_buttons)}
        if self.recording is not None:
            evidence = self.recording.branches[self.recording.branch_id]["evidence"]
            if evidence:
                current = evidence[-1]
                if (current["frame"] == self.frame and current["sha256"] == result["sha256"]
                        and current["rgbaSha256"] == result["rgbaSha256"]):
                    try:
                        result["path"] = str(self.verified_evidence_bytes(current)[0])
                    except (OSError, ValueError, RuntimeError):
                        # Retained files are optional supporting evidence. A
                        # missing/corrupt archive must not prevent recovery of
                        # this verified live framebuffer or trigger any repair.
                        pass
        return result

    def play_step(self, params: dict[str, Any]) -> dict[str, Any]:
        # Validate the entire request before controller events, ticks, encoding,
        # or journal effects. Unknown/legacy fields never silently change play.
        if not isinstance(params, dict) or set(params) - {"buttons", "frames", "sampleCount"}:
            raise RequestValidationError("A play step accepts only buttons, frames, and optional sampleCount")
        buttons = params.get("buttons")
        if (not isinstance(buttons, list) or len(buttons) > len(BUTTONS)
                or any(not isinstance(button, str) or button not in BUTTONS for button in buttons)
                or len(set(buttons)) != len(buttons)):
            raise RequestValidationError("A play step requires a full unique set of Game Boy buttons")
        try:
            frames = bounded_integer(params.get("frames"), "play step frames", 1, MAX_FRAMES)
            sample_count = bounded_integer(params.get("sampleCount", 4), "play step sampleCount", 1, MAX_STEP_SAMPLES)
        except ValueError as error:
            raise RequestValidationError(str(error)) from error
        try:
            self.require_mutable()
            self.require_paused()
        except RuntimeError as error:
            raise RequestValidationError(str(error)) from error
        start_frame = self.frame
        original_buttons = set(self.active_buttons)
        applied_buttons: set[str] | None = None
        samples = []
        try:
            if self.recording is not None and self.recording.total_frames + frames > self.recording.limits["maxFrames"]:
                raise RecordingLimitError("Recording frame limit reached; the attempt was retained")
            self.set_buttons(set(buttons))
            applied_buttons = set(self.active_buttons)
            count = min(sample_count, frames)
            for index in range(1, count + 1):
                # Positive, strictly increasing integer offsets always include
                # the exact endpoint; no sample is borrowed from another call.
                target = start_frame + index * frames // count
                self.advance(target - self.frame)
                samples.append(self.frame_sample())
        except Exception as error:
            unknown = native_accounting_error(error)
            if unknown is not None:
                unknown.start_frame = start_frame
                unknown.requested_frames = frames
                # An untrusted native clock cannot establish a final frame.
                # The protocol handler closes this worker without extra ticks.
                raise
            failed_frame = self.frame
            sampled_buttons = set(self.sampled_buttons)
            try:
                self.restore_buttons(original_buttons)
            except Exception as restoration_error:
                try:
                    self.stop()
                except Exception:
                    pass
                raise TimelineExecutionError(
                    f"Play step failed and the emulator session was reset: {error}; "
                    f"held-button restoration failed: {restoration_error}",
                    failed_action_index=0, start_frame=start_frame,
                    frame=failed_frame, active_buttons=set(),
                    requested_frames=frames, applied_buttons=applied_buttons, sampled_buttons=sampled_buttons,
                ) from error
            raise TimelineExecutionError(
                f"Play step failed after {failed_frame - start_frame} advanced frames: {error}",
                failed_action_index=0, start_frame=start_frame,
                frame=failed_frame, active_buttons=self.active_buttons,
                requested_frames=frames, applied_buttons=applied_buttons, sampled_buttons=sampled_buttons,
            ) from error
        return {**self.state(), "startFrame": start_frame,
                "advancedFrames": self.frame - start_frame,
                "appliedButtons": sorted(buttons), "samples": samples}

    def observe(self, params: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(params, dict) or params:
            raise RequestValidationError("Observation accepts an empty object and never applies input")
        state = self.state()
        return {**state, "startFrame": self.frame, "advancedFrames": 0,
                "appliedButtons": sorted(self.active_buttons), "samples": [self.frame_sample()]}

    def input(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_mutable()
        button = params.get("button")
        action = params.get("action")
        if button not in BUTTONS:
            raise ValueError(f"Unknown Game Boy button: {button!r}")
        if action not in {"press", "release", "tap"}:
            raise ValueError(f"Unknown button action: {action!r}")

        if action == "press":
            self.set_buttons(self.active_buttons | {button})
        elif action == "release":
            self.set_buttons(self.active_buttons - {button})
        else:
            self.require_paused()
            frames = self.validate_frames(params.get("frames", 1))
            original_buttons = set(self.active_buttons)
            self.set_buttons(original_buttons | {button})
            try:
                self.advance(frames)
            finally:
                self.set_buttons(original_buttons, emergency=True)

        return self.state()

    def set_buttons(self, buttons: set[str], *, emergency: bool = False) -> None:
        emulator = self.require_emulator()
        if buttons == self.active_buttons:
            return
        recording = self.recording
        if recording is not None and recording.status == "recording":
            recording.flush_steps(emergency=emergency)
            recording.check_budget(2048, emergency=emergency)
        releases = sorted(self.active_buttons - buttons)
        presses = sorted(buttons - self.active_buttons)
        for button in releases:
            emulator.button_release(button)
            self.active_buttons.discard(button)
        for button in presses:
            emulator.button_press(button)
            self.active_buttons.add(button)
        self.controller_dirty = True
        if recording is not None and recording.status == "recording":
            recording.action({"type": "set_buttons", "buttons": sorted(self.active_buttons)}, emergency=emergency)
            recording.append("controller", releases=releases, presses=presses,
                             activeButtons=sorted(self.active_buttons), appliesBeforeFrame=self.frame + 1, emergency=emergency)

    def validate_timeline_actions(
        self, actions: object, *, require_actions: bool
    ) -> list[dict[str, Any]]:
        if not isinstance(actions, list):
            raise ValueError("An emulator timeline requires an actions array")
        if (require_actions and len(actions) == 0) or len(actions) > MAX_TIMELINE_ACTIONS:
            raise ValueError(
                f"An emulator timeline permits at most {MAX_TIMELINE_ACTIONS} actions"
            )

        advanced_frames = 0
        for index, action in enumerate(actions):
            if not isinstance(action, dict):
                raise ValueError(f"Timeline action {index} must be an object")
            action_type = action.get("type")
            if action_type not in {"hold", "tap", "step", "press", "release", "set_buttons", "hold_buttons"}:
                raise ValueError(f"Unknown timeline action at index {index}: {action_type!r}")

            if action_type in {"set_buttons", "hold_buttons"}:
                buttons = action.get("buttons")
                if not isinstance(buttons, list) or len(buttons) > len(BUTTONS) or any(not isinstance(button, str) or button not in BUTTONS for button in buttons) or len(set(buttons)) != len(buttons):
                    raise ValueError(f"Timeline action {index} requires a unique bounded Game Boy button set")
            elif action_type != "step" and action.get("button") not in BUTTONS:
                raise ValueError(f"Unknown Game Boy button in timeline action {index}")

            if action_type in {"hold", "tap", "step", "hold_buttons"}:
                advanced_frames += self.validate_frames(action.get("frames"))
            if action_type in {"hold", "tap", "hold_buttons"} and "settleFrames" in action:
                advanced_frames += self.validate_frames(action["settleFrames"], minimum=0)

            if advanced_frames > MAX_FRAMES:
                raise ValueError(f"An emulator timeline may advance at most {MAX_FRAMES} frames")

        return actions

    def restore_buttons(self, original_buttons: set[str]) -> None:
        self.set_buttons(original_buttons, emergency=True)

    def execute_action(self, action: dict[str, Any]) -> None:
        action_type = action["type"]
        if action_type == "step":
            self.require_paused()
            self.advance(action["frames"])
            return
        if action_type == "set_buttons":
            self.set_buttons(set(action["buttons"]))
            return

        if action_type in {"press", "release"}:
            self.input({"button": action["button"], "action": action_type})
            return

        self.require_paused()
        original_buttons = set(self.active_buttons)
        temporary_buttons = set(action["buttons"]) if action_type == "hold_buttons" else original_buttons | {action["button"]}
        self.set_buttons(temporary_buttons)
        try:
            self.advance(action["frames"])
        finally:
            self.set_buttons(original_buttons, emergency=True)

        self.advance(action.get("settleFrames", 0))

    def execute_timeline(
        self,
        checkpoints: list[dict[str, Any]],
        *,
        include_captures: bool,
    ) -> dict[str, Any]:
        self.require_mutable()
        if any(action["type"] in {"step", "hold", "tap", "hold_buttons"}
               for checkpoint in checkpoints for action in checkpoint["actions"]):
            self.require_paused()
        start_frame = self.frame
        original_buttons = set(self.active_buttons)
        action_index = 0
        captures: list[dict[str, Any]] = []

        try:
            for checkpoint_index, checkpoint in enumerate(checkpoints):
                for action in checkpoint["actions"]:
                    self.execute_action(action)
                    action_index += 1

                if include_captures:
                    capture = self.screenshot({"outputPath": str(checkpoint["outputPath"])})
                    captures.append({"checkpointIndex": checkpoint_index, **capture})
        except Exception as error:
            unknown = native_accounting_error(error)
            if unknown is not None:
                unknown.start_frame = start_frame
                raise
            try:
                self.restore_buttons(original_buttons)
            except Exception as restoration_error:
                try:
                    self.stop()
                except Exception:
                    pass
                raise TimelineExecutionError(
                    f"Timeline action {action_index} failed and the emulator session was reset: "
                    f"{error}; held-button restoration failed: {restoration_error}",
                    failed_action_index=action_index,
                    start_frame=start_frame,
                    frame=max(start_frame, self.frame),
                    active_buttons=set(),
                ) from error

            raise TimelineExecutionError(
                f"Timeline action {action_index} failed after {self.frame - start_frame} "
                f"advanced frames: {error}",
                failed_action_index=action_index,
                start_frame=start_frame,
                frame=self.frame,
                active_buttons=self.active_buttons,
            ) from error

        result: dict[str, Any] = {
            "startFrame": start_frame,
            "frame": self.frame,
            "advancedFrames": self.frame - start_frame,
            "actionCount": action_index,
            "activeButtons": sorted(self.active_buttons),
        }
        if include_captures:
            result["captures"] = captures
        return result

    def timeline(self, params: dict[str, Any]) -> dict[str, Any]:
        actions = self.validate_timeline_actions(params.get("actions"), require_actions=True)
        return self.execute_timeline([{"actions": actions}], include_captures=False)

    def capture_timeline(self, params: dict[str, Any]) -> dict[str, Any]:
        checkpoints = params.get("checkpoints")
        if (
            not isinstance(checkpoints, list)
            or len(checkpoints) < 1
            or len(checkpoints) > MAX_TIMELINE_CHECKPOINTS
        ):
            raise ValueError(
                f"A capture timeline requires between 1 and {MAX_TIMELINE_CHECKPOINTS} checkpoints"
            )

        all_actions: list[dict[str, Any]] = []
        validated_checkpoints: list[dict[str, Any]] = []
        for index, checkpoint in enumerate(checkpoints):
            if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get("actions"), list):
                raise ValueError(f"Timeline checkpoint {index} requires an actions array")
            output = self.resolve_project_path(checkpoint.get("outputPath"), existing=False)
            if output.suffix.lower() != ".png":
                raise ValueError("Emulator timeline screenshots must use the .png extension")
            actions = checkpoint["actions"]
            all_actions.extend(actions)
            validated_checkpoints.append({"actions": actions, "outputPath": output})

        self.validate_timeline_actions(all_actions, require_actions=False)
        return self.execute_timeline(validated_checkpoints, include_captures=True)

    def control(self, params: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(params, dict) or set(params) != {"action"}:
            raise RequestValidationError("Emulator control requires an action")
        action = params.get("action")
        if not isinstance(action, str) or action not in {"pause", "cancel"}:
            raise RequestValidationError("The emulator is stepped-only; internal control accepts pause or cancel")
        self.require_emulator()
        self.pause_clock()
        if action == "pause":
            # Compatibility for private regression helpers only. Stepped play
            # already waits between calls, so a pause is genuinely idempotent.
            return self.state()
        self.cancel_event.clear()
        if self.recording is None or self.recording.status == "recording":
            self.set_buttons(set(), emergency=True)
        self.record_current("cancel")
        if self.recording is not None:
            self.recording.finish("cancelled", outcome="cancelled", reason="Playback cancelled")
        return {**self.state(), "cancelled": True}

    def recording_path(self, params: dict[str, Any]) -> Path:
        value = params.get("recordingPath")
        if value is None:
            if self.recording is not None:
                return self.recording.root
            if self.last_recording_path is not None:
                return self.last_recording_path
            raise RuntimeError("A recordingPath is required when no retained recording is selected")
        path = self.resolve_project_path(value, existing=True)
        if not path.is_dir():
            raise ValueError("recordingPath must name a recording directory")
        return path

    def recording_data(self, params: dict[str, Any]) -> dict[str, Any]:
        path = self.recording_path(params)
        recording = self.recording
        if recording is not None and recording.root == path and recording.status == "recording":
            recording.flush_steps()
            return {**recording.header, **recording.snapshot(), "branchesById": recording.branches,
                    "checkpointsById": recording.checkpoints}
        return read_recording(path, self.resolve_project_path)

    def recording_status(self, params: dict[str, Any]) -> dict[str, Any]:
        data = self.recording_data(params)
        return {key: data[key] for key in ("recordingPath", "sessionId", "status", "branchId", "frame", "totalFrames", "bytesUsed", "limits", "branches", "eventCount", "eventDigest", "failure", "outcome", "reason", "truncatedTail") if key in data}

    def committed_recording_cursor(self) -> dict[str, Any] | None:
        recording = self.recording
        if not self.paused or self.emulator is None or recording is None or self.frame != recording.frame:
            return None
        return recording.committed_cursor()

    def recording_span(self, before: dict[str, Any] | None) -> dict[str, Any] | None:
        after = self.committed_recording_cursor()
        if (before is None or after is None
                or any(before[key] != after[key] for key in ("recordingPath", "sessionId", "branchId"))
                or before["actionIndex"] > after["actionIndex"] or before["frame"] > after["frame"]):
            return None
        return {
            **{key: before[key] for key in ("recordingPath", "sessionId", "branchId")},
            "fromActionIndex": before["actionIndex"], "toActionIndex": after["actionIndex"],
            "fromFrame": before["frame"], "toFrame": after["frame"],
            "fromPrefixPin": before["prefixPin"], "prefixPin": after["prefixPin"],
            "emptyInterval": before["actionIndex"] == after["actionIndex"],
        }

    def recording_review(self, params: dict[str, Any]) -> dict[str, Any]:
        # Do not pause, flush, take a capture, or consult recording_data here.
        # Even reviewing an unrelated archive refuses a running worker in v1.
        if self.emulator is not None and not self.paused:
            raise RuntimeError("Recording review requires a paused emulator; pause it explicitly first")
        options = review_options(params)
        root = self.recording_path(params)

        def check_cancel() -> None:
            if self.cancel_event.is_set():
                raise SessionCancelled("The recording review was cancelled")

        check_cancel()
        selected = RecordingReviewSelection(options)
        data = read_recording(root, self.resolve_project_path, prefix_pin=options.get("prefixPin"),
                              review=selected, check_cancel=check_cancel)
        bounds = selected.prefix_state
        if bounds is None:
            raise ValueError("The recording review has no authenticated interval")
        start_frame, end_frame = bounds["fromFrame"], bounds["toFrame"]
        candidates = [item for item in selected.frames if start_frame <= item["frame"] <= end_frame]
        image_count = min(len(candidates), options["maxImages"])
        if image_count == 1:
            indices = [len(candidates) - 1]
        elif image_count > 1:
            indices = [index * (len(candidates) - 1) // (image_count - 1) for index in range(image_count)]
        else:
            indices = []
        frames = []
        for index in indices:
            check_cancel()
            evidence = candidates[index]
            expected_path = root / "frames" / f"{evidence['sha256']}.png"
            if Path(evidence["path"]) != expected_path:
                raise ValueError("Review images must name their existing content-addressed recording PNG")
            verified_path, image_bytes = self.verified_evidence_bytes(evidence)
            if (len(image_bytes) < 24 or image_bytes[:8] != b"\x89PNG\r\n\x1a\n"
                    or int.from_bytes(image_bytes[16:20], "big") != 160
                    or int.from_bytes(image_bytes[20:24], "big") != 144
                    or digest(image_bytes) != evidence["sha256"]):
                raise ValueError("Recorded review image failed PNG/dimension/digest verification")
            frames.append({**evidence, "path": str(verified_path)})

        returned_ids = {item["evidenceId"] for item in frames}

        def endpoint(action_index: int, frame_number: int) -> dict[str, Any]:
            exact = [item for item in candidates if item["actionIndex"] == action_index and item["frame"] == frame_number]
            returned = next((item for item in exact if item["evidenceId"] in returned_ids), None)
            item = returned or (exact[-1] if exact else None)
            return {"actionIndex": action_index, "frame": frame_number, "available": bool(exact),
                    "returned": returned is not None, "pngSha256Verified": returned is not None,
                    "evidenceId": item["evidenceId"] if item is not None else None}

        def maximum_gap(items: list[dict[str, Any]]) -> int | None:
            if not items:
                return None
            points = sorted({start_frame, end_frame, *(item["frame"] for item in items)})
            return max((right - left for left, right in zip(points, points[1:])), default=0)

        imported_inputs = [item for item in selected.inputs if item["origin"]["kind"] == "imported-prefix"]
        unavailable = [item["actionIndex"] for item in selected.inputs
                       if item["action"]["type"] == "set_buttons" and item["actionIndex"] not in selected.matched_controllers]
        uncertainties = ([selected.prior_failure] if selected.prior_failure is not None else []) + selected.uncertainties
        incomplete_physical = bool(imported_inputs or unavailable or uncertainties)
        runtime = data.get("runtime")
        rom = data.get("rom")
        if (not isinstance(runtime, dict) or runtime.get("name") != "PyBoy" or runtime.get("protocolVersion") != PROTOCOL_VERSION
                or not isinstance(runtime.get("version"), str) or not 1 <= len(runtime["version"]) <= 100
                or not isinstance(rom, dict) or not isinstance(rom.get("cgb"), bool)):
            raise ValueError("The recorded source identity is unsupported")
        source_runtime = {"name": "PyBoy", "version": runtime["version"], "protocolVersion": PROTOCOL_VERSION,
                          "workerSha256": sha256_string(runtime.get("workerSha256"), "recorded worker SHA-256")}
        elapsed_frames = end_frame - start_frame
        result = {
            "schemaVersion": 1, "kind": "gb-studio-recording-review",
            "recordingPath": str(root), "sessionId": options["sessionId"], "branchId": options["branchId"],
            "status": data["sourcePins"]["manifestStatus"],
            "interval": {"semantics": "(fromActionIndex,toActionIndex]", "fromActionIndex": selected.start,
                         "toActionIndex": selected.end, "fromFrame": start_frame, "toFrame": end_frame,
                         "elapsedFrames": elapsed_frames, "normalizedActionCount": len(selected.inputs),
                         "emptyInterval": selected.start == selected.end},
            "prefixPin": data["prefixPin"], "sourcePins": data["sourcePins"],
            "source": {"romSha256": sha256_string(rom.get("sha256"), "recorded ROM SHA-256"),
                       "cgb": rom["cgb"], "runtime": source_runtime,
                       "reader": {"protocolVersion": PROTOCOL_VERSION, "workerSha256": WORKER_SHA256}},
            "initialButtons": {"buttons": selected.initial_buttons, "basis": "normalized-input-history", "physicalDeliveryInferred": False},
            "inputs": selected.inputs, "physicalEvents": selected.physical_events,
            "physicalCoverage": {"status": ("partial" if selected.physical_events else "unavailable") if incomplete_physical else "complete",
                                 "basis": "recorded-controller-delivery-events", "importedInputCount": len(imported_inputs),
                                 "unavailableActionIndices": unavailable, "uncertaintyBoundaries": uncertainties,
                                 "missingEdgesReconstructed": False},
            "frames": frames,
            "coverage": {"fromEndpoint": endpoint(selected.start, start_frame), "toEndpoint": endpoint(selected.end, end_frame),
                         "sampleEveryFrames": data["limits"]["sampleEveryFrames"],
                         "retainedImageCount": len(candidates), "returnedImageCount": len(frames),
                         "imagesDownsampled": len(candidates) > len(frames),
                         "retainedCoverageBasis": "authenticated-frame-records", "returnedImagesVerified": "png-sha256-and-dimensions",
                         "rgbaSha256Verification": "recorded-not-recomputed",
                         "maxRetainedImageGapFrames": maximum_gap(candidates), "maxImageGapFrames": maximum_gap(frames),
                         "samplingCoverage": {"intervalNativeFrameCount": elapsed_frames + 1,
                                              "retainedNativeFrameCount": len({item["frame"] for item in candidates}),
                                              "returnedNativeFrameCount": len({item["frame"] for item in frames}),
                                              "allNativeFramesRetained": len({item["frame"] for item in candidates}) == elapsed_frames + 1}},
            "semanticValidity": "not-adjudicated",
        }
        if len(encoded(result)) > MAX_REVIEW_METADATA_BYTES:
            raise ValueError("Review metadata exceeds 2 MiB; narrow the interval")
        # Recheck the bytes this read actually authenticated. A later append is
        # allowed for unfinished sources, never a rewrite of the selected prefix.
        manifest_path = self.resolve_project_path(str(root / "recording.json"), existing=True)
        manifest_pin = data["sourcePins"]["manifest"]
        if manifest_path.stat().st_size != manifest_pin["byteLength"] or digest(bounded_recording_metadata(manifest_path, 1024 * 1024)) != manifest_pin["sha256"]:
            raise ValueError("The recording manifest changed during review")
        event_path = self.resolve_project_path(str(root / "events.jsonl"), existing=True)
        events_pin = data["sourcePins"]["events"]
        if event_path != root / "events.jsonl" or (data["sourcePins"]["finalized"] and event_path.stat().st_size != events_pin["byteLength"]):
            raise ValueError("The recording event source changed during review")
        remaining = events_pin["byteLength"]
        hasher = hashlib.sha256()
        with event_path.open("rb") as events:
            while remaining:
                check_cancel()
                chunk = events.read(min(64 * 1024, remaining))
                if not chunk:
                    raise ValueError("The recording event prefix changed during review")
                remaining -= len(chunk)
                hasher.update(chunk)
        if hasher.hexdigest() != events_pin["sha256"]:
            raise ValueError("The recording event prefix changed during review")
        check_cancel()
        return result

    def verified_evidence_bytes(self, evidence: dict[str, Any]) -> tuple[Path, bytes]:
        path = self.resolve_project_path(evidence.get("path"), existing=True)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        with os.fdopen(os.open(path, flags), "rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
                raise ValueError("A retained framebuffer exceeds its regular-file byte limit")
            data = source.read(1024 * 1024 + 1)
            after = os.fstat(source.fileno())
            current = path.lstat()
            if (len(data) != before.st_size or after.st_size != before.st_size or after.st_mtime_ns != before.st_mtime_ns
                    or current.st_ino != before.st_ino or current.st_dev != before.st_dev or stat.S_ISLNK(current.st_mode)
                    or self.resolve_project_path(str(path), existing=True) != path
                    or digest(data) != evidence.get("sha256")):
                raise ValueError("A retained framebuffer failed its SHA-256 integrity check")
        return path, data

    def verified_evidence(self, evidence: dict[str, Any]) -> dict[str, Any]:
        path, _ = self.verified_evidence_bytes(evidence)
        return {**evidence, "path": str(path)}

    def recording_export(self, params: dict[str, Any]) -> dict[str, Any]:
        path = self.recording_path(params)
        if self.recording is not None and self.recording.root == path and self.recording.status == "recording":
            self.record_current("export")
        data = self.recording_data({"recordingPath": str(path)})
        branch_id = params.get("branchId", data["branchId"])
        branch = data["branchesById"].get(branch_id)
        if branch is None:
            raise ValueError("The requested recording branch does not exist")
        evidence = [self.verified_evidence(item) for item in branch["evidence"]]
        if not evidence:
            raise ValueError("This attempt did not retain a genuine framebuffer")
        if evidence[-1]["frame"] != branch["frame"] or evidence[-1]["actionIndex"] != len(branch["actions"]):
            raise ValueError("The retained attempt has no complete final-frame evidence")
        return {"schemaVersion": 1, "sessionId": data["sessionId"], "recordingPath": str(path),
                "branchId": branch_id, "rom": data["rom"], "runtime": data["runtime"],
                "startingCondition": branch["startingCondition"], "actions": branch["actions"],
                "evidence": evidence, "finalFrame": branch["frame"], "finalEvidence": evidence[-1],
                "status": data["status"]}

    def recent_frames(self, params: dict[str, Any]) -> dict[str, Any]:
        recording = self.require_recording()
        limit = bounded_integer(params.get("limit", recording.limits["recentFrameCount"]), "recent frame limit", 1, MAX_RECENT_FRAMES)
        if recording.status == "recording":
            self.record_current("recent")
        branch = recording.branches[recording.branch_id]
        frames = [self.verified_evidence(item) for item in branch["evidence"][-limit:]]
        return {"recordingPath": str(recording.root), "branchId": recording.branch_id,
                "frame": self.frame, "frames": frames, "sampleEveryFrames": recording.limits["sampleEveryFrames"]}

    def recording_stop(self, params: dict[str, Any]) -> dict[str, Any]:
        recording = self.require_recording()
        outcome = params.get("outcome")
        reason = params.get("reason")
        if outcome is not None and outcome not in {"passed", "failed", "needs-review", "cancelled"}:
            raise ValueError("Recording outcome must be passed, failed, needs-review, or cancelled")
        if reason is not None and (not isinstance(reason, str) or len(reason) > 2000):
            raise ValueError("Recording outcome reason must be a string of at most 2000 characters")
        if recording.status == "recording":
            self.pause_clock()
            recording.append("pause", clock=self.clock_snapshot())
            self.record_current("recording-stop")
            status = "failed" if outcome == "failed" else "cancelled" if outcome == "cancelled" else "stopped"
            recording.finish(status, failure=reason if status == "failed" else None, outcome=outcome, reason=reason)
        return recording.snapshot()

    def checkpoint_save(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_mutable()
        self.require_paused()
        recording = self.require_recording()
        label = params.get("label")
        if label is not None and (not isinstance(label, str) or len(label) > 160):
            raise ValueError("Checkpoint labels must contain at most 160 characters")
        if self.active_buttons or self.sampled_buttons or self.controller_dirty:
            raise RuntimeError("Checkpoint save requires a sampled neutral controller; release all buttons and step one neutral frame first")
        if len(list((recording.root / "checkpoints").iterdir())) >= 64:
            raise RecordingLimitError("The recording checkpoint limit was reached")
        entry = self.record_current("checkpoint")
        if entry is None:
            raise RuntimeError("Checkpoint save requires an active recording")
        state_buffer = io.BytesIO()
        self.require_emulator().save_state(state_buffer)
        state_bytes = state_buffer.getvalue()
        if len(state_bytes) > MAX_STATE_BYTES:
            raise RecordingLimitError("The opaque emulator checkpoint exceeds its byte limit")
        checkpoint_id = f"checkpoint-{uuid.uuid4().hex}"
        checkpoint_root = recording.root / "checkpoints" / checkpoint_id
        state_hash = digest(state_bytes)
        branch = recording.branches[recording.branch_id]
        metadata = {"schemaVersion": 1, "kind": "gb-studio-checkpoint", "checkpointId": checkpoint_id,
                    "sessionId": recording.session_id, "romSha256": self.rom_sha256, "cgb": self.cgb,
                    "runtime": self.runtime, "frame": self.frame, "branchId": recording.branch_id,
                    "actionCount": len(branch["actions"]), "evidenceCount": len(branch["evidence"]),
                    "stateSha256": state_hash, "stateFile": "state.bin",
                    "entryFile": str(Path(entry["path"]).relative_to(recording.root)), "entrySha256": entry["sha256"],
                    "activeButtons": [], "sampledButtons": [], "automaticAdvance": 0,
                    **({"label": label} if label is not None else {})}
        data = encoded(metadata) + b"\n"
        recording.check_budget(len(state_bytes) + len(data) + 2048)
        checkpoint_root.mkdir(mode=0o700)
        recording.write_new(checkpoint_root / "state.bin", state_bytes)
        recording.write_new(checkpoint_root / "checkpoint.json", data)
        saved = recording.append("checkpoint_saved", checkpointId=checkpoint_id,
                                 metadataSha256=digest(data), stateSha256=state_hash, automaticAdvance=0)
        recording.checkpoints[checkpoint_id] = saved
        return {"checkpointId": checkpoint_id, "recordingPath": str(recording.root),
                "path": str(checkpoint_root / "checkpoint.json"), "frame": self.frame,
                "branchId": recording.branch_id, "romSha256": self.rom_sha256,
                "stateSha256": state_hash, "automaticAdvance": 0}

    def checkpoint_restore(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_mutable()
        self.require_paused()
        recording = self.require_recording()
        checkpoint_id = params.get("checkpointId")
        if not isinstance(checkpoint_id, str) or not checkpoint_id.startswith("checkpoint-") or len(checkpoint_id) != len("checkpoint-") + 32 or any(character not in "0123456789abcdef" for character in checkpoint_id[len("checkpoint-"):]):
            raise ValueError("Invalid opaque checkpoint ID")
        source_root = self.recording_path(params)
        metadata_path = self.resolve_project_path(str(source_root / "checkpoints" / checkpoint_id / "checkpoint.json"), existing=True)
        if not metadata_path.is_relative_to(source_root) or metadata_path.stat().st_size > 64 * 1024:
            raise ValueError("Checkpoint metadata is invalid")
        metadata_bytes = metadata_path.read_bytes()
        metadata = json.loads(metadata_bytes)
        if metadata.get("kind") != "gb-studio-checkpoint" or metadata.get("schemaVersion") != 1 or metadata.get("checkpointId") != checkpoint_id:
            raise ValueError("Unsupported checkpoint format or identity")
        if metadata.get("romSha256") != self.rom_sha256 or metadata.get("cgb") != self.cgb:
            raise ValueError("Checkpoint ROM identity is incompatible with the loaded ROM bytes")
        if metadata.get("runtime") != self.runtime:
            raise ValueError("Checkpoint runtime identity is incompatible with this PyBoy worker")
        if self.rom_path is None or digest(self.rom_path.read_bytes()) != self.rom_sha256:
            raise ValueError("The ROM file changed after loading; restart before restoring a checkpoint")
        if metadata.get("activeButtons") != [] or metadata.get("sampledButtons") != [] or metadata.get("automaticAdvance") != 0:
            raise ValueError("Checkpoint controller state is not safely restorable")
        state_path = self.resolve_project_path(str(metadata_path.parent / metadata.get("stateFile", "")), existing=True)
        if not state_path.is_relative_to(metadata_path.parent) or state_path.stat().st_size > MAX_STATE_BYTES:
            raise ValueError("Checkpoint state file is invalid")
        state_bytes = state_path.read_bytes()
        if digest(state_bytes) != metadata.get("stateSha256"):
            raise ValueError("Checkpoint state SHA-256 differs")
        source = self.recording_data({"recordingPath": str(source_root)})
        if source.get("rom", {}).get("sha256") != self.rom_sha256 or source.get("rom", {}).get("cgb") != self.cgb or source.get("runtime") != self.runtime:
            raise ValueError("Checkpoint source recording ROM or runtime identity is incompatible")
        if source["sessionId"] != metadata.get("sessionId"):
            raise ValueError("Checkpoint recording identity differs")
        saved = source["checkpointsById"].get(checkpoint_id)
        if saved is None or saved.get("metadataSha256") != digest(metadata_bytes) or saved.get("stateSha256") != metadata.get("stateSha256"):
            raise ValueError("Checkpoint metadata failed its immutable recording integrity check")
        parent = source["branchesById"].get(metadata.get("branchId"))
        if parent is None:
            raise ValueError("Checkpoint source branch is unavailable")
        action_count = bounded_integer(metadata.get("actionCount"), "checkpoint action count", 0, len(parent["actions"]))
        evidence_count = bounded_integer(metadata.get("evidenceCount"), "checkpoint evidence count", 1, len(parent["evidence"]))
        prefix_actions = [dict(action) for action in parent["actions"][:action_count]]
        prefix_evidence = [self.verified_evidence(item) for item in parent["evidence"][:evidence_count]]
        if prefix_evidence[-1]["frame"] != metadata.get("frame") or prefix_evidence[-1]["actionIndex"] != action_count or prefix_evidence[-1]["sha256"] != metadata.get("entrySha256"):
            raise ValueError("Checkpoint entry evidence differs from its source timeline")
        from PIL import Image
        entry_image = Image.open(io.BytesIO(Path(prefix_evidence[-1]["path"]).read_bytes())).convert("RGBA")
        # A fresh instance discards queued inputs that PyBoy's opaque state omits.
        candidate = create_pyboy(self.rom_bytes, self.cgb)
        candidate.set_emulation_speed(0)
        try:
            candidate.load_state(io.BytesIO(state_bytes))
            verification = io.BytesIO()
            candidate.save_state(verification)
            if digest(verification.getvalue()) != metadata["stateSha256"]:
                raise RuntimeError("PyBoy did not restore the opaque checkpoint exactly")
            self.record_current("branch-end")
            if len(recording.branches) >= MAX_RECORDING_BRANCHES:
                raise RecordingLimitError("The recording branch limit was reached")
            branch_id = f"branch-{len(recording.branches) + 1:04d}"
            imported = []
            files: dict[str, bytes] = {}
            for item in prefix_evidence:
                file = f"frames/{item['sha256']}.png"
                target = recording.root / file
                if target.exists():
                    if target.is_symlink() or not target.is_file() or digest(target.read_bytes()) != item["sha256"]:
                        raise ValueError("An imported retained framebuffer failed its integrity check")
                else:
                    files[file] = Path(item["path"]).read_bytes()
                copy = {**item, "sourceBranchId": item["branchId"], "branchId": branch_id, "file": file}
                copy.pop("path", None)
                imported.append(copy)
            payload = {"parentBranchId": metadata["branchId"], "checkpointId": checkpoint_id,
                       "sourceSessionId": metadata["sessionId"], "prefixActions": prefix_actions,
                       "prefixEvidence": imported, "startingCondition": parent["startingCondition"],
                       "frame": metadata["frame"]}
            if len(encoded(payload)) > 16 * 1024 * 1024:
                raise RecordingLimitError("The checkpoint branch prefix exceeds its supported metadata limit")
            recording.check_budget(sum(len(value) for value in files.values()) + len(encoded(payload)) + 2048)
            for file, value in files.items():
                recording.write_new(recording.root / file, value)
            old_emulator = self.emulator
            recording.branch_id = branch_id
            recording.frame = metadata["frame"]
            recording.append("branch", **payload)
            copied_evidence = [{**item, "path": str(recording.root / item["file"])} for item in imported]
            for item in copied_evidence:
                item.pop("file", None)
            recording.branches[branch_id] = {"actions": prefix_actions, "evidence": copied_evidence,
                                             "frame": metadata["frame"], "parentBranchId": metadata["branchId"],
                                             "sourceSessionId": metadata["sessionId"],
                                             "checkpointId": checkpoint_id, "startingCondition": parent["startingCondition"]}
            recording.recent.clear()
            recording.recent.extend(copied_evidence[-recording.limits["recentFrameCount"]:])
            self.emulator = candidate
            candidate = None
            self.frame = metadata["frame"]
            self.active_buttons.clear()
            self.sampled_buttons.clear()
            self.controller_dirty = False
            self.restored_image = entry_image
            if old_emulator is not None:
                old_emulator.stop(save=False)
            return self.state()
        finally:
            if candidate is not None:
                candidate.stop(save=False)

    def validate_clip_destination(self, output: Path, recording_root: Path) -> None:
        canonical = self.resolve_project_path(str(output), existing=False)
        if canonical != output or recording_root.resolve(strict=True) != recording_root:
            raise ValueError("The clip destination changed or was redirected")
        if output.is_relative_to(recording_root):
            for name in (".gitignore", ".npmignore"):
                marker = recording_root / name
                if marker.is_symlink() or not marker.is_file() or marker.stat().st_size != 2 or marker.read_bytes() != b"*\n":
                    raise ValueError("The recording directory's package-protection markers are missing or changed")
            return
        # Keep this root lexical. Resolving a top-level artifacts symlink or
        # Windows junction and then trusting its target could bless examples/
        # (or another authored directory) as a packageable clip destination.
        generated_root = self.project_root / "artifacts"
        is_junction = getattr(generated_root, "is_junction", lambda: False)
        if generated_root.is_symlink() or is_junction() or (
            generated_root.exists() and not generated_root.is_dir()
        ) or generated_root.resolve(strict=False) != generated_root:
            raise ValueError("The top-level artifacts directory must not be a symbolic link, junction, or redirected path")
        if not output.is_relative_to(generated_root):
            raise ValueError("Clips must be written inside their recording directory or the authorized artifacts directory")

    def clip(self, params: dict[str, Any]) -> dict[str, Any]:
        def check_cancel() -> None:
            if self.cancel_event.is_set():
                raise SessionCancelled("The clip export was cancelled")

        check_cancel()
        cuts = None
        if "cuts" in params:
            if "startFrame" in params or "endFrame" in params:
                raise RequestValidationError("Provide cuts or a legacy startFrame/endFrame range, not both")
            requested_cuts = params["cuts"]
            if not isinstance(requested_cuts, list) or not 1 <= len(requested_cuts) <= 16:
                raise RequestValidationError("A montage requires between 1 and 16 ordered cuts")
            cuts = []
            try:
                for cut in requested_cuts:
                    if not isinstance(cut, dict) or set(cut) != {"startFrame", "endFrame"}:
                        raise ValueError("Each cut requires only startFrame and endFrame")
                    start = bounded_integer(cut["startFrame"], "cut start frame", 0, MAX_RECORDING_FRAMES)
                    end = bounded_integer(cut["endFrame"], "cut end frame", start, MAX_RECORDING_FRAMES)
                    cuts.append({"startFrame": start, "endFrame": end})
            except ValueError as error:
                raise RequestValidationError(str(error)) from error
            if sum(cut["endFrame"] - cut["startFrame"] + 1 for cut in cuts) * FRAME_DOTS > 60 * GB_HZ:
                raise RequestValidationError("A montage may contain at most 60 seconds of native game time")

        # A supporting clip can use an earlier retained interval of a failed
        # attempt. Read committed files, never an export/capture or
        # the live recording's flush-on-read compatibility helpers.
        root = self.recording_path(params)
        recording = read_recording(root, self.resolve_project_path, check_cancel=check_cancel)
        branch_id = params.get("branchId", recording["branchId"])
        branch = recording["branchesById"].get(branch_id)
        if branch is None:
            raise ValueError("The requested recording branch does not exist")
        evidence = branch["evidence"]
        if not evidence:
            raise ValueError("This attempt did not retain a genuine framebuffer")
        last_evidence_frame = evidence[-1]["frame"]
        partial_recording = last_evidence_frame != branch["frame"] or evidence[-1]["actionIndex"] != len(branch["actions"])
        output = self.resolve_project_path(params.get("outputPath"), existing=False)
        if output.suffix.lower() != ".gif" or output.exists():
            raise ValueError("A clip requires a new .gif output path; existing files are never overwritten")
        self.validate_clip_destination(output, root)
        max_frames = bounded_integer(params.get("maxFrames", MAX_CLIP_FRAMES), "clip frame limit", 1, MAX_CLIP_FRAMES)
        segments = []
        if cuts is None:
            # Preserve legacy range selection and its explicit downsampling.
            start = bounded_integer(params.get("startFrame", min(branch["startingCondition"]["initialFrames"], last_evidence_frame)), "clip start frame", 0, last_evidence_frame)
            end = bounded_integer(params.get("endFrame", last_evidence_frame), "clip end frame (last retained evidence)", start, last_evidence_frame)
            selected = [self.verified_evidence(item) for item in evidence if start <= item["frame"] <= end]
            selected = list({item["frame"]: item for item in selected}.values())
            if not selected:
                raise ValueError("The requested clip interval has no recorded frames")
            if len(selected) > max_frames:
                if max_frames == 1:
                    selected = [selected[-1]]
                else:
                    selected = [selected[round(index * (len(selected) - 1) / (max_frames - 1))] for index in range(max_frames)]
            segments.append((selected, end))
        else:
            # Dedupe same-frame input edges within each cut, not across cuts.
            # Reordered and repeated ranges intentionally repeat their images.
            logical_frames = list({item["frame"]: item for item in evidence}.values())
            occurrence_count = 0
            for cut in cuts:
                selected = [item for item in logical_frames if cut["startFrame"] <= item["frame"] <= cut["endFrame"]]
                if not selected or selected[0]["frame"] != cut["startFrame"] or selected[-1]["frame"] != cut["endFrame"]:
                    raise RequestValidationError("Every montage cut requires both exact endpoints in the retained branch evidence")
                occurrence_count += len(selected)
                if occurrence_count > max_frames:
                    raise RequestValidationError(f"The montage exceeds its {max_frames} selected image occurrence limit; cuts are never downsampled")
                segments.append((selected, cut["endFrame"]))

        selected = [item for frames, _end in segments for item in frames]
        durations = []
        previous_centiseconds = 0
        native_frame_periods = 0
        cut_mapping = []
        for frames, end in segments:
            output_start = previous_centiseconds * 10
            samples = []
            gaps = []
            for index, item in enumerate(frames):
                boundary = frames[index + 1]["frame"] if index + 1 < len(frames) else end + 1
                native_frame_periods += boundary - item["frame"]
                # Carry GIF rounding across cuts, but never carry source time
                # across them. Missing native frames hold the previous sample.
                centiseconds = round(native_frame_periods * FRAME_DOTS * 100 / GB_HZ)
                duration = max(1, centiseconds - previous_centiseconds)
                if duration > 65_535:
                    raise ValueError("The selected clip is too sparse for GIF timing; choose a shorter interval")
                samples.append({"frame": item["frame"], "outputStartMs": previous_centiseconds * 10,
                                "outputEndMs": (previous_centiseconds + duration) * 10})
                if index + 1 < len(frames) and boundary - item["frame"] > 1:
                    gaps.append({"fromFrame": item["frame"], "toFrame": boundary, "missingFrames": boundary - item["frame"] - 1})
                durations.append(duration * 10)
                previous_centiseconds += duration
            cut_mapping.append({"startFrame": frames[0]["frame"], "endFrame": frames[-1]["frame"],
                                "outputStartMs": output_start, "outputEndMs": previous_centiseconds * 10,
                                "sourceFrameCount": len(frames), "samples": samples, "sampledGaps": gaps})

        # A live recording retains its finalization reserve even when the file
        # reader labels its unfinished journal as interrupted.
        active_recording = self.recording is not None and self.recording.root == root and self.recording.status == "recording"
        ceiling = recording["limits"]["maxBytes"] - (RECORDING_RESERVE_BYTES if active_recording or recording["status"] == "recording" else 0)
        used = artifact_usage(root, self.resolve_project_path)
        available_bytes = ceiling - used
        if available_bytes <= 0:
            raise RecordingLimitError("Clip output would exceed the recording byte limit")

        class ClipBuffer(io.BytesIO):
            def write(self, value: bytes) -> int:
                check_cancel()
                if self.tell() + len(value) > available_bytes:
                    raise RecordingLimitError("Clip output would exceed the recording byte limit")
                return super().write(value)

        from PIL import Image
        images = []
        try:
            for item in selected:
                check_cancel()
                # Never reopen a verified path with an unbounded read. Validate
                # native dimensions before decoding and retain at most 600 RGB
                # frame occurrences, closing all images on success or failure.
                _path, png_bytes = self.verified_evidence_bytes(item)
                with io.BytesIO(png_bytes) as source, Image.open(source) as source_image:
                    if source_image.format != "PNG" or source_image.size != (160, 144):
                        raise ValueError("Recorded clip images must be native 160 x 144 PNG framebuffers")
                    with source_image.convert("RGBA") as rgba:
                        if digest(rgba.tobytes()) != item["rgbaSha256"]:
                            raise ValueError("A recorded clip framebuffer failed its RGBA integrity check")
                        images.append(rgba.convert("RGB"))
            with ClipBuffer() as buffer:
                images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=False, disposal=2)
                data = buffer.getvalue()
            with io.BytesIO(data) as source, Image.open(source) as encoded_clip:
                encoded_frame_count = encoded_clip.n_frames
                encoded_duration = 0
                for index in range(encoded_frame_count):
                    check_cancel()
                    encoded_clip.seek(index)
                    encoded_duration += int(encoded_clip.info.get("duration", 0))
        finally:
            for image in images:
                image.close()
        if cuts is not None and (encoded_duration != previous_centiseconds * 10 or encoded_duration > 60_000):
            raise ValueError("The encoded montage timing differs from its bounded output mapping")
        row = {"path": str(output), "sha256": digest(data), "bytes": len(data), "branchId": branch_id,
               "startFrame": selected[0]["frame"], "endFrame": selected[-1]["frame"],
               "recordingFinalFrame": branch["frame"], "lastEvidenceFrame": last_evidence_frame,
               "partialRecording": partial_recording,
               **({"cuts": cuts} if cuts is not None else {})}
        ledger_data = encoded(row) + b"\n"
        used = artifact_usage(root, self.resolve_project_path)
        # An active attempt still needs its failure/finalization reserve. Once
        # closed (or recovered as interrupted), derived clips can use remaining
        # space up to the same hard byte cap without modifying the original log.
        if used + len(data) + len(ledger_data) > ceiling:
            raise RecordingLimitError("Clip output would exceed the recording byte limit")
        ledger = root / "derived.jsonl"
        if ledger.exists() and (ledger.is_symlink() or ledger.stat().st_size + len(ledger_data) > 1024 * 1024):
            raise RecordingLimitError("The derived-artifact ledger reached its limit")
        output.parent.mkdir(parents=True, exist_ok=True)
        # Parent creation may race an external rename/link replacement. Check
        # the same physical boundary again immediately before artifact writes.
        self.validate_clip_destination(output, root)
        if output.exists() or output.is_symlink():
            raise ValueError("A clip requires a new .gif output path; existing files are never overwritten")
        check_cancel()
        # Reserve the derived bytes first. A failed external write remains
        # charged, preventing repeated partial writes from escaping the quota.
        with ledger.open("ab") as destination:
            destination.write(ledger_data)
        try:
            with output.open("xb") as destination:
                destination.write(data)
        finally:
            if self.recording is not None and self.recording.root == root:
                self.recording.bytes_used = artifact_usage(root, self.resolve_project_path)
        return {"path": str(output), "sha256": row["sha256"], "frameCount": encoded_frame_count, "sourceFrameCount": len(selected),
                "startFrame": row["startFrame"], "endFrame": row["endFrame"], "durationMs": encoded_duration,
                "branchId": branch_id, "recordingPath": str(root), "width": 160, "height": 144,
                "recordingFinalFrame": row["recordingFinalFrame"], "lastEvidenceFrame": last_evidence_frame,
                "partialRecording": partial_recording,
                **({"cuts": cut_mapping, "timing": {
                    "mode": "native-game-time", "clockHz": GB_HZ, "dotsPerFrame": FRAME_DOTS,
                    "nativeFramePeriods": native_frame_periods,
                    "nativeDurationMs": native_frame_periods * FRAME_DOTS * 1000 / GB_HZ,
                    "decisionPausesIncluded": False, "sampleDisplay": "hold-until-next-sample", "interpolated": False,
                }} if cuts is not None else {})}

    def handle_failure(self, error: BaseException, *, method: str) -> None:
        recording = self.recording
        if recording is None or recording.status != "recording":
            return
        message = str(error)
        cause: BaseException | None = error
        terminal = method in {"clock", "shutdown", "open"}
        cancelled = False
        while cause is not None:
            terminal = terminal or isinstance(cause, RecordingLimitError)
            cancelled = cancelled or isinstance(cause, SessionCancelled)
            cause = cause.__cause__
        if cancelled and method != "shutdown":
            terminal = False
        try:
            recording.flush_steps(emergency=True)
            if not recording.boot_finished:
                recording.boot_complete()
            recording.failure_event(message, method=method)
            if terminal:
                self.pause_clock()
                try:
                    recording.record_frame(self.current_image(), reason="failure", emergency=True)
                except Exception as evidence_error:
                    recording.append("failure", message=f"Final framebuffer unavailable: {evidence_error}"[:2000],
                                     method=method, evidenceUnavailable=True,
                                     rgbaSha256=digest(self.current_image().convert("RGBA").tobytes()), emergency=True)
                recording.finish("failed", failure=message, outcome="failed", reason=message[:2000])
        except Exception as persistence_error:
            self.pause_clock()
            logging.error("Could not finalize playtest failure: %s", persistence_error)

    def unknown_execution(self, error: BaseException, *, method: str) -> dict[str, Any] | None:
        cause = native_accounting_error(error)
        if cause is None:
            return None
        start = error.start_frame if isinstance(error, TimelineExecutionError) else cause.start_frame
        result = {"message": str(error), "executionStatus": "unknown",
                  "confirmedPrefix": {"startFrame": start, "frame": cause.confirmed_frame,
                                      "advancedFrames": cause.confirmed_frame - start,
                                      "sampledButtons": cause.sampled_buttons},
                  **({"requestedFrames": cause.requested_frames} if cause.requested_frames is not None else {})}
        recording = self.recording
        if recording is not None and recording.status == "recording":
            try:
                # Flush only already-authenticated ticks. The native framebuffer
                # after the failed tick has an unknown frame identity and must
                # never be captured under the prefix's last confirmed number.
                recording.flush_steps(emergency=True)
                if not recording.boot_finished:
                    recording.boot_complete()
                recording.append("failure", message=str(error)[:2000], method=method,
                                 executionStatus="unknown", evidenceUnavailable=True,
                                 confirmedFrame=cause.confirmed_frame, emergency=True)
                recording.finish("failed", failure=str(error), outcome="failed", reason="Native frame accounting is unavailable")
            except Exception as persistence_error:
                logging.error("Could not finalize unverified native execution: %s", persistence_error)
        # Detach first so even failed persistence cannot make stop() capture the
        # unverified framebuffer. Stop never writes adjacent cartridge saves.
        self.recording = None
        try:
            self.stop()
        except Exception as stop_error:
            logging.error("Could not stop an inconsistent native emulator cleanly: %s", stop_error)
        return result

    def inspect_oam(self, params: dict[str, Any]) -> dict[str, Any]:
        emulator = self.require_emulator()
        visible_only = params.get("visibleOnly", False)
        include_scanlines = params.get("includeScanlineSummary", False)
        limit = params.get("limit", MAX_OAM_OBJECTS)
        if not isinstance(visible_only, bool) or not isinstance(include_scanlines, bool):
            raise ValueError("OAM inspection flags must be boolean values")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_OAM_OBJECTS:
            raise ValueError(f"OAM inspection limits must be between 1 and {MAX_OAM_OBJECTS}")

        objects: list[dict[str, Any]] = []
        visible_objects = 0
        scanline_counts = [0] * 144
        for index in range(MAX_OAM_OBJECTS):
            sprite = emulator.get_sprite(index)
            visible = bool(sprite.on_screen)
            if visible:
                visible_objects += 1

            if include_scanlines:
                start_line = max(0, sprite.y)
                stop_line = min(144, sprite.y + sprite.shape[1])
                for scanline in range(start_line, stop_line):
                    scanline_counts[scanline] += 1

            if visible_only and not visible:
                continue
            objects.append(
                {
                    "index": index,
                    "x": sprite.x,
                    "y": sprite.y,
                    "tile": sprite.tile_identifier,
                    "attributes": int(emulator.memory[0xFE00 + index * 4 + 3]),
                    "width": sprite.shape[0],
                    "height": sprite.shape[1],
                    "visible": visible,
                }
            )

        matched_objects = len(objects)
        sampled_objects = objects[:limit]
        result: dict[str, Any] = {
            "view": "oam",
            "frame": self.frame,
            "totalObjects": MAX_OAM_OBJECTS,
            "visibleObjects": visible_objects,
            "matchedObjects": matched_objects,
            "returnedObjects": len(sampled_objects),
            "truncated": matched_objects > len(sampled_objects),
            "objects": sampled_objects,
        }

        if include_scanlines:
            peak_objects = max(scanline_counts, default=0)
            result["scanlineSummary"] = {
                "peakObjects": peak_objects,
                "hardwareLimit": 10,
                "overLimitScanlines": sum(count > 10 for count in scanline_counts),
                "peakScanlines": [
                    index
                    for index, count in enumerate(scanline_counts)
                    if count == peak_objects and peak_objects > 0
                ],
            }
        return result

    def inspect_memory(self, params: dict[str, Any]) -> dict[str, Any]:
        emulator = self.require_emulator()
        region = params.get("region")
        view = params.get("view")
        if region not in MEMORY_REGIONS or (view == "vram" and region != "vram"):
            raise ValueError("Memory inspection requires a named VRAM, WRAM, OAM, or HRAM region")

        offset = params.get("offset")
        length = params.get("length")
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise ValueError("Memory inspection offsets must be non-negative integers")
        if (
            isinstance(length, bool)
            or not isinstance(length, int)
            or not 1 <= length <= MAX_INSPECTION_BYTES
        ):
            raise ValueError(
                f"Memory inspection length must be between 1 and {MAX_INSPECTION_BYTES} bytes"
            )

        base_address, region_size = MEMORY_REGIONS[region]
        if offset + length > region_size:
            raise ValueError(f"The requested byte range exceeds the {region} region")

        bank = params.get("bank")
        if bank is not None:
            if isinstance(bank, bool) or not isinstance(bank, int) or bank < 0:
                raise ValueError("Memory bank selections must be non-negative integers")
            if region not in {"vram", "wram"}:
                raise ValueError("Only VRAM and WRAM regions support bank selection")
            maximum_bank = 1 if region == "vram" else 7
            if bank > maximum_bank:
                raise ValueError(f"The {region} bank must be between 0 and {maximum_bank}")
            if bank > 0 and not self.cgb:
                raise ValueError("Nonzero VRAM or WRAM bank selection requires Game Boy Color mode")
            if region == "wram":
                if offset + length > 0x1000:
                    raise ValueError("A banked WRAM inspection must remain inside one 4 KiB bank")
                base_address = 0xC000 if bank == 0 else 0xD000

        address = base_address + offset
        if bank is None:
            values = [int(emulator.memory[address + index]) for index in range(length)]
        else:
            values = [int(emulator.memory[bank, address + index]) for index in range(length)]

        result: dict[str, Any] = {
            "view": view,
            "frame": self.frame,
            "region": region,
            "offset": offset,
            "length": length,
            "address": f"0x{address:04x}",
            "hex": bytes(values).hex(),
        }
        if bank is not None:
            result["bank"] = bank
        return result

    def inspect(self, params: dict[str, Any]) -> dict[str, Any]:
        view = params.get("view")
        if view == "oam":
            return self.inspect_oam(params)
        if view in {"memory", "vram"}:
            return self.inspect_memory(params)
        raise ValueError(f"Unsupported emulator inspection view: {view!r}")

    def screenshot(self, params: dict[str, Any]) -> dict[str, Any]:
        self.require_emulator()
        image = self.current_image()
        output = self.resolve_project_path(params.get("outputPath"), existing=False)
        if output.suffix.lower() != ".png":
            raise ValueError("Emulator screenshots must use the .png extension")

        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
        try:
            image.save(temporary, format="PNG")
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)

        result = {
            "path": str(output),
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "frame": self.frame,
            "width": image.width,
            "height": image.height,
        }
        if self.recording is not None and self.recording.status == "recording":
            self.record_current("capture")
            self.recording.append("capture", **result)
        return result

    def stop(self) -> None:
        self.pause_clock()
        recording = self.recording
        if recording is not None and recording.status == "recording":
            try:
                if self.emulator is not None:
                    self.record_current("close")
                recording.finish("stopped")
            except Exception as error:
                self.handle_failure(error, method="shutdown")
        try:
            if self.emulator is not None:
                self.emulator.stop(save=False)
        finally:
            self.emulator = None
        self.emulator = None
        self.rom_path = None
        self.cgb = False
        self.frame = 0
        self.active_buttons.clear()
        self.sampled_buttons.clear()
        self.controller_dirty = False
        self.rom_bytes = None
        self.rom_sha256 = None
        self.runtime = None
        self.restored_image = None
        self.recording = None

    def dispatch(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method in {"play_step", "step", "input", "timeline", "capture_timeline"}:
            before = self.committed_recording_cursor()
            operation = {"play_step": self.play_step, "step": self.step, "input": self.input, "timeline": self.timeline,
                         "capture_timeline": self.capture_timeline}[method]
            try:
                result = operation(params)
            except TimelineExecutionError as error:
                # Execution facts survive a later image failure. Only attach
                # boundaries already committed by the operation; never capture
                # or flush extra evidence to manufacture an error receipt.
                error.recording_span = self.recording_span(before)
                raise
            span = self.recording_span(before)
            if span is not None:
                result["recordingSpan"] = span
            return result
        if method == "open":
            return self.open(params)
        if method == "observe":
            return self.observe(params)
        if method == "screenshot":
            return self.screenshot(params)
        if method == "inspect":
            return self.inspect(params)
        if method == "control":
            return self.control(params)
        if method == "recent_frames":
            return self.recent_frames(params)
        if method == "checkpoint_save":
            return self.checkpoint_save(params)
        if method == "checkpoint_restore":
            return self.checkpoint_restore(params)
        if method == "recording_status":
            return self.recording_status(params)
        if method == "recording_export":
            return self.recording_export(params)
        if method == "recording_review":
            return self.recording_review(params)
        if method == "recording_stop":
            return self.recording_stop(params)
        if method == "clip":
            return self.clip(params)
        if method == "state":
            return self.state()
        if method == "close":
            self.stop()
            return {"closed": True}
        raise ValueError(f"Unknown emulator method: {method!r}")


def respond(record: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(record, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Allowed ROM and screenshot root")
    arguments = parser.parse_args()

    logging.basicConfig(level=logging.ERROR, stream=sys.stderr)
    cancellation = threading.Event()
    shutdown = threading.Event()
    requests: queue.Queue[str | None] = queue.Queue(maxsize=64)
    worker = EmulatorWorker(Path(arguments.root), cancellation)

    def read_requests() -> None:
        try:
            for line in sys.stdin:
                # Cancellation must interrupt a bounded operation already in progress.
                try:
                    pending = json.loads(line)
                    if isinstance(pending, dict) and pending.get("method") == "control" and isinstance(pending.get("params"), dict) and pending["params"].get("action") == "cancel":
                        cancellation.set()
                except (ValueError, TypeError):
                    pass
                requests.put(line)
        finally:
            requests.put(None)

    def terminate(_signum: int, _frame: Any) -> None:
        cancellation.set()
        shutdown.set()

    signal.signal(signal.SIGTERM, terminate)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, terminate)
    threading.Thread(target=read_requests, name="emulator-stdin", daemon=True).start()

    try:
        while not shutdown.is_set():
            try:
                # There is no autonomous emulation loop. Wake only to process
                # explicit requests or notice a process termination signal.
                line = requests.get(timeout=0.1)
            except queue.Empty:
                continue
            if line is None:
                break
            request_id: Any = None
            method = "request"
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError("An emulator request must be a JSON object")
                request_id = request.get("id")
                method = request.get("method")
                params = request.get("params", {})
                if not isinstance(method, str) or not isinstance(params, dict):
                    raise RequestValidationError("Requests require a string method and object params")

                result = worker.dispatch(method, params)
                respond({"id": request_id, "result": result})
                if method == "close":
                    break
            except TimelineExecutionError as error:
                unknown = worker.unknown_execution(error, method=method)
                if unknown is not None:
                    respond({"id": request_id, "error": unknown})
                    break
                worker.handle_failure(error, method=method)
                respond({"id": request_id, "error": error.record()})
            except Exception as error:
                unknown = worker.unknown_execution(error, method=method)
                if unknown is not None:
                    respond({"id": request_id, "error": unknown})
                    break
                # Invalid stepped requests and read-only observations/reviews
                # never mutate the recording. Real cancellation/termination
                # still uses fail-closed cleanup.
                if not isinstance(error, RequestValidationError) and (method not in {"recording_review", "observe", "clip"} or isinstance(error, SessionCancelled)):
                    worker.handle_failure(error, method=method)
                if method == "open":
                    worker.stop()
                respond({"id": request_id, "error": {"message": str(error),
                         **({"executionStatus": "pre-execution-rejected"} if isinstance(error, RequestValidationError) else {})}})
    finally:
        if shutdown.is_set():
            worker.handle_failure(RuntimeError("The emulator worker was terminated"), method="shutdown")
        worker.stop()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
