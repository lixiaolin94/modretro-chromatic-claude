import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, parse as parsePath } from 'node:path';
import { pathToFileURL } from 'node:url';

// Help remains available before a lean payload's runtime is configured.
let PNG;
function loadPng() {
  if (PNG) return;
  const require = createRequire(process.env.GB_STUDIO_RUNTIME_ROOT
    ? resolve(process.env.GB_STUDIO_RUNTIME_ROOT, 'package.json')
    : import.meta.url);
  ({ PNG } = require('pngjs'));
}

const defaults = ['transparent=#ffffff', 'ink=#22303a', 'light=#8ebe67', 'mid=#4d8751'];
const maximumSearchCandidates = 25_000;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const rounded = (value, digits = 2) => Number(value.toFixed(digits));
const percent = (numerator, denominator) => denominator ? rounded(numerator / denominator * 100) : 0;
const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = rgb => '#' + rgb.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');

function parseColor(specification, index) {
  const [possibleName, possibleColor] = specification.split('=');
  const name = possibleColor ? possibleName : `color${index}`;
  const color = possibleColor ?? possibleName;
  const match = color.match(/^#?([\da-f]{6})$/i);
  if (!match) throw new Error(`Not a six-digit color: ${specification}`);
  const rgb = match[1].match(/../g).map(part => Number.parseInt(part, 16));
  return { name, hex: hex(rgb), rgb };
}

function cli(argv) {
  const result = { inputs: [] };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument.startsWith('--')) {
      const key = argument.slice(2);
      if (!['out', 'name', 'palette', 'grid', 'crop', 'cells', 'guide', 'transparent', 'tolerance', 'phase-search', 'pitch-search', 'margin'].includes(key)) throw new Error(`Unknown option ${argument}`);
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${argument}`);
      result[key] = value;
    } else result.inputs.push(argument);
  }
  return result;
}

function searchBound(raw, name) {
  if (raw === undefined) return undefined;
  const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a finite nonnegative number`);
  return value;
}

function guideMatch(r, g, b, a, guide, loose) {
  if (a < 200) return false;
  if (guide === 'black') return Math.max(r, g, b) <= (loose ? 52 : 26) && Math.max(r, g, b) - Math.min(r, g, b) <= (loose ? 18 : 15);
  return loose ? r >= 155 && b >= 150 && g <= 130 && Math.min(r, b) - g >= 55 : r >= 215 && b >= 200 && g <= 70;
}

function smoothProfile(profile, radius) {
  return profile.map((value, index) => {
    let sum = 0; let count = 0;
    for (let pos = Math.max(0, index - radius); pos <= Math.min(profile.length - 1, index + radius); pos++) { sum += profile[pos]; count++; }
    return sum / count;
  });
}

function searchOffsets(radius, step) {
  // A fractional search radius need not land on zero when stepped from -radius.
  // Always test the caller's expected grid before nearby alternatives.
  const values = [0];
  for (let offset = -radius; offset <= radius + step / 10; offset += step) {
    if (offset !== 0) values.push(offset);
  }
  return values;
}

function profiles(png, expected, guide, cells) {
  const { width, height, data } = png;
  const xBounds = [clamp(Math.round(expected.x), 0, width - 1), clamp(Math.round(expected.x + cells * expected.pitchX), 0, width - 1)];
  const yBounds = [clamp(Math.round(expected.y), 0, height - 1), clamp(Math.round(expected.y + cells * expected.pitchY), 0, height - 1)];
  const columns = { strict: new Array(width).fill(0), loose: new Array(width).fill(0) };
  const rows = { strict: new Array(height).fill(0), loose: new Array(height).fill(0) };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!(y >= yBounds[0] && y <= yBounds[1]) && !(x >= xBounds[0] && x <= xBounds[1])) continue;
    const i = (y * width + x) * 4;
    const strict = guideMatch(data[i], data[i + 1], data[i + 2], data[i + 3], guide, false) ? 1 : 0;
    const loose = guideMatch(data[i], data[i + 1], data[i + 2], data[i + 3], guide, true) ? 1 : 0;
    if (y >= yBounds[0] && y <= yBounds[1]) { columns.strict[x] += strict; columns.loose[x] += loose; }
    if (x >= xBounds[0] && x <= xBounds[1]) { rows.strict[y] += strict; rows.loose[y] += loose; }
  }
  for (const values of Object.values(columns)) for (let x = 0; x < width; x++) values[x] /= yBounds[1] - yBounds[0] + 1;
  for (const values of Object.values(rows)) for (let y = 0; y < height; y++) values[y] /= xBounds[1] - xBounds[0] + 1;
  return { columns, rows, xBounds, yBounds };
}

