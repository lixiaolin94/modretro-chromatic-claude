import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { decodeResourceBytes } from "./resource-codec.js";
import { WRECKLIGHT_PACING_SOURCE_REVIEW, WRECKLIGHT_BUSYROOM_SOURCE_REVIEW, WRECKLIGHT_DOOR_REVIEW, WRECKLIGHT_PERFORMANCE_SOURCE_REVIEW, WRECKLIGHT_REMIX_SOURCE_REVIEW, WRECKLIGHT_REVIEW } from "./wrecklight/profiles/base.js";
import { WRECKLIGHT_CURRENT_REVIEW } from "./wrecklight/profiles/current.js";
import { WRECKLIGHT_CHAMBERS_REVIEW } from "./wrecklight/profiles/chambers.js";
import { WRECKLIGHT_SEP17_REVIEW } from "./wrecklight/profiles/sep17.js";
import { WRECKLIGHT_COMBINED_SOURCE_REVIEW } from "./wrecklight/profiles/combined.js";
import { WRECKLIGHT_PAYOFF_SOURCE_REVIEW } from "./wrecklight/profiles/payoff.js";
import { WRECKLIGHT_OVERLAY_SOURCE_REVIEW } from "./wrecklight/profiles/overlay.js";
import { WRECKLIGHT_CAPTURE_SOURCE_REVIEW } from "./wrecklight/profiles/capture.js";
import { WRECKLIGHT_RENDER_SOURCE_REVIEW } from "./wrecklight/profiles/render.js";
import { WRECKLIGHT_SCROLL_SOURCE_REVIEW } from "./wrecklight/profiles/scroll.js";
import { WRECKLIGHT_SAMPLING_SOURCE_REVIEW } from "./wrecklight/profiles/sampling.js";
import { WRECKLIGHT_CHAMBER_CACHE_SOURCE_REVIEW } from "./wrecklight/profiles/chamber-cache.js";
import { WRECKLIGHT_FLAT_PROJECTILE_SOURCE_REVIEW } from "./wrecklight/profiles/flat-projectile.js";
import { WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW } from "./wrecklight/profiles/drive-performance.js";
import { WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW } from "./wrecklight/profiles/boss-three-phase.js";
import { WRECKLIGHT_BOSS_CUE_SOURCE_REVIEW } from "./wrecklight/profiles/boss-cue.js";
import { WRECKLIGHT_BOSS_LOOP_SOURCE_REVIEW } from "./wrecklight/profiles/boss-loop.js";
import { WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW } from "./wrecklight/profiles/boss-capture-prefix.js";
import { WRECKLIGHT_SCHEDULER_COUNTDOWN_SOURCE_REVIEW } from "./wrecklight/profiles/scheduler-countdown.js";
import { WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW } from "./wrecklight/profiles/brakemaw-timers.js";
import { WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW } from "./wrecklight/profiles/opening-direction.js";
import { WRECKLIGHT_OPENING_CORRECTION_SOURCE_REVIEW } from "./wrecklight/profiles/opening-correction.js";
import { WRECKLIGHT_COMBINED_PERFORMANCE_SOURCE_REVIEW } from "./wrecklight/profiles/combined-performance.js";
import { WRECKLIGHT_KEEP_VIEW_MAP_SOURCE_REVIEW } from "./wrecklight/profiles/keep-view-map.js";
import { WRECKLIGHT_GAMEPLAY_POLISH_SOURCE_REVIEW } from "./wrecklight/profiles/gameplay-polish.js";
import { WRECKLIGHT_WARDEN_ROW_SOURCE_REVIEW } from "./wrecklight/profiles/warden-row.js";
import { WRECKLIGHT_COMPOSED_GAMEPLAY_SOURCE_REVIEW } from "./wrecklight/profiles/composed-gameplay.js";
import { WRECKLIGHT_BRAKEMAW_FINISH_SOURCE_REVIEW } from "./wrecklight/profiles/brakemaw-finish.js";
import { WRECKLIGHT_CROWN_MOTION_SOURCE_REVIEW } from "./wrecklight/profiles/crown-motion.js";
import { WRECKLIGHT_BRAKEMAW_CAPTURE_LAYOUT_SOURCE_REVIEW } from "./wrecklight/profiles/brakemaw-capture-layout.js";
import { WRECKLIGHT_CARGO_CONTACT_SOURCE_REVIEW as cargoContact } from "./wrecklight/profiles/cargo-contact.js";
import { WRECKLIGHT_PROJECTILE_SPAWN_CONTACT_SOURCE_REVIEW as projectileSpawnContact } from "./wrecklight/profiles/projectile-spawn-contact.js";
import { WRECKLIGHT_WARDEN_CONDENSER_REVIEW, WRECKLIGHT_WARDEN_CUE_REVIEW, WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW, WRECKLIGHT_WARDEN_FEEDBACK_REVIEW, WRECKLIGHT_WARDEN_REVIEW, WRECKLIGHT_WARDEN_ROM44_REVIEW } from "./wrecklight/profiles/warden.js";
function immutable(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value))
            immutable(child);
        Object.freeze(value);
    }
    return value;
}
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
const incomplete = (reason) => ({ status: "incomplete", reason });
// Each alternative owns its complete bindings AND semantics. A successor must
// never inherit the old room table merely because a handler's bytes stayed the same.
function nativeContracts(source, idSuffix, version = 2) {
    const review = immutable(source);
    const MAP_WORDS = review.runtime?.mapWords ?? range(223, 582);
    const SEEN = review.runtime?.seen ?? range(223, 398);
    const VISITED = review.runtime?.visited ?? range(399, 574);
    const ROOM_WORDS = review.runtime?.roomWords ?? ["579"];
    const HUD_READS = ["81", "36", "80", "86", "98", "94", "95", "21", "221", "8", "77", "587", "586", "585", ...(review.runtime?.hudReads ?? [])];
    const VERIFY_READS = [...MAP_WORDS, "143", "8", "88", "585", "586", "587", "588", ...(review.runtime?.verifyReads ?? [])];
    const wardenEventBranches = [...new Set(Object.values(review.warden?.operations ?? {})
            .flatMap((operation) => operation.children))];
    /** This review covers a fixed native extension, not arbitrary C or handlers.
     * Preserve the compiler's slice-then-filter actor order. Missing sprites and
     * prefab expansion are refused instead of guessing the fallback actor index.
     * Actor positions, scripts and scene collision edits remain ordinary resources
     * unless a successor explicitly binds a compiler-sensitive actor resource. */
    function layoutReason(context) {
        const { inventory, resourceFiles } = context;
        if (inventory.format !== "distributed" || inventory.descriptor._version !== "4.2.0"
            || inventory.descriptor._release !== "10"
            || path.relative(inventory.projectRoot, inventory.projectPath) !== "project.gbsproj") {
            return "The reviewed distributed project descriptor is required";
        }
        if (review.fixedRemixDescriptor) {
            const descriptor = inventory.descriptor;
            const fixed = review.fixedRemixDescriptor;
            if (typeof descriptor.name !== "string" || typeof descriptor.author !== "string"
                || Object.keys(descriptor).length !== Object.keys(fixed).length + 2
                || Object.entries(fixed).some(([key, value]) => descriptor[key] !== value)
                || Object.keys(descriptor).some((key) => key !== "name" && key !== "author" && !Object.hasOwn(fixed, key))) {
                return "The reviewed remix descriptor permits only string name and author changes";
            }
        }
        if (!resourceFiles)
            return "The complete compiler-visible resource classification is required";
        // The ordinary loader uses each resource's _resourceType and its immediate
        // folder. The index's filename-based projection must not hide another loaded
        // actor/scene/asset or associate a nested actor with a different scene.
        for (const file of resourceFiles) {
            if (file.type === "scene") {
                const matches = inventory.scenes.filter((scene) => scene.resourcePath === file.path && scene.id === file.id);
                if (matches.length !== 1)
                    return "A compiler-visible scene is missing or ambiguous in the inventory";
            }
            else if (file.type === "actor" || file.type === "trigger") {
                const family = file.type === "actor" ? "actors" : "triggers";
                const directory = path.posix.dirname(file.path);
                if (path.posix.basename(directory) !== family)
                    return "A compiler-visible owner has an unsupported folder association";
                const scenes = inventory.scenes.filter((scene) => path.posix.dirname(scene.resourcePath) === path.posix.dirname(directory));
                if (scenes.length !== 1 || scenes[0][family].filter((owner) => owner.resourcePath === file.path && owner.id === file.id).length !== 1) {
                    return "Compiler and index owner membership differ";
                }
            }
            else if (file.type === "sprite" || file.type === "sound" || (file.type === "background" && review.backgrounds)) {
                if (inventory.assets.filter((asset) => asset.type === file.type && asset.metadataPath === file.path && asset.id === file.id).length !== 1) {
                    return "A compiler-visible native asset is missing or ambiguous in the inventory";
                }
            }
        }
        for (const room of review.rooms) {
            const scenes = inventory.scenes.filter((scene) => scene.id === room.id);
            if (scenes.length !== 1)
                return "A native room ID is missing or ambiguous";
            const scene = scenes[0];
            if (scene._resourceType !== "scene" || scene.symbol !== room.symbol || scene.type !== "PLATFORM"
                || (room.resourcePath !== undefined && scene.resourcePath !== room.resourcePath)
                || inventory.scenes.filter((other) => other.symbol === room.symbol).length !== 1) {
                return "A native room symbol or platform selection changed";
            }
            if (scene.actors.length !== room.actors.length || scene.actors.length > 20
                || scene.actors.some((actor) => !Number.isSafeInteger(actor._index) || actor.prefabId)
                || new Set(scene.actors.map((actor) => actor._index)).size !== scene.actors.length) {
                return "Native actor membership, unique ordering or prefab selection changed";
            }
            const actors = [...scene.actors].sort((a, b) => Number(a._index) - Number(b._index));
            for (let i = 0; i < actors.length; i++) {
                const actor = actors[i], expected = room.actors[i];
                if (actor._resourceType !== "actor" || actor.id !== expected.id || actor._index !== expected.index
                    || actor.resourcePath !== path.posix.join(path.posix.dirname(scene.resourcePath), "actors", expected.filename)
                    || scene.actors.filter((other) => other.id === actor.id).length !== 1) {
                    return "An authored actor no longer has the reviewed native slot";
                }
                const sprites = inventory.assets.filter((asset) => asset.type === "sprite" && asset.id === actor.spriteSheetId);
                if (typeof actor.spriteSheetId !== "string" || sprites.length !== 1 || !sprites[0].hasMetadata) {
                    return "The compiler's actor sprite inclusion is missing or ambiguous";
                }
                if (resourceFiles.filter((file) => file.path === sprites[0].metadataPath && file.type === "sprite" && file.id === sprites[0].id).length !== 1) {
                    return "The actor sprite is not uniquely present in the compiler's resource inputs";
                }
            }
        }
        for (const expected of [review.sound, ...(review.extendedEvents?.sounds ?? []), ...(review.warden?.sounds ?? [])]) {
            const sounds = inventory.assets.filter((asset) => asset.type === "sound"
                && (asset.id === expected.id || asset.symbol === expected.symbol));
            if (sounds.length !== 1 || sounds[0].id !== expected.id || sounds[0].symbol !== expected.symbol
                || sounds[0].filename !== expected.filename || sounds[0].plugin) {
                return "A native ceremony or reward sound association changed";
            }
        }
        if (review.warden) {
            const expected = review.warden;
            const room = review.rooms.find((room) => room.id === expected.sceneId);
            const binding = room?.actors.find((actor) => actor.id === expected.actorId);
            const scene = inventory.scenes.find((scene) => scene.id === expected.sceneId);
            const actor = scene?.actors.find((actor) => actor.id === expected.actorId);
            const sprite = inventory.assets.find((asset) => asset.id === expected.spriteId && asset.type === "sprite");
            if (!scene || scene.width !== 40 || scene.height !== 24
                || (scene.tilesetId !== undefined && scene.tilesetId !== "")) {
                return "The Warden requires the reviewed 40 by 24 resident background without an extra tileset";
            }
            if (!actor || !binding || binding.slot !== expected.actorSlot || actor._index !== expected.actorIndex
                || actor.resourcePath !== expected.actorPath || actor.spriteSheetId !== expected.spriteId || !sprite) {
                return "The Warden requires its exact Deck actor, compiled slot and sprite association";
            }
            const states = sprite.states;
            const state = Array.isArray(states) ? states[0] : undefined;
            if (!state || typeof state !== "object" || Array.isArray(state) || state.id !== expected.stateId
                || state.name !== "" || state.animationType !== "fixed" || state.flipLeft !== false
                || !Array.isArray(state.animations) || !state.animations[0]
                || !Array.isArray(state.animations[0].frames) || state.animations[0].frames.length !== expected.frameCount) {
                return "The Warden requires its reviewed default fixed animation and frame offsets";
            }
            for (const sound of expected.sounds) {
                const asset = inventory.assets.find((asset) => asset.id === sound.id && asset.type === "sound");
                if (!asset?.hasMetadata || asset.metadataPath !== sound.metadataPath
                    || resourceFiles.filter((file) => file.path === sound.metadataPath && file.type === "sound" && file.id === sound.id).length !== 1) {
                    return "A Warden sound is missing its reviewed compiler-visible metadata";
                }
            }
        }
        for (const expected of [...(review.nativeSprites ?? []), ...(review.player ? [review.player] : [])]) {
            const matches = inventory.assets.filter((asset) => asset.type === "sprite"
                && (asset.id === expected.id || asset.symbol === expected.symbol));
            if (matches.length !== 1 || matches[0].id !== expected.id || matches[0].symbol !== expected.symbol
                || matches[0].filename !== expected.filename || matches[0].metadataPath !== expected.metadataPath
                || !matches[0].hasMetadata || matches[0].plugin
                || resourceFiles.filter((file) => file.path === expected.metadataPath && file.type === "sprite" && file.id === expected.id).length !== 1) {
                return "A native compiled sprite association changed";
            }
        }
        if (review.player) {
            const defaults = inventory.settings.defaultPlayerSprites;
            if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)
                || defaults.PLATFORM !== review.player.id
                || inventory.scenes.some((scene) => scene.type === "PLATFORM"
                    && scene.playerSpriteSheetId !== undefined && scene.playerSpriteSheetId !== review.player.id)) {
                return "The native presentation player sprite selection changed";
            }
            const player = inventory.assets.find((asset) => asset.id === review.player.id);
            const states = player.states;
            if (!Array.isArray(states) || review.player.states.some((expected) => states.filter((state) => state && typeof state === "object" && !Array.isArray(state)
                && (state.id === expected.id || state.name === expected.name)).length !== 1
                || !states.some((state) => state && typeof state === "object" && !Array.isArray(state)
                    && state.id === expected.id && state.name === expected.name))) {
                return "A native player animation state is missing or ambiguous";
            }
        }
        for (const expected of review.backgrounds ?? []) {
            const scene = inventory.scenes.find((candidate) => candidate.id === expected.sceneId);
            const choices = [expected, ...(expected.alternatives ?? [])].filter((choice) => choice.id === scene?.backgroundId);
            const selected = choices[0];
            const backgrounds = inventory.assets.filter((asset) => asset.type === "background" && asset.id === selected?.id);
            if (!scene || choices.length !== 1 || !selected
                || (scene.parallax !== undefined && (!Array.isArray(scene.parallax) || scene.parallax.length !== 0))
                || scene.parallaxLayers !== undefined
                || backgrounds.length !== 1 || backgrounds[0].metadataPath !== selected.metadataPath
                || !backgrounds[0].hasMetadata || backgrounds[0].width !== expected.width || backgrounds[0].height !== expected.height
                || resourceFiles.filter((file) => file.path === selected.metadataPath && file.type === "background" && file.id === selected.id).length !== 1) {
                return "The native door renderer requires its reviewed background association without parallax";
            }
        }
        if (review.extendedEvents) {
            const expected = review.extendedEvents.title;
            const scenes = inventory.scenes.filter((scene) => scene.id === expected.id || scene.symbol === expected.symbol);
            const scene = scenes[0];
            const choices = [expected.background, ...(expected.backgroundAlternatives ?? [])]
                .filter((background) => background.id === scene?.backgroundId);
            const background = choices[0];
            if (choices.length !== 1 || !background)
                return "The reviewed title background association is required";
            const assets = inventory.assets.filter((asset) => asset.type === "background" && asset.id === background.id);
            if (scenes.length !== 1 || !scene || scene.id !== expected.id || scene.symbol !== expected.symbol
                || scene.resourcePath !== expected.resourcePath || scene._resourceType !== "scene" || scene.type !== "LOGO"
                || scene.actors.length !== 0 || scene.backgroundId !== background.id
                || ![expected.paletteIds, ...(expected.paletteAlternatives ?? [])]
                    .some((paletteIds) => JSON.stringify(scene.paletteIds) === JSON.stringify(paletteIds))
                || (scene.parallax !== undefined && (!Array.isArray(scene.parallax) || scene.parallax.length !== 0))
                || scene.parallaxLayers !== undefined || assets.length !== 1 || !assets[0].hasMetadata
                || assets[0].metadataPath !== background.metadataPath || assets[0].width !== background.width
                || assets[0].height !== background.height
                || resourceFiles.filter((file) => file.path === background.metadataPath && file.type === "background" && file.id === background.id).length !== 1) {
                return "The reviewed actor-free LOGO scene and title background/palette associations are required";
            }
            if ("preserveUiFromRow" in background) {
                const preserveUiFromRow = background.preserveUiFromRow;
                if (typeof preserveUiFromRow !== "number" || !Number.isInteger(preserveUiFromRow)) {
                    return "The reviewed title UI row binding must be an integer";
                }
                const asset = assets[0];
                if (asset.autoColor !== false || typeof asset.tileColors !== "string" || asset.tileColors.length === 0) {
                    return "Replacement title art requires explicit manual-color attributes including its reviewed startup rows";
                }
                try {
                    const width = background.width / 8, height = background.height / 8;
                    const cells = decodeResourceBytes(asset.tileColors, { maximumValues: width * height });
                    // These are compiler-preloaded background attributes. The exact
                    // native header supplies the visible menu's palette-7 strip later.
                    // Keep each reviewed startup strip uniform; mixed strips are invalid.
                    const uiValues = background.startupUiValues ?? [7];
                    if (cells.length !== width * height || !uiValues.some((value) => cells.every((cell, index) => index >= preserveUiFromRow * width ? cell === value : cell <= 6))) {
                        return "Replacement title attributes must match a reviewed startup strip and ordinary palette slots";
                    }
                }
                catch {
                    return "Replacement title attributes are not a complete native palette grid";
                }
            }
        }
        if (review.engineLocalReads) {
            const reason = nativeLocalOwnerReason(context, review.engineLocalReads, "The Crown frame hooks");
            if (reason)
                return reason;
        }
        if (review.crownPress) {
            const expected = review.crownPress;
            const core = inventory.scenes.find((scene) => scene.id === expected.sceneId)?.actors.find((actor) => actor.id === expected.coreId);
            const binding = review.rooms.find((room) => room.id === expected.sceneId)?.actors.find((actor) => actor.id === expected.coreId);
            const sprite = inventory.assets.find((asset) => asset.type === "sprite" && asset.id === expected.spriteId);
            const states = sprite?.states;
            if (binding?.slot !== expected.coreSlot || core?.spriteSheetId !== expected.spriteId || !sprite
                || sprite.canvasWidth !== 32 || sprite.canvasHeight !== 32 || !Array.isArray(states) || states.length !== 1
                || states[0]?.id !== expected.stateId || states[0]?.name !== "" || states[0]?.animationType !== "fixed"
                || states[0]?.flipLeft !== false || !Array.isArray(states[0]?.animations?.[0]?.frames)
                || states[0].animations[0].frames.length !== 11)
                return "The Crown core requires its reviewed sprite and eleven fixed frames";
        }
        if (review.crownMotion) {
            const expected = review.crownMotion;
            // Early motion publishes poses to both relays; the existing core check
            // above establishes the shared eleven-frame sprite layout.
            if (expected.spriteId !== review.crownPress?.spriteId || expected.stateId !== review.crownPress?.stateId) {
                return "The Crown relays require the reviewed core frame layout";
            }
            const room = review.rooms.find((room) => room.id === expected.sceneId);
            const scene = inventory.scenes.find((scene) => scene.id === expected.sceneId);
            for (const relay of expected.relays) {
                if (room?.actors.find((actor) => actor.id === relay.id)?.slot !== relay.slot
                    || scene?.actors.find((actor) => actor.id === relay.id)?.spriteSheetId !== expected.spriteId) {
                    return "The Crown relays require their reviewed physical slots and sprite association";
                }
            }
        }
        return undefined;
    }
    class Effects {
        resources = [];
        variables = new Map();
        access(ids, access) {
            for (const id of ids) {
                const previous = this.variables.get(id);
                this.variables.set(id, previous && previous !== access ? "read-write" : access);
            }
        }
        constructor(context) {
            // Native translation units and inline compiler alias registrations need
            // these definitions even when this particular operation never reads them.
            // They are structural compile/link dependencies, NOT runtime accesses.
            for (const variable of review.variables)
                this.resources.push({ kind: "resource", type: "variable",
                    id: variable.id, relation: "native-compile-symbol" });
            for (const room of review.rooms) {
                this.resources.push({ kind: "resource", type: "scene", id: room.id, relation: "native-room-symbol" });
                for (const actor of room.actors)
                    this.resources.push({ kind: "resource", type: "actor", id: actor.id,
                        sceneId: room.id, relation: "native-actor-slot" });
            }
            this.resources.push({ kind: "resource", type: "asset", id: review.sound.id, relation: "native-reward-sound" });
            for (const sprite of review.nativeSprites ?? [])
                this.resources.push({ kind: "resource", type: "asset",
                    id: sprite.id, relation: "native-compiled-sprite" });
            if (review.player)
                this.resources.push({ kind: "resource", type: "asset",
                    id: review.player.id, relation: "native-player-presentation" });
            for (const background of review.backgrounds ?? []) {
                // layoutReason has already accepted exactly one maintained association.
                const selectedId = context.inventory.scenes.find((scene) => scene.id === background.sceneId).backgroundId;
                this.resources.push({ kind: "resource", type: "asset", id: selectedId, relation: "native-door-background" });
            }
            for (const sound of review.extendedEvents?.sounds ?? [])
                this.resources.push({ kind: "resource", type: "asset",
                    id: sound.id, relation: "native-ceremony-sound" });
            for (const sound of review.warden?.sounds ?? [])
                this.resources.push({ kind: "resource", type: "asset",
                    id: sound.id, relation: "native-warden-sound" });
            // Frame hooks execute independently of an event's direct VM accesses.
            // Keep these verified dependencies distinct from operation read/write sets.
            for (const id of review.warden?.renderReads ?? [])
                this.resources.push({ kind: "resource", type: "variable",
                    id, relation: "native-engine-render-read" });
            for (const id of review.engineRenderReads ?? [])
                if (!review.warden?.renderReads.includes(id)) {
                    this.resources.push({ kind: "resource", type: "variable", id, relation: "native-engine-render-read" });
                }
            for (const id of review.combatContactReads ?? [])
                this.resources.push({ kind: "resource", type: "variable",
                    id, relation: "native-engine-contact-read" });
            if (review.engineLocalReads) {
                const owner = review.engineLocalReads;
                for (const [relation, ids] of [
                    ["native-engine-render-read", owner.render], ["native-engine-contact-read", owner.contact],
                ])
                    for (const id of ids)
                        this.resources.push({ kind: "resource", type: "variable", id,
                            ownerId: owner.actorId, sceneId: owner.sceneId, relation });
            }
            if (review.extendedEvents) {
                this.resources.push({ kind: "resource", type: "scene", id: review.extendedEvents.title.id, relation: "native-title-scene" });
                this.resources.push({ kind: "resource", type: "asset", id: context.inventory.scenes.find((scene) => scene.id === review.extendedEvents.title.id).backgroundId,
                    relation: "native-title-background" });
            }
        }
        result(childBranches = []) {
            return { status: "complete", childBranches, effects: [...this.resources,
                    ...[...this.variables].map(([id, access]) => ({ kind: "variable", id, access }))] };
        }
    }
    function actorSlot(input, context) {
        const room = review.rooms.find((item) => item.id === context.owner.sceneId);
        if (!room)
            return undefined;
        const id = input.actorId === "$self$"
            ? (context.owner.resourceType === "actor" ? context.owner.resourceId : undefined) : input.actorId;
        return typeof id === "string" ? room.actors.find((actor) => actor.id === id)?.slot : undefined;
    }
    function markerEffects(effects, marker, visible) {
        effects.access(["582"], "read"); // schema is checked even for an unused marker
        if (marker >= 16)
            return; // pinned table rows 16..31 have room=255
        const seen = String(575 + (marker >> 4)), collected = String(577 + (marker >> 4));
        effects.access([seen], "read-write");
        effects.access([collected], visible ? "read" : "read-write");
        if (visible)
            effects.access(SEEN, "read-write"); // dynamic cell; bounded union, not an observed cell
    }
    function modalEffects(effects, opening) {
        // Modal input may choose any page. These are possible accesses across its
        // branches, not a promise that every word is touched during a given call.
        effects.access([...MAP_WORDS, "8", "77", "88", "585", "586", "587", ...HUD_READS, ...(review.runtime?.modalReads ?? [])], "read");
        effects.access(["89"], "write");
        effects.access(["586"], "read-write");
        if (opening) {
            effects.access(["76"], "read");
            effects.access([...SEEN, ...VISITED, ...ROOM_WORDS, "580", "581"], "read-write");
        }
    }
    function extractCombat(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const effects = new Effects(context);
        const header = review.brakemawCaptureHeader;
        if (header && input.operation === header.operation) {
            const reason = brakemawCaptureHeaderReason(input, context, header);
            if (reason)
                return incomplete(reason);
            effects.access(header.writes, "write");
            const owner = review.brakemawGuards;
            effects.resources.push({ kind: "resource", type: "actor", id: owner.actorId,
                sceneId: owner.sceneId, relation: "actor" });
            // Admission may execute all captures natively; refusal executes the
            // original compiled children. Both possible paths retain dependencies.
            return effects.result(["fallback"]);
        }
        const operation = review.brakemawOperations && typeof input.operation === "string"
            && Object.hasOwn(review.brakemawOperations, input.operation)
            ? review.brakemawOperations[input.operation] : undefined;
        if (operation) {
            const owner = review.brakemawGuards;
            if (!owner)
                return incomplete("The Brakemaw operation requires its reviewed owner");
            if (Object.keys(input).some((key) => key !== "operation" && key !== "__comment")) {
                return incomplete("The Brakemaw operation accepts no arguments or child actions");
            }
            const reason = brakemawGuardReason(context, owner, operation.aliases, "EVENT_WRECKLIGHT_COMBAT");
            if (reason)
                return incomplete(reason);
            if (!operation.sites.includes(context.event?.id ?? "")) {
                return incomplete("The Brakemaw operation requires its original event ID");
            }
            effects.access(operation.reads, "read");
            effects.access(operation.writes, "write");
            // The player is compiler slot zero, not an inventory actor. The shared
            // player-presentation binding remains structural; the boss is an actor.
            if (operation.actor === "owner")
                effects.resources.push({ kind: "resource", type: "actor",
                    id: owner.actorId, sceneId: owner.sceneId, relation: "actor" });
            return effects.result();
        }
        switch (input.operation) {
            case "crownWaitTick": {
                const expected = review.crownCountdown;
                if (!expected)
                    return incomplete("The Crown countdown requires its opted-in source profile");
                if (!Number.isInteger(input.expectedPhase) || !Number.isInteger(input.maxFrames)
                    || !expected.pairs.some((pair) => pair.phase === input.expectedPhase && pair.maxFrames === input.maxFrames)) {
                    return incomplete("The Crown countdown requires one reviewed explicit integer phase/maximum pair");
                }
                const reason = crownCountdownReason(context, expected);
                if (reason)
                    return incomplete(reason);
                effects.access([...expected.reads, ...expected.locals.map((local) => local.local)], "read");
                if (Number(input.expectedPhase) >= 7)
                    effects.access(["97"], "read");
                // The live path decrements L5; cancellation writes maximum + 1.
                // Actor movement, captures and yielding remain authored events.
                effects.access(["L5"], "write");
                return effects.result();
            }
            case "grace":
                if (!review.combatGrace)
                    return incomplete("The combat operation is absent or outside the reviewed native dispatch");
                // A signed positive check may decrement this global; no child is compiled.
                effects.access(["9"], "read-write");
                return effects.result();
            case "hit":
            case "defeated": {
                const slot = actorSlot(input, context);
                if (!slot)
                    return incomplete("Combat requires an explicit, uniquely bound scene actor; fallback-to-self is not reviewed");
                // The compiled argument is a slot; native find_target also checks the
                // current scene. Do not assume a script owner's scene is runtime state.
                const targets = review.targets.filter((target) => target.slot === slot);
                effects.access(targets.map((target) => target.dead), "read");
                if (input.operation === "hit") {
                    effects.access(targets.flatMap((target) => target.hp ? [target.hp] : []), "read-write");
                    effects.access(targets.flatMap((target) => target.hitReadWrites ?? []), "read-write");
                    return effects.result(["false", "true"]);
                }
                if (targets.some((target) => target.armor !== 3)) {
                    effects.access(["585", "8", "587", "77"], "read");
                    effects.access(["588"], "read-write");
                }
                return effects.result();
            }
            case "entry":
                effects.access(review.runtime?.entryReads ?? [], "read");
                effects.access(review.targets.filter((target) => target.armor !== 3)
                    .flatMap((target) => [target.dead, ...(target.phase ? [target.phase] : [])]), "write");
                // entry calls loaded: equipment normalization reads the original ammo.
                effects.access(["585", "587"], "read");
                effects.access(["586"], "read-write");
                return effects.result();
            case "loaded":
                effects.access(["585", "587"], "read");
                effects.access(["586"], "read-write");
                return effects.result();
            case "newGame":
                effects.access(["585", "586", "587", "588"], "write");
                return effects.result();
            case "ready": return effects.result(); // private native flag only
            case "station":
                effects.access(["585"], "read");
                effects.access(["587"], "write");
                return effects.result();
            case "collect": {
                if (!Number.isInteger(input.rewardId) || Number(input.rewardId) < 0 || Number(input.rewardId) > 6) {
                    return incomplete("Only an explicit integer reward 0..6 is reviewed; editor defaults and Number coercion are not applied");
                }
                const reward = Number(input.rewardId);
                effects.access(["8"], "read");
                effects.access(review.runtime?.collectReads ?? [], "read");
                effects.access(["585"], "read-write");
                if (reward === 2)
                    effects.access(["587"], "write");
                else if (reward >= 3 && reward <= 5)
                    effects.access(["587"], "read-write");
                markerEffects(effects, reward + 9, false);
                return effects.result();
            }
            default: return incomplete("The combat operation is absent or outside the reviewed native dispatch");
        }
    }
    function directNativeOwnerReason(context, expected, command, label) {
        if (context.owner.resourceType !== "actor" || context.owner.resourceId !== expected.actorId
            || context.owner.sceneId !== expected.sceneId || context.owner.resourcePath !== expected.actorPath
            || context.owner.definitionPath !== undefined || context.event?.scriptKey !== "updateScript"
            || context.event.command !== command) {
            return `${label} requires its direct reviewed actor update owner`;
        }
        return nativeOwnerLayoutReason(context, expected, label);
    }
    function nativeOwnerLayoutReason(context, expected, label) {
        const scenes = context.inventory.scenes;
        if (scenes.some((scene) => scene._resourceType !== "scene" || typeof scene.type !== "string"
            || context.resourceFiles.filter((file) => file.type === "scene" && file.id === scene.id
                && file.path === scene.resourcePath).length !== 1)) {
            return `${label} requires actual compiler-visible scenes with string scene types`;
        }
        if (scenes.some((scene) => !Number.isSafeInteger(scene._index) || Number(scene._index) < 0)
            || new Set(scenes.map((scene) => scene._index)).size !== scenes.length
            || new Set(scenes.map((scene) => scene.id)).size !== scenes.length
            || new Set(scenes.map((scene) => scene.resourcePath)).size !== scenes.length) {
            return `${label} requires unique scene identities and explicit integer ordering`;
        }
        const disabled = context.inventory.settings.disabledSceneTypeIds ?? [];
        if (!Array.isArray(disabled) || disabled.some((type) => typeof type !== "string")) {
            return `${label} requires the reviewed compiler scene-type filtering`;
        }
        const compiledScenes = [...scenes].sort((a, b) => Number(a._index) - Number(b._index))
            .filter((scene) => expected.enabledSceneTypes.includes(String(scene.type)) && !disabled.includes(scene.type));
        if (compiledScenes.findIndex((scene) => scene.id === expected.sceneId) !== expected.sceneIndex) {
            return `${label} changed the compiled scene ordinal used by its local aliases`;
        }
        // getVariableAlias caches locals by entity ID, without a scene qualifier.
        const owners = context.resourceFiles.filter((file) => file.id === expected.actorId
            && ["scene", "actor", "trigger", "script"].includes(String(file.type)));
        if (owners.length !== 1 || owners[0].type !== "actor" || owners[0].path !== expected.actorPath) {
            return `${label} requires a unique compiler-visible local-variable owner`;
        }
        // layoutReason proves the whole actor cohort, its slice/filter order and
        // sprite inclusion. The bound variables resource fixes local names and
        // global aliases; ordinary edits to the update event tree stay editable.
        const actors = [...compiledScenes[expected.sceneIndex].actors]
            .sort((a, b) => Number(a._index) - Number(b._index));
        const entityIndex = actors.findIndex((actor) => actor.id === expected.actorId);
        if (entityIndex !== expected.entityIndex)
            return `${label} changed the compiled actor ordinal used by its local aliases`;
        return undefined;
    }
    function nativeLocalOwnerReason(context, expected, label) {
        const reason = nativeOwnerLayoutReason(context, expected, label);
        if (reason)
            return reason;
        if (expected.locals.some(({ local, alias }) => !/^L[0-5]$/.test(local)
            || alias !== `VAR_S${expected.sceneIndex}A${expected.entityIndex}_LOCAL_${local.slice(1)}`)
            || new Set(expected.locals.map(({ local }) => local)).size !== expected.locals.length
            || expected.globalAliases.some(({ id, alias }) => review.variables.filter((variable) => variable.id === id && variable.symbol.toUpperCase() === alias).length !== 1)) {
            return `${label} changed a reviewed local or global alias`;
        }
        return undefined;
    }
    function crownCountdownReason(context, expected) {
        const reason = directNativeOwnerReason(context, expected, "EVENT_WRECKLIGHT_COMBAT", "The Crown countdown");
        if (reason)
            return reason;
        if (expected.locals.length !== 6
            || ["L0", "L1", "L2", "L3", "L4", "L5"].some((local) => expected.locals.filter((entry) => entry.local === local).length !== 1)
            || expected.locals.some((entry) => entry.alias !== `VAR_${`S${expected.sceneIndex}A${expected.entityIndex}_${entry.localName}`
                .toUpperCase().replace(/[^A-Z0-9]/g, "_")}`)
            || expected.globalAliases.some(({ id, alias }) => review.variables.filter((variable) => variable.id === id && variable.symbol.toUpperCase() === alias).length !== 1)) {
            return "The Crown countdown changed an owning local or global alias";
        }
        return undefined;
    }
    function brakemawGuardReason(context, expected, aliases, command = "EVENT_WRECKLIGHT_ENEMY_CONDITION") {
        const reason = directNativeOwnerReason(context, expected, command, "The Brakemaw guard");
        if (reason)
            return reason;
        const slot = review.rooms.find((room) => room.id === expected.sceneId)?.actors
            .find((actor) => actor.id === expected.actorId)?.slot;
        if (slot !== expected.actorSlot || slot !== expected.entityIndex + 1
            || aliases.some(({ id, alias }) => /^L[0-5]$/.test(id)
                ? alias !== `VAR_S${expected.sceneIndex}A${expected.entityIndex}_LOCAL_${id.slice(1)}`
                : review.variables.filter((variable) => variable.id === id && variable.symbol.toUpperCase() === alias).length !== 1)) {
            return "The Brakemaw guard changed an owning slot or local/global alias";
        }
        return undefined;
    }
    const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    function brakemawCaptureHeaderReason(input, context, expected) {
        const owner = review.brakemawGuards;
        if (!owner)
            return "The Brakemaw capture header requires its reviewed owner";
        const reason = brakemawGuardReason(context, owner, expected.aliases, "EVENT_WRECKLIGHT_COMBAT");
        if (reason)
            return reason;
        if (!isDeepStrictEqual(input, { operation: expected.operation, fallback: expected.fallback })) {
            return "The Brakemaw capture header requires all seven original captures in order";
        }
        const actor = context.inventory.scenes.find((scene) => scene.id === owner.sceneId).actors
            .find((actor) => actor.id === owner.actorId);
        const life = Array.isArray(actor.updateScript) ? actor.updateScript[0] : undefined;
        const branch = isObject(life) && isObject(life.children) ? life.children.true : undefined;
        const event = Array.isArray(branch) ? branch[0] : undefined;
        if (context.event?.id !== expected.eventId
            || !isDeepStrictEqual(context.event.branchPath, [{ eventId: expected.lifeEventId, branch: "true", index: 0 }])
            || !isObject(life) || life.id !== expected.lifeEventId
            || life.command !== "EVENT_WRECKLIGHT_ENEMY_CONDITION" || !isObject(life.args)
            || life.args.kind !== "brakemawLife" || life.args.__comment
            || !isDeepStrictEqual(event, { id: expected.eventId, command: "EVENT_WRECKLIGHT_COMBAT",
                args: { operation: expected.operation }, children: { fallback: expected.fallback } })) {
            return "The Brakemaw capture header must be first under its original life predicate";
        }
        // Exact engine.json and variables.gbsres bindings establish field widths,
        // signed-byte conversions, local names and the global allocation guards.
        return undefined;
    }
    function fixedPhaseGuard(value, id, kind, trueCount, falseCount) {
        if (!isObject(value) || !isDeepStrictEqual(Object.keys(value).sort(), ["args", "children", "command", "id"])
            || value.id !== id || value.command !== "EVENT_WRECKLIGHT_ENEMY_CONDITION"
            || !isDeepStrictEqual(value.args, { kind }) || !isObject(value.children)
            || !isDeepStrictEqual(Object.keys(value.children).sort(), ["false", "true"])
            || !Array.isArray(value.children.true) || value.children.true.length !== trueCount
            || !Array.isArray(value.children.false) || value.children.false.length !== falseCount)
            return undefined;
        return { event: value, true: value.children.true, false: value.children.false };
    }
    function brakemawPhasePrefixReason(input, context, expected, prefix) {
        const owner = review.brakemawGuards;
        const actor = context.inventory.scenes.find((scene) => scene.id === owner.sceneId).actors
            .find((actor) => actor.id === owner.actorId);
        const update = actor.updateScript;
        if (!Array.isArray(update) || update.length !== 1)
            return "The Brakemaw phase prefix requires its original update root";
        const life = fixedPhaseGuard(update[0], expected.lifeEventId, "brakemawLife", 2, 0);
        const lt10 = life && fixedPhaseGuard(life.true[1], expected.lessThan10EventId, "brakemawPhaseLt10", 1, 1);
        const lt20 = lt10 && fixedPhaseGuard(lt10.false[0], expected.lessThan20EventId, "brakemawPhaseLt20", 1, 1);
        if (!lt20 || !isDeepStrictEqual(context.event?.branchPath, [
            { eventId: expected.lifeEventId, branch: "true", index: 0 },
            { eventId: expected.lessThan10EventId, branch: "false", index: 1 },
            { eventId: expected.lessThan20EventId, branch: prefix.branch, index: 0 },
        ]))
            return "The Brakemaw phase prefix requires its original outer phase gates";
        let event = lt20[prefix.branch][0];
        let first;
        for (let index = 0; index < prefix.phases.length; index++) {
            const node = fixedPhaseGuard(event, prefix.sites[index], `brakemawPhaseEq${prefix.phases[index]}`, 1, 1);
            if (!node)
                return "The Brakemaw phase prefix requires its complete original source span";
            if (index === 0)
                first = node;
            event = node.false[0];
        }
        if (!first || !isDeepStrictEqual(input, { kind: input.kind, true: first.true, false: first.false })) {
            return "The Brakemaw phase prefix input differs from its authored event";
        }
        const counts = new Map(prefix.sites.map((id) => [id, 0]));
        const visit = (value) => {
            if (Array.isArray(value)) {
                for (const item of value)
                    visit(item);
            }
            else if (isObject(value)) {
                if (typeof value.id === "string" && counts.has(value.id))
                    counts.set(value.id, counts.get(value.id) + 1);
                for (const item of Object.values(value))
                    visit(item);
            }
        };
        visit(update);
        if ([...counts.values()].some((count) => count !== 1))
            return "The Brakemaw phase prefix event identity must be unique";
        return undefined;
    }
    function brakemawCountdownReason(input, context, expected, entry) {
        const owner = review.brakemawGuards;
        const reason = brakemawGuardReason(context, owner, expected.aliases);
        if (reason)
            return reason;
        const actor = context.inventory.scenes.find((scene) => scene.id === owner.sceneId).actors
            .find((actor) => actor.id === owner.actorId);
        const update = actor.updateScript;
        if (!Array.isArray(update))
            return "The Brakemaw countdown requires its original owner update";
        const counts = new Map();
        let duplicate = false, source;
        const visit = (value, callback) => {
            if (Array.isArray(value)) {
                for (const child of value)
                    visit(child, callback);
            }
            else if (isObject(value)) {
                callback(value);
                for (const child of Object.values(value))
                    visit(child, callback);
            }
        };
        visit(entry.graph, (value) => {
            if (typeof value.id !== "string")
                return;
            if (counts.has(value.id))
                duplicate = true;
            counts.set(value.id, 0);
        });
        visit(update, (value) => {
            if (typeof value.id !== "string")
                return;
            if (counts.has(value.id))
                counts.set(value.id, counts.get(value.id) + 1);
            if (value.id === entry.eventId)
                source = value;
        });
        if (duplicate || [...counts.values()].some((count) => count !== 1)) {
            return "The Brakemaw countdown source identities must be unique";
        }
        // Join the graph walker's current invocation to the same node inspected by
        // the compiler, rather than accepting another occurrence or a stale path.
        if (!context.event || (entry.path && !isDeepStrictEqual(context.event.branchPath, entry.path))) {
            return "The Brakemaw countdown invocation has a different source path";
        }
        let current = update;
        for (const segment of context.event.branchPath) {
            const parent = Array.isArray(current) && Number.isSafeInteger(segment.index)
                && segment.index >= 0 ? current[segment.index] : undefined;
            if (!isObject(parent) || parent.id !== segment.eventId || !isObject(parent.children)) {
                return "The Brakemaw countdown invocation has a different source path";
            }
            current = parent.children[segment.branch];
        }
        if (context.event.id !== entry.eventId || entry.graph.id !== entry.eventId
            || !Array.isArray(current) || (entry.index === undefined ? !current.includes(source) : current[entry.index] !== source)
            || !isDeepStrictEqual(source, entry.graph) || !isObject(entry.graph.args) || !isObject(entry.graph.children)
            || !isDeepStrictEqual(input, { kind: entry.graph.args.kind,
                true: entry.graph.children.true, false: entry.graph.children.false })) {
            return "The Brakemaw countdown requires its complete original source graph";
        }
        return undefined;
    }
    function extractMap(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const effects = new Effects(context);
        switch (input.operation) {
            case "pause":
            case "map":
                modalEffects(effects, true);
                return effects.result();
            case "saved":
                effects.access(VERIFY_READS, "read");
                modalEffects(effects, false);
                return effects.result();
            case "verifySave":
                effects.access(VERIFY_READS, "read");
                return effects.result(["false", "true"]);
            case "saveReady":
            case "loadVerified":
            case "loadRejected": return effects.result(["false", "true"]);
            case "abort":
            case "loaded": return effects.result(); // controls/private flags, no VM-global write
            case "newGame":
                effects.access(review.runtime?.newGameWrites ?? range(223, 584), "write");
                return effects.result();
            case "visible":
            case "collected":
                if (!Number.isInteger(input.markerId) || Number(input.markerId) < 0 || Number(input.markerId) > 31) {
                    return incomplete("The map marker must be an explicit integer 0..31");
                }
                if (input.operation === "visible" && !actorSlot(input, context)) {
                    return incomplete("Visible marker requires an explicit actual scene actor; no helper fallback is allowed");
                }
                markerEffects(effects, Number(input.markerId), input.operation === "visible");
                return effects.result();
            default: return incomplete("The map operation is absent or outside the reviewed native dispatch");
        }
    }
    // The two current Drive handlers pass the owning actor's sampled local INDEXES
    // on the VM stack. Local reads stay L0..L4 here so the graph binds the actual
    // owner; the temporary stack result is not a write to one of those variables.
    function enemyOwnerReason(context, actorId) {
        const reason = layoutReason(context);
        if (reason)
            return reason;
        const sceneId = review.enemyScenes?.[actorId];
        const room = review.rooms.find((room) => sceneId ? room.id === sceneId : room.symbol === "scene_drive_hall");
        if (!room)
            return "The native enemy's reviewed owning scene is missing";
        const scene = context.inventory.scenes.find((scene) => scene.id === room.id);
        const actor = scene.actors.find((actor) => actor.id === actorId);
        if (context.owner.resourceType !== "actor" || context.owner.sceneId !== room.id
            || context.owner.resourceId !== actorId || context.owner.resourcePath !== actor?.resourcePath) {
            return "The native enemy handler requires its exact reviewed owning scene actor";
        }
        return undefined;
    }
    function extractEnemyCondition(input, context) {
        const guards = review.brakemawGuards;
        if (guards && typeof input.kind === "string" && Object.hasOwn(guards.kinds, input.kind)) {
            if ((input.true !== undefined && !Array.isArray(input.true))
                || (input.false !== undefined && !Array.isArray(input.false))
                || (input.__disableElse !== undefined && typeof input.__disableElse !== "boolean")) {
                return incomplete("The Brakemaw guard requires event arrays and a boolean else control");
            }
            const guard = guards.kinds[input.kind];
            const reason = layoutReason(context) ?? brakemawGuardReason(context, guards, guard.aliases);
            if (reason)
                return incomplete(reason);
            if (guard.sites && !guard.sites.includes(context.event?.id ?? "")) {
                return incomplete("The Brakemaw predicate requires its original countdown event ID");
            }
            const prefixes = review.brakemawPhasePrefixes;
            const prefix = prefixes && Object.hasOwn(prefixes.entries, input.kind) ? prefixes.entries[input.kind] : undefined;
            if (prefix && context.event?.id === prefix.sites[0]) {
                const reason = brakemawPhasePrefixReason(input, context, prefixes, prefix);
                if (reason)
                    return incomplete(reason);
            }
            const countdowns = review.brakemawCountdownBatches;
            const countdown = countdowns?.entries.find((entry) => entry.eventId === context.event?.id);
            if (countdown) {
                const reason = brakemawCountdownReason(input, context, countdowns, countdown);
                if (reason)
                    return incomplete(reason);
            }
            const continuations = review.brakemawContinuations;
            const continuation = continuations?.entries.find((entry) => entry.eventId === context.event?.id);
            if (continuation) {
                const reason = brakemawCountdownReason(input, context, continuations, continuation);
                if (reason)
                    return incomplete(reason);
            }
            const effects = new Effects(context);
            effects.access(guard.aliases.map(({ id }) => id), "read");
            if (countdown)
                effects.access(countdowns.aliases.map(({ id }) => id), "read-write");
            if (continuation)
                effects.access(continuations.aliases.map(({ id }) => id), "read-write");
            // The result word is temporary. Only the source-bound batches above add a
            // persistent timer write; ordinary predicates remain read-only.
            return effects.result(input.__disableElse ? ["true"] : ["false", "true"]);
        }
        let actor, reads;
        const sampled = ["L0", "L1", "L3", "L4"];
        switch (input.kind) {
            case "sentryKeep":
                actor = "drive_guard";
                reads = ["0", "59", "92", ...sampled];
                break;
            case "sentryCommitted":
                actor = "drive_guard";
                reads = ["0", "59", "92", "150", "182", ...sampled];
                break;
            case "sentryTell":
                actor = "drive_guard";
                reads = ["0", "59", "92", "150", "181", "182", ...sampled];
                break;
            case "sentryArm":
                actor = "drive_guard";
                reads = ["0", "1", "181", "L2"];
                break;
            case "sentryReady":
                actor = "drive_guard";
                reads = ["0", "1", "60", "61", "150", "181", "182", "183"];
                break;
            case "skimmerKeep":
                actor = "drive_skimmer";
                reads = ["0", "53", "92", ...sampled];
                break;
            case "skimmerCommitted":
                actor = "drive_skimmer";
                reads = ["0", "53", "92", "150", "185", ...sampled];
                break;
            case "skimmerTell":
                actor = "drive_skimmer";
                reads = ["0", "53", "92", "150", "184", "185", ...sampled];
                break;
            case "skimmerArm":
                actor = "drive_skimmer";
                reads = ["0", "1", "184", "L2"];
                break;
            default: return incomplete("The Drive predicate kind is absent or outside the reviewed native dispatch");
        }
        const reason = enemyOwnerReason(context, actor);
        if (reason)
            return incomplete(reason);
        const effects = new Effects(context);
        effects.access(reads, "read");
        return effects.result(["false", "true"]);
    }
    function extractEnemyTick(input, context) {
        let actor, reads, writes;
        switch (input.kind) {
            case "sentry":
                actor = "drive_guard";
                reads = ["0", "1", "59", "60", "61", "92", "150"];
                writes = ["62", "63", "181", "182", "183", "209"];
                break;
            case "skimmer":
                actor = "drive_skimmer";
                reads = ["0", "1", "53", "54", "92", "150"];
                writes = ["56", "57", "184", "185", "210"];
                break;
            default: return incomplete("The Drive controller kind is absent or outside the reviewed native dispatch");
        }
        const reason = enemyOwnerReason(context, actor);
        if (reason)
            return incomplete(reason);
        if (review.driveCaptures) {
            const operation = input.operation === undefined ? "tick" : input.operation;
            if (operation !== "tick") {
                const expected = review.driveCaptures;
                if (input.kind !== "skimmer" || typeof operation !== "string" || !expected.order.includes(operation)) {
                    return incomplete("The Drive sampling operation is outside its reviewed skimmer dispatch");
                }
                const captureReason = driveCaptureReason(context, operation, expected);
                if (captureReason)
                    return incomplete(captureReason);
                if (operation !== "tick_packed") {
                    if (input.true !== undefined && (!Array.isArray(input.true) || input.true.length !== 0)) {
                        return incomplete("Drive samples cannot own an external action branch");
                    }
                    const effects = new Effects(context);
                    if (operation === "sample_player")
                        effects.access(["0", "1"], "write");
                    else if (operation === "sample_skimmer") {
                        effects.access(["54", "55"], "write");
                        effects.resources.push({ kind: "resource", type: "actor", id: expected.actorId,
                            sceneId: expected.sceneId, relation: "actor" });
                    }
                    else
                        effects.access([expected.fields[operation].local], "write");
                    return effects.result();
                }
            }
        }
        const effects = new Effects(context);
        if (review.skimmerProwl && input.kind === "skimmer")
            reads.push("55");
        effects.access([...reads, "L0", "L1", "L2", "L3", "L4"], "read");
        effects.access(writes, "read-write");
        // Direction/frame changes address the compiled actor slot. The existing
        // all-room actor union remains conservative when runtime scene differs.
        // Projectile launch/shot count and yielding MoveTo are authored child code,
        // not hidden direct native effects, and only the true branch is compiled.
        return effects.result(["true"]);
    }
    function driveCaptureReason(context, operation, expected) {
        const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
        const event = context.event;
        if (context.owner.resourceId !== expected.actorId || context.owner.sceneId !== expected.sceneId
            || context.owner.resourcePath !== expected.actorPath || context.owner.definitionPath !== undefined
            || event?.scriptKey !== "updateScript" || event.command !== "EVENT_WRECKLIGHT_ENEMY_TICK"
            || !Array.isArray(event.branchPath) || event.branchPath.length !== 1
            || event.branchPath[0]?.eventId !== expected.guardId || event.branchPath[0]?.branch !== "true"
            || event.branchPath[0]?.index !== 0) {
            return "Drive sampling requires the original dead guard in its direct actor update script";
        }
        const scene = context.inventory.scenes.find((scene) => scene.id === expected.sceneId);
        const actor = scene.actors.find((actor) => actor.id === expected.actorId);
        const guard = Array.isArray(actor.updateScript) ? actor.updateScript[0] : undefined;
        const branch = isObject(guard) && isObject(guard.children) ? guard.children.true : undefined;
        if (!isObject(guard) || guard.id !== expected.guardId || guard.command !== "EVENT_IF_EXPRESSION"
            || !isObject(guard.args) || guard.args.expression !== expected.guardExpression || guard.args.__comment
            || !Array.isArray(branch) || branch.length !== expected.order.length
            || branch.some((entry, index) => !isObject(entry) || typeof entry.id !== "string" || !entry.id
                || entry.command !== "EVENT_WRECKLIGHT_ENEMY_TICK" || !isObject(entry.args)
                || entry.args.kind !== "skimmer" || entry.args.operation !== expected.order[index] || entry.args.__comment)
            || new Set(branch.map((entry) => entry.id)).size !== branch.length
            || branch[expected.order.indexOf(operation)]?.id !== event.id) {
            return "Drive sampling must retain the original dead guard and eight-command sample order";
        }
        const scenes = context.inventory.scenes;
        if (scenes.some((scene) => scene._resourceType !== "scene" || typeof scene.type !== "string"
            || context.resourceFiles.filter((file) => file.type === "scene" && file.id === scene.id
                && file.path === scene.resourcePath).length !== 1)) {
            return "Drive sampling requires actual compiler-visible scenes with string scene types";
        }
        if (scenes.some((scene) => !Number.isSafeInteger(scene._index) || Number(scene._index) < 0)
            || new Set(scenes.map((scene) => scene._index)).size !== scenes.length
            || new Set(scenes.map((scene) => scene.id)).size !== scenes.length
            || new Set(scenes.map((scene) => scene.resourcePath)).size !== scenes.length) {
            return "Drive sampling requires unique scene identities and explicit nonnegative integer ordering";
        }
        const compiledScenes = [...scenes].sort((a, b) => Number(a._index) - Number(b._index))
            .filter((scene) => expected.enabledSceneTypes.includes(String(scene.type)));
        if (compiledScenes.findIndex((scene) => scene.id === expected.sceneId) !== expected.sceneIndex) {
            return "Drive sampling changed the compiled scene ordinal used by its local aliases";
        }
        const owners = context.resourceFiles.filter((file) => file.id === expected.actorId
            && ["scene", "actor", "trigger", "script"].includes(String(file.type)));
        if (owners.length !== 1 || owners[0].type !== "actor" || owners[0].path !== expected.actorPath) {
            return "Drive sampling requires a unique compiler-visible local-variable owner";
        }
        const actors = [...scene.actors].sort((a, b) => Number(a._index) - Number(b._index));
        const entityIndex = actors.findIndex((actor) => actor.id === expected.actorId);
        const fields = Object.values(expected.fields);
        // The exact engine.json and variables.gbsres bindings fix all five field
        // types, signed conversions, default local names and global aliases. Extra
        // engine/variable inputs are refused by the closed source profile. Check
        // every local here, as the compiler does even for a position-only sample.
        if (entityIndex !== expected.entityIndex || entityIndex + 1 !== expected.actorSlot || fields.length !== 5
            || ["L0", "L1", "L2", "L3", "L4"].some((local) => fields.filter((field) => field.local === local).length !== 1)
            || fields.some((field) => field.alias !== `VAR_${`S${expected.sceneIndex}A${entityIndex}_${field.localName}`
                .toUpperCase().replace(/[^A-Z0-9]/g, "_")}`)
            || expected.globalAliases.some(({ id, alias }) => review.variables.filter((variable) => variable.id === id && variable.symbol.toUpperCase() === alias).length !== 1)) {
            return "Drive sampling changed an owning local or sampled global alias";
        }
        return undefined;
    }
    function boundedNumber(value, first, last) {
        // These two handlers explicitly call Number; they do not receive editor
        // defaults. The immutable JSON input cannot supply executable coercions.
        try {
            const number = Number(value);
            return Number.isInteger(number) && number >= first && number <= last ? number : undefined;
        }
        catch {
            return undefined;
        }
    }
    function extractTitle(_input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const title = review.extendedEvents.title;
        if (context.owner.resourceType !== "scene" || context.owner.resourceId !== title.id
            || context.owner.sceneId !== title.id || context.owner.resourcePath !== title.resourcePath) {
            return incomplete("The title event requires its reviewed LOGO scene owner");
        }
        // Flags use JavaScript truthiness. Both branches compile regardless of the
        // flags; native choice stays on the stack. Load/reset belongs to children.
        return new Effects(context).result(["false", "true"]);
    }
    function extractAcquisition(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        if (boundedNumber(input.kind, 1, 17) === undefined)
            return incomplete("Acquisition requires an explicit reward kind 1..17");
        const sounds = review.extendedEvents.sounds;
        const references = input.references;
        // Extra discovery inputs are outside this maintained native asset closure.
        if (!Array.isArray(references) || references.length !== sounds.length
            || references.some((ref) => !ref || typeof ref !== "object" || Array.isArray(ref)
                || Object.keys(ref).some((key) => key !== "id" && key !== "type")
                || ref.type !== "sound" || !sounds.some((sound) => sound.id === ref.id))
            || sounds.some((sound) => references.filter((ref) => ref && typeof ref === "object"
                && !Array.isArray(ref) && ref.id === sound.id).length !== 1)) {
            return incomplete("Acquisition requires exactly its five reviewed sound references");
        }
        const effects = new Effects(context);
        effects.access(["8", "76", ...HUD_READS], "read");
        return effects.result(); // post-commit presentation, never a reward grant
    }
    function extractChamberPoll(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        if (boundedNumber(input.doorId, 51, 62) === undefined)
            return incomplete("Chamber polling requires an explicit door 51..62");
        const effects = new Effects(context);
        // The native call precedes the authored-ID comparison; do not narrow these
        // reads to a particular door. Pending-entry mutation is private, not VM state.
        effects.access(["8", "92", "59", "137"], "read");
        return effects.result(["false", "true"]);
    }
    function extractChamberVariables(_input, context) {
        const reason = layoutReason(context);
        return reason ? incomplete(reason) : new Effects(context).result();
    }
    const idleProfiles = {
        cargo_sentry: { room: 5, actor: "cargo_guard", slot: 5, reads: ["0", "65", "68", "92", "150"], phase: "69", writes: ["189", "190", "212"] },
        reactor_sentry: { room: 6, actor: "3fd19a9d-aa24-58ff-87b3-aa44b7f6960d", slot: 5,
            reads: ["92", "107", "110", "150", "155"], phase: "111", writes: ["195", "196", "197", "215"] },
        reactor_skimmer: { room: 6, actor: "be82ae00-8c09-53b3-bae0-887a6b3fc6d8", slot: 6,
            reads: ["92", "113", "116", "150", "155"], phase: "117", writes: ["198", "199", "216"] },
        lower_induction_sentinel: { room: 6, actor: "62cc5954-087c-57db-b5b7-054b83dd1660", slot: 10,
            reads: ["92", "150", "155", "166", "168"], phase: "167", writes: ["200", "201", "202", "217"] },
    };
    function extractIdle(input, context, cargo) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const profile = typeof input.profile === "string" && Object.hasOwn(idleProfiles, input.profile)
            ? idleProfiles[input.profile] : undefined;
        if (!profile || (profile.room === 5) !== cargo)
            return incomplete("The idle profile is absent or outside its reviewed dispatch");
        const room = review.rooms.find((room) => room.room === profile.room);
        const actor = context.inventory.scenes.find((scene) => scene.id === room.id).actors.find((actor) => actor.id === profile.actor);
        if (input.actorId !== profile.actor || actorSlot(input, context) !== profile.slot
            || context.owner.resourceType !== "actor" || context.owner.sceneId !== room.id
            || context.owner.resourceId !== profile.actor || context.owner.resourcePath !== actor?.resourcePath) {
            return incomplete("The idle handler requires its exact reviewed actor, native slot and owner");
        }
        const effects = new Effects(context);
        effects.access(profile.reads, "read");
        effects.access([profile.phase], "read-write");
        effects.access(profile.writes, "write");
        return effects.result(["false", "true"]);
    }
    function extractAirworksTick(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const expected = review.airworks;
        const profile = expected && typeof input.profile === "string" && Object.hasOwn(expected.profiles, input.profile)
            ? expected.profiles[input.profile] : undefined;
        if (!expected || !profile)
            return incomplete("The Airworks profile is absent or outside its reviewed dispatch");
        const actor = context.inventory.scenes.find((scene) => scene.id === expected.sceneId)
            ?.actors.find((actor) => actor.id === profile.actorId);
        if (input.actorId !== profile.actorId || actorSlot(input, context) !== profile.actorSlot
            || context.owner.resourceType !== "actor" || context.owner.sceneId !== expected.sceneId
            || context.owner.resourceId !== profile.actorId || context.owner.resourcePath !== actor?.resourcePath) {
            return incomplete("The Airworks handler requires its exact reviewed actor, native slot and owner");
        }
        const effects = new Effects(context);
        // Unlike the Drive tick, this call publishes the position/engine samples
        // itself before reading them. These are the owning actor's allocated locals,
        // not shared scratch. The action result stays on the six-word argument stack.
        const locals = ["L0", "L1", "L2", "L3", "L4"];
        effects.access([...profile.reads, ...locals], "read");
        effects.access([...profile.writes, ...locals], "write");
        // All continuations compile. Native dispatch can enter either movement,
        // then afterMove; the zero/unknown action skips all three. Movement, speed
        // and fresh post-yield death checks belong to the authored child events.
        return effects.result(["moveLeft", "moveRight", "afterMove"]);
    }
    function extractService(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        if (typeof input.panel !== "string" || !["service", "newGame", "saveError"].includes(input.panel))
            return incomplete("The service panel is absent or unreviewed");
        const effects = new Effects(context);
        if (input.panel !== "saveError")
            effects.access(["89"], "write");
        // Stock modal/menu loops render actors. The pinned actor patch records
        // visible markers: only the seen plane/marker word can change, no grants.
        effects.access(["582", "577"], "read");
        effects.access([...SEEN, "575"], "read-write");
        return effects.result();
    }
    function nativeActorReason(context, expected, command, scripts, label) {
        if (context.owner.resourceType !== "actor" || context.owner.resourceId !== expected.actorId
            || context.owner.resourcePath !== expected.actorPath || context.owner.sceneId !== expected.sceneId
            || context.owner.definitionPath !== undefined || context.event?.command !== command
            || !scripts.includes(context.event.scriptKey))
            return `${label} requires its direct reviewed actor script`;
        return nativeLocalOwnerReason(context, expected, label);
    }
    function paletteEffects(input, context, expected, owner, label) {
        if (input.paletteId !== expected.id || context.owner.resourceType !== "scene"
            || context.owner.resourceId !== owner.sceneId || context.owner.sceneId !== owner.sceneId
            || context.owner.resourcePath !== expected.scenePath || context.owner.definitionPath !== undefined
            || context.event?.scriptKey !== "script")
            return incomplete(`${label} requires its exact scene-start palette context`);
        const palettes = context.inventory.palettes.filter((palette) => palette.id === expected.id);
        const palette = palettes[0];
        if (palettes.length !== 1 || !palette || !Array.isArray(palette.colors) || palette.colors.length !== 4
            || palette.colors.some((color) => typeof color !== "string" || !/^[0-9a-f]{6}$/i.test(color))
            || context.resourceFiles.filter((file) => file.type === "palette" && file.id === expected.id
                && file.path === palette.resourcePath).length !== 1)
            return incomplete(`${label} requires one complete four-color palette`);
        const reason = nativeOwnerLayoutReason(context, owner, label);
        if (reason)
            return incomplete(reason);
        const effects = new Effects(context);
        effects.resources.push({ kind: "resource", type: "palette", id: expected.id, relation: "native-entry-palette" });
        return effects.result();
    }
    function nativeSpriteReason(context, owner, spriteId, frames, names) {
        const actor = context.inventory.scenes.find((scene) => scene.id === owner.sceneId)?.actors
            .find((entry) => entry.id === owner.actorId);
        const sprites = context.inventory.assets.filter((asset) => asset.id === spriteId && asset.type === "sprite");
        const sprite = sprites[0];
        const states = sprite?.states;
        if (actor?.spriteSheetId !== spriteId || sprites.length !== 1 || !sprite || sprite.canvasWidth !== 16 || sprite.canvasHeight !== 16
            || !Array.isArray(states) || states.length !== names.length
            || names.some((name) => states.filter((state) => state.name === name).length !== 1)
            || states.some((state) => state.animationType !== "fixed" || state.flipLeft !== false
                || !Array.isArray(state.animations) || !Array.isArray(state.animations[0]?.frames)
                || state.animations[0].frames.length !== frames)) {
            return "The native actor requires its reviewed sprite, directional states and frame layout";
        }
        return undefined;
    }
    function operationEffects(context, selected, owner) {
        const effects = new Effects(context);
        effects.access(selected.reads, "read");
        effects.access(selected.writes, "write");
        effects.resources.push({ kind: "resource", type: "actor", id: owner.actorId,
            sceneId: owner.sceneId, relation: "native-operation-actor" });
        return effects.result(selected.children);
    }
    function extractCargoCrawler(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const expected = review.cargoCrawler;
        if (!expected || input.actorId !== expected.actorId)
            return incomplete("The Cargo crawler requires its explicit actor");
        const spriteReason = nativeSpriteReason(context, expected, expected.spriteId, 16, [""]);
        if (spriteReason)
            return incomplete(spriteReason);
        if (input.operation === "palette_init")
            return paletteEffects(input, context, expected.palette, expected, "The Cargo crawler");
        if (typeof input.operation !== "string" || !Object.hasOwn(expected.operations, input.operation)) {
            return incomplete("The Cargo crawler operation is absent or unreviewed");
        }
        const ownerReason = nativeActorReason(context, expected, "EVENT_WRECKLIGHT_CARGO_CRAWLER", input.operation === "contact" ? ["script"]
            : input.operation === "hit" || input.operation === "pose" ? ["hit1Script"] : ["updateScript"], "The Cargo crawler");
        if (ownerReason)
            return incomplete(ownerReason);
        return operationEffects(context, expected.operations[input.operation], expected);
    }
    function extractReactorHunter(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const expected = review.reactorHunter;
        if (!expected)
            return incomplete("The Reactor hunter requires its opted-in source profile");
        const spriteReason = nativeSpriteReason(context, expected.hunter, expected.spriteId, 7, ["", "Left"]);
        if (spriteReason)
            return incomplete(spriteReason);
        if (input.operation === "palette_init")
            return paletteEffects(input, context, expected.palette, expected.hunter, "The Reactor hunter");
        if (typeof input.operation !== "string" || !Object.hasOwn(expected.operations, input.operation)) {
            return incomplete("The Reactor hunter operation is absent or unreviewed");
        }
        const owner = input.operation === "sentinel_claim" ? expected.sentinel : expected.hunter;
        if (input.actorId !== owner.actorId)
            return incomplete("The Reactor operation requires its explicit Hunter or Sentinel actor");
        for (const boundOwner of [expected.hunter, expected.sentinel]) {
            const reason = nativeLocalOwnerReason(context, boundOwner, "The Reactor hunter");
            if (reason)
                return incomplete(reason);
        }
        const scripts = input.operation === "hit_restore" ? ["hit1Script"]
            : input.operation === "present" ? ["startScript", "updateScript"] : ["updateScript"];
        const ownerReason = nativeActorReason(context, owner, "EVENT_WRECKLIGHT_REACTOR_HUNTER", scripts, "The Reactor hunter");
        if (ownerReason)
            return incomplete(ownerReason);
        return operationEffects(context, expected.operations[input.operation], owner);
    }
    function extractCrownPress(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const expected = review.crownPress;
        if (!expected || typeof input.operation !== "string" || !Object.hasOwn(expected.operations, input.operation)) {
            return incomplete("The Crown press operation is absent or unreviewed");
        }
        const ownerReason = nativeActorReason(context, expected, "EVENT_WRECKLIGHT_CROWN_PRESS", ["updateScript"], "The Crown press");
        if (ownerReason)
            return incomplete(ownerReason);
        const core = review.rooms.find((room) => room.id === expected.sceneId)?.actors.find((actor) => actor.id === expected.coreId);
        if (core?.slot !== expected.coreSlot)
            return incomplete("The Crown press requires its physical core actor");
        if (input.operation === "guard") {
            if (![7, 8, 9].includes(input.expectedPhase))
                return incomplete("The Crown press guard requires phase 7, 8 or 9");
        }
        else if (input.expectedPhase !== undefined || input.true !== undefined || input.false !== undefined) {
            return incomplete("Crown motion operations accept no phase or child branches");
        }
        const effects = operationEffects(context, expected.operations[input.operation], expected);
        if (effects.status === "complete")
            return { ...effects, effects: [...effects.effects,
                    { kind: "resource", type: "actor", id: expected.coreId, sceneId: expected.sceneId, relation: "native-moving-core" }] };
        return effects;
    }
    function extractCrownMotion(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const expected = review.crownMotion;
        if (!expected || typeof input.operation !== "string" || !Object.hasOwn(expected.operations, input.operation)
            || Object.keys(input).some((key) => key !== "operation" && key !== "__comment")) {
            return incomplete("The Crown early-motion operation is absent or unreviewed");
        }
        const ownerReason = nativeActorReason(context, expected, "EVENT_WRECKLIGHT_CROWN_MOTION", ["updateScript"], "The Crown early motion");
        if (ownerReason)
            return incomplete(ownerReason);
        const selected = expected.operations[input.operation];
        const effects = operationEffects(context, selected, expected);
        if (effects.status === "complete")
            return { ...effects, effects: [...effects.effects,
                    ...expected.relays.filter((relay) => selected.movingSlots.includes(relay.slot)).map((relay) => ({ kind: "resource", type: "actor", id: relay.id, sceneId: expected.sceneId, relation: "native-moving-relay" })),
                ] };
        return effects;
    }
    function extractWarden(input, context) {
        const reason = layoutReason(context);
        if (reason)
            return incomplete(reason);
        const expected = review.warden;
        const operation = input.operation;
        if (!expected || typeof operation !== "string" || !Object.hasOwn(expected.operations, operation)) {
            return incomplete("The Warden operation is absent or outside the reviewed operations");
        }
        const selected = expected.operations[operation];
        for (const key of selected.requiredChildren ?? []) {
            if (!Array.isArray(input[key]) || input[key].length === 0) {
                return incomplete(`The Warden committed action requires a nonempty authored child path: ${key}`);
            }
        }
        if (context.owner.sceneId !== expected.sceneId || (operation !== "init"
            && (context.owner.resourceType !== "actor" || context.owner.resourceId !== expected.actorId
                || context.owner.resourcePath !== expected.actorPath))) {
            return incomplete("The Warden operation requires its exact reviewed Deck scene and actor owner");
        }
        if ((operation === "sample_player" || operation === "sample_boss")
            && (context.event?.scriptKey !== "updateScript" || context.owner.definitionPath !== undefined)) {
            // Shared scripts retain the caller's graph context but are compiled and
            // cached separately. Only the direct actor-update context was reviewed.
            return incomplete("Warden position sampling requires its direct actor update script");
        }
        const captures = expected.captureBindings;
        const capture = captures && Object.hasOwn(captures.operations, operation) ? captures.operations[operation] : undefined;
        const packedTick = operation === "tick" && captures?.packTickArguments === true;
        const compositeTick = operation === "sample_and_tick" && captures?.sampleAndTick === true;
        if (operation === "sample_and_tick" && !compositeTick) {
            return incomplete("The Warden composite sampling operation requires its opted-in source profile");
        }
        const allCaptures = packedTick || compositeTick;
        const boundLocals = capture ? [capture] : allCaptures && captures ? Object.values(captures.operations) : [];
        if (captures && (capture || allCaptures)) {
            const bindingLabel = compositeTick ? "Warden composite sampling" : packedTick ? "Warden argument pack" : "Warden field sampling";
            if (allCaptures && (boundLocals.length !== 5
                || ["L0", "L1", "L2", "L3", "L4"].some((local) => !boundLocals.some((binding) => binding.local === local)))) {
                return incomplete("The Warden argument pack requires exactly the five owning local bindings");
            }
            if (context.event?.scriptKey !== "updateScript" || context.owner.definitionPath !== undefined
                || !Array.isArray(context.event.branchPath) || context.event.branchPath.length !== 0) {
                return incomplete(`${bindingLabel} requires the root of its direct actor update script`);
            }
            if (capture && wardenEventBranches.some((key) => input[key] !== undefined && !Array.isArray(input[key]))) {
                return incomplete(`${bindingLabel} has a malformed unused event branch`);
            }
            const scenes = context.inventory.scenes;
            // Inventory also recognizes scene.gbsres by filename, while the
            // compiler requires the resource discriminator. Such an inventory-only
            // entry must not pad the ordinal of the actual compiled scenes.
            if (scenes.some((scene) => scene._resourceType !== "scene" || typeof scene.type !== "string"
                || context.resourceFiles.filter((file) => file.type === "scene" && file.id === scene.id
                    && file.path === scene.resourcePath).length !== 1)) {
                return incomplete(`${bindingLabel} requires actual compiler-visible scenes with string scene types`);
            }
            // The compiler sorts loaded scenes, then removes disabled scene types.
            // Refuse coercions and ties instead of guessing its path-order fallback.
            if (scenes.some((scene) => !Number.isSafeInteger(scene._index) || Number(scene._index) < 0)
                || new Set(scenes.map((scene) => scene._index)).size !== scenes.length
                || new Set(scenes.map((scene) => scene.id)).size !== scenes.length
                || new Set(scenes.map((scene) => scene.resourcePath)).size !== scenes.length) {
                return incomplete(`${bindingLabel} requires unique scene identities and explicit nonnegative integer ordering`);
            }
            const compiledScenes = [...scenes].sort((a, b) => Number(a._index) - Number(b._index))
                .filter((scene) => captures.enabledSceneTypes.some((type) => type === scene.type));
            if (compiledScenes.findIndex((scene) => scene.id === expected.sceneId) !== captures.sceneIndex) {
                return incomplete(`${bindingLabel} changed the compiled scene ordinal used by its local aliases`);
            }
            // Local alias IDs use the entity ID without a scene qualifier. A second
            // owner could register an incompatible alias before this actor compiles.
            const owners = context.resourceFiles.filter((file) => file.id === expected.actorId
                && (file.type === "scene" || file.type === "actor" || file.type === "trigger" || file.type === "script"));
            if (owners.length !== 1 || owners[0].type !== "actor" || owners[0].path !== expected.actorPath) {
                return incomplete(`${bindingLabel} requires a unique compiler-visible local-variable owner`);
            }
            // layoutReason already proves the complete actor cohort and sprite
            // inclusion, so no actor is truncated or filtered from this ordering.
            const actors = [...compiledScenes[captures.sceneIndex].actors]
                .sort((a, b) => Number(a._index) - Number(b._index));
            const entityIndex = actors.findIndex((actor) => actor.id === expected.actorId);
            const aliasesMatch = boundLocals.every((binding) => {
                const alias = `VAR_${`S${captures.sceneIndex}A${entityIndex}_${binding.localName}`
                    .toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
                return alias === binding.alias;
            });
            // The exact bound variables file fixes the local names and excludes
            // global symbol collisions; inspection never runs the project compiler.
            if (entityIndex !== expected.actorSlot - 1 || !aliasesMatch) {
                return incomplete(`${bindingLabel} changed its owning local alias`);
            }
        }
        const effects = new Effects(context);
        effects.access([...selected.reads, ...selected.locals], "read");
        effects.access(selected.writes, "write");
        if (operation === "sample_boss" || compositeTick)
            effects.resources.push({ kind: "resource", type: "actor",
                id: expected.actorId, sceneId: expected.sceneId, relation: "actor" });
        return effects.result(selected.children);
    }
    const shared = {
        version,
        resolutionProfile: "gb-studio-4.3.2/project-event-exports/v1",
        compilerProfile: review.compiler,
        ...(review.compilerDependencies ? { compilerDependencies: review.compilerDependencies } : {}),
        closedDependencyPrefixes: ["plugins/", "assets/engine/"],
        closedResourceTypes: ["settings", "variables", "engineFieldValues"],
    };
    function contract(command, suffix, fields, extract) {
        const handler = review.project.find((binding) => binding.path.endsWith(suffix));
        if (!handler)
            throw new Error("Missing maintained Wrecklight handler binding");
        const id = `wrecklight-${command.slice("EVENT_WRECKLIGHT_".length).toLowerCase().replaceAll("_", "-")}${idSuffix}`;
        return { ...shared, id,
            command, handler, dependencies: review.project.filter((binding) => binding.path !== handler.path), fields, extract };
    }
    const contracts = [
        contract("EVENT_WRECKLIGHT_COMBAT", "/eventWrecklightCombat.js", [
            { key: "operation", type: "select", editorDefault: "hit" },
            ...(review.brakemawCaptureHeader ? [{ key: "fallback", type: "events" }] : []),
            ...(review.crownCountdown ? [
                { key: "expectedPhase", type: "number", editorDefault: 1 },
                { key: "maxFrames", type: "number", editorDefault: 32 },
            ] : []),
            { key: "actorId", type: "actor", editorDefault: "$self$" },
            { key: "rewardId", type: "number", editorDefault: 0 },
            { key: "true", type: "events" }, { key: "false", type: "events" },
        ], extractCombat),
        contract("EVENT_WRECKLIGHT_MAP", "/eventWrecklightMap.js", [
            { key: "operation", type: "select", editorDefault: "map" },
            { key: "markerId", type: "number", editorDefault: 0 },
            { key: "actorId", type: "actor", editorDefault: "$self$" },
            { key: "true", type: "events" }, { key: "false", type: "events" },
        ], extractMap),
        contract("EVENT_WRECKLIGHT_ENEMY_CONDITION", "/eventWrecklightEnemyCondition.js", [
            { key: "kind", type: "select", editorDefault: "sentryKeep" },
            ...(review.brakemawGuards ? [
                { key: "__disableElse", type: "checkbox" }, { key: "__collapseElse", type: "checkbox" },
                { key: "__label", type: "text" },
            ] : []),
            { key: "true", type: "events" }, { key: "false", type: "events" },
        ], extractEnemyCondition),
        contract("EVENT_WRECKLIGHT_ENEMY_TICK", "/eventWrecklightEnemyTick.js", [
            { key: "kind", type: "select", editorDefault: "sentry" },
            ...(review.driveCaptures ? [{ key: "operation", type: "select", editorDefault: "tick" }] : []),
            { key: "true", type: "events" },
        ], extractEnemyTick),
    ];
    if (review.extendedEvents)
        contracts.push(contract("EVENT_WRECKLIGHT_TITLE", "/eventWrecklightTitle.js", [
            { key: "hasSave", type: "checkbox", editorDefault: false }, { key: "loadRejected", type: "checkbox", editorDefault: false },
            { key: "true", type: "events" }, { key: "false", type: "events" },
        ], extractTitle), contract("EVENT_WRECKLIGHT_ACQUISITION", "/eventWrecklightAcquisition.js", [
            { key: "kind", type: "select", editorDefault: 1 }, { key: "references", type: "references" },
        ], extractAcquisition), contract("EVENT_WRECKLIGHT_CHAMBER_POLL", "/eventWrecklightChamberPoll.js", [
            { key: "doorId", type: "number", editorDefault: 51 }, { key: "true", type: "events" }, { key: "false", type: "events" },
        ], extractChamberPoll), contract("EVENT_WRECKLIGHT_CHAMBER_VARIABLES", "/eventWrecklightChamberVariables.js", [], extractChamberVariables), ...["CARGO", "REACTOR"].map((family) => contract(`EVENT_WRECKLIGHT_${family}_IDLE`, `/eventWrecklight${family === "CARGO" ? "Cargo" : "Reactor"}Idle.js`, [
            { key: "profile", type: "select" }, { key: "actorId", type: "actor", editorDefault: "$self$" },
            { key: "true", type: "events" }, { key: "false", type: "events" },
        ], (input, context) => extractIdle(input, context, family === "CARGO"))), contract("EVENT_WRECKLIGHT_SERVICE_UI", "/eventWrecklightService.js", [{ key: "panel", type: "select", editorDefault: "service" }], extractService));
    if (review.warden)
        contracts.push(contract("EVENT_WRECKLIGHT_WARDEN", "/eventWrecklightWarden.js", [
            { key: "operation", type: "select", editorDefault: "tick" },
            ...wardenEventBranches.map((key) => ({ key, type: "events" })),
        ], extractWarden));
    if (review.airworks)
        contracts.push(contract("EVENT_WRECKLIGHT_AIRWORKS_TICK", "/eventWrecklightAirworksTick.js", [
            { key: "profile", type: "select", editorDefault: "bellows" },
            { key: "actorId", type: "actor", editorDefault: "$self$" },
            { key: "moveLeft", type: "events" }, { key: "moveRight", type: "events" }, { key: "afterMove", type: "events" },
        ], extractAirworksTick));
    if (review.cargoCrawler)
        contracts.push(contract("EVENT_WRECKLIGHT_CARGO_CRAWLER", "/eventWrecklightCargoCrawler.js", [
            { key: "operation", type: "select", editorDefault: "tick" },
            { key: "actorId", type: "actor", editorDefault: "$self$" },
            { key: "paletteId", type: "palette", editorDefault: review.cargoCrawler.palette.id },
            { key: "lunge", type: "events" },
        ], extractCargoCrawler));
    if (review.reactorHunter)
        contracts.push(contract("EVENT_WRECKLIGHT_REACTOR_HUNTER", "/eventWrecklightReactorHunter.js", [
            { key: "operation", type: "select", editorDefault: "tick" },
            { key: "actorId", type: "actor", editorDefault: "$self$" },
            { key: "paletteId", type: "palette", editorDefault: review.reactorHunter.palette.id },
            ...review.reactorHunter.operations.tick.children.map((key) => ({ key, type: "events" })),
        ], extractReactorHunter));
    if (review.crownPress)
        contracts.push(contract("EVENT_WRECKLIGHT_CROWN_PRESS", "/eventWrecklightCrownPress.js", [
            { key: "operation", type: "select", editorDefault: "tick" },
            { key: "expectedPhase", type: "number", editorDefault: 7 },
            { key: "true", type: "events" }, { key: "false", type: "events" },
        ], extractCrownPress));
    if (review.crownMotion)
        contracts.push(contract("EVENT_WRECKLIGHT_CROWN_MOTION", "/eventWrecklightCrownMotion.js", [
            { key: "operation", type: "select", editorDefault: "tick" },
        ], extractCrownMotion));
    return contracts;
}
// r06 changes drawing/release order without changing native13's effect model.
// r31 separately binds its expanded map state, room/actor associations and combat
// effects. Share extractor logic, never alternative hashes or profile state.
const remixRemovedBindings = new Set(WRECKLIGHT_REMIX_SOURCE_REVIEW.removedProjectBindings);
export const WRECKLIGHT_REMIX_REVIEW = {
    ...WRECKLIGHT_CHAMBERS_REVIEW,
    project: [
        ...WRECKLIGHT_CHAMBERS_REVIEW.project.filter((binding) => !remixRemovedBindings.has(binding.path))
            .map((binding) => WRECKLIGHT_REMIX_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
        ...WRECKLIGHT_REMIX_SOURCE_REVIEW.additions,
    ],
    fixedRemixDescriptor: WRECKLIGHT_REMIX_SOURCE_REVIEW.fixedDescriptor,
    variables: [...WRECKLIGHT_CHAMBERS_REVIEW.variables, ...WRECKLIGHT_REMIX_SOURCE_REVIEW.additionalVariables],
    airworks: WRECKLIGHT_REMIX_SOURCE_REVIEW.airworks,
};
export const WRECKLIGHT_PERFORMANCE_REVIEW = {
    ...WRECKLIGHT_REMIX_REVIEW,
    project: WRECKLIGHT_REMIX_REVIEW.project.map((binding) => WRECKLIGHT_PERFORMANCE_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    combatGrace: true,
};
export const WRECKLIGHT_BUSYROOM_REVIEW = {
    ...WRECKLIGHT_PERFORMANCE_REVIEW,
    project: WRECKLIGHT_PERFORMANCE_REVIEW.project.map((binding) => WRECKLIGHT_BUSYROOM_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_BUSYROOM_SOURCE_REVIEW.fixedDescriptor,
};
export const WRECKLIGHT_PACING_REVIEW = {
    ...WRECKLIGHT_BUSYROOM_REVIEW,
    compilerDependencies: [
        ...WRECKLIGHT_BUSYROOM_REVIEW.compilerDependencies,
        ...WRECKLIGHT_PACING_SOURCE_REVIEW.compilerAdditions,
    ],
    project: [
        ...WRECKLIGHT_BUSYROOM_REVIEW.project.map((binding) => WRECKLIGHT_PACING_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
        ...WRECKLIGHT_PACING_SOURCE_REVIEW.additions,
    ],
    fixedRemixDescriptor: WRECKLIGHT_PACING_SOURCE_REVIEW.fixedDescriptor,
};
// Preserve the owner's semantic associations; only the reviewed Airworks and
// grace callbacks extend them. This is one complete source set, not hash alternatives.
const combinedRemovedBindings = new Set(WRECKLIGHT_COMBINED_SOURCE_REVIEW.removedProjectBindings);
export const WRECKLIGHT_COMBINED_REVIEW = {
    ...WRECKLIGHT_SEP17_REVIEW,
    project: [
        ...WRECKLIGHT_SEP17_REVIEW.project.filter((binding) => !combinedRemovedBindings.has(binding.path))
            .map((binding) => WRECKLIGHT_COMBINED_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
        ...WRECKLIGHT_COMBINED_SOURCE_REVIEW.additions,
    ],
    compilerDependencies: [
        ...WRECKLIGHT_SEP17_REVIEW.compilerDependencies,
        ...WRECKLIGHT_PACING_SOURCE_REVIEW.compilerAdditions,
    ],
    variables: [...WRECKLIGHT_SEP17_REVIEW.variables, ...WRECKLIGHT_REMIX_SOURCE_REVIEW.additionalVariables],
    airworks: WRECKLIGHT_REMIX_SOURCE_REVIEW.airworks,
    combatGrace: true,
    fixedRemixDescriptor: WRECKLIGHT_COMBINED_SOURCE_REVIEW.fixedDescriptor,
};
// The payoff keeps the combined native effects and structural associations.
// Source variants differ only in the exact inactive backup omitted by the sample.
export const WRECKLIGHT_PAYOFF_REVIEW = {
    ...WRECKLIGHT_COMBINED_REVIEW,
    project: WRECKLIGHT_COMBINED_REVIEW.project.map((binding) => WRECKLIGHT_PAYOFF_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_PAYOFF_SOURCE_REVIEW.fixedDescriptor,
};
const payoffCuratedOmittedBindings = new Set(WRECKLIGHT_PAYOFF_SOURCE_REVIEW.curatedOmittedBindings);
export const WRECKLIGHT_PAYOFF_CURATED_REVIEW = {
    ...WRECKLIGHT_PAYOFF_REVIEW,
    project: WRECKLIGHT_PAYOFF_REVIEW.project.filter((binding) => !payoffCuratedOmittedBindings.has(binding.path)),
};
// Position capture remains in the actor update's original VM slots. The two
// converters write only their named outputs; engine-render reads stay separate.
export const WRECKLIGHT_OVERLAY_REVIEW = {
    ...WRECKLIGHT_PAYOFF_REVIEW,
    project: WRECKLIGHT_PAYOFF_REVIEW.project.map((binding) => WRECKLIGHT_OVERLAY_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    compilerDependencies: [
        ...WRECKLIGHT_PAYOFF_REVIEW.compilerDependencies,
        ...WRECKLIGHT_OVERLAY_SOURCE_REVIEW.compilerAdditions,
    ],
    warden: {
        ...WRECKLIGHT_PAYOFF_REVIEW.warden,
        operations: {
            ...WRECKLIGHT_PAYOFF_REVIEW.warden.operations,
            sample_player: { reads: [], writes: ["0", "1"], locals: [], children: [] },
            sample_boss: { reads: [], writes: ["60", "61"], locals: [], children: [] },
        },
    },
    fixedRemixDescriptor: WRECKLIGHT_OVERLAY_SOURCE_REVIEW.fixedDescriptor,
};
const overlayCuratedOmittedBindings = new Set(WRECKLIGHT_OVERLAY_SOURCE_REVIEW.curatedOmittedBindings);
export const WRECKLIGHT_OVERLAY_CURATED_REVIEW = {
    ...WRECKLIGHT_OVERLAY_REVIEW,
    project: WRECKLIGHT_OVERLAY_REVIEW.project.filter((binding) => !overlayCuratedOmittedBindings.has(binding.path)),
};
// Preserve each engine-field read at its original VM command boundary. The
// native callbacks write only the one owning local described by each capture.
export const WRECKLIGHT_CAPTURE_REVIEW = {
    ...WRECKLIGHT_OVERLAY_REVIEW,
    project: WRECKLIGHT_OVERLAY_REVIEW.project.map((binding) => WRECKLIGHT_CAPTURE_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    warden: {
        ...WRECKLIGHT_OVERLAY_REVIEW.warden,
        captureBindings: WRECKLIGHT_CAPTURE_SOURCE_REVIEW.captureBindings,
        operations: {
            ...WRECKLIGHT_OVERLAY_REVIEW.warden.operations,
            sample_scroll_x: { reads: [], writes: ["L0"], locals: [], children: [] },
            sample_scroll_y: { reads: [], writes: ["L1"], locals: [], children: [] },
            sample_grounded: { reads: [], writes: ["L2"], locals: [], children: [] },
            sample_hud: { reads: [], writes: ["L3"], locals: [], children: [] },
            sample_death: { reads: [], writes: ["L4"], locals: [], children: [] },
        },
    },
    fixedRemixDescriptor: WRECKLIGHT_CAPTURE_SOURCE_REVIEW.fixedDescriptor,
};
const captureCuratedOmittedBindings = new Set(WRECKLIGHT_CAPTURE_SOURCE_REVIEW.curatedOmittedBindings);
export const WRECKLIGHT_CAPTURE_CURATED_REVIEW = {
    ...WRECKLIGHT_CAPTURE_REVIEW,
    project: WRECKLIGHT_CAPTURE_REVIEW.project.filter((binding) => !captureCuratedOmittedBindings.has(binding.path)),
};
// Renderer-only changes keep the exact capture callbacks, packed tick bindings
// and semantic associations. Partial source transfers match neither profile.
export const WRECKLIGHT_RENDER_REVIEW = {
    ...WRECKLIGHT_CAPTURE_REVIEW,
    project: WRECKLIGHT_CAPTURE_REVIEW.project.map((binding) => WRECKLIGHT_RENDER_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_RENDER_SOURCE_REVIEW.fixedDescriptor,
};
const renderCuratedOmittedBindings = new Set(WRECKLIGHT_RENDER_SOURCE_REVIEW.curatedOmittedBindings);
export const WRECKLIGHT_RENDER_CURATED_REVIEW = {
    ...WRECKLIGHT_RENDER_REVIEW,
    project: WRECKLIGHT_RENDER_REVIEW.project.filter((binding) => !renderCuratedOmittedBindings.has(binding.path)),
};
export const WRECKLIGHT_SCROLL_REVIEW = {
    ...WRECKLIGHT_RENDER_REVIEW,
    project: WRECKLIGHT_RENDER_REVIEW.project.map((binding) => WRECKLIGHT_SCROLL_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_SCROLL_SOURCE_REVIEW.fixedDescriptor,
};
const scrollCuratedOmittedBindings = new Set(WRECKLIGHT_SCROLL_SOURCE_REVIEW.curatedOmittedBindings);
export const WRECKLIGHT_SCROLL_CURATED_REVIEW = {
    ...WRECKLIGHT_SCROLL_REVIEW,
    project: WRECKLIGHT_SCROLL_REVIEW.project.filter((binding) => !scrollCuratedOmittedBindings.has(binding.path)),
};
// A single event owns the budgeted sampling prefix and separate native tick.
// Keep the older operations and profiles unchanged for existing authored games.
export const WRECKLIGHT_SAMPLING_REVIEW = {
    ...WRECKLIGHT_SCROLL_REVIEW,
    project: WRECKLIGHT_SCROLL_REVIEW.project.map((binding) => WRECKLIGHT_SAMPLING_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_SAMPLING_SOURCE_REVIEW.fixedDescriptor,
    warden: {
        ...WRECKLIGHT_SCROLL_REVIEW.warden,
        captureBindings: {
            ...WRECKLIGHT_SCROLL_REVIEW.warden.captureBindings,
            sampleAndTick: true,
        },
        operations: {
            ...WRECKLIGHT_SCROLL_REVIEW.warden.operations,
            sample_and_tick: {
                ...WRECKLIGHT_SCROLL_REVIEW.warden.operations.tick,
                writes: [
                    ...WRECKLIGHT_SCROLL_REVIEW.warden.operations.tick.writes,
                    ...WRECKLIGHT_SCROLL_REVIEW.warden.operations.sample_player.writes,
                    ...WRECKLIGHT_SCROLL_REVIEW.warden.operations.sample_boss.writes,
                    "L0", "L1", "L2", "L3", "L4",
                ],
            },
        },
    },
};
const samplingCuratedOmittedBindings = new Set(WRECKLIGHT_SAMPLING_SOURCE_REVIEW.curatedOmittedBindings);
export const WRECKLIGHT_SAMPLING_CURATED_REVIEW = {
    ...WRECKLIGHT_SAMPLING_REVIEW,
    project: WRECKLIGHT_SAMPLING_REVIEW.project.filter((binding) => !samplingCuratedOmittedBindings.has(binding.path)),
};
// Chamber caching changes only the exact C binding and save marker.
// The complete sampling contract and all historical profiles stay intact.
export const CHAMBER_CACHE_NATIVE = {
    ...WRECKLIGHT_SAMPLING_REVIEW,
    project: WRECKLIGHT_SAMPLING_REVIEW.project.map((binding) => WRECKLIGHT_CHAMBER_CACHE_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_CHAMBER_CACHE_SOURCE_REVIEW.fixedDescriptor,
};
const chamberCacheCuratedOmittedBindings = new Set(WRECKLIGHT_CHAMBER_CACHE_SOURCE_REVIEW.curatedOmittedBindings);
export const CHAMBER_CACHE_CURATED = {
    ...CHAMBER_CACHE_NATIVE,
    project: CHAMBER_CACHE_NATIVE.project.filter((binding) => !chamberCacheCuratedOmittedBindings.has(binding.path)),
};
// Bind the combined compiler override and projectile renderer with their own
// native save marker, directly preserving the released chamber-cache contract.
export const FLAT_PROJECTILE_NATIVE = {
    ...CHAMBER_CACHE_NATIVE,
    project: CHAMBER_CACHE_NATIVE.project.map((binding) => WRECKLIGHT_FLAT_PROJECTILE_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_FLAT_PROJECTILE_SOURCE_REVIEW.fixedDescriptor,
};
export const FLAT_PROJECTILE_CURATED = {
    ...CHAMBER_CACHE_CURATED,
    project: CHAMBER_CACHE_CURATED.project.map((binding) => WRECKLIGHT_FLAT_PROJECTILE_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_FLAT_PROJECTILE_SOURCE_REVIEW.fixedDescriptor,
};
function drivePerformanceBindings(base) {
    const replacements = WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW.replacements;
    return [...base.map((binding) => replacements.find((next) => next.path === binding.path) ?? binding),
        // Earlier profiles did not freeze this actor resource. This successor does
        // because the compiler's sample-order guard reads its complete update tree.
        ...replacements.filter((next) => !base.some((binding) => binding.path === next.path))];
}
export const DRIVE_PERFORMANCE_NATIVE = {
    ...FLAT_PROJECTILE_NATIVE,
    project: drivePerformanceBindings(FLAT_PROJECTILE_NATIVE.project),
    variables: [...FLAT_PROJECTILE_NATIVE.variables, ...WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW.additionalVariables],
    fixedRemixDescriptor: WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW.fixedDescriptor,
    driveCaptures: WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW.captureBindings,
};
export const DRIVE_PERFORMANCE_CURATED = {
    ...FLAT_PROJECTILE_CURATED,
    project: drivePerformanceBindings(FLAT_PROJECTILE_CURATED.project),
    variables: DRIVE_PERFORMANCE_NATIVE.variables,
    fixedRemixDescriptor: WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW.fixedDescriptor,
    driveCaptures: WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW.captureBindings,
};
function bossThreePhaseBindings(base) {
    const source = WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW;
    return [...base.map((binding) => source.replacements.find((next) => next.path === binding.path) ?? binding),
        ...source.additions];
}
// The boss source adds committed Warden actions and changes the synchronous
// combat predicates. Keep those semantics separate from released Drive games.
export const BOSS_THREE_PHASE_NATIVE = {
    ...DRIVE_PERFORMANCE_NATIVE,
    project: bossThreePhaseBindings(DRIVE_PERFORMANCE_NATIVE.project),
    variables: [...DRIVE_PERFORMANCE_NATIVE.variables, ...WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.additionalVariables],
    fixedRemixDescriptor: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.fixedDescriptor,
    targets: DRIVE_PERFORMANCE_NATIVE.targets.map((target) => target.room === 9 && target.slot === 5
        ? { ...target, hitReadWrites: ["141"] }
        : target.room === 11 && target.slot === 7 ? { ...target, dead: "98" } : target),
    combatContactReads: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.combatContactReads,
    crownCountdown: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.crownCountdown,
    brakemawGuards: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.brakemawGuards,
    nativeSprites: [...DRIVE_PERFORMANCE_NATIVE.nativeSprites, WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.sprite],
    warden: {
        ...DRIVE_PERFORMANCE_NATIVE.warden,
        spriteId: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.sprite.id,
        stateId: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.stateId,
        frameCount: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.frameCount,
        operations: {
            ...DRIVE_PERFORMANCE_NATIVE.warden.operations,
            tick: {
                ...DRIVE_PERFORMANCE_NATIVE.warden.operations.tick,
                children: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.requiredChildren,
                requiredChildren: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.requiredChildren,
            },
            sample_and_tick: {
                ...DRIVE_PERFORMANCE_NATIVE.warden.operations.sample_and_tick,
                children: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.requiredChildren,
                requiredChildren: WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW.warden.requiredChildren,
            },
        },
    },
};
export const BOSS_THREE_PHASE_CURATED = {
    ...BOSS_THREE_PHASE_NATIVE,
    project: bossThreePhaseBindings(DRIVE_PERFORMANCE_CURATED.project),
};
function bossCueBindings(base) {
    const replacements = WRECKLIGHT_BOSS_CUE_SOURCE_REVIEW.replacements;
    return [...base.map((binding) => replacements.find((next) => next.path === binding.path) ?? binding),
        // Freeze the accepted six sites as well as their C and event handler.
        ...replacements.filter((next) => !base.some((binding) => binding.path === next.path))];
}
export const BOSS_CUE_NATIVE = {
    ...BOSS_THREE_PHASE_NATIVE,
    project: bossCueBindings(BOSS_THREE_PHASE_NATIVE.project),
    fixedRemixDescriptor: WRECKLIGHT_BOSS_CUE_SOURCE_REVIEW.fixedDescriptor,
    brakemawGuards: {
        ...BOSS_THREE_PHASE_NATIVE.brakemawGuards,
        kinds: { ...BOSS_THREE_PHASE_NATIVE.brakemawGuards.kinds, ...WRECKLIGHT_BOSS_CUE_SOURCE_REVIEW.kinds },
    },
};
export const BOSS_CUE_CURATED = {
    ...BOSS_CUE_NATIVE,
    project: bossCueBindings(BOSS_THREE_PHASE_CURATED.project),
};
function bossLoopBindings(base) {
    const source = WRECKLIGHT_BOSS_LOOP_SOURCE_REVIEW;
    return [...base.map((binding) => source.replacements.find((next) => next.path === binding.path) ?? binding),
        ...source.additions];
}
// This separately selected source profile describes the prospective combined
// loop. It does not replace the released cue profile or imply native acceptance.
export const BOSS_LOOP_NATIVE = {
    ...BOSS_CUE_NATIVE,
    project: bossLoopBindings(BOSS_CUE_NATIVE.project),
    fixedRemixDescriptor: WRECKLIGHT_BOSS_LOOP_SOURCE_REVIEW.fixedDescriptor,
    brakemawGuards: {
        ...BOSS_CUE_NATIVE.brakemawGuards,
        kinds: { ...BOSS_CUE_NATIVE.brakemawGuards.kinds, ...WRECKLIGHT_BOSS_LOOP_SOURCE_REVIEW.kinds },
    },
    brakemawOperations: WRECKLIGHT_BOSS_LOOP_SOURCE_REVIEW.operations,
};
export const BOSS_LOOP_CURATED = {
    ...BOSS_LOOP_NATIVE,
    project: bossLoopBindings(BOSS_CUE_CURATED.project),
};
function bossCapturePrefixBindings(base) {
    return base.map((binding) => WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW.replacements
        .find((next) => next.path === binding.path) ?? binding);
}
// Additive implementation preparation: earlier loop/cue contracts keep their
// exact source identities. This profile makes no runtime acceptance claim.
export const BOSS_CAPTURE_PREFIX_NATIVE = {
    ...BOSS_LOOP_NATIVE,
    project: bossCapturePrefixBindings(BOSS_LOOP_NATIVE.project),
    variables: [...BOSS_LOOP_NATIVE.variables, ...WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW.additionalVariables],
    fixedRemixDescriptor: WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW.fixedDescriptor,
    brakemawCaptureHeader: WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW.captureHeader,
    brakemawPhasePrefixes: WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW.phasePrefixes,
};
export const BOSS_CAPTURE_PREFIX_CURATED = {
    ...BOSS_CAPTURE_PREFIX_NATIVE,
    project: bossCapturePrefixBindings(BOSS_LOOP_CURATED.project),
};
function schedulerCountdownBindings(base) {
    return base.map((binding) => WRECKLIGHT_SCHEDULER_COUNTDOWN_SOURCE_REVIEW.replacements
        .find((next) => next.path === binding.path) ?? binding);
}
// Isolated five-file tuple; prior capture/prefix profiles remain exact. Keep the
// production descriptor and startup until a separately accepted release binds them.
export const BOSS_SCHEDULER_COUNTDOWN_NATIVE = {
    ...BOSS_CAPTURE_PREFIX_NATIVE,
    project: schedulerCountdownBindings(BOSS_CAPTURE_PREFIX_NATIVE.project),
    brakemawCountdownBatches: WRECKLIGHT_SCHEDULER_COUNTDOWN_SOURCE_REVIEW.countdown,
};
export const BOSS_SCHEDULER_COUNTDOWN_CURATED = {
    ...BOSS_SCHEDULER_COUNTDOWN_NATIVE,
    project: schedulerCountdownBindings(BOSS_CAPTURE_PREFIX_CURATED.project),
};
function brakemawTimerBindings(base) {
    return base.map((binding) => WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW.replacements
        .find((next) => next.path === binding.path) ?? binding);
}
function withTimerSites(prior, added) {
    return { ...prior, sites: [...prior.sites, ...added] };
}
// These ordinary calls preserve their individual branches and variable effects.
// The existing three countdown batches and every historical tuple stay intact.
export const BRAKEMAW_TIMERS_NATIVE = {
    ...BOSS_SCHEDULER_COUNTDOWN_NATIVE,
    project: brakemawTimerBindings(BOSS_SCHEDULER_COUNTDOWN_NATIVE.project),
    brakemawGuards: {
        ...BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawGuards,
        kinds: {
            ...BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawGuards.kinds,
            brakemawCueContinue: withTimerSites(BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawGuards.kinds.brakemawCueContinue, WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW.ordinarySites.brakemawCueContinue),
            brakemawCueFlash: withTimerSites(BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawGuards.kinds.brakemawCueFlash, WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW.ordinarySites.brakemawCueFlash),
            brakemawCuePose: withTimerSites(BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawGuards.kinds.brakemawCuePose, WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW.ordinarySites.brakemawCuePose),
        },
    },
    brakemawOperations: {
        ...BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawOperations,
        brakemawCueDecrement: withTimerSites(BOSS_SCHEDULER_COUNTDOWN_NATIVE.brakemawOperations.brakemawCueDecrement, WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW.ordinarySites.brakemawCueDecrement),
    },
};
export const BRAKEMAW_TIMERS_CURATED = {
    ...BRAKEMAW_TIMERS_NATIVE,
    project: brakemawTimerBindings(BOSS_SCHEDULER_COUNTDOWN_CURATED.project),
};
// The opening-direction freeze is one complete curated successor, including
// both its original and new room artwork associations. Historical tuples retain
// their own handler, descriptor, room membership, and event semantics.
export const OPENING_DIRECTION_NATIVE = {
    ...BRAKEMAW_TIMERS_CURATED,
    project: BRAKEMAW_TIMERS_CURATED.project.map((binding) => WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.fixedDescriptor,
    variables: [...BRAKEMAW_TIMERS_CURATED.variables, ...WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.additionalVariables],
    rooms: BRAKEMAW_TIMERS_CURATED.rooms.map((room) => {
        const added = WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.rooms.find((addition) => addition.sceneId === room.id);
        return added ? { ...room, actors: [...room.actors, added.actor] } : room;
    }),
    targets: [...BRAKEMAW_TIMERS_CURATED.targets, ...WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.targets],
    combatContactReads: [...BRAKEMAW_TIMERS_CURATED.combatContactReads,
        ...WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.combatContactReads],
    backgrounds: BRAKEMAW_TIMERS_CURATED.backgrounds.map((background) => {
        const added = WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.backgrounds.find((addition) => addition.sceneId === background.sceneId);
        return added ? { ...background, alternatives: [...(background.alternatives ?? []),
                { id: added.id, metadataPath: added.metadataPath }] } : background;
    }),
    brakemawGuards: {
        ...BRAKEMAW_TIMERS_CURATED.brakemawGuards,
        kinds: {
            ...BRAKEMAW_TIMERS_CURATED.brakemawGuards.kinds,
            brakemawPhaseEq14: { ...BRAKEMAW_TIMERS_CURATED.brakemawGuards.kinds.brakemawPhaseEq14,
                sites: WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.phaseSites.brakemawPhaseEq14 },
            brakemawPhaseEq24: { ...BRAKEMAW_TIMERS_CURATED.brakemawGuards.kinds.brakemawPhaseEq24,
                sites: WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.phaseSites.brakemawPhaseEq24 },
        },
    },
    brakemawContinuations: WRECKLIGHT_OPENING_DIRECTION_SOURCE_REVIEW.continuations,
};
// Keep the original opening tuple intact. This successor binds the corrected
// presentation and descriptor, and admits only the named Airworks alternative.
export const OPENING_CORRECTION_NATIVE = {
    ...OPENING_DIRECTION_NATIVE,
    project: OPENING_DIRECTION_NATIVE.project.map((binding) => WRECKLIGHT_OPENING_CORRECTION_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    fixedRemixDescriptor: WRECKLIGHT_OPENING_CORRECTION_SOURCE_REVIEW.fixedDescriptor,
    backgrounds: OPENING_DIRECTION_NATIVE.backgrounds.map((background) => {
        const added = WRECKLIGHT_OPENING_CORRECTION_SOURCE_REVIEW.backgrounds.find((entry) => entry.sceneId === background.sceneId);
        return added ? { ...background, alternatives: [...(background.alternatives ?? []),
                { id: added.id, metadataPath: added.metadataPath }] } : background;
    }),
};
// This source tuple adds the reviewed native cache/rendering changes without
// changing the opening layout, descriptor, compiler or authored VM effects.
export const COMBINED_PERFORMANCE_NATIVE = {
    ...OPENING_CORRECTION_NATIVE,
    project: OPENING_CORRECTION_NATIVE.project.map((binding) => WRECKLIGHT_COMBINED_PERFORMANCE_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
    engineRenderReads: WRECKLIGHT_COMBINED_PERFORMANCE_SOURCE_REVIEW.engineRenderReads,
};
// Retain the exact-scroll Lens invariant and clearer map legend without
// changing event effects, scene ownership, the compiler or earlier copies.
export const KEEP_VIEW_MAP_NATIVE = {
    ...COMBINED_PERFORMANCE_NATIVE,
    project: COMBINED_PERFORMANCE_NATIVE.project.map((binding) => WRECKLIGHT_KEEP_VIEW_MAP_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
};
// Source-contract review only: keep the compiler, capture order, VM effects,
// layout checks and all previous source tuples unchanged. Native review is separate.
export const GAMEPLAY_POLISH_NATIVE = {
    ...KEEP_VIEW_MAP_NATIVE,
    project: KEEP_VIEW_MAP_NATIVE.project.map((binding) => WRECKLIGHT_GAMEPLAY_POLISH_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
};
// Full authored source keeps one exact historical backup that the compact
// sample omits. Neither shape accepts an arbitrary additional engine input.
export const GAMEPLAY_POLISH_SOURCE_NATIVE = {
    ...GAMEPLAY_POLISH_NATIVE,
    project: [...GAMEPLAY_POLISH_NATIVE.project, ...WRECKLIGHT_GAMEPLAY_POLISH_SOURCE_REVIEW.sourceAdditions],
};
// Preserve the released gameplay tuple. Only the complete reviewed Warden/row
// successor is admitted; event semantics, compiler and metadata guards stay fixed.
export const WARDEN_ROW_NATIVE = {
    ...GAMEPLAY_POLISH_NATIVE,
    project: GAMEPLAY_POLISH_NATIVE.project.map((binding) => WRECKLIGHT_WARDEN_ROW_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
};
export const WARDEN_ROW_SOURCE_NATIVE = {
    ...WARDEN_ROW_NATIVE,
    project: [...WARDEN_ROW_NATIVE.project, ...WRECKLIGHT_GAMEPLAY_POLISH_SOURCE_REVIEW.sourceAdditions],
};
// The composed sample is a distinct source tuple. Preserve the historical P
// profiles; no unselected backup-file variant is introduced for this snapshot.
const composed = WRECKLIGHT_COMPOSED_GAMEPLAY_SOURCE_REVIEW;
const composedBindings = [...composed.replacements, ...composed.additions];
export const COMPOSED_GAMEPLAY_NATIVE = {
    ...WARDEN_ROW_NATIVE,
    project: [
        ...WARDEN_ROW_NATIVE.project.map((binding) => composedBindings.find((next) => next.path === binding.path) ?? binding),
        ...composed.additions.filter((next) => !WARDEN_ROW_NATIVE.project.some((binding) => binding.path === next.path)),
    ],
    variables: [...WARDEN_ROW_NATIVE.variables,
        ...composed.additionalVariables.filter((next) => !WARDEN_ROW_NATIVE.variables.some((variable) => variable.id === next.id))],
    nativeSprites: [...WARDEN_ROW_NATIVE.nativeSprites, ...composed.nativeSprites],
    cargoCrawler: composed.cargoCrawler,
    reactorHunter: composed.reactorHunter,
    crownPress: composed.crownPress,
    engineLocalReads: composed.engineLocalReads,
    engineRenderReads: [...new Set([...WARDEN_ROW_NATIVE.engineRenderReads, ...composed.engineRenderReads])],
    combatContactReads: [...new Set([...WARDEN_ROW_NATIVE.combatContactReads, ...composed.combatContactReads])],
    skimmerProwl: true,
    warden: {
        ...WARDEN_ROW_NATIVE.warden,
        operations: {
            ...WARDEN_ROW_NATIVE.warden.operations,
            ...composed.wardenOperations,
            tick: { ...WARDEN_ROW_NATIVE.warden.operations.tick,
                children: composed.wardenBranches, requiredChildren: composed.wardenBranches },
            sample_and_tick: { ...WARDEN_ROW_NATIVE.warden.operations.sample_and_tick,
                children: composed.wardenBranches, requiredChildren: composed.wardenBranches },
            after_move: { ...WARDEN_ROW_NATIVE.warden.operations.after_move, reads: ["8", "21", "58", "59", "62", "63"] },
            contact: { ...WARDEN_ROW_NATIVE.warden.operations.contact, reads: ["8", "21", "58", "59", "63"] },
            hit: { ...WARDEN_ROW_NATIVE.warden.operations.hit, reads: ["8", "21", "58", "59", "63"] },
        },
    },
};
// Camera and warning follow-up. Event operations and authored branches are
// unchanged; only the complete native tuple and camera-hook reads differ.
const brakemawFinish = WRECKLIGHT_BRAKEMAW_FINISH_SOURCE_REVIEW;
export const BRAKEMAW_FINISH_NATIVE = {
    ...COMPOSED_GAMEPLAY_NATIVE,
    project: [
        ...COMPOSED_GAMEPLAY_NATIVE.project.map((binding) => brakemawFinish.bindings.find((next) => next.path === binding.path) ?? binding),
        ...brakemawFinish.bindings.filter((next) => !COMPOSED_GAMEPLAY_NATIVE.project.some((binding) => binding.path === next.path)),
    ],
    engineRenderReads: [...new Set([...COMPOSED_GAMEPLAY_NATIVE.engineRenderReads, ...brakemawFinish.engineRenderReads])],
};
// The new motion hook owns only its added native accesses and relay guards.
// Earlier profiles and the stage-III press contract retain their exact source.
const crownMotion = WRECKLIGHT_CROWN_MOTION_SOURCE_REVIEW;
export const CROWN_MOTION_NATIVE = {
    ...BRAKEMAW_FINISH_NATIVE,
    project: [
        ...BRAKEMAW_FINISH_NATIVE.project.map((binding) => crownMotion.bindings.find((next) => next.path === binding.path) ?? binding),
        ...crownMotion.bindings.filter((next) => !BRAKEMAW_FINISH_NATIVE.project.some((binding) => binding.path === next.path)),
    ],
    crownMotion: {
        ...BRAKEMAW_FINISH_NATIVE.crownPress,
        globalAliases: BRAKEMAW_FINISH_NATIVE.crownPress.globalAliases.filter(({ id }) => id !== "97"),
        relays: crownMotion.relays,
        operations: crownMotion.operations,
    },
};
// Permit relocated Brakemaw locals only with both reviewed guard replacements.
// Keep the Crown motion tuple and all earlier profiles unchanged.
export const BRAKEMAW_CAPTURE_LAYOUT_NATIVE = {
    ...CROWN_MOTION_NATIVE,
    project: CROWN_MOTION_NATIVE.project.map((binding) => WRECKLIGHT_BRAKEMAW_CAPTURE_LAYOUT_SOURCE_REVIEW.replacements.find((next) => next.path === binding.path) ?? binding),
};
export const CARGO_CONTACT_NATIVE = {
    ...BRAKEMAW_CAPTURE_LAYOUT_NATIVE,
    project: BRAKEMAW_CAPTURE_LAYOUT_NATIVE.project.map((binding) => cargoContact.replacements.find((next) => next.path === binding.path) ?? binding),
    cargoCrawler: {
        ...BRAKEMAW_CAPTURE_LAYOUT_NATIVE.cargoCrawler,
        globalAliases: [...BRAKEMAW_CAPTURE_LAYOUT_NATIVE.cargoCrawler.globalAliases, ...cargoContact.additionalGlobalAliases],
        operations: { ...BRAKEMAW_CAPTURE_LAYOUT_NATIVE.cargoCrawler.operations, contact: cargoContact.contact },
    },
};
// Spawn and endpoint contacts use the same Combat routine and native read sets.
// Deferred hit consumption stays on the authored event; contact adds no VM writes.
// Preserve Cargo and every earlier tuple as independently selectable history.
export const PROJECTILE_SPAWN_CONTACT_NATIVE = {
    ...CARGO_CONTACT_NATIVE,
    project: CARGO_CONTACT_NATIVE.project.map((binding) => projectileSpawnContact.replacements.find((next) => next.path === binding.path) ?? binding),
};
const nativeContractGroups = [
    { review: WRECKLIGHT_REVIEW, contracts: nativeContracts(WRECKLIGHT_REVIEW, "-native-v1") },
    { review: WRECKLIGHT_DOOR_REVIEW, contracts: nativeContracts(WRECKLIGHT_DOOR_REVIEW, "-native-r06-v1") },
    { review: WRECKLIGHT_CURRENT_REVIEW, contracts: nativeContracts(WRECKLIGHT_CURRENT_REVIEW, "-native-r31-v1") },
    { review: WRECKLIGHT_WARDEN_REVIEW, contracts: nativeContracts(WRECKLIGHT_WARDEN_REVIEW, "-native-r36-v1") },
    { review: WRECKLIGHT_WARDEN_CUE_REVIEW, contracts: nativeContracts(WRECKLIGHT_WARDEN_CUE_REVIEW, "-native-r37-v1") },
    { review: WRECKLIGHT_WARDEN_FEEDBACK_REVIEW, contracts: nativeContracts(WRECKLIGHT_WARDEN_FEEDBACK_REVIEW, "-native-feedback-v1") },
    { review: WRECKLIGHT_WARDEN_CONDENSER_REVIEW, contracts: nativeContracts(WRECKLIGHT_WARDEN_CONDENSER_REVIEW, "-native-condenser-v1") },
    { review: WRECKLIGHT_WARDEN_ROM44_REVIEW, contracts: nativeContracts(WRECKLIGHT_WARDEN_ROM44_REVIEW, "-native-r44-v1") },
    { review: WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW, contracts: nativeContracts(WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW, "-native-dynamo-beam-v1") },
    { review: WRECKLIGHT_CHAMBERS_REVIEW, contracts: nativeContracts(WRECKLIGHT_CHAMBERS_REVIEW, "-native-chambers-v1") },
    { review: WRECKLIGHT_SEP17_REVIEW, contracts: nativeContracts(WRECKLIGHT_SEP17_REVIEW, "-native-sep17-v1", 3) },
    { review: WRECKLIGHT_REMIX_REVIEW, contracts: nativeContracts(WRECKLIGHT_REMIX_REVIEW, "-native-remix-v1") },
    { review: WRECKLIGHT_PERFORMANCE_REVIEW, contracts: nativeContracts(WRECKLIGHT_PERFORMANCE_REVIEW, "-native-performance-v1") },
    { review: WRECKLIGHT_BUSYROOM_REVIEW, contracts: nativeContracts(WRECKLIGHT_BUSYROOM_REVIEW, "-native-busyroom-v1") },
    { review: WRECKLIGHT_PACING_REVIEW, contracts: nativeContracts(WRECKLIGHT_PACING_REVIEW, "-native-pacing-v1") },
    { review: WRECKLIGHT_COMBINED_REVIEW, contracts: nativeContracts(WRECKLIGHT_COMBINED_REVIEW, "-native-combined-v1", 3) },
    { review: WRECKLIGHT_PAYOFF_REVIEW, contracts: nativeContracts(WRECKLIGHT_PAYOFF_REVIEW, "-native-payoff-v1", 3) },
    { review: WRECKLIGHT_PAYOFF_CURATED_REVIEW, contracts: nativeContracts(WRECKLIGHT_PAYOFF_CURATED_REVIEW, "-native-payoff-curated-v1", 3) },
    { review: WRECKLIGHT_OVERLAY_REVIEW, contracts: nativeContracts(WRECKLIGHT_OVERLAY_REVIEW, "-native-overlay-v1", 3) },
    { review: WRECKLIGHT_OVERLAY_CURATED_REVIEW, contracts: nativeContracts(WRECKLIGHT_OVERLAY_CURATED_REVIEW, "-native-overlay-curated-v1", 3) },
    { review: WRECKLIGHT_CAPTURE_REVIEW, contracts: nativeContracts(WRECKLIGHT_CAPTURE_REVIEW, "-native-capture-v1", 3) },
    { review: WRECKLIGHT_CAPTURE_CURATED_REVIEW, contracts: nativeContracts(WRECKLIGHT_CAPTURE_CURATED_REVIEW, "-native-capture-curated-v1", 3) },
    { review: WRECKLIGHT_RENDER_REVIEW, contracts: nativeContracts(WRECKLIGHT_RENDER_REVIEW, "-native-render-v1", 3) },
    { review: WRECKLIGHT_RENDER_CURATED_REVIEW, contracts: nativeContracts(WRECKLIGHT_RENDER_CURATED_REVIEW, "-native-render-curated-v1", 3) },
    { review: WRECKLIGHT_SCROLL_REVIEW, contracts: nativeContracts(WRECKLIGHT_SCROLL_REVIEW, "-native-scroll-v1", 3) },
    { review: WRECKLIGHT_SCROLL_CURATED_REVIEW, contracts: nativeContracts(WRECKLIGHT_SCROLL_CURATED_REVIEW, "-native-scroll-curated-v1", 3) },
    { review: WRECKLIGHT_SAMPLING_REVIEW, contracts: nativeContracts(WRECKLIGHT_SAMPLING_REVIEW, "-native-sampling-v1", 3) },
    { review: WRECKLIGHT_SAMPLING_CURATED_REVIEW, contracts: nativeContracts(WRECKLIGHT_SAMPLING_CURATED_REVIEW, "-native-sampling-curated-v1", 3) },
    { review: CHAMBER_CACHE_NATIVE, contracts: nativeContracts(CHAMBER_CACHE_NATIVE, "-native-chamber-cache-v1", 3) },
    { review: CHAMBER_CACHE_CURATED, contracts: nativeContracts(CHAMBER_CACHE_CURATED, "-native-chamber-cache-curated-v1", 3) },
    { review: FLAT_PROJECTILE_NATIVE, contracts: nativeContracts(FLAT_PROJECTILE_NATIVE, "-native-flat-projectile-v1", 3) },
    { review: FLAT_PROJECTILE_CURATED, contracts: nativeContracts(FLAT_PROJECTILE_CURATED, "-native-flat-projectile-curated-v1", 3) },
    { review: DRIVE_PERFORMANCE_NATIVE, contracts: nativeContracts(DRIVE_PERFORMANCE_NATIVE, "-native-drive-performance-v1", 3) },
    { review: DRIVE_PERFORMANCE_CURATED, contracts: nativeContracts(DRIVE_PERFORMANCE_CURATED, "-native-drive-performance-curated-v1", 3) },
    { review: BOSS_THREE_PHASE_NATIVE, contracts: nativeContracts(BOSS_THREE_PHASE_NATIVE, "-native-boss-three-phase-v1", 3) },
    { review: BOSS_THREE_PHASE_CURATED, contracts: nativeContracts(BOSS_THREE_PHASE_CURATED, "-native-boss-three-phase-curated-v1", 3) },
    { review: BOSS_CUE_NATIVE, contracts: nativeContracts(BOSS_CUE_NATIVE, "-native-boss-cue-v1", 3) },
    { review: BOSS_CUE_CURATED, contracts: nativeContracts(BOSS_CUE_CURATED, "-native-boss-cue-curated-v1", 3) },
    { review: BOSS_LOOP_NATIVE, contracts: nativeContracts(BOSS_LOOP_NATIVE, "-native-boss-loop-v1", 3) },
    { review: BOSS_LOOP_CURATED, contracts: nativeContracts(BOSS_LOOP_CURATED, "-native-boss-loop-curated-v1", 3) },
    { review: BOSS_CAPTURE_PREFIX_NATIVE, contracts: nativeContracts(BOSS_CAPTURE_PREFIX_NATIVE, "-native-boss-capture-prefix-v1", 3) },
    { review: BOSS_CAPTURE_PREFIX_CURATED, contracts: nativeContracts(BOSS_CAPTURE_PREFIX_CURATED, "-native-boss-capture-prefix-curated-v1", 3) },
    { review: BOSS_SCHEDULER_COUNTDOWN_NATIVE, contracts: nativeContracts(BOSS_SCHEDULER_COUNTDOWN_NATIVE, "-native-boss-scheduler-countdown-v1", 3) },
    { review: BOSS_SCHEDULER_COUNTDOWN_CURATED, contracts: nativeContracts(BOSS_SCHEDULER_COUNTDOWN_CURATED, "-native-boss-scheduler-countdown-curated-v1", 3) },
    { review: BRAKEMAW_TIMERS_NATIVE, contracts: nativeContracts(BRAKEMAW_TIMERS_NATIVE, "-native-brakemaw-timers-v1", 3) },
    { review: BRAKEMAW_TIMERS_CURATED, contracts: nativeContracts(BRAKEMAW_TIMERS_CURATED, "-native-brakemaw-timers-curated-v1", 3) },
    { review: OPENING_DIRECTION_NATIVE, contracts: nativeContracts(OPENING_DIRECTION_NATIVE, "-native-opening-direction-v1", 3) },
    { review: OPENING_CORRECTION_NATIVE, contracts: nativeContracts(OPENING_CORRECTION_NATIVE, "-native-opening-correction-v1", 3) },
    { review: COMBINED_PERFORMANCE_NATIVE, contracts: nativeContracts(COMBINED_PERFORMANCE_NATIVE, "-native-combined-performance-v1", 3) },
    { review: KEEP_VIEW_MAP_NATIVE, contracts: nativeContracts(KEEP_VIEW_MAP_NATIVE, "-native-keep-view-map-v1", 3) },
    { review: GAMEPLAY_POLISH_NATIVE, contracts: nativeContracts(GAMEPLAY_POLISH_NATIVE, "-native-gameplay-polish-v1", 3) },
    { review: GAMEPLAY_POLISH_SOURCE_NATIVE, contracts: nativeContracts(GAMEPLAY_POLISH_SOURCE_NATIVE, "-native-gameplay-polish-source-v1", 3) },
    { review: WARDEN_ROW_NATIVE, contracts: nativeContracts(WARDEN_ROW_NATIVE, "-native-warden-row-v1", 3) },
    { review: WARDEN_ROW_SOURCE_NATIVE, contracts: nativeContracts(WARDEN_ROW_SOURCE_NATIVE, "-native-warden-row-source-v1", 3) },
    { review: COMPOSED_GAMEPLAY_NATIVE, contracts: nativeContracts(COMPOSED_GAMEPLAY_NATIVE, "-native-composed-gameplay-v1", 3) },
    { review: BRAKEMAW_FINISH_NATIVE, contracts: nativeContracts(BRAKEMAW_FINISH_NATIVE, "-native-brakemaw-finish-v1", 3) },
    { review: CROWN_MOTION_NATIVE, contracts: nativeContracts(CROWN_MOTION_NATIVE, "-native-crown-motion-v1", 3) },
    { review: BRAKEMAW_CAPTURE_LAYOUT_NATIVE, contracts: nativeContracts(BRAKEMAW_CAPTURE_LAYOUT_NATIVE, "-native-brakemaw-capture-layout-v1", 3) },
    { review: CARGO_CONTACT_NATIVE, contracts: nativeContracts(CARGO_CONTACT_NATIVE, "-native-cargo-contact-v1", 3) },
    { review: PROJECTILE_SPAWN_CONTACT_NATIVE, contracts: nativeContracts(PROJECTILE_SPAWN_CONTACT_NATIVE, "-native-projectile-spawn-contact-v1", 3) },
];
export const WRECKLIGHT_CONTRACTS = nativeContractGroups.flatMap(({ contracts }) => contracts);
/** The fixed door renderer compiles all room symbols into each invoking event.
 * Those references still prevent deletion, but their output belongs to the
 * reviewed room, not every actor that invokes the native translation unit.
 * Call only after complete current dependency coverage has been established. */
export function reviewedNativeBackgroundOwner(reference, metadataPath) {
    if (reference.confidence !== "verified" || reference.relation !== "native-door-background"
        || reference.target.type !== "asset" || !reference.reviewedContract)
        return undefined;
    for (const { review, contracts } of nativeContractGroups) {
        const contract = contracts.find((candidate) => candidate.id === reference.reviewedContract.id
            && candidate.version === reference.reviewedContract.version && candidate.handler.path === reference.resourcePath);
        if (!contract)
            continue;
        const backgrounds = review.backgrounds?.filter((background) => [background, ...(background.alternatives ?? [])]
            .some((choice) => choice.id === reference.target.id && choice.metadataPath === metadataPath
            && choice.metadataPath.replace(/\.gbsres$/u, "") === reference.target.resourcePath)) ?? [];
        if (backgrounds.length === 1)
            return backgrounds[0].sceneId;
    }
    return undefined;
}
//# sourceMappingURL=wrecklight-dependencies.js.map