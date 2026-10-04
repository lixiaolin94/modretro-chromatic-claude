import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { artifactUsage, boundedInteger, boundedReadFile, canonicalEventPayload, digest, encoded, MAX_FRAMES, MAX_RECORDING_EVENT_BYTES, MAX_RECORDING_EVENTS, MAX_RECORDING_FRAMES, MAX_REVIEW_ACTIONS, MAX_REVIEW_FRAME_RECORDS, MAX_REVIEW_IMAGES, MAX_REVIEW_METADATA_BYTES, MAX_SAFE_INTEGER, normalizedRecordedAction, recordedButtons, recordingBranchId, recordingLimits, RecordingLimitError, recordingPrefixPin, RECORDING_RESERVE_BYTES, sha256String, } from "./recording-common.js";
const MANIFEST_BYTES = 1024 * 1024;
const JOURNAL_CHUNK_BYTES = 64 * 1024;
const RECORDING_STATUSES = new Set(["recording", "stopped", "cancelled", "failed", "interrupted"]);
const PRESENTATION_TYPES = new Set(["unrendered", "normal", "lcd-off", "artificial", "repeat"]);
const utf8 = new TextDecoder("utf-8", { fatal: true });
function object(value, message) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error(message);
    return value;
}
function jsonObject(bytes, message) {
    return object(JSON.parse(utf8.decode(bytes)), message);
}
function sameJson(left, right) {
    return encoded(left ?? null).equals(encoded(right ?? null));
}
function sessionIdentity(value, message) {
    if (typeof value !== "string" || !/^[0-9a-f]{32}$/u.test(value))
        throw new Error(message);
    return value;
}
function presentationFields(value) {
    const hasFrame = Object.hasOwn(value, "hasPresentedFrame");
    const hasType = Object.hasOwn(value, "presentationType");
    if (!hasFrame && !hasType)
        return {};
    if (!hasFrame || !hasType || typeof value.hasPresentedFrame !== "boolean"
        || typeof value.presentationType !== "string" || !PRESENTATION_TYPES.has(value.presentationType)) {
        throw new Error("Recorded native frame presentation metadata is invalid");
    }
    return { hasPresentedFrame: value.hasPresentedFrame, presentationType: value.presentationType };
}
export function reviewOptions(value) {
    object(value, "Recording review options must be an object");
    const allowed = new Set([
        "recordingPath", "sessionId", "branchId", "fromActionIndex", "toActionIndex",
        "fromFrame", "toFrame", "prefixPin", "maxImages",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
        throw new Error("Unknown recording review options");
    const sessionId = sessionIdentity(value.sessionId, "Recording review requires an exact sessionId");
    const branchId = recordingBranchId(value.branchId);
    const start = boundedInteger(value.fromActionIndex, "fromActionIndex", 0, MAX_SAFE_INTEGER);
    const end = boundedInteger(value.toActionIndex, "toActionIndex", 0, MAX_SAFE_INTEGER);
    if (end < start || end - start > MAX_REVIEW_ACTIONS) {
        throw new Error("Review requires an ordered interval of at most " + MAX_REVIEW_ACTIONS + " normalized actions; narrow the interval");
    }
    const result = {
        sessionId, branchId, fromActionIndex: start, toActionIndex: end,
        maxImages: boundedInteger(Object.hasOwn(value, "maxImages") ? value.maxImages : 4, "review image limit", 1, MAX_REVIEW_IMAGES),
    };
    if (Object.hasOwn(value, "fromFrame") !== Object.hasOwn(value, "toFrame")) {
        throw new Error("Review frame bounds must be supplied together");
    }
    if (Object.hasOwn(value, "fromFrame")) {
        const fromFrame = boundedInteger(value.fromFrame, "fromFrame", 0, MAX_RECORDING_FRAMES);
        const toFrame = boundedInteger(value.toFrame, "toFrame", 0, MAX_RECORDING_FRAMES);
        if (toFrame < fromFrame || toFrame - fromFrame > MAX_FRAMES) {
            throw new Error("Review requires an ordered interval of at most " + MAX_FRAMES + " native frames; narrow the interval");
        }
        Object.assign(result, { fromFrame, toFrame });
    }
    if (Object.hasOwn(value, "prefixPin"))
        result.prefixPin = recordingPrefixPin(value.prefixPin);
    return result;
}
/** Bounded metadata selected only from the reader's authenticated event stream.
 *
 * Copied normalized actions do not establish physical controller delivery.
 * This class never opens a journal, reads a framebuffer, or invokes an emulator.
 */
export class RecordingReviewSelection {
    options;
    sessionId;
    branchId;
    start;
    end;
    inputs = [];
    frames = [];
    physicalEvents = [];
    uncertainties = [];
    priorFailure = null;
    metadataBytes = 0;
    foundBranch = false;
    bootComplete = false;
    actionCount = 0;
    actionFrame = 0;
    boundaries = new Map();
    actionFrames = new Map();
    normalizedButtons = [];
    initialButtons = [];
    matchedControllers = new Set();
    lastAction = null;
    prefixState = null;
    constructor(options) {
        this.options = reviewOptions(options);
        this.sessionId = this.options.sessionId;
        this.branchId = this.options.branchId;
        this.start = this.options.fromActionIndex;
        this.end = this.options.toActionIndex;
    }
    retain(destination, value) {
        this.metadataBytes += encoded(value).length + 1;
        if (this.metadataBytes > MAX_REVIEW_METADATA_BYTES) {
            throw new Error("Review metadata exceeds 2 MiB; narrow the interval");
        }
        destination.push(value);
    }
    eventIdentity(row, eventDigest) {
        return { sessionId: this.sessionId, branchId: this.branchId, sequence: row.sequence, digest: eventDigest };
    }
    beginBranch(condition, options) {
        if (object(condition, "Review requires a supported recorded starting condition").type !== "clean-boot") {
            throw new Error("Review requires a supported recorded starting condition");
        }
        this.foundBranch = true;
        this.bootComplete = options.imported;
        this.actionCount = 0;
        this.actionFrame = boundedInteger(condition.initialFrames, "recorded boot frames", 0, MAX_FRAMES);
        this.boundaries.set(0, this.actionFrame);
    }
    action(value, index, options) {
        const action = normalizedRecordedAction(value);
        if (index !== this.actionCount + 1)
            throw new Error("Review controller action indices are inconsistent");
        const start = this.actionFrame;
        const end = start + (action.type === "step" ? action.frames : 0);
        if (end > MAX_RECORDING_FRAMES || (options.frame !== undefined && options.frame !== end)
            || (options.startFrame !== undefined && options.startFrame !== start)) {
            throw new Error("Review controller action frames are inconsistent");
        }
        this.actionCount = index;
        this.actionFrame = end;
        if (action.type === "set_buttons")
            this.normalizedButtons = [...action.buttons];
        if (index === this.start)
            this.initialButtons = [...this.normalizedButtons];
        if (index === this.start || index === this.end)
            this.boundaries.set(index, end);
        if (this.start <= index && index <= this.end)
            this.actionFrames.set(index, end);
        if (this.start < index && index <= this.end) {
            this.retain(this.inputs, {
                actionIndex: index, startFrame: start, frame: end, action,
                source: options.source, origin: options.origin,
            });
        }
    }
    frame(item, options) {
        const index = boundedInteger(item.actionIndex, "recorded frame action index", 0, this.actionCount);
        const frame = boundedInteger(item.frame, "recorded evidence frame", 0, MAX_RECORDING_FRAMES);
        const presentation = presentationFields(item);
        if (index < this.start || index > this.end)
            return;
        const bootBoundary = this.boundaries.get(0);
        if ((index > 0 && this.actionFrames.get(index) !== frame)
            || (index === 0 && (bootBoundary === undefined || frame > bootBoundary))) {
            throw new Error("Recorded review image differs from its normalized action boundary");
        }
        if (Object.hasOwn(this.options, "fromFrame")
            && (frame < this.options.fromFrame || frame > this.options.toFrame))
            return;
        if (item.width !== 160 || item.height !== 144) {
            throw new Error("Recorded review images must have native 160x144 dimensions");
        }
        const { origin } = options;
        const locator = origin.kind === "direct" ? "event-" + origin.event.sequence
            : "import-" + origin.importEvent.sequence + "-prefix-" + origin.prefixOrdinal;
        if (this.frames.length >= MAX_REVIEW_FRAME_RECORDS) {
            throw new Error("Review retained-image metadata exceeds its limit; narrow the interval");
        }
        // Candidate metadata is not a returned PNG. A fragmented 3,600-tick step
        // may have 3,600 records, while only maxImages records enter the response.
        this.frames.push({
            sessionId: this.sessionId, branchId: this.branchId,
            evidenceId: this.sessionId + "/" + this.branchId + "/" + locator,
            sequence: boundedInteger(item.sequence, "recorded frame sequence", 1, MAX_RECORDING_EVENTS),
            frame, actionIndex: index, path: item.path,
            sha256: sha256String(item.sha256, "recorded PNG SHA-256"),
            rgbaSha256: sha256String(item.rgbaSha256, "recorded RGBA SHA-256"),
            width: 160, height: 144, origin, ...presentation,
        });
    }
    accept(row, eventDigest, branches) {
        const kind = row.kind;
        if (kind === "header" && row.sessionId !== this.sessionId) {
            throw new Error("The requested recording sessionId differs from its authenticated header");
        }
        if (row.branchId !== this.branchId)
            return;
        const identity = this.eventIdentity(row, eventDigest);
        if (kind === "header") {
            this.beginBranch(row.startingCondition, { imported: false });
        }
        else if (kind === "boot_complete") {
            this.bootComplete = true;
            this.actionFrame = boundedInteger(row.frame, "recorded boot frame", 0, MAX_FRAMES);
            this.boundaries.set(0, this.actionFrame);
        }
        else if (kind === "branch") {
            this.beginBranch(row.startingCondition, { imported: true });
            if (!Array.isArray(row.prefixActions))
                throw new Error("The imported action prefix must be an array");
            const sourceSession = sessionIdentity(row.sourceSessionId, "The imported recording prefix identity is invalid");
            const sourceBranch = recordingBranchId(row.parentBranchId);
            row.prefixActions.forEach((action, index) => {
                const ordinal = index + 1;
                this.action(action, ordinal, {
                    source: "imported-prefix",
                    origin: {
                        kind: "imported-prefix", importEvent: identity, prefixOrdinal: ordinal,
                        sourceSessionId: sourceSession, sourceBranchId: sourceBranch,
                    },
                });
            });
            if (this.actionFrame !== row.frame) {
                throw new Error("The imported action prefix does not reach its recorded branch frame");
            }
            const branch = requireBranch(branches, this.branchId);
            branch.evidence.forEach((item, index) => {
                this.frame(item, {
                    origin: {
                        kind: "imported-prefix", importEvent: identity, prefixOrdinal: index + 1,
                        sourceSessionId: sourceSession,
                        sourceBranchId: recordingBranchId(Object.hasOwn(item, "sourceBranchId") ? item.sourceBranchId : sourceBranch),
                        copiedSequence: item.sequence,
                    },
                });
            });
        }
        else if (kind === "action") {
            const source = Object.hasOwn(row, "source") ? row.source : "manual";
            if (source !== "manual" && source !== "clock") {
                throw new Error("The recorded action has an unsupported input source");
            }
            this.action(row.action, row.actionIndex, {
                source, origin: { kind: "direct", event: identity }, frame: row.frame,
                ...(Object.hasOwn(row, "startFrame") ? { startFrame: row.startFrame } : {}),
            });
            this.lastAction = { sequence: row.sequence, actionIndex: row.actionIndex, frame: row.frame, action: row.action };
        }
        else if (kind === "frame") {
            this.frame(requireBranch(branches, this.branchId).evidence.at(-1), { origin: { kind: "direct", event: identity } });
        }
        else if (kind === "controller") {
            const releases = recordedButtons(row.releases);
            const presses = recordedButtons(row.presses);
            const active = recordedButtons(row.activeButtons);
            boundedInteger(row.appliesBeforeFrame, "controller delivery frame", 1, MAX_RECORDING_FRAMES + 1);
            if (releases.some((button) => presses.includes(button)) || row.appliesBeforeFrame !== row.frame + 1) {
                throw new Error("Recorded controller-delivery metadata is inconsistent");
            }
            const previous = this.lastAction;
            const associated = previous !== null && previous.sequence === row.sequence - 1
                && previous.frame === row.frame && sameJson(previous.action, { type: "set_buttons", buttons: active });
            const actionIndex = associated ? previous.actionIndex : null;
            if ((actionIndex !== null && this.start < actionIndex && actionIndex <= this.end)
                || (actionIndex === null && this.start <= this.actionCount && this.actionCount <= this.end)) {
                this.retain(this.physicalEvents, {
                    event: identity, actionIndex, atActionIndex: this.actionCount, frame: row.frame,
                    appliesBeforeFrame: row.appliesBeforeFrame, releases, presses, activeButtons: active,
                });
                if (actionIndex !== null)
                    this.matchedControllers.add(actionIndex);
                else
                    this.retain(this.uncertainties, {
                        kind: "unassociated-controller-event", event: identity, actionIndex: this.actionCount, frame: row.frame,
                    });
            }
        }
        else if (kind === "failure") {
            // Failed physical delivery cannot be reconstructed from a later action.
            // Expose only the uncertainty boundary, not an arbitrary raw error log.
            const boundary = { kind: "failure-boundary", event: identity, actionIndex: this.actionCount, frame: row.frame };
            if (this.actionCount < this.start)
                this.priorFailure = boundary;
            else if (this.actionCount <= this.end)
                this.retain(this.uncertainties, boundary);
        }
    }
    freeze(branches) {
        const branch = branches[this.branchId];
        if (branch === undefined || !this.foundBranch) {
            throw new Error("The requested recording branch does not exist in the committed prefix");
        }
        if (this.end > this.actionCount)
            throw new Error("The requested action interval exceeds the committed recording prefix");
        if (!this.bootComplete && this.actionCount === 0)
            this.boundaries.set(0, branch.frame);
        const startFrame = this.boundaries.get(this.start);
        const endFrame = this.boundaries.get(this.end);
        if (startFrame === undefined || endFrame === undefined || endFrame < startFrame || endFrame - startFrame > MAX_FRAMES) {
            throw new Error("Review spans more than " + MAX_FRAMES + " native frames; narrow the interval");
        }
        if (Object.hasOwn(this.options, "fromFrame")
            && (this.options.fromFrame !== startFrame || this.options.toFrame !== endFrame)) {
            throw new Error("Review frame bounds differ from the normalized action boundaries");
        }
        this.prefixState = {
            fromFrame: startFrame, toFrame: endFrame, branchActionCount: this.actionCount, branchFrame: branch.frame,
        };
    }
}
function requireBranch(branches, branchId) {
    const branch = branches[branchId];
    if (branch === undefined)
        throw new Error("Recording event names an unavailable branch");
    return branch;
}
function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
function guardDirectory(root, identity, canonical) {
    const current = lstatSync(root);
    if (current.isSymbolicLink() || !current.isDirectory() || !sameFile(identity, current)
        || realpathSync(root) !== canonical) {
        throw new Error("The recording directory changed while it was being read");
    }
}
function evidencePath(root, value, resolvePath, imported) {
    if (typeof value !== "string" || value.length === 0)
        throw new Error("Recorded frames require a file path");
    const candidate = resolve(root, value);
    const filename = resolvePath(candidate, { existing: true });
    const tail = relative(root, filename);
    if (tail === ".." || tail.startsWith(".." + sep) || isAbsolute(tail)) {
        throw new Error(imported ? "Imported recorded frames must remain inside their recording"
            : "Recorded frames must remain inside their recording");
    }
    return filename;
}
/** Read at most one bounded event plus a small chunk, never the whole journal. */
function* journalLines(descriptor, checkCancel) {
    let fragments = [];
    let length = 0;
    for (;;) {
        checkCancel?.();
        const chunk = Buffer.allocUnsafe(JOURNAL_CHUNK_BYTES);
        const count = readSync(descriptor, chunk, 0, chunk.length, null);
        if (count === 0) {
            if (length > 0)
                yield Buffer.concat(fragments, length);
            return;
        }
        let start = 0;
        while (start < count) {
            checkCancel?.();
            const newline = chunk.subarray(0, count).indexOf(10, start);
            const end = newline === -1 ? count : newline + 1;
            const part = chunk.subarray(start, end);
            length += part.length;
            if (length > MAX_RECORDING_EVENT_BYTES)
                throw new Error("The recording has an incomplete or oversized event");
            fragments.push(part);
            if (newline !== -1) {
                yield fragments.length === 1 ? part : Buffer.concat(fragments, length);
                fragments = [];
                length = 0;
            }
            start = end;
        }
    }
}
function verifyReadPrefix(descriptor, byteLength, expected, checkCancel) {
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(JOURNAL_CHUNK_BYTES);
    let position = 0;
    while (position < byteLength) {
        checkCancel?.();
        const count = readSync(descriptor, chunk, 0, Math.min(chunk.length, byteLength - position), position);
        if (count === 0)
            throw new Error("The recording event source changed while it was being read");
        hash.update(chunk.subarray(0, count));
        position += count;
    }
    if (hash.digest("hex") !== expected)
        throw new Error("The recording event source changed while it was being read");
}
export function readRecording(root, resolvePath, options = {}) {
    const { review, checkCancel } = options;
    const prefixPin = options.prefixPin === undefined ? undefined : recordingPrefixPin(options.prefixPin);
    checkCancel?.();
    const rootIdentity = lstatSync(root);
    const canonicalRoot = realpathSync(root);
    if (rootIdentity.isSymbolicLink() || !rootIdentity.isDirectory()) {
        throw new Error("The recording directory has no valid recording.json");
    }
    // Authorize the directory itself, even if it has no frame records that would
    // otherwise call the resolver. Do not grant access from a valid journal hash.
    root = resolvePath(root, { existing: true });
    if (root !== canonicalRoot)
        throw new Error("The recording directory changed while it was being read");
    const manifestPath = join(root, "recording.json");
    guardDirectory(root, rootIdentity, canonicalRoot);
    const manifestBytes = boundedReadFile(manifestPath, MANIFEST_BYTES, "Recording manifest");
    const manifest = jsonObject(manifestBytes, "Recording manifest must be an object");
    if (manifest.schemaVersion !== 1 || manifest.kind !== "gb-studio-playtest") {
        throw new Error("Unsupported playtest recording format");
    }
    if (!RECORDING_STATUSES.has(manifest.status))
        throw new Error("Unsupported playtest recording status");
    const limits = recordingLimits(manifest.limits);
    const maxBytes = limits.maxBytes;
    const eventPath = join(root, "events.jsonl");
    const eventIdentity = lstatSync(eventPath);
    if (eventIdentity.isSymbolicLink() || !eventIdentity.isFile() || eventIdentity.size > maxBytes) {
        throw new Error("The recording event log is missing or exceeds its limit");
    }
    const observedEventBytes = eventIdentity.size;
    if (prefixPin !== undefined && prefixPin.byteLength > observedEventBytes) {
        throw new Error("The requested recording prefix is not present");
    }
    const branches = Object.create(null);
    const checkpoints = Object.create(null);
    let current = "branch-0001";
    let previous = "0".repeat(64);
    let sequence = 0;
    let status = "interrupted";
    let truncatedTail = false;
    let bootFinished = false;
    let final;
    let totalFrames = 0;
    const eventHasher = createHash("sha256");
    let eventBytes = 0;
    let selectedPrefix;
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0))
        | (constants.O_NONBLOCK ?? 0);
    const descriptor = openSync(eventPath, flags);
    try {
        const opened = fstatSync(descriptor);
        guardDirectory(root, rootIdentity, canonicalRoot);
        if (!opened.isFile() || !sameFile(opened, eventIdentity) || opened.size > maxBytes) {
            throw new Error("The recording event source changed while it was being read");
        }
        for (const line of journalLines(descriptor, checkCancel)) {
            if (line.at(-1) !== 10) {
                if (manifest.status === "recording") {
                    truncatedTail = true;
                    break;
                }
                throw new Error("The recording has an incomplete or oversized event");
            }
            const row = jsonObject(line, "A recording event must be an object");
            const claimed = row.digest;
            delete row.digest;
            boundedInteger(row.sequence, "recording event sequence", 1, MAX_RECORDING_EVENTS);
            boundedInteger(row.frame, "recording event frame", 0, MAX_RECORDING_FRAMES);
            recordingBranchId(row.branchId);
            // Parsing JSON into JS numbers loses Python's integral-float spelling.
            // Canonicalize the source tokens, keeping that distinction, for old logs.
            if (row.sequence !== sequence + 1 || row.previousDigest !== previous
                || digest(canonicalEventPayload(line)) !== claimed) {
                throw new Error("Recording event integrity check failed");
            }
            sequence += 1;
            previous = claimed;
            eventHasher.update(line);
            eventBytes += line.length;
            if (eventBytes > maxBytes)
                throw new RecordingLimitError("The recording event log exceeds its byte limit");
            if (final !== undefined)
                throw new Error("The recording contains events after its final footer");
            const kind = row.kind;
            if (kind === "header") {
                if (sequence !== 1 || row.sessionId !== manifest.sessionId || row.branchId !== current) {
                    throw new Error("Recording header identity differs");
                }
                if (["rom", "runtime", "limits", "startingCondition"].some((key) => !sameJson(row[key], manifest[key]))) {
                    throw new Error("Recording manifest differs from its authenticated header");
                }
                branches[current] = {
                    actions: [], evidence: [], frame: 0,
                    startingCondition: object(row.startingCondition, "Recording starting condition must be an object"),
                };
            }
            else if (sequence === 1) {
                throw new Error("Recording header is missing");
            }
            else if (kind === "boot_complete") {
                const branch = requireBranch(branches, current);
                branch.startingCondition = object(row.startingCondition, "Recording starting condition must be an object");
                branch.frame = row.frame;
                totalFrames = Math.max(totalFrames, row.frame);
                bootFinished = true;
            }
            else if (kind === "branch") {
                current = row.branchId;
                if (Object.hasOwn(branches, current))
                    throw new Error("Recording branch identity is duplicated");
                if (!Array.isArray(row.prefixActions) || !Array.isArray(row.prefixEvidence)
                    || row.prefixActions.length > MAX_RECORDING_EVENTS || row.prefixEvidence.length > MAX_RECORDING_EVENTS) {
                    throw new Error("The imported recording prefix must contain bounded action and evidence arrays");
                }
                const evidence = row.prefixEvidence.map((value) => {
                    const item = { ...object(value, "Imported recorded frame metadata must be an object") };
                    const filename = evidencePath(root, item.file, resolvePath, true);
                    delete item.file;
                    return { ...item, path: filename, ...presentationFields(item) };
                });
                branches[current] = {
                    actions: row.prefixActions.map(normalizedRecordedAction), evidence, frame: row.frame,
                    parentBranchId: recordingBranchId(row.parentBranchId), sourceSessionId: row.sourceSessionId,
                    checkpointId: row.checkpointId,
                    startingCondition: object(row.startingCondition, "Recording starting condition must be an object"),
                };
            }
            else if (kind === "action") {
                const branch = requireBranch(branches, row.branchId);
                boundedInteger(row.actionIndex, "recording action index", 1, MAX_SAFE_INTEGER);
                if (Object.hasOwn(row, "startFrame"))
                    boundedInteger(row.startFrame, "recording action start frame", 0, MAX_RECORDING_FRAMES);
                if (row.actionIndex !== branch.actions.length + 1)
                    throw new Error("Recording controller action index differs");
                const action = normalizedRecordedAction(row.action);
                if (action.type === "step")
                    totalFrames += action.frames;
                branch.actions.push(action);
                branch.frame = row.frame;
            }
            else if (kind === "frame") {
                const branch = requireBranch(branches, row.branchId);
                boundedInteger(row.actionIndex, "recorded frame action index", 0, MAX_SAFE_INTEGER);
                if (row.actionIndex !== branch.actions.length) {
                    throw new Error("Recorded frame has an inconsistent controller action index");
                }
                const filename = evidencePath(root, row.file, resolvePath, false);
                const evidence = {};
                for (const key of ["sequence", "branchId", "frame", "sha256", "rgbaSha256", "width", "height", "actionIndex"]) {
                    evidence[key] = row[key];
                }
                evidence.path = filename;
                Object.assign(evidence, presentationFields(row));
                branch.evidence.push(evidence);
                branch.frame = row.frame;
                if (!bootFinished) {
                    // Retain a shorter valid boot prefix after a hard interruption.
                    totalFrames = Math.max(totalFrames, row.frame);
                    branch.startingCondition = { ...branch.startingCondition, initialFrames: row.frame };
                }
            }
            else if (kind === "finish") {
                if (!RECORDING_STATUSES.has(row.status) || row.status === "recording") {
                    throw new Error("Unsupported playtest recording status");
                }
                status = row.status;
                totalFrames = boundedInteger(row.totalFrames, "recording total frames", 0, MAX_RECORDING_FRAMES);
                final = row;
            }
            else if (kind === "checkpoint_saved") {
                if (typeof row.checkpointId !== "string" || row.checkpointId.length === 0) {
                    throw new Error("Recording checkpoint identity is invalid");
                }
                if (Object.hasOwn(checkpoints, row.checkpointId))
                    throw new Error("Checkpoint identity is duplicated in the recording");
                checkpoints[row.checkpointId] = row;
            }
            else if (!["controller", "pause", "resume", "failure", "capture", "outcome"].includes(kind)) {
                throw new Error("Unsupported recording event kind");
            }
            if (review !== undefined && (prefixPin === undefined || sequence <= prefixPin.eventCount)) {
                review.accept(row, claimed, branches);
            }
            if (prefixPin !== undefined && sequence === prefixPin.eventCount) {
                selectedPrefix = {
                    eventCount: sequence, eventDigest: previous, byteLength: eventBytes,
                    sha256: eventHasher.copy().digest("hex"),
                };
                if (!sameJson(selectedPrefix, prefixPin)) {
                    throw new Error("The requested recording prefix failed its byte and event-chain integrity check");
                }
                review?.freeze(branches);
                // Live pins name committed bytes. Finalized archives must still have
                // their complete tail checked, even when only an earlier span is shown.
                if (manifest.status === "recording")
                    break;
            }
        }
        const guardJournal = () => {
            const completed = fstatSync(descriptor);
            const named = lstatSync(eventPath);
            guardDirectory(root, rootIdentity, canonicalRoot);
            if (!completed.isFile() || named.isSymbolicLink() || !named.isFile()
                || !sameFile(completed, named) || !sameFile(completed, eventIdentity)
                || completed.size < eventBytes || completed.size > maxBytes
                || (manifest.status !== "recording"
                    && (completed.size !== observedEventBytes || completed.size !== eventBytes
                        || completed.mtimeMs !== eventIdentity.mtimeMs || completed.ctimeMs !== eventIdentity.ctimeMs))) {
                throw new Error("The recording event source changed while it was being read");
            }
        };
        guardJournal();
        // Appends to a live journal are allowed; rewrites of authenticated bytes
        // are not. Re-read only the committed prefix from the guarded descriptor.
        verifyReadPrefix(descriptor, eventBytes, eventHasher.copy().digest("hex"), checkCancel);
        guardJournal();
    }
    finally {
        closeSync(descriptor);
    }
    if (Object.keys(branches).length === 0)
        throw new Error("Recording header is missing");
    if (truncatedTail)
        status = "interrupted";
    if (manifest.status !== "recording"
        && (manifest.eventDigest !== previous || manifest.eventCount !== sequence || manifest.status !== status)) {
        throw new Error("Finalized recording integrity check failed");
    }
    if (prefixPin !== undefined && selectedPrefix === undefined)
        throw new Error("The requested recording prefix is not present");
    const completePrefix = {
        eventCount: sequence, eventDigest: previous, byteLength: eventBytes, sha256: eventHasher.digest("hex"),
    };
    if (prefixPin === undefined)
        review?.freeze(branches);
    checkCancel?.();
    if (!boundedReadFile(manifestPath, MANIFEST_BYTES, "Recording manifest").equals(manifestBytes)) {
        throw new Error("The recording manifest changed while it was being read");
    }
    guardDirectory(root, rootIdentity, canonicalRoot);
    const result = {
        ...manifest, recordingPath: root, status, branchId: current,
        frame: requireBranch(branches, current).frame, totalFrames, eventCount: sequence, eventDigest: previous,
        branchesById: branches, checkpointsById: checkpoints, truncatedTail,
        prefixPin: selectedPrefix ?? completePrefix,
        sourcePins: {
            manifest: { byteLength: manifestBytes.length, sha256: digest(manifestBytes) },
            events: completePrefix, observedEventLogBytes: observedEventBytes,
            finalized: manifest.status !== "recording",
            tailValidation: manifest.status !== "recording" ? "finalized-complete" : "committed-prefix",
            manifestStatus: manifest.status,
        },
        bytesUsed: artifactUsage(root, resolvePath),
    };
    if (result.bytesUsed > maxBytes)
        throw new RecordingLimitError("The retained recording exceeds its byte limit");
    for (const key of ["failure", "outcome", "reason"]) {
        if (final !== undefined && Object.hasOwn(final, key))
            result[key] = final[key];
    }
    const failuresPath = join(root, "worker-failures.jsonl");
    if (status === "interrupted") {
        let failureIdentity;
        try {
            failureIdentity = lstatSync(failuresPath);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
        if (failureIdentity !== undefined) {
            if (failureIdentity.isSymbolicLink() || !failureIdentity.isFile() || failureIdentity.size > RECORDING_RESERVE_BYTES) {
                throw new Error("Worker failure record exceeds its limit");
            }
            const failureBytes = boundedReadFile(failuresPath, RECORDING_RESERVE_BYTES, "Worker failure record");
            const rows = utf8.decode(failureBytes).split(/\r?\n/u);
            if (rows.at(-1) === "")
                rows.pop();
            const last = rows.at(-1);
            if (last !== undefined) {
                const failure = object(JSON.parse(last), "Worker failure record must be an object");
                result.failure = Object.hasOwn(failure, "message") ? failure.message : "The emulator worker was interrupted";
            }
        }
    }
    result.branches = Object.entries(branches).map(([branchId, branch]) => ({
        branchId, frame: branch.frame,
        ...(Object.hasOwn(branch, "parentBranchId") ? { parentBranchId: branch.parentBranchId } : {}),
        ...(Object.hasOwn(branch, "sourceSessionId") ? { sourceSessionId: branch.sourceSessionId } : {}),
        ...(Object.hasOwn(branch, "checkpointId") ? { checkpointId: branch.checkpointId } : {}),
    }));
    checkCancel?.();
    if (!boundedReadFile(manifestPath, MANIFEST_BYTES, "Recording manifest").equals(manifestBytes)) {
        throw new Error("The recording manifest changed while it was being read");
    }
    guardDirectory(root, rootIdentity, canonicalRoot);
    return result;
}
//# sourceMappingURL=recording-archive.js.map