function detectAxis(profiles, origin, pitch, cells, scale, options) {
  const smooth = smoothProfile(profiles.loose, Math.max(1, Math.round(1.5 * scale)));
  const coverageAt = position => smooth[clamp(Math.round(position), 0, smooth.length - 1)];
  const phaseSearch = options.phaseSearch ?? Math.max(2, Math.min(30 * scale, pitch * 0.46));
  const pitchSearch = options.pitchSearch ?? Math.max(1, 5 * scale);
  const step = Math.max(0.25, 0.5 * scale);
  const candidateBound = radius => Math.floor((2 * radius + step / 10) / step) + 2;
  if (candidateBound(phaseSearch) * candidateBound(pitchSearch) > maximumSearchCandidates) {
    throw new Error(`Grid search exceeds the ${maximumSearchCandidates}-candidate budget per axis; reduce search bounds or correct --grid`);
  }
  let best = { merit: -Infinity };
  const phases = searchOffsets(phaseSearch, step);
  const pitches = searchOffsets(pitchSearch, step);
  for (const phase of phases) for (const delta of pitches) {
    const candidateOrigin = origin + phase; const candidatePitch = pitch + delta;
    if (candidateOrigin < 0 || candidateOrigin + candidatePitch * cells > smooth.length - 1 || candidatePitch < 4) continue;
    const coverages = Array.from({ length: cells + 1 }, (_, line) => coverageAt(candidateOrigin + candidatePitch * line));
    const worst = [...coverages].sort((a, b) => a - b).slice(0, Math.max(1, Math.ceil(coverages.length / 4)));
    const rawMerit = mean(coverages) * 0.76 + mean(worst) * 0.24;
    const regularization = (Math.abs(phase) / Math.max(phaseSearch, 1) + Math.abs(delta) / Math.max(pitchSearch, 1)) * 0.006;
    if (rawMerit - regularization > best.merit) best = { merit: rawMerit - regularization, rawMerit, origin: candidateOrigin, pitch: candidatePitch };
  }
  if (!Number.isFinite(best.merit)) best = { merit: 0, rawMerit: 0, origin, pitch };
  const lines = [];
  for (let line = 0; line <= cells; line++) {
    const expectedPosition = best.origin + best.pitch * line;
    const search = Math.max(3, Math.round(best.pitch * 0.20));
    const searchStart = Math.max(0, Math.round(expectedPosition) - search);
    const searchEnd = Math.min(smooth.length - 1, Math.round(expectedPosition) + search);
    let local = searchStart;
    // Smoothing is useful for the periodic fit, but must never place an actual guide
    // on a neighboring low-coverage pixel when a thin guide creates a smoothed plateau.
    // Search the unsmoothed projection first, using expected phase only for exact ties.
    for (let position = searchStart + 1; position <= searchEnd; position++) {
      if (profiles.loose[position] > profiles.loose[local] || (profiles.loose[position] === profiles.loose[local] && Math.abs(position - expectedPosition) < Math.abs(local - expectedPosition))) local = position;
    }
    const peak = profiles.loose[local];
    const threshold = Math.max(0.35, peak * 0.65);
    let first = local; let last = local;
    if (peak >= threshold) {
      while (first > 0 && profiles.loose[first - 1] >= threshold && local - first <= best.pitch / 3) first--;
      while (last + 1 < smooth.length && profiles.loose[last + 1] >= threshold && last - local <= best.pitch / 3) last++;
      const midpoint = (first + last) / 2;
      // Prefer the center of an equally strong run, but retain the actual raw peak.
      for (let position = first; position <= last; position++) {
        if (profiles.loose[position] !== peak) continue;
        const currentDistance = Math.abs(local - midpoint); const candidateDistance = Math.abs(position - midpoint);
        if (candidateDistance < currentDistance || (candidateDistance === currentDistance && Math.abs(position - expectedPosition) < Math.abs(local - expectedPosition))) local = position;
      }
    }
    lines.push({ line, predictedPosition: rounded(expectedPosition), observedPosition: local, displacement: rounded(local - expectedPosition), looseCoveragePercent: percent(profiles.loose[local], 1), strictCoveragePercent: percent(profiles.strict[local], 1), visibleWidth: peak >= threshold ? last - first + 1 : null, visibleStart: peak >= threshold ? first : null, visibleEnd: peak >= threshold ? last : null });
  }
  const strong = lines.filter(line => line.looseCoveragePercent >= 55).length;
  const likely = best.rawMerit >= 0.43 && strong >= Math.ceil((cells + 1) * 0.65);
  return { likely, origin: rounded(likely ? best.origin : origin), pitch: rounded(likely ? best.pitch : pitch), fitOrigin: rounded(best.origin), fitPitch: rounded(best.pitch), fitMeanAndLowCoveragePercent: percent(best.rawMerit, 1), observedLineMethod: 'Maximum unsmoothed loose projection within the fitted-line neighborhood; ties prefer the measured band center, then the fitted phase. Existing line thresholds are unchanged.', strongLines: strong, totalLines: cells + 1, maxLocalDisplacement: rounded(Math.max(...lines.filter(line => line.looseCoveragePercent >= 55).map(line => Math.abs(line.displacement)), 0)), medianVisibleWidth: (() => { const widths = lines.map(line => line.visibleWidth).filter(width => width !== null).sort((a, b) => a - b); return widths.length ? widths[Math.floor(widths.length / 2)] : null; })(), lines };
}

function nearestColor(rgb, palette) {
  let index = 0; let distance = Infinity;
  for (let candidate = 0; candidate < palette.length; candidate++) {
    const next = distanceSquared(rgb, palette[candidate].rgb);
    if (next < distance) { distance = next; index = candidate; }
  }
  return { index, distance: Math.sqrt(distance) };
}

function transitionColor(rgb, colors) {
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
    const a = colors[i]; const b = colors[j];
    const span = b.map((value, channel) => value - a[channel]);
    const lengthSquared = span.reduce((sum, value) => sum + value * value, 0);
    if (lengthSquared < 2500) continue;
    const t = span.reduce((sum, value, channel) => sum + value * (rgb[channel] - a[channel]), 0) / lengthSquared;
    if (t < 0.15 || t > 0.85) continue;
    const interpolated = a.map((value, channel) => value + span[channel] * t);
    if (distanceSquared(rgb, interpolated) <= 18 ** 2) return true;
  }
  return false;
}

function scanAlpha(png) {
  const { data, width, height } = png; let empty = 0; let partial = 0; let opaque = 0;
  const alphas = new Set(); const rgbaColors = new Set();
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3]; alphas.add(alpha);
    if (alpha === 0) empty++; else if (alpha === 255) opaque++; else partial++;
    rgbaColors.add(data.readUInt32BE(index));
  }
  const total = width * height;
  return { rgbaColorCount: rgbaColors.size, distinctAlphaCount: alphas.size, transparentPixels: empty, partiallyTransparentPixels: partial, opaquePixels: opaque, transparentPercent: percent(empty, total), partiallyTransparentPercent: percent(partial, total), opaquePercent: percent(opaque, total), hasActualTransparency: empty + partial > 0 };
}

