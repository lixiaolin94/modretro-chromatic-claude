import { createHash } from "node:crypto";
import path from "node:path";
import { PROJECT_REVISION_ALGORITHM, PUBLIC_REVISION_DIRECTORIES } from "./project-access.js";
const SHA256_HEX = /^[a-f\d]{64}$/u;
const ROOT_DOMAIN = Buffer.from(`codex-gb-studio\u0000${PROJECT_REVISION_ALGORITHM}\u0000root\u0000`, "utf8");
const NODE_DOMAIN = Buffer.from(`codex-gb-studio\u0000${PROJECT_REVISION_ALGORITHM}\u0000node\u0000`, "utf8");
const FILE_DOMAIN = Buffer.from(`codex-gb-studio\u0000${PROJECT_REVISION_ALGORITHM}\u0000file\u0000`, "utf8");
function compareNames(left, right) {
    return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function updateLength(digest, length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff) {
        throw new RangeError("A project revision entry exceeds its maximum encodable length");
    }
    const encoded = Buffer.allocUnsafe(4);
    encoded.writeUInt32BE(length);
    digest.update(encoded);
}
function normalizeRelativePath(relativePath) {
    if (typeof relativePath !== "string" ||
        relativePath.length === 0 ||
        relativePath.includes("\u0000") ||
        relativePath.includes("\\") ||
        path.posix.isAbsolute(relativePath) ||
        path.posix.normalize(relativePath) !== relativePath ||
        relativePath === "." ||
        relativePath === ".." ||
        relativePath.startsWith("../")) {
        throw new TypeError("Project revision paths must be normalized, project-relative POSIX paths");
    }
    return relativePath;
}
function fileHash(relativePath, sha256) {
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
        throw new TypeError("Project revision entries require a lowercase 64-character SHA-256 digest");
    }
    const encodedPath = Buffer.from(relativePath, "utf8");
    const digest = createHash("sha256").update(FILE_DOMAIN);
    updateLength(digest, encodedPath.length);
    digest.update(encodedPath).update(Buffer.from(sha256, "hex"));
    return digest.digest();
}
function createNode() {
    return { children: new Map(), hash: Buffer.alloc(0) };
}
function rehashNode(node) {
    const digest = createHash("sha256").update(NODE_DOMAIN);
    digest.update(Buffer.from([node.fileHash ? 1 : 0]));
    if (node.fileHash)
        digest.update(node.fileHash);
    const children = [...node.children.entries()].sort(([left], [right]) => compareNames(left, right));
    updateLength(digest, children.length);
    for (const [name, child] of children) {
        const encodedName = Buffer.from(name, "utf8");
        updateLength(digest, encodedName.length);
        digest.update(encodedName).update(child.hash);
    }
    node.hash = digest.digest();
}
function initializeNode(node) {
    for (const child of node.children.values())
        initializeNode(child);
    rehashNode(node);
}
/**
 * Deterministic, domain-separated path trie for incrementally authored files.
 *
 * Construction hashes every node once. Updating one resource only rehashes its
 * path ancestry; unrelated file contents and branches are never revisited.
 */
export class ProjectRevisionTree {
    #root = createNode();
    #entries = new Map();
    constructor(entries = []) {
        for (const entry of entries) {
            const relativePath = normalizeRelativePath(entry.relativePath);
            const digest = fileHash(relativePath, entry.sha256);
            let node = this.#root;
            for (const segment of relativePath.split("/")) {
                let child = node.children.get(segment);
                if (!child) {
                    child = createNode();
                    node.children.set(segment, child);
                }
                node = child;
            }
            node.fileHash = digest;
            this.#entries.set(relativePath, entry.sha256);
        }
        initializeNode(this.#root);
    }
    upsert(relativePath, sha256) {
        const normalized = normalizeRelativePath(relativePath);
        const digest = fileHash(normalized, sha256);
        if (this.#entries.get(normalized) === sha256)
            return;
        const ancestry = [this.#root];
        let node = this.#root;
        for (const segment of normalized.split("/")) {
            let child = node.children.get(segment);
            if (!child) {
                child = createNode();
                node.children.set(segment, child);
            }
            node = child;
            ancestry.push(node);
        }
        node.fileHash = digest;
        this.#entries.set(normalized, sha256);
        for (let index = ancestry.length - 1; index >= 0; index -= 1) {
            const ancestor = ancestry[index];
            if (ancestor)
                rehashNode(ancestor);
        }
    }
    remove(relativePath) {
        const normalized = normalizeRelativePath(relativePath);
        if (!this.#entries.has(normalized))
            return false;
        const ancestry = [{ node: this.#root }];
        let node = this.#root;
        for (const segment of normalized.split("/")) {
            const child = node.children.get(segment);
            if (!child)
                return false;
            ancestry.push({ node: child, segment });
            node = child;
        }
        delete node.fileHash;
        this.#entries.delete(normalized);
        for (let index = ancestry.length - 1; index > 0; index -= 1) {
            const current = ancestry[index];
            const parent = ancestry[index - 1];
            if (!current || !parent)
                continue;
            if (!current.node.fileHash && current.node.children.size === 0 && current.segment) {
                parent.node.children.delete(current.segment);
            }
            else {
                rehashNode(current.node);
            }
        }
        rehashNode(this.#root);
        return true;
    }
    revision() {
        return createHash("sha256").update(ROOT_DOMAIN).update(this.#root.hash).digest("hex");
    }
    entries() {
        return [...this.#entries.entries()]
            .sort(([left], [right]) => compareNames(left, right))
            .map(([relativePath, sha256]) => ({ relativePath, sha256 }));
    }
}
/** Plugins, generated root outputs, and other root files are intentionally excluded. */
export function isPublicProjectRevisionPath(relativePath, descriptorRelativePath) {
    const normalized = normalizeRelativePath(relativePath);
    const descriptor = normalizeRelativePath(descriptorRelativePath);
    return normalized === descriptor || PUBLIC_REVISION_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`));
}
//# sourceMappingURL=project-revision.js.map