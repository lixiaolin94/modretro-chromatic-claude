// Palette-family constraint solving for image graphics. This module does not
// decode pixels or assign shade indices; callers supply encodable tile colors.
export const MAX_PALETTES = 8;
const MAX_PALETTE_SEARCH_NODES = 100_000;
function paletteKey(colors) {
    return Array.from(colors).sort().join(",");
}
export function includesPalette(family, palette) {
    for (const color of palette) {
        if (!family.has(color)) {
            return false;
        }
    }
    return true;
}
// Drop duplicates and subsets before search. Supersets impose every constraint
// of their subsets, so they must be visited first, with deterministic tie breaks.
function constrainedPalettes(tilePalettes, capacity) {
    const unique = Array.from(new Map(tilePalettes
        .filter((palette) => palette.size > 0 && palette.size <= capacity)
        .map((palette) => [paletteKey(palette), palette])).values()).sort((left, right) => right.size - left.size || paletteKey(left).localeCompare(paletteKey(right)));
    const palettes = [];
    for (const palette of unique) {
        if (!palettes.some((candidate) => includesPalette(candidate, palette))) {
            palettes.push(palette);
        }
    }
    return palettes;
}
function greedyPacking(palettes, capacity) {
    const greedyFamilies = [];
    for (const palette of palettes) {
        let bestFamily;
        let smallestGrowth = Number.POSITIVE_INFINITY;
        for (const family of greedyFamilies) {
            const combinedSize = new Set([...family, ...palette]).size;
            const growth = combinedSize - family.size;
            if (combinedSize <= capacity && growth < smallestGrowth) {
                bestFamily = family;
                smallestGrowth = growth;
            }
        }
        if (bestFamily === undefined) {
            greedyFamilies.push(new Set(palette));
        }
        else {
            for (const color of palette) {
                bestFamily.add(color);
            }
        }
    }
    return greedyFamilies;
}
// The budget belongs to the entire optimization, not one candidate limit.
function findPacking(palettes, capacity, limit, budget) {
    const families = [];
    const impossibleStates = new Set();
    const visit = (index) => {
        budget.nodes += 1;
        if (budget.nodes > MAX_PALETTE_SEARCH_NODES) {
            budget.exhausted = true;
            return undefined;
        }
        if (index === palettes.length) {
            return families.map((family) => new Set(family));
        }
        const state = `${index}:${families.map((family) => paletteKey(family)).sort().join(";")}`;
        if (impossibleStates.has(state)) {
            return undefined;
        }
        const palette = palettes[index];
        const triedFamilies = new Set();
        const candidates = families
            .map((family, familyIndex) => ({
            family,
            familyIndex,
            combined: new Set([...family, ...palette]),
        }))
            .filter(({ combined }) => combined.size <= capacity)
            .sort((left, right) => left.combined.size - left.family.size - (right.combined.size - right.family.size));
        for (const { family, familyIndex, combined } of candidates) {
            const signature = paletteKey(combined);
            if (triedFamilies.has(signature)) {
                continue;
            }
            triedFamilies.add(signature);
            families[familyIndex] = combined;
            const result = visit(index + 1);
            families[familyIndex] = family;
            if (result !== undefined || budget.exhausted) {
                return result;
            }
        }
        if (families.length < limit) {
            families.push(new Set(palette));
            const result = visit(index + 1);
            families.pop();
            if (result !== undefined || budget.exhausted) {
                return result;
            }
        }
        impossibleStates.add(state);
        return undefined;
    };
    return visit(0);
}
function packingResult(families, lowerBound, status, exceedsHardwareLimit) {
    const upperBound = families.length;
    return {
        status,
        count: status === "indeterminate" ? null : upperBound,
        upperBound,
        lowerBound,
        families,
        exceedsHardwareLimit,
    };
}
export function packTilePalettes(tilePalettes, capacity) {
    const palettes = constrainedPalettes(tilePalettes, capacity);
    if (palettes.length === 0) {
        return packingResult([], 0, "exact", false);
    }
    const allColors = new Set(palettes.flatMap((palette) => Array.from(palette)));
    const lowerBound = Math.ceil(allColors.size / capacity);
    const greedyFamilies = greedyPacking(palettes, capacity);
    const upperBound = greedyFamilies.length;
    if (lowerBound === upperBound) {
        return packingResult(greedyFamilies, lowerBound, "exact", lowerBound > MAX_PALETTES);
    }
    if (lowerBound > MAX_PALETTES) {
        return packingResult(greedyFamilies, lowerBound, "upper-bound", true);
    }
    const budget = { nodes: 0, exhausted: false };
    // Hardware feasibility matters more than minimizing an already usable result:
    // a greedy result above eight must never itself become a rejection.
    if (upperBound > MAX_PALETTES) {
        const feasibleFamilies = findPacking(palettes, capacity, MAX_PALETTES, budget);
        if (feasibleFamilies === undefined) {
            return packingResult(greedyFamilies, lowerBound, budget.exhausted ? "indeterminate" : "upper-bound", !budget.exhausted);
        }
        return packingResult(feasibleFamilies, lowerBound, lowerBound === feasibleFamilies.length ? "exact" : "upper-bound", false);
    }
    for (let limit = lowerBound; limit < upperBound; limit += 1) {
        const families = findPacking(palettes, capacity, limit, budget);
        if (families !== undefined) {
            return packingResult(families, lowerBound, "exact", false);
        }
        if (budget.exhausted) {
            return packingResult(greedyFamilies, lowerBound, "upper-bound", false);
        }
    }
    return packingResult(greedyFamilies, lowerBound, "exact", false);
}
//# sourceMappingURL=graphics-palette-packing.js.map