function countTop(counts) { let index = 0; for (let i = 1; i < counts.length; i++) if (counts[i] > counts[index]) index = i; return index; }

const strictThresholds = Object.freeze({ edgeFraction: 0.22, rejectionDominantMinimum: 92, rejectionClusterMinimum: 6, rejectionEdgeCoreDelta: 12, rejectionDeltaClusterMinimum: 3, reviewDominantMinimum: 96, reviewClusterMinimum: 3, reviewEdgeCoreDelta: 8, reviewDeltaClusterMinimum: 1.5, possibleSubjectClusterMinimum: 2, minimumClusterPixels: 6 });

function cropImage(source, region) {
  const target = new PNG({ width: region.width, height: region.height });
  PNG.bitblt(source, target, region.x, region.y, region.width, region.height, 0, 0);
  return target;
}

function strictLineBand(axis, index) {
  const line = axis.lines[index];
  if (!axis.likely || line.visibleStart === null || line.looseCoveragePercent < 55) return null;
  // A single source pixel beyond the measured loose guide excludes the remaining guide antialias fringe.
  return { start: line.visibleStart - 1, end: line.visibleEnd + 1 };
}

function componentsFor(labels, width, height, color, total) {
  const visited = new Uint8Array(labels.length); const components = [];
  for (let offset = 0; offset < labels.length; offset++) {
    if (visited[offset] || labels[offset] !== color) continue;
    const stack = [offset]; visited[offset] = 1;
    let count = 0; let minimumX = width; let minimumY = height; let maximumX = -1; let maximumY = -1;
    while (stack.length) {
      const current = stack.pop(); const x = current % width; const y = Math.floor(current / width); count++;
      minimumX = Math.min(minimumX, x); minimumY = Math.min(minimumY, y); maximumX = Math.max(maximumX, x); maximumY = Math.max(maximumY, y);
      for (const adjacent of [x > 0 ? current - 1 : -1, x < width - 1 ? current + 1 : -1, y > 0 ? current - width : -1, y < height - 1 ? current + width : -1]) {
        if (adjacent < 0 || visited[adjacent] || labels[adjacent] !== color) continue;
        visited[adjacent] = 1; stack.push(adjacent);
      }
    }
    components.push({ pixels: count, areaPercent: percent(count, total), localBounds: { x: minimumX, y: minimumY, width: maximumX - minimumX + 1, height: maximumY - minimumY + 1 }, touchesUsableEdge: minimumX === 0 || minimumY === 0 || maximumX === width - 1 || maximumY === height - 1 });
  }
  return components.sort((a, b) => b.pixels - a.pixels);
}

