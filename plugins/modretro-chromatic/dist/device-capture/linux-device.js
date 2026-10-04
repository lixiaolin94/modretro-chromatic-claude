import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { NativeHelperError } from "./native-helper.js";
const SYSFS = "/sys/class/video4linux";
function identity(stat) {
    return [stat.dev, stat.ino, stat.rdev, stat.uid, stat.gid, stat.mode, stat.ctimeNs].join(":");
}
async function attribute(filename) {
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await file.stat();
        if (!before.isFile())
            throw new Error("Linux camera metadata is not a regular sysfs attribute.");
        const bytes = Buffer.alloc(1025), result = await file.read(bytes, 0, bytes.length, 0);
        if (result.bytesRead > 1024)
            throw new Error("Linux camera metadata exceeds its bound.");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, result.bytesRead));
        const after = await file.stat();
        if (before.ino !== after.ino || before.dev !== after.dev)
            throw new Error("Linux camera metadata changed.");
        return text.trim();
    }
    finally {
        await file.close();
    }
}
function isMissing(error) { return error.code === "ENOENT"; }
/** Kernel device metadata narrows candidates before any native capture open. */
async function describe(name) {
    if (!/^video\d{1,4}$/.test(name))
        return undefined;
    const sysfs = await realpath(path.join(SYSFS, name));
    if (!sysfs.startsWith("/sys/devices/"))
        throw new Error("Linux video node has an unexpected sysfs target.");
    const label = await attribute(path.join(sysfs, "name"));
    const match = /^Chromatic - Player (0[1-9]|[1-9][0-9])$/.exec(label);
    if (!match)
        return undefined;
    const player = match[1];
    let parent = sysfs, usb;
    for (let depth = 0; depth < 12 && parent.startsWith("/sys/devices/"); depth++, parent = path.dirname(parent)) {
        let vendor, product;
        try {
            vendor = await attribute(path.join(parent, "idVendor"));
            product = await attribute(path.join(parent, "idProduct"));
        }
        catch (error) {
            if (isMissing(error))
                continue;
            throw error;
        }
        if (vendor.toLowerCase() !== "374e" || !/^[a-fA-F0-9]{4}$/.test(product) || Number.parseInt(product, 16) !== 0x0100 + Number(player))
            return undefined;
        usb = parent;
        break;
    }
    if (!usb)
        return undefined;
    const [bus, deviceNumber] = await Promise.all([attribute(path.join(usb, "busnum")), attribute(path.join(usb, "devnum"))]);
    if (![bus, deviceNumber].every(value => /^\d{1,6}$/.test(value) && Number(value) > 0))
        throw new Error("Linux USB instance metadata is invalid.");
    const device = /^(\d+):(\d+)$/.exec(await attribute(path.join(sysfs, "dev")));
    if (!device)
        throw new Error("Linux video node has an invalid device number.");
    const major = BigInt(device[1]), minor = BigInt(device[2]);
    const rdev = ((major & 0xfffn) << 8n) | ((major & ~0xfffn) << 32n) | (minor & 0xffn) | ((minor & ~0xffn) << 12n);
    const filename = path.join("/dev", name), stat = await lstat(filename, { bigint: true });
    if (!stat.isCharacterDevice() || stat.rdev !== rdev)
        throw new Error("Linux video device does not match its sysfs identity.");
    return { name, label, player, filename, sysfs, usb, usbInstance: `${bus}:${deviceNumber}`, identity: identity(stat) };
}
export async function scanChromaticVideoNodes() {
    let names;
    try {
        names = (await readdir(SYSFS)).filter(name => /^video\d{1,4}$/.test(name)).sort();
    }
    catch (error) {
        if (isMissing(error))
            return { total: 0, candidates: [] };
        throw error;
    }
    if (names.length > 128)
        throw new Error("Linux video device inventory exceeds its bound.");
    const candidates = [];
    for (const name of names) {
        const node = await describe(name);
        if (node)
            candidates.push({ ...node, id: `linux-video-${createHash("sha256").update(JSON.stringify(node)).digest("hex")}` });
    }
    return { total: names.length, candidates };
}
/** Pass this descriptor to the native child; never reopen a caller-supplied path. */
export async function openBoundLinuxVideo(node) {
    const current = await describe(node.name);
    if (!current || current.identity !== node.identity || current.sysfs !== node.sysfs || current.usb !== node.usb || current.usbInstance !== node.usbInstance || current.label !== node.label)
        throw new Error("The selected Linux Chromatic changed. Refresh the device list before connecting.");
    const file = await open(node.filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await file.stat({ bigint: true });
        if (!stat.isCharacterDevice() || identity(stat) !== node.identity)
            throw new Error("The selected Linux Chromatic changed while opening.");
        return file;
    }
    catch (error) {
        try {
            await file.close();
        }
        catch {
            throw new NativeHelperError("Linux video descriptor closure is unconfirmed.", true, "LINUX_CLOSE_UNKNOWN");
        }
        throw error;
    }
}
//# sourceMappingURL=linux-device.js.map