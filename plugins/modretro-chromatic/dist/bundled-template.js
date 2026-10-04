import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { GameStudioProjectError } from "./project.js";
// This is the owner-delivered source snapshot, not a promised rebuilt ROM hash.
const MANIFEST = {
    path: "MANIFEST.json", bytes: 228142,
    sha256: "239d182ec218f5bc4145f58dc3c4ed3ec5ad3fc1425356c63c79269b659f9cdc",
};
const CHECKSUM = {
    path: "MANIFEST.sha256", bytes: 80,
    sha256: "1a8ee3c5d6b28fe2ea75f5d889c65c9e60161bf96d8dd52028f3812d1bf591b1",
};
const stable = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink &&
    a.uid === b.uid && a.gid === b.gid && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
/** Capture the exact trusted bytes once; later copying never rereads a changed source. */
export async function readWrecklightTemplate(root) {
    const files = new Map();
    const identities = new Map();
    const fail = (name) => {
        throw new GameStudioProjectError("INVALID_PROJECT", `The Wrecklight template is missing, changed or unsafe: ${name}. Use the matching reviewed source template before creating a remix.`, path.join(root, name));
    };
    async function identity(name, directory) {
        const filename = path.join(root, name);
        const details = await lstat(filename);
        if (await realpath(filename) !== filename || details.isSymbolicLink() ||
            (directory ? !details.isDirectory() : !details.isFile() || details.nlink !== 1) ||
            (typeof process.getuid === "function" && details.uid !== process.getuid()) ||
            (process.platform !== "win32" && (directory ? (details.mode & 0o022) !== 0 : (details.mode & 0o777) !== 0o644)))
            fail(name);
        return details;
    }
    async function capture(member) {
        const before = await identity(member.path, false);
        identities.set(member.path, before);
        if (before.size !== member.bytes || before.size > 16 * 1024 * 1024)
            fail(member.path);
        // A raced replacement with a FIFO must reach the identity check without waiting for a writer.
        const handle = await open(path.join(root, member.path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        try {
            if (!stable(before, await handle.stat()))
                fail(member.path);
            // Bound the read itself, not just the size observed before opening.
            const buffer = Buffer.alloc(member.bytes + 1);
            let total = 0;
            while (total < buffer.length) {
                const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
                if (bytesRead === 0)
                    break;
                total += bytesRead;
            }
            const bytes = buffer.subarray(0, total);
            if (bytes.length !== member.bytes || createHash("sha256").update(bytes).digest("hex") !== member.sha256 ||
                !stable(before, await handle.stat()))
                fail(member.path);
            files.set(member.path, bytes);
        }
        finally {
            await handle.close();
        }
    }
    identities.set("", await identity("", true));
    await capture(MANIFEST);
    const manifest = JSON.parse(files.get(MANIFEST.path).toString("utf8"));
    if (manifest.schema !== "wrecklight-source-sample-v1" || manifest.fileCount !== 960 ||
        manifest.totalBytes !== 11706594 || manifest.files.length !== 960)
        fail(MANIFEST.path);
    const members = new Map();
    const directories = new Set([""]);
    for (const member of [...manifest.files, MANIFEST, CHECKSUM]) {
        if (members.has(member.path) || member.path.includes("\\") || member.path.split("/").some((part) => !part || part === "." || part === ".."))
            fail(member.path);
        members.set(member.path, member);
        let parent = path.posix.dirname(member.path);
        while (parent !== ".") {
            directories.add(parent);
            parent = path.posix.dirname(parent);
        }
    }
    async function visit(relative) {
        if (!identities.has(relative))
            identities.set(relative, await identity(relative, true));
        const entries = await readdir(path.join(root, relative), { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory() && directories.has(name))
                await visit(name);
            else {
                const member = members.get(name);
                if (!member || !entry.isFile())
                    return fail(name);
                if (!files.has(name))
                    await capture(member);
            }
        }
    }
    await visit("");
    if (files.size !== members.size || identities.size !== members.size + directories.size)
        fail("member inventory");
    for (const [name, before] of identities) {
        if (!stable(before, await identity(name, directories.has(name))))
            fail(name);
    }
    return files;
}
//# sourceMappingURL=bundled-template.js.map