function strictCell(png, x, y, horizontal, vertical, palette, options) {
  const left = strictLineBand(horizontal, x); const right = strictLineBand(horizontal, x + 1); const top = strictLineBand(vertical, y); const bottom = strictLineBand(vertical, y + 1);
  if (!left || !right || !top || !bottom) return { x, y, acquisition: 'unavailable', reason: 'One or more enclosing guide bands were not acquired with at least 55% line coverage.' };
  const startX = clamp(left.end + 1, 0, png.width - 1); const endX = clamp(right.start - 1, 0, png.width - 1);
  const startY = clamp(top.end + 1, 0, png.height - 1); const endY = clamp(bottom.start - 1, 0, png.height - 1);
  const width = endX - startX + 1; const height = endY - startY + 1;
  if (width < 4 || height < 4) return { x, y, acquisition: 'unavailable', reason: 'The enclosing measured guide bands leave fewer than four usable source pixels.' };
  const total = width * height; const edgeX = Math.max(1, Math.round(width * strictThresholds.edgeFraction)); const edgeY = Math.max(1, Math.round(height * strictThresholds.edgeFraction));
  const full = palette.map(() => 0); const core = full.slice(); const edge = full.slice(); const labels = new Uint8Array(total);
  let corePixels = 0; let edgePixels = 0; let offPalette = 0; let distanceTotal = 0; let alphaEmpty = 0; let alphaPartial = 0;
  for (let ry = 0; ry < height; ry++) for (let rx = 0; rx < width; rx++) {
    const source = ((ry + startY) * png.width + rx + startX) * 4;
    const rgba = [png.data[source], png.data[source + 1], png.data[source + 2], png.data[source + 3]];
    if (rgba[3] === 0) alphaEmpty++; else if (rgba[3] < 255) alphaPartial++;
    const mapped = rgba[3] < 32 && options.transparentIndex !== -1 ? { index: options.transparentIndex, distance: 0 } : nearestColor(rgba, palette);
    labels[ry * width + rx] = mapped.index; full[mapped.index]++; distanceTotal += mapped.distance;
    if (mapped.distance > options.tolerance) offPalette++;
    if (rx < edgeX || rx >= width - edgeX || ry < edgeY || ry >= height - edgeY) { edge[mapped.index]++; edgePixels++; } else { core[mapped.index]++; corePixels++; }
  }
  const dominant = countTop(full); const coreDominant = countTop(core); const edgeDominant = countTop(edge);
  const shares = full.map((count, color) => ({ index: color, name: palette[color].name, fullPercent: percent(count, total), corePercent: percent(core[color], corePixels), edgePercent: percent(edge[color], edgePixels) })).sort((a, b) => b.fullPercent - a.fullPercent);
  const clusters = full.flatMap((count, color) => !count ? [] : componentsFor(labels, width, height, color, total).filter(component => component.pixels >= strictThresholds.minimumClusterPixels).map(component => ({ index: color, name: palette[color].name, ...component, sourceBounds: { x: startX + component.localBounds.x, y: startY + component.localBounds.y, width: component.localBounds.width, height: component.localBounds.height } }))).sort((a, b) => b.pixels - a.pixels);
  const minorities = clusters.filter(cluster => cluster.index !== dominant);
  const largestMinority = minorities[0] ?? null;
  const dominantShare = percent(full[dominant], total);
  const edgeCoreDelta = rounded(Math.abs(percent(core[dominant], corePixels) - percent(edge[dominant], edgePixels)));
  const reasons = [];
  const largestShare = largestMinority?.areaPercent ?? 0;
  if (dominantShare < strictThresholds.rejectionDominantMinimum) reasons.push('usable-interior-dominant-below-92%');
  if (largestShare >= strictThresholds.rejectionClusterMinimum) reasons.push('contiguous-minority-at-least-6%');
  if (edgeCoreDelta >= strictThresholds.rejectionEdgeCoreDelta && largestShare >= strictThresholds.rejectionDeltaClusterMinimum) reasons.push('edge/core-difference-at-least-12pp-with-3%-cluster');
  if (coreDominant !== edgeDominant && largestShare >= strictThresholds.rejectionDeltaClusterMinimum) reasons.push('edge-and-core-disagree-with-3%-cluster');
  const reviewReasons = [];
  if (dominantShare < strictThresholds.reviewDominantMinimum) reviewReasons.push('usable-interior-dominant-below-96%');
  if (largestShare >= strictThresholds.reviewClusterMinimum) reviewReasons.push('contiguous-minority-at-least-3%');
  if (edgeCoreDelta >= strictThresholds.reviewEdgeCoreDelta && largestShare >= strictThresholds.reviewDeltaClusterMinimum) reviewReasons.push('edge/core-difference-at-least-8pp-with-1.5%-cluster');
  if (coreDominant !== edgeDominant) reviewReasons.push('edge-and-core-disagree');
  const foregroundClusters = clusters.filter(cluster => cluster.index !== options.transparentIndex);
  const transparentClusters = clusters.filter(cluster => cluster.index === options.transparentIndex);
  return { x, y, acquisition: 'acquired', usableBounds: { x: startX, y: startY, width, height }, usableFractionOfNominalCellPercent: percent(total, horizontal.pitch * vertical.pitch), samplePixels: total, corePixels, edgePixels, dominant: palette[dominant].name, dominantIndex: dominant, purityPercent: dominantShare, coreDominant: palette[coreDominant].name, edgeDominant: palette[edgeDominant].name, dominantCorePercent: percent(core[dominant], corePixels), dominantEdgePercent: percent(edge[dominant], edgePixels), absoluteEdgeCoreDifferencePercentagePoints: edgeCoreDelta, nearestPaletteShares: shares, largestMinority, minorityClusters: minorities.filter(cluster => cluster.areaPercent >= 1), status: reasons.length ? 'reject' : reviewReasons.length ? 'review' : 'pass', reasons: reasons.length ? reasons : reviewReasons, source: { meanPaletteResidual: rounded(distanceTotal / total), offPalettePercent: percent(offPalette, total), alphaEmptyPercent: percent(alphaEmpty, total), alphaPartialPercent: percent(alphaPartial, total) }, isDominantSubject: options.transparentIndex < 0 || dominant !== options.transparentIndex, isPossibleSubject: options.transparentIndex < 0 || dominant !== options.transparentIndex || foregroundClusters.some(cluster => cluster.areaPercent >= strictThresholds.possibleSubjectClusterMinimum), hasMeaningfulKey: options.transparentIndex >= 0 && (dominant === options.transparentIndex || transparentClusters.some(cluster => cluster.areaPercent >= strictThresholds.possibleSubjectClusterMinimum)) };
}

