const WIDTH = 160;
const HEIGHT = 144;
const hex = (value, width = 2) => value.toString(16).toUpperCase().padStart(width, "0");
function contains(rect, x, y) {
    return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}
export function toGamePoint(rect, x, y) {
    if (rect.width <= 0 || rect.height <= 0 || !contains(rect, x, y))
        return null;
    return {
        x: Math.floor(((x - rect.x) * WIDTH) / rect.width),
        y: Math.floor(((y - rect.y) * HEIGHT) / rect.height),
    };
}
export function viewportRect(rect, canvasRect) {
    return {
        x: canvasRect.x + (rect.x * canvasRect.width) / WIDTH,
        y: canvasRect.y + (rect.y * canvasRect.height) / HEIGHT,
        width: (rect.width * canvasRect.width) / WIDTH,
        height: (rect.height * canvasRect.height) / HEIGHT,
    };
}
function finishTarget(snapshot, target) {
    const counts = new Map();
    for (const pixel of target.pixels) {
        const offset = pixel * 4;
        const color = `#${hex(snapshot.rgba[offset])}${hex(snapshot.rgba[offset + 1])}${hex(snapshot.rgba[offset + 2])}`.toLowerCase();
        counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    return {
        ...target,
        colors: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([color]) => color),
    };
}
export function frameTarget(snapshot) {
    return {
        id: `${snapshot.id}:frame`,
        name: snapshot.rom,
        kind: "frame",
        rect: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
        pixels: [],
        colors: [],
        details: `${snapshot.cgb ? "GBC" : "GB"} framebuffer`,
    };
}
function tilePixel(snapshot, tile, bank, x, y, signed = false) {
    const base = signed ? 0x1000 + (tile < 128 ? tile : tile - 256) * 16 : tile * 16;
    const data = snapshot.vram[bank === 1 ? 1 : 0];
    return ((data[base + y * 2] >> (7 - x)) & 1) | (((data[base + y * 2 + 1] >> (7 - x)) & 1) << 1);
}
/** Reconstructs snapshot hardware. Mid-frame raster changes and special priority modes remain approximate. */
export function hardwareTargets(snapshot) {
    if (!(snapshot.lcdc & 0x80))
        return [];
    const tiles = new Map();
    const bgIndices = new Uint8Array(WIDTH * HEIGHT);
    const bgPriority = new Uint8Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            if (!snapshot.cgb && !(snapshot.lcdc & 1))
                continue;
            const window = !!(snapshot.lcdc & 0x20) && y >= snapshot.wy && x >= snapshot.wx - 7 && snapshot.wx <= 166;
            const mx = window ? x - (snapshot.wx - 7) : (x + snapshot.scx) & 255;
            const my = window ? y - snapshot.wy : (y + snapshot.scy) & 255;
            const map = snapshot.lcdc & (window ? 0x40 : 0x08) ? 0x1c00 : 0x1800;
            const offset = map + (my >> 3) * 32 + (mx >> 3);
            const tile = snapshot.vram[0][offset];
            const attr = snapshot.cgb ? snapshot.vram[1][offset] : 0;
            bgIndices[y * WIDTH + x] = tilePixel(snapshot, tile, (attr >> 3) & 1, attr & 0x20 ? 7 - (mx & 7) : mx & 7, attr & 0x40 ? 7 - (my & 7) : my & 7, !(snapshot.lcdc & 0x10));
            bgPriority[y * WIDTH + x] = attr >> 7;
            const kind = window ? "window" : "background";
            const key = `${kind}:${hex(offset + 0x8000, 4)}`;
            let target = tiles.get(key);
            if (!target) {
                target = {
                    id: `${snapshot.id}:${key}`,
                    name: `${window ? "Window" : "Background"} tile ${hex(tile)}`,
                    kind,
                    rect: { x, y, width: 1, height: 1 },
                    pixels: [],
                    graphic: {
                        tile,
                        bank: (attr >> 3) & 1,
                        palette: attr & 7,
                        mapAddress: offset + 0x8000,
                        address: snapshot.lcdc & 0x10 ? 0x8000 + tile * 16 : 0x9000 + (tile < 128 ? tile : tile - 256) * 16,
                        flipX: !!(attr & 0x20),
                        flipY: !!(attr & 0x40),
                    },
                    details: `Map $${hex(offset + 0x8000, 4)}; tile $${hex(tile)}; VRAM bank ${(attr >> 3) & 1}; palette ${attr & 7}`,
                };
                tiles.set(key, target);
            }
            target.pixels.push(y * WIDTH + x);
            target.rect.width = Math.max(target.rect.width, x - target.rect.x + 1);
            target.rect.height = Math.max(target.rect.height, y - target.rect.y + 1);
        }
    }
    const sprites = [];
    const height = snapshot.lcdc & 4 ? 16 : 8;
    if (snapshot.lcdc & 2) {
        for (let index = 0; index < 40; index++) {
            const y = snapshot.oam[index * 4] - 16;
            const x = snapshot.oam[index * 4 + 1] - 8;
            if (x >= WIDTH || x + 8 <= 0 || y >= HEIGHT || y + height <= 0)
                continue;
            const tile = snapshot.oam[index * 4 + 2] & (height === 16 ? 254 : 255);
            const attr = snapshot.oam[index * 4 + 3];
            const pixels = [];
            for (let py = Math.max(y, 0); py < Math.min(y + height, HEIGHT); py++) {
                let eligible = 0;
                for (let earlier = 0; earlier <= index; earlier++) {
                    const sy = snapshot.oam[earlier * 4] - 16;
                    if (py >= sy && py < sy + height)
                        eligible++;
                }
                if (eligible > 10)
                    continue;
                for (let px = Math.max(x, 0); px < Math.min(x + 8, WIDTH); px++) {
                    let ty = py - y;
                    if (attr & 0x40)
                        ty = height - 1 - ty;
                    const color = tilePixel(snapshot, tile + (ty >> 3), snapshot.cgb ? (attr >> 3) & 1 : 0, attr & 0x20 ? 7 - (px - x) : px - x, ty & 7);
                    if (color)
                        pixels.push(py * WIDTH + px);
                }
            }
            sprites.push({
                id: `${snapshot.id}:oam:${index}`,
                name: `Sprite ${index}; tile ${hex(tile)}`,
                kind: "sprite",
                graphic: {
                    tile,
                    bank: snapshot.cgb ? (attr >> 3) & 1 : 0,
                    palette: snapshot.cgb ? attr & 7 : (attr >> 4) & 1,
                    address: 0x8000 + tile * 16,
                    oamIndex: index,
                    flipX: !!(attr & 0x20),
                    flipY: !!(attr & 0x40),
                },
                rect: {
                    x: Math.max(x, 0), y: Math.max(y, 0),
                    width: Math.min(x + 8, WIDTH) - Math.max(x, 0),
                    height: Math.min(y + height, HEIGHT) - Math.max(y, 0),
                },
                pixels,
                details: `OAM ${index} at $${hex(0xfe00 + index * 4, 4)}; tile $${hex(tile)}; bank ${snapshot.cgb ? (attr >> 3) & 1 : 0}; palette ${snapshot.cgb ? attr & 7 : (attr >> 4) & 1}`,
            });
        }
    }
    const ordered = snapshot.cgb ? sprites : [...sprites].sort((a, b) => {
        const ai = a.graphic.oamIndex;
        const bi = b.graphic.oamIndex;
        return snapshot.oam[ai * 4 + 1] - snapshot.oam[bi * 4 + 1] || ai - bi;
    });
    const occupied = new Set();
    for (const sprite of ordered) {
        const attr = snapshot.oam[sprite.graphic.oamIndex * 4 + 3];
        sprite.pixels = sprite.pixels.filter((pixel) => {
            if (occupied.has(pixel))
                return false;
            occupied.add(pixel);
            return !((snapshot.cgb ? !!(snapshot.lcdc & 1) : true) && bgIndices[pixel] && (attr & 0x80 || (snapshot.cgb && bgPriority[pixel])));
        });
    }
    const spritePixels = new Set(sprites.flatMap((target) => target.pixels));
    for (const target of tiles.values()) {
        target.hitPixels = target.pixels;
        target.pixels = target.pixels.filter((pixel) => !spritePixels.has(pixel));
    }
    return [...sprites.filter((target) => target.pixels.length), ...tiles.values()].map((target) => finishTarget(snapshot, target));
}
function bounds(targets) {
    const x = Math.min(...targets.map((target) => target.rect.x));
    const y = Math.min(...targets.map((target) => target.rect.y));
    return {
        x, y,
        width: Math.max(...targets.map((target) => target.rect.x + target.rect.width)) - x,
        height: Math.max(...targets.map((target) => target.rect.y + target.rect.height)) - y,
    };
}
function adjacent(a, b) {
    return ((a.x + a.width === b.x || b.x + b.width === a.x) && a.y === b.y)
        || ((a.y + a.height === b.y || b.y + b.height === a.y) && a.x === b.x);
}
/** Adjacent consecutive OAM entries are a grouping hint, never an authored object identity. */
function spriteGroups(snapshot, hardware) {
    const height = snapshot.lcdc & 4 ? 16 : 8;
    const sprites = hardware.filter((target) => target.kind === "sprite" && target.rect.width === 8 && target.rect.height === height);
    const byIndex = new Map(sprites.map((target) => [target.graphic.oamIndex, target]));
    const remaining = new Set(sprites);
    const groups = [];
    for (const first of sprites) {
        if (!remaining.delete(first))
            continue;
        const members = [first];
        const graphic = first.graphic;
        const priority = snapshot.oam[graphic.oamIndex * 4 + 3] & 0x80;
        for (let index = graphic.oamIndex + 1; members.length < 12; index++) {
            const next = byIndex.get(index);
            if (!next || !remaining.has(next) || next.graphic.bank !== graphic.bank || next.graphic.palette !== graphic.palette
                || (snapshot.oam[index * 4 + 3] & 0x80) !== priority || !members.some((member) => adjacent(member.rect, next.rect)))
                break;
            const rect = bounds([...members, next]);
            if (rect.width > 48 || rect.height > 48)
                break;
            members.push(next);
            remaining.delete(next);
        }
        if (members.length < 2)
            continue;
        const summary = "Inferred from adjacent consecutive OAM parts with shared bank, palette and priority; authored identity unknown.";
        groups.push(finishTarget(snapshot, {
            id: `${snapshot.id}:sprite-group:${graphic.oamIndex}`,
            name: `Inferred sprite group; ${members.length} parts`,
            kind: "sprite",
            rect: bounds(members),
            pixels: members.flatMap((target) => target.pixels),
            details: `Inferred group; OAM ${members.map((target) => target.graphic.oamIndex).join(", ")}; bank ${graphic.bank}; palette ${graphic.palette}`,
            evidence: { method: "oam-group", summary, members: members.map((target) => target.id) },
        }));
    }
    return groups;
}
export function annotationTargets(snapshot) {
    const hardware = hardwareTargets(snapshot);
    return [...spriteGroups(snapshot, hardware), ...hardware];
}
export function targetAt(targets, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT)
        return null;
    const pixel = y * WIDTH + x;
    return targets.find((target) => contains(target.rect, x, y) && (target.hitPixels ?? target.pixels).includes(pixel)) ?? null;
}
/** Two compact context fields; the native target ID already carries capture identity. */
export function metadata(snapshot, target) {
    const source = snapshot.sourceRevision ? `; source ${snapshot.sourceRevision}` : "";
    return {
        Build: `ROM SHA-256 ${snapshot.sha256}; frame ${snapshot.frame}${source}`.slice(0, 256),
        Hardware: `${target.rect.x},${target.rect.y} ${target.rect.width}x${target.rect.height}px; ${target.details}`.slice(0, 256),
    };
}
//# sourceMappingURL=targets.js.map