function strictSummary(cells, size, palette, options, geometryAcquired) {
  const acquired = cells.filter(cell => cell.acquisition === 'acquired');
  for (const cell of acquired) {
    const adjacent = [[cell.x - 1, cell.y], [cell.x + 1, cell.y], [cell.x, cell.y - 1], [cell.x, cell.y + 1]].map(([x, y]) => x < 0 || x >= size || y < 0 || y >= size ? null : cells[y * size + x]).filter(candidate => candidate?.acquisition === 'acquired');
    cell.isSubjectBoundary = options.transparentIndex < 0 ? adjacent.some(other => other.dominantIndex !== cell.dominantIndex) : (cell.isPossibleSubject && (cell.hasMeaningfulKey || adjacent.some(other => !other.isDominantSubject))) || (!cell.isDominantSubject && adjacent.some(other => other.isDominantSubject));
    cell.classification = options.transparentIndex < 0 ? 'opaque-design-cell' : cell.isDominantSubject ? 'occupied-dominant' : cell.isPossibleSubject ? 'empty-dominant-with-subject-spill' : 'empty';
  }
  const summary = subset => { const lowest = subset.length ? Math.min(...subset.map(cell => cell.purityPercent)) : null; return { cells: subset.length, rejected: subset.filter(cell => cell.status === 'reject').length, review: subset.filter(cell => cell.status === 'review').length, pass: subset.filter(cell => cell.status === 'pass').length, meanPurityPercent: subset.length ? rounded(mean(subset.map(cell => cell.purityPercent))) : null, lowestPurityPercent: lowest, maximumEdgeCoreDifferencePercentagePoints: subset.length ? Math.max(...subset.map(cell => cell.absoluteEdgeCoreDifferencePercentagePoints)) : null }; };
  const groups = { all: summary(acquired), occupied: summary(acquired.filter(cell => cell.isDominantSubject)), subjectOrSpill: summary(acquired.filter(cell => cell.isPossibleSubject)), subjectBoundary: summary(acquired.filter(cell => cell.isSubjectBoundary)), empty: summary(acquired.filter(cell => !cell.isDominantSubject)), emptyFarFromSubject: summary(acquired.filter(cell => !cell.isPossibleSubject && !cell.isSubjectBoundary)) };
  const asDiagnostic = cell => ({ x: cell.x, y: cell.y, classification: cell.classification, subjectBoundary: cell.isSubjectBoundary, status: cell.status, dominant: cell.dominant, purityPercent: cell.purityPercent, core: { dominant: cell.coreDominant, sharePercent: cell.dominantCorePercent }, edge: { dominant: cell.edgeDominant, sharePercent: cell.dominantEdgePercent }, edgeCoreDifferencePercentagePoints: cell.absoluteEdgeCoreDifferencePercentagePoints, largestMinority: cell.largestMinority, reasons: cell.reasons });
  const rejected = acquired.filter(cell => cell.status === 'reject'); const review = acquired.filter(cell => cell.status === 'review');
  return { status: !geometryAcquired || acquired.length !== cells.length ? 'unscored-geometry' : rejected.length ? 'reject-grid-fidelity' : review.length ? 'review-grid-fidelity' : 'pass-grid-fidelity', geometryAcquired, acquiredCells: acquired.length, unscoredCells: cells.filter(cell => cell.acquisition !== 'acquired'), thresholds: strictThresholds, artifactAcceptance: 'These are empirical triage thresholds, not permission for intentional subdivisions. A candidate requires every guide/cell acquired, zero rejected cells, zero review cells, a source palette/alpha contract check, and human visual review of the source and native result. Detectable rejection remains actionable even if other cells were unscored.', coordinateConvention: 'zero-based native cell coordinates x,y; source bounds are crop-relative when a crop was supplied', protocol: 'Find enclosing high-coverage loose guide bands on both axes; exclude the measured guide extent and one fringe source pixel; classify every remaining source pixel to its nearest explicit palette color before majority selection. Edge is the outer 22% of the usable interior in either axis, core is the rest. Minority components are four-connected and normalized over the whole usable cell; groups are reported separately. For an opaque asset, a boundary is a four-neighbor palette boundary.', groups, rejectedCoordinates: rejected.map(asDiagnostic), reviewCoordinates: review.map(asDiagnostic), paletteCountsFromStrictMajority: Object.fromEntries(palette.map((color, index) => [color.name, acquired.filter(cell => cell.dominantIndex === index).length])), rows: Array.from({ length: size }, (_, y) => cells.filter(cell => cell.y === y)) };
}

function strictOverlay(source, cells, horizontal, vertical) {
  const out = new PNG({ width: source.width, height: source.height });
  for (let i = 0; i < source.data.length; i += 4) { const alpha = source.data[i + 3] / 255; for (let c = 0; c < 3; c++) out.data[i + c] = Math.round((source.data[i + c] * alpha + 255 * (1 - alpha)) * 0.60 + 255 * 0.40); out.data[i + 3] = 255; }
  const pixel = (x, y, color) => { x = Math.round(x); y = Math.round(y); if (x < 0 || x >= out.width || y < 0 || y >= out.height) return; const i = (y * out.width + x) * 4; for (let c = 0; c < 3; c++) out.data[i + c] = color[c]; };
  const rectangle = (x, y, width, height, color, thickness = 2) => { for (let inset = 0; inset < thickness; inset++) { for (let px = x + inset; px <= x + width - 1 - inset; px++) { pixel(px, y + inset, color); pixel(px, y + height - 1 - inset, color); } for (let py = y + inset; py <= y + height - 1 - inset; py++) { pixel(x + inset, py, color); pixel(x + width - 1 - inset, py, color); } } };
  for (const cell of cells) {
    if (cell.acquisition !== 'acquired') { const x = Math.round(horizontal.origin + (cell.x + 0.5) * horizontal.pitch); const y = Math.round(vertical.origin + (cell.y + 0.5) * vertical.pitch); for (let offset = -5; offset <= 5; offset++) { pixel(x + offset, y + offset, [40, 80, 255]); pixel(x + offset, y - offset, [40, 80, 255]); } continue; }
    if (cell.status === 'pass') continue;
    const color = cell.status === 'reject' ? [235, 27, 48] : [240, 137, 0]; const b = cell.usableBounds;
    rectangle(b.x, b.y, b.width, b.height, color, Math.max(2, Math.round(Math.min(b.width, b.height) / 22)));
    if (cell.largestMinority) { const b = cell.largestMinority.sourceBounds; for (let py = b.y; py < b.y + b.height; py += 3) pixel(b.x, py, [0, 130, 220]); for (let px = b.x; px < b.x + b.width; px += 3) pixel(px, b.y, [0, 130, 220]); }
  }
  return out;
}

function sampleCell(png, x, y, geometry, palette, options) {
  const { width, height, data } = png;
  const left = geometry.x + geometry.pitchX * x; const top = geometry.y + geometry.pitchY * y;
  const margin = options.margin;
  const startX = clamp(Math.ceil(left + margin * geometry.pitchX), 0, width - 1); const endX = clamp(Math.floor(left + (1 - margin) * geometry.pitchX), 0, width - 1);
  const startY = clamp(Math.ceil(top + margin * geometry.pitchY), 0, height - 1); const endY = clamp(Math.floor(top + (1 - margin) * geometry.pitchY), 0, height - 1);
  const centerX = left + 0.5 * geometry.pitchX; const centerY = top + 0.5 * geometry.pitchY;
  const counts = new Array(palette.length).fill(0); const centerCounts = counts.slice(); const exact = new Map();
  let sampled = 0; let centers = 0; let residual = 0; let offPalette = 0; let likelyTransition = 0; let guideInterior = 0; let boundaries = 0; let boundaryTransition = 0; let boundaryGuide = 0; let ignoredAlpha = 0;
  const transitionColors = [...palette.map(color => color.rgb), options.guide === 'magenta' ? [255, 0, 255] : [0, 0, 0]];
  function position(px, py) {
    const index = (py * width + px) * 4; const rgba = [data[index], data[index + 1], data[index + 2], data[index + 3]];
    if (rgba[3] < 32 && options.transparentIndex !== -1) return { rgba, mapped: { index: options.transparentIndex, distance: 0 }, guideLike: false, transition: false };
    const mapped = nearestColor(rgba, palette);
    const guideLike = guideMatch(...rgba, options.guide, true);
    const transition = mapped.distance > 20 && transitionColor(rgba, transitionColors);
    return { rgba, mapped, guideLike, transition };
  }
  for (let py = startY; py <= endY; py++) for (let px = startX; px <= endX; px++) {
    const { rgba, mapped, guideLike, transition } = position(px, py);
    sampled++; counts[mapped.index]++; residual += mapped.distance;
    if (mapped.distance > options.tolerance) offPalette++;
    if (transition) likelyTransition++;
    if (guideLike) guideInterior++;
    if (rgba[3] < 32) ignoredAlpha++;
    const key = rgba.join(','); exact.set(key, (exact.get(key) ?? 0) + 1);
    if (Math.abs(px - centerX) <= geometry.pitchX * 0.12 && Math.abs(py - centerY) <= geometry.pitchY * 0.12) { centers++; centerCounts[mapped.index]++; }
  }
  const ringMinX = clamp(Math.ceil(left + 0.08 * geometry.pitchX), 0, width - 1); const ringMaxX = clamp(Math.floor(left + 0.92 * geometry.pitchX), 0, width - 1);
  const ringMinY = clamp(Math.ceil(top + 0.08 * geometry.pitchY), 0, height - 1); const ringMaxY = clamp(Math.floor(top + 0.92 * geometry.pitchY), 0, height - 1);
  for (let py = ringMinY; py <= ringMaxY; py++) for (let px = ringMinX; px <= ringMaxX; px++) {
    if (px >= startX && px <= endX && py >= startY && py <= endY) continue;
    const { guideLike, transition } = position(px, py); boundaries++;
    if (guideLike) boundaryGuide++; if (transition) boundaryTransition++;
  }
  const majority = countTop(counts); const center = countTop(centerCounts);
  const centerPixel = position(clamp(Math.round(centerX), 0, width - 1), clamp(Math.round(centerY), 0, height - 1));
  let exactTop = ['', 0]; for (const pair of exact) if (pair[1] > exactTop[1]) exactTop = pair;
  const representative = exactTop[0] ? exactTop[0].split(',').map(Number) : centerPixel.rgba;
  const sortedPalette = counts.map((count, index) => ({ name: palette[index].name, index, sharePercent: percent(count, sampled) })).sort((a, b) => b.sharePercent - a.sharePercent);
  return { x, y, samplePixels: sampled, majority: palette[majority].name, majorityIndex: majority, dominantPalettePercent: percent(counts[majority], sampled), center: palette[center].name, centerIndex: center, centerDominantPalettePercent: percent(centerCounts[center], centers), centerPixel: { rgba: centerPixel.rgba, nearest: palette[centerPixel.mapped.index].name, residual: rounded(centerPixel.mapped.distance) }, representativeRgba: representative, dominantExactRgbaPercent: percent(exactTop[1], sampled), meanPaletteResidual: rounded(residual / Math.max(1, sampled)), offPalettePercent: percent(offPalette, sampled), likelyTransitionInteriorPercent: percent(likelyTransition, sampled), guideLikeInteriorPercent: percent(guideInterior, sampled), transitionBoundaryRingPercent: percent(boundaryTransition, boundaries), guideLikeBoundaryRingPercent: percent(boundaryGuide, boundaries), transparentSourceInteriorPercent: percent(ignoredAlpha, sampled), nearestPaletteShares: sortedPalette };
}

function makeNative(cells, size, palette, field, transparentIndex) {
  const png = new PNG({ width: size, height: size });
  for (const cell of cells) {
    const rgba = field === 'representativeRgba' ? cell.representativeRgba : [...palette[cell[field]].rgb, cell[field] === transparentIndex ? 0 : 255];
    const index = (cell.y * size + cell.x) * 4; rgba.forEach((value, channel) => { png.data[index + channel] = value; });
  }
  return png;
}

function zoom(source, scale = 16) {
  const png = new PNG({ width: source.width * scale, height: source.height * scale });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const sourceIndex = (Math.floor(y / scale) * source.width + Math.floor(x / scale)) * 4;
    const targetIndex = (y * png.width + x) * 4; const a = source.data[sourceIndex + 3] / 255;
    const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) ? 227 : 247;
    for (let channel = 0; channel < 3; channel++) png.data[targetIndex + channel] = Math.round(a * source.data[sourceIndex + channel] + (1 - a) * checker);
    png.data[targetIndex + 3] = 255;
  }
  return png;
}

export async function evaluate(input, rawOptions = {}) {
  const phaseSearch = searchBound(rawOptions['phase-search'], 'phase-search');
  const pitchSearch = searchBound(rawOptions['pitch-search'], 'pitch-search');
  loadPng();
  const original = PNG.sync.read(await readFile(input));
  const rawCrop = rawOptions.crop?.split(',').map(Number);
  if (rawCrop && (rawCrop.length !== 4 || rawCrop.some(value => !Number.isInteger(value)) || rawCrop[0] < 0 || rawCrop[1] < 0 || rawCrop[2] < 8 || rawCrop[3] < 8 || rawCrop[0] + rawCrop[2] > original.width || rawCrop[1] + rawCrop[3] > original.height)) throw new Error('--crop requires in-bounds integer x,y,width,height as original-image pixel values');
  const crop = rawCrop ? { x: rawCrop[0], y: rawCrop[1], width: rawCrop[2], height: rawCrop[3] } : null;
  const png = crop ? cropImage(original, crop) : original;
  for (const [name, value] of [['phase-search', phaseSearch], ['pitch-search', pitchSearch]]) {
    if (value !== undefined && value > Math.max(png.width, png.height)) {
      throw new Error(`--${name} must not exceed the largest source-image dimension`);
    }
  }
  const size = Number(rawOptions.cells ?? 16); if (!Number.isInteger(size) || size < 2 || size > 64) throw new Error('--cells must be an integer from 2 to 64');
  const guide = rawOptions.guide ?? 'black'; if (!['black', 'magenta'].includes(guide)) throw new Error('--guide must be black or magenta');
  const margin = Number(rawOptions.margin ?? 0.19); if (!(margin >= 0.10 && margin < 0.39)) throw new Error('--margin must be from 0.10 to less than 0.39');
  const palette = (rawOptions.palette ? rawOptions.palette.split(',') : defaults).map(parseColor);
  if (palette.length < 2 || palette.length > 12) throw new Error('Use from two to twelve palette colors');
  const transparency = rawOptions.transparent ?? 'transparent';
  const transparentIndex = transparency === 'none' ? -1 : /^\d+$/.test(transparency) ? Number(transparency) : palette.findIndex(color => color.name === transparency);
  if (transparency !== 'none' && (transparentIndex < 0 || transparentIndex >= palette.length)) throw new Error('The --transparent palette name or index does not exist; use none for an opaque target');
  const options = { guide, margin, tolerance: Number(rawOptions.tolerance ?? 42), transparentIndex, phaseSearch, pitchSearch };
  const grid = rawOptions.grid?.split(',').map(Number);
  if (grid && (grid.length !== 4 || grid.some(value => !Number.isFinite(value)) || grid[2] < 2 || grid[3] < 2)) throw new Error('--grid requires x,y,pitchX,pitchY as source-image pixel values');
  const expected = grid ? { x: grid[0], y: grid[1], pitchX: grid[2], pitchY: grid[3] } : { x: 31 * png.width / 1024, y: 31 * png.height / 1024, pitchX: 60 * png.width / 1024, pitchY: 60 * png.height / 1024 };
  const coverage = profiles(png, expected, guide, size);
  const horizontal = detectAxis(coverage.columns, expected.x, expected.pitchX, size, png.width / 1024, options);
  const vertical = detectAxis(coverage.rows, expected.y, expected.pitchY, size, png.height / 1024, options);
  const geometry = { x: horizontal.origin, y: vertical.origin, pitchX: horizontal.pitch, pitchY: vertical.pitch };
  const cells = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells.push(sampleCell(png, x, y, geometry, palette, options));
  const fullCells = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) fullCells.push(strictCell(png, x, y, horizontal, vertical, palette, options));
  const strict = strictSummary(fullCells, size, palette, options, horizontal.likely && vertical.likely);
  const rollup = property => rounded(mean(cells.map(cell => cell[property])));
  const disagreements = cells.filter(cell => cell.majorityIndex !== cell.centerIndex).map(cell => ({ x: cell.x, y: cell.y, majority: cell.majority, center: cell.center }));
  const low = cells.filter(cell => cell.dominantPalettePercent < 80).map(cell => ({ x: cell.x, y: cell.y, majority: cell.majority, dominantPalettePercent: cell.dominantPalettePercent }));
  const highTransitions = cells.filter(cell => cell.likelyTransitionInteriorPercent > 10).map(cell => ({ x: cell.x, y: cell.y, percent: cell.likelyTransitionInteriorPercent }));
  const analysis = {
    source: { path: resolve(input), width: png.width, height: png.height, aspectRatio: rounded(png.width / png.height, 4), expectedSquare: png.width === png.height, originalDimensions: { width: original.width, height: original.height }, crop, alphaAndColors: scanAlpha(png) },
    protocol: { size, guide, expectedGrid: expected, effectiveGrid: geometry, interiorFractionFromEachSide: margin, excludedSourceBorderBeforeBoundaryRingFraction: 0.08, referencePalette: palette.map(({ name, hex }) => ({ name, hex })), transparentTargetIndex: transparentIndex === -1 ? null : transparentIndex, offPaletteEuclideanRgbThreshold: options.tolerance, guideStrict: guide === 'black' ? 'alpha >= 200; max channel <= 26; channel spread <= 15' : 'alpha >= 200; R >= 215; B >= 200; G <= 70', guideLoose: guide === 'black' ? 'alpha >= 200; max channel <= 52; channel spread <= 18' : 'alpha >= 200; R >= 155; B >= 150; G <= 130; min(R,B)-G >= 55' },
    guides: { likelyDetectedBothAxes: horizontal.likely && vertical.likely, columns: horizontal, rows: vertical, coordinateStrategy: 'globally periodic best-fit center lines independently per axis when detected, expected bounds otherwise; no perspective correction' },
    cells: { total: cells.length, summary: { meanDominantPalettePercent: rollup('dominantPalettePercent'), meanDominantExactRgbaPercent: rollup('dominantExactRgbaPercent'), meanPaletteResidual: rollup('meanPaletteResidual'), meanOffPalettePercent: rollup('offPalettePercent'), meanLikelyTransitionInteriorPercent: rollup('likelyTransitionInteriorPercent'), meanGuideLikeInteriorPercent: rollup('guideLikeInteriorPercent'), meanTransitionBoundaryRingPercent: rollup('transitionBoundaryRingPercent'), meanGuideLikeBoundaryRingPercent: rollup('guideLikeBoundaryRingPercent'), exactMajorityCenterDisagreements: disagreements.length, nonflatBelow80Percent: low.length, cellsWithTransitionSpillOver10Percent: highTransitions.length, paletteCountsFromMajority: Object.fromEntries(palette.map((color, index) => [color.name, cells.filter(cell => cell.majorityIndex === index).length])) }, centerMajorityDisagreements: disagreements, nonflatCellsBelow80Percent: low, highTransitionSpillCells: highTransitions, rows: Array.from({ length: size }, (_, y) => cells.filter(cell => cell.y === y)) },
    strict,
    limits: ['Palette metrics depend on supplied reference colors; genuinely different flat fills can have large palette residuals without anti-aliasing. Multiple visually distinct source colors mapped into the same supplied palette class can conceal a split; source residual remains separate.', 'The transition metric is a color-mixing heuristic and can mistake palette-adjacent intentional shades or compression; it is not an independent proof of anti-aliasing.', 'Near-black pure art can contribute to guide-like interior metrics; full-length axis coverage is a stronger indicator of a guide.', 'Perspective, nonlinear warp, or heavily hand-drawn grid distortion is not corrected. Both axes, per-line displacement, and native previews must be inspected. Strict classification refuses to score geometry when the guide is not acquired; partial acquisition never produces a pass.', 'Source alpha is measured independently; white/pale target transparency exists only when explicitly assigned to a palette slot; majority/center images show that mapping.', 'Artwork readability, silhouette, anchors, seams, and animation quality are qualitative and require looking at native samples.'],
  };
  const strictNativeCells = fullCells.filter(cell => cell.acquisition === 'acquired');
  return { analysis, images: { majority: makeNative(cells, size, palette, 'majorityIndex', transparentIndex), center: makeNative(cells, size, palette, 'centerIndex', transparentIndex), 'source-modal': makeNative(cells, size, palette, 'representativeRgba', -1), 'strict-majority': makeNative(strictNativeCells, size, palette, 'dominantIndex', transparentIndex), 'strict-overlay': strictOverlay(png, fullCells, horizontal, vertical) } };
}

async function main() {
  const options = cli(process.argv.slice(2));
  if (options.help || !options.inputs.length) {
    console.log('node skills/modretro-chromatic-pixel-art/scripts/evaluate-grid.mjs <image.png> [more.png] [--out <directory>] [--name <single-output-stem>] [--palette transparent=#ffffff,ink=#22303a,light=#8ebe67,mid=#4d8751] [--transparent <name|index|none>] [--grid <x,y,pitchX,pitchY>] [--crop <x,y,width,height>] [--guide black|magenta] [--cells 16] [--tolerance 42] [--margin 0.19] [--phase-search <source-pixels>] [--pitch-search <source-pixels>]');
    console.log('Defaults target a 1024 square template with 16 cells and line centers 31+60*n, scaled with input dimensions. Writes a full JSON, native palette-majority/center/raw-modal/strict-majority PNGs, checkerboard previews, and source-size strict diagnostic overlay (red rejects, amber reviews, blue partial cluster or unscored cross).');
    console.log('For a lean plugin payload, set GB_STUDIO_RUNTIME_ROOT to its configured prepared runtime so the helper can resolve pngjs. Help works before that dependency is loaded.');
    console.log(`Search bounds must be finite, nonnegative, no larger than the largest source-image dimension, and within ${maximumSearchCandidates} candidates per axis. Output paths must be unique and must not already exist.`);
    return;
  }
  if (options.name && options.inputs.length !== 1) throw new Error('--name supports exactly one input');
  const directory = resolve(options.out ?? '.local/imagegen-workflow/grid-evaluations');
  const imageNames = ['majority', 'center', 'source-modal', 'strict-majority', 'strict-overlay'];
  const plans = options.inputs.map(input => {
    const stem = options.name ?? parsePath(input).name;
    if (!/^[\w.-]+$/.test(stem)) throw new Error('--name must be a file stem containing only letters, digits, period, underscore, or dash');
    const filenames = [`${stem}.json`, ...imageNames.flatMap(name => name === 'strict-overlay'
      ? [`${stem}-${name}.png`]
      : [`${stem}-${name}.png`, `${stem}-${name}-zoom.png`])];
    return { input, stem, outputs: filenames.map(filename => resolve(directory, filename)) };
  });
  const destinations = new Set();
  for (const output of plans.flatMap(plan => plan.outputs)) {
    const portableKey = output.toLowerCase();
    if (destinations.has(portableKey)) throw new Error(`Colliding output path: ${output}. Use distinct input basenames or separate output directories.`);
    destinations.add(portableKey);
    try {
      await lstat(output);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(`Output already exists: ${output}. Choose a new output directory or --name.`);
  }
  for (const { input, stem } of plans) {
    const { analysis, images } = await evaluate(input, options);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${stem}.json`), JSON.stringify(analysis, null, 2) + '\n', { flag: 'wx' });
    for (const [name, png] of Object.entries(images)) {
      await writeFile(resolve(directory, `${stem}-${name}.png`), PNG.sync.write(png), { flag: 'wx' });
      if (name !== 'strict-overlay') await writeFile(resolve(directory, `${stem}-${name}-zoom.png`), PNG.sync.write(zoom(png)), { flag: 'wx' });
    }
    console.log(JSON.stringify({ input, output: resolve(directory, `${stem}.json`), source: analysis.source, guides: { both: analysis.guides.likelyDetectedBothAxes, columns: { strong: analysis.guides.columns.strongLines, pitch: analysis.guides.columns.pitch }, rows: { strong: analysis.guides.rows.strongLines, pitch: analysis.guides.rows.pitch } }, metrics: analysis.cells.summary, strict: { status: analysis.strict.status, groups: analysis.strict.groups, rejected: analysis.strict.rejectedCoordinates.map(({ x, y }) => [x, y]), review: analysis.strict.reviewCoordinates.map(({ x, y }) => [x, y]) } }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
