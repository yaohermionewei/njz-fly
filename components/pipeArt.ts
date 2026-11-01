/**
 * Pixel pipe + snow renderer shared by the game and the segment review page.
 *
 * Pipes are rasterized on a screen-aligned pixel grid (not drawn upright and
 * rotated), so tilted pipes keep clean stair-step edges. Snow then settles
 * physically: in every grid column it lies on the topmost pipe surface only,
 * thick on flat tops, thinner on slopes, none on steep sides. Its outline is
 * built from smooth curves (rounded ends, gentle swells, soft lumps hanging
 * over the contact edge) so it reads soft like the background snow.
 */

import { nightTint } from './nightTint';

export interface PipeAppearance {
  id: number;
  x: number;
  width: number;
  height: number;
  pipeOrientation?: 'vertical' | 'horizontal' | 'diagonal';
  pipeRotation?: number;
}

export interface PipeRasterOptions {
  seed: number;
  /** Length along the pipe axis, world units. */
  length: number;
  /** Visual thickness (cap width), world units. */
  thickness: number;
  /** Screen rotation of the axis; 0 means the cap points up. */
  rotation: number;
}

export interface PipeRaster {
  width: number;
  height: number;
  /** Palette indices, row-major; 0 is transparent. */
  pixels: Uint8Array;
  /** Offset of the raster's top-left corner from the pipe center, world units. */
  originX: number;
  originY: number;
  pixelSize: number;
  /** Per column: first pipe row (or -1) and first snow row (or -1). */
  pipeTop: Int16Array;
  snowTop: Int16Array;
}

export const PIPE_PIXEL_SIZE = 3;
/** Sloped pipes use a finer grid so their stair-stepped edges read as a thinner stroke. */
export const PIPE_PIXEL_SIZE_TILTED = 2.4;

// Colours are graded for the blue night scene: navy outline instead of black,
// teal-green body, moonlit blue-white snow. Everything passes through
// nightTint() once more when the raster is turned into an image.
export const PIPE_PALETTE = [
  'transparent',
  '#17223f', // 1 shadow-side outline
  '#1a2e47', // 2-9 body, dark → bright
  '#1f3b51',
  '#25495a',
  '#2b5862',
  '#336769',
  '#3d7871',
  '#4c8b7b',
  '#64a08a',
  '#192b44', // 10 seam / groove
  '#7584bd', // 11-14 snow, dark → bright
  '#a1aedd',
  '#d9e1f6',
  '#f3f6ff',
  '#2c4d5e', // 15 lit-side outline
  '#9fd0b6', // 16 specular streak
  '#2f4a6e', // 17 reflected sky light on the shadow side
  '#14233a', // 18 bolt
  '#88b9a3', // 19 bolt glint
  '#7f9cc0', // 20 frost just under the snow
] as const;

const OUTLINE = 1;
const BODY_DARK = 2;
const BODY_BRIGHT = 9;
const SEAM = 10;
const SNOW_DEEP = 11;
const SNOW_SHADE = 12;
const SNOW_BASE = 13;
const SNOW_LIGHT = 14;
const OUTLINE_LIT = 15;
const SPECULAR = 16;
const RIM = 17;
const BOLT = 18;
const BOLT_LIGHT = 19;
const FROST = 20;

const BODY_RATIO = 0.39; // half-width of the shaft: 72 wide for a 92 pipe, matching the hitbox
const COLLAR_RATIO = 0.48;
const COLLAR_LENGTH = 24;
const JOINT_SPACING = 78;
const FLANGE_WIDTH = 7;
const FLANGE_LIP = 2.5;
/** Snow tuning was authored on a 3-unit grid; scale pixel counts to a raster's grid. */
const snowScale = (pixelSize: number) => 3 / pixelSize;
const maxSnow = (scale: number) => Math.round(4.5 * scale); // pixels

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const isBody = (color: number) => color >= BODY_DARK && color <= BODY_BRIGHT;
const shift = (color: number, by: number) => clamp(color + by, BODY_DARK, BODY_BRIGHT);

function randomFor(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Light from the upper left, slightly toward the viewer.
const LIGHT_X = -0.5;
const LIGHT_Y = -0.82;
const SHADE_STEPS = [0, 0.14, 0.26, 0.37, 0.47, 0.57, 0.68];

/**
 * Body level 2..9 of a cylinder cross-section point (vn in -1..1). Band edges
 * get a one-pixel checker so the round shading reads smooth, not striped.
 */
function cylinderShade(vn: number, lightSide: number, checker: boolean): number {
  const facing = Math.sqrt(Math.max(0, 1 - vn * vn));
  const intensity = 0.62 * vn * lightSide + 0.5 * facing;
  let level = BODY_DARK;
  for (const threshold of SHADE_STEPS) {
    if (intensity > threshold) level += 1;
    else if (checker && threshold - intensity < 0.025) return level + 1;
  }
  return level;
}

export function rasterizePipe(options: PipeRasterOptions): PipeRaster {
  const { seed, length, thickness, rotation } = options;
  const axisAligned = Math.abs(Math.sin(rotation * 2)) < 0.01;
  const P = axisAligned ? PIPE_PIXEL_SIZE : PIPE_PIXEL_SIZE_TILTED;
  // Every exposed end is finished, including horizontal platforms and upright
  // floating posts. Facing affects lighting/orientation, never completeness.
  const bothEnds = true;
  const S = snowScale(P);
  const random = randomFor(seed);
  const ax = Math.sin(rotation);
  const ay = -Math.cos(rotation);
  const nx = Math.cos(rotation);
  const ny = Math.sin(rotation);
  // n·L: which side of the pipe faces the light.
  const lightSide = nx * LIGHT_X + ny * LIGHT_Y;
  const litSign = lightSide >= 0 ? 1 : -1;
  const bodyHalf = thickness * BODY_RATIO;
  const collarHalf = thickness * COLLAR_RATIO;
  const halfLength = length / 2;
  const collarStart = halfLength - COLLAR_LENGTH;

  /** Distance past the last flange start, or -1 when not on a flange. */
  const flangeAt = (a: number) => {
    const fromCollar = collarStart - a;
    if (fromCollar < JOINT_SPACING * 0.5 || a < -halfLength + 14) return -1;
    const ring = fromCollar % JOINT_SPACING;
    return ring < FLANGE_WIDTH ? ring : -1;
  };

  /** 0 empty, 1 shaft, 2 collar, 3 flange at a world-space offset from the pipe center. */
  const partAt = (x: number, y: number) => {
    const a = x * ax + y * ay;
    const v = Math.abs(x * nx + y * ny);
    const capA = bothEnds ? Math.abs(a) : a;
    if (capA >= collarStart && capA <= halfLength && v <= collarHalf) return 2;
    if (a < -halfLength || a >= collarStart || (bothEnds && a <= -collarStart)) return 0;
    if (v <= bodyHalf) return flangeAt(a) >= 0 ? 3 : 1;
    if (v <= bodyHalf + FLANGE_LIP && flangeAt(a) >= 0) return 3;
    return 0;
  };

  // Bounding box of the rotated shape, plus room for snow above and a margin.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [a, v] of [[-halfLength, -collarHalf], [-halfLength, collarHalf], [halfLength, -collarHalf], [halfLength, collarHalf]]) {
    const x = a * ax + v * nx;
    const y = a * ay + v * ny;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const originX = Math.floor(minX / P - 3) * P;
  // Room above for the tallest pillow mounds.
  const originY = Math.floor(minY / P - maxSnow(S) * 1.6 - 4) * P;
  const width = Math.ceil((maxX - originX) / P) + 3;
  const height = Math.ceil((maxY - originY) / P) + 3;
  const pixels = new Uint8Array(width * height);
  const kind = new Uint8Array(width * height);
  const along = new Float32Array(width * height);
  const across = new Float32Array(width * height);

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = originX + (column + 0.5) * P;
      const y = originY + (row + 0.5) * P;
      const index = row * width + column;
      along[index] = x * ax + y * ay;
      across[index] = x * nx + y * ny;
      kind[index] = partAt(x, y);
    }
  }

  const solid = (column: number, row: number) =>
    column >= 0 && row >= 0 && column < width && row < height && kind[row * width + column] !== 0;

  // Round the outer corners of collars and flanges on axis-aligned pipes.
  if (axisAligned) {
    const corners: number[] = [];
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const index = row * width + column;
        if (kind[index] < 2) continue;
        const horizontalOpen = !solid(column - 1, row) || !solid(column + 1, row);
        const verticalOpen = !solid(column, row - 1) || !solid(column, row + 1);
        if (horizontalOpen && verticalOpen) corners.push(index);
      }
    }
    corners.forEach((index) => { kind[index] = 0; });
  }

  // Wear: thin darker streaks running along the shaft, a few per pipe.
  const streaks = Array.from({ length: 3 + Math.floor(length / 60) }, () => {
    const from = -halfLength + 10 + random() * Math.max(1, length - COLLAR_LENGTH - 30);
    return { from, to: from + 5 + random() * 14, v: (random() * 1.5 - 0.75) * bodyHalf };
  });
  const onStreak = (a: number, v: number) => streaks.some((streak) => a >= streak.from && a <= streak.to && Math.abs(v - streak.v) < P * 0.55);

  // Bolts sit on the collar band and on every flange.
  const collarBolt = collarStart + COLLAR_LENGTH * 0.42;
  const boltAt = (part: number, a: number, v: number) => {
    if (part === 2) return Math.abs((bothEnds ? Math.abs(a) : a) - collarBolt) <= P * 0.6 && [-0.62, 0.62].some((at) => Math.abs(v - at * collarHalf) <= P * 0.6);
    if (part === 3) {
      const ring = flangeAt(a);
      return Math.abs(ring - FLANGE_WIDTH / 2) <= P * 0.6 && [-0.58, 0, 0.58].some((at) => Math.abs(v - at * bodyHalf) <= P * 0.6);
    }
    return false;
  };
  const bolts: number[] = [];
  const across2 = (v: number): [number, number] => (v >= 0 ? [nx, ny] : [-nx, -ny]);
  /** Outward normal of the pipe surface an outline pixel belongs to. */
  const outwardNormal = (part: number, a: number, v: number): [number, number] => {
    const toCap: [number, number] = [ax, ay];
    const toBase: [number, number] = [-ax, -ay];
    if (part === 2) {
      const back = bothEnds && a < 0;
      const capA = back ? -a : a;
      if (capA > halfLength - P * 1.2) return back ? toBase : toCap;
      if (capA < collarStart + P * 1.2 && Math.abs(v) > bodyHalf) return back ? toCap : toBase;
    } else if (part === 3 && Math.abs(v) > bodyHalf) {
      return flangeAt(a) < FLANGE_WIDTH / 2 ? toCap : toBase;
    } else if (part === 1 && a < -halfLength + P * 1.2) {
      return toBase;
    }
    return across2(v);
  };
  // Band-edge dithering reads as noise on sloped pipes; keep it for upright ones.

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const part = kind[index];
      if (!part) continue;
      const openUp = !solid(column, row - 1);
      const openLeft = !solid(column - 1, row);
      const openDown = !solid(column, row + 1);
      const openRight = !solid(column + 1, row);
      const a = along[index];
      const v = across[index];
      if (openUp || openLeft || openDown || openRight) {
        // Selective outline: edges facing the light get a soft teal line,
        // only the shadow side keeps the dark navy contour. The side is
        // decided by the pipe's own geometry, not by which neighbour pixel is
        // empty, so a sloped edge keeps one colour instead of zig-zagging.
        const [ox, oy] = outwardNormal(part, a, v);
        pixels[index] = ox * LIGHT_X + oy * LIGHT_Y > 0.1 ? OUTLINE_LIT : OUTLINE;
        continue;
      }
      const half = part === 2 ? collarHalf : part === 3 ? bodyHalf + FLANGE_LIP : bodyHalf;
      const vn = clamp(v / half, -1, 1);
      const lit = vn * litSign;
      const checker = axisAligned && (row + column) % 2 === 0;
      let level = cylinderShade(vn, lightSide, checker);

      if (boltAt(part, a, v)) {
        pixels[index] = BOLT;
        bolts.push(index);
        continue;
      }
      if (part === 2) {
        // Cap: bright rolled lip, a groove under it, shadowed bottom edge.
        const capA = bothEnds ? Math.abs(a) : a;
        if (capA > halfLength - 4) level = shift(level, 1);
        else if (capA > halfLength - 7) level = shift(level, -2);
        else if (capA < collarStart + P) level = shift(level, -2);
      } else if (part === 3) {
        // Flange: raised band with a lit edge and a shadowed edge.
        const ring = flangeAt(a);
        if (ring < P) level = shift(level, 2);
        else if (ring >= FLANGE_WIDTH - P) level = shift(level, -2);
        else level = shift(level, 1);
      } else {
        const capA = bothEnds ? Math.abs(a) : a;
        if (capA > collarStart - P) {
          pixels[index] = SEAM;
          continue;
        }
        // The collar casts a short shadow on the shaft.
        if (capA > collarStart - P * 3) level = shift(level, -1);
        if (onStreak(a, v)) level = shift(level, -1);
      }
      if (part !== 3 && lit > 0.36 && lit < 0.36 + (P * 1.3) / half && !(part === 1 && (bothEnds ? Math.abs(a) : a) > collarStart - P * 3)) {
        pixels[index] = SPECULAR;
        continue;
      }
      // Reflected sky light: a single pixel just inside the shadow-side outline.
      if (lit < 0 && part !== 3 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const neighbour = kind[(row + dy) * width + column + dx];
        return !neighbour || (kind[(row + 2 * dy) * width + column + 2 * dx] ?? 0) === 0;
      }) && lit < -0.6) {
        pixels[index] = RIM;
        continue;
      }
      pixels[index] = level;
    }
  }
  // Each bolt catches a glint on its upper-left.
  bolts.forEach((index) => {
    const glint = index - width - 1;
    if (glint >= 0 && isBody(pixels[glint])) pixels[glint] = BOLT_LIGHT;
  });

  const pipeTop = new Int16Array(width).fill(-1);
  for (let column = 0; column < width; column += 1) {
    for (let row = 0; row < height; row += 1) {
      if (kind[row * width + column]) {
        pipeTop[column] = row;
        break;
      }
    }
  }
  // Sub-pixel surface height per column keeps snow curves smooth on slopes.
  const exactTop = new Float32Array(width).fill(-1);
  for (let column = 0; column < width; column += 1) {
    if (pipeTop[column] < 0) continue;
    const x = originX + (column + 0.5) * P;
    let sub = (pipeTop[column] - 1) * 4;
    while (sub < (pipeTop[column] + 1) * 4 && !partAt(x, originY + (sub + 0.5) * (P / 4))) sub += 1;
    exactTop[column] = Math.min(pipeTop[column], sub / 4);
  }

  const snowTop = new Int16Array(width).fill(-1);
  layDownSnow({ pixels, width, height, pipeTop, exactTop, snowTop, random, scale: S });
  return { width, height, pixels, originX, originY, pixelSize: P, pipeTop, snowTop };
}

interface SnowLayer {
  /** Pixel counts relative to the 3-unit grid the snow was tuned on. */
  scale: number;
  pixels: Uint8Array;
  width: number;
  height: number;
  pipeTop: Int16Array;
  exactTop: Float32Array;
  snowTop: Int16Array;
  random: () => number;
}


/**
 * Paint one drift per stretch of surface that can hold snow. Stretches are
 * split wherever the surface is too steep, so a small ledge beside a slope
 * gets a small cap rather than the depth of the whole slope.
 */
function layDownSnow(layer: SnowLayer) {
  const { width, pipeTop, exactTop, scale: S } = layer;
  const SURFACE_STEP = 2.5 * S;
  const joined = (a: number, b: number) =>
    a >= 0 && b < width && pipeTop[a] >= 0 && pipeTop[b] >= 0 && Math.abs(exactTop[b] - exactTop[a]) <= SURFACE_STEP;
  const holds = new Uint8Array(width);
  for (let column = 0; column < width; column += 1) {
    if (pipeTop[column] < 0) continue;
    let flattest = 1;
    for (const reach of [2, 3]) {
      let a = column;
      let b = column;
      while (a > column - reach && joined(a - 1, a)) a -= 1;
      while (b < column + reach && joined(b, b + 1)) b += 1;
      const slope = b > a ? (exactTop[b] - exactTop[a]) / (b - a) : 0;
      flattest = Math.min(flattest, 1 / Math.sqrt(1 + slope * slope));
    }
    holds[column] = flattest > 0.62 ? 1 : 0;
  }
  let start = 0;
  while (start < width) {
    if (!holds[start]) {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < width && holds[end + 1] && joined(end, end + 1)) end += 1;
    paintDrift(layer, start, end);
    start = end + 1;
  }
}

function paintDrift(layer: SnowLayer, start: number, end: number) {
  const { pixels, width, height, pipeTop, exactTop, snowTop, random, scale: S } = layer;
  const MAX_SNOW = maxSnow(S);
  const run = end - start + 1;
  // Single columns (stair corners of tilted ends) would become spikes.
  if (run < 3 || (run < 4 * S && Math.abs(exactTop[end] - exactTop[start]) > S)) return;
  const thickness = run < 4 * S ? S : Math.min(MAX_SNOW, 1.1 * S + run * 0.2);
  // A wide drift rolls over the ends of its support like a soft cushion.
  const overhang = run >= 10 * S ? 2 * S : run >= 5 * S ? 1 * S : 0;
  // Only overhang into open air; against a taller neighbour the drift ends round.
  const left = start - (start > 0 && pipeTop[start - 1] < 0 ? overhang : 0);
  const right = end + 1 + (end + 1 < width && pipeTop[end + 1] < 0 ? overhang : 0);
  const span = right - left;
  const radius = Math.min(thickness + 1.5 * S, span / 2);
  // The top keeps curving: three waves of different length add up, so the
  // height changes all along the drift instead of resting on flat runs.
  const waves = [
    { length: (9 + random() * 5) * S, phase: random() * Math.PI * 2, weight: 0.5 },
    { length: (15 + random() * 8) * S, phase: random() * Math.PI * 2, weight: 0.35 },
    { length: (30 + random() * 20) * S, phase: random() * Math.PI * 2, weight: 0.3 },
  ];
  const ripple = (center: number) => waves.reduce((sum, wave) => sum + wave.weight * Math.sin((center / wave.length) * Math.PI * 2 + wave.phase), 0);
  const settleOver = (column: number, reach: number) => {
    const a = Math.max(start, column - reach);
    const b = Math.min(end, column + reach);
    const slope = b > a ? (exactTop[b] - exactTop[a]) / (b - a) : 0;
    const level = 1 / Math.sqrt(1 + slope * slope);
    return clamp((level - 0.62) / 0.3, 0, 1);
  };
  // Both the local and the wider slope must be gentle enough to hold snow.
  const settleAt = (column: number) => Math.min(settleOver(column, 2), settleOver(column, 3));

  const firstColumn = Math.max(0, Math.floor(left));
  const lastColumn = Math.min(width - 1, Math.ceil(right) - 1);
  const tops = new Map<number, { top: number; contact: number; supported: boolean }>();
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    const center = column + 0.5;
    const supported = column >= start && column <= end;
    // Overhang only into open air, never onto another drift's support.
    if (!supported && layer.pipeTop[column] >= 0) continue;
    const anchor = supported ? column : column < start ? start : end;
    const settle = settleAt(anchor);
    if (settle <= 0) continue;
    // Rounded ends: a quarter circle rising from each end of the drift.
    const fromEnd = Math.min(center - left, right - center);
    const t = clamp(fromEnd / radius, 0, 1);
    const roundness = Math.sqrt(1 - (1 - t) * (1 - t));
    const depth = (thickness * 0.7 + ripple(center) * Math.min(thickness * 0.45, 2.2 * S)) * settle * roundness;
    // Pile on a smoothed surface so small ridges (flanges) don't poke through as spikes.
    let sum = 0;
    let count = 0;
    for (let near = Math.max(start, anchor - 3); near <= Math.min(end, anchor + 3); near += 1) {
      sum += exactTop[near];
      count += 1;
    }
    const surface = Math.max(exactTop[anchor], sum / count);
    // Past the support the cushion droops down over the edge, rounded.
    const past = supported ? 0 : column < start ? start - center : center - (end + 1);
    const droop = supported || !overhang ? 0 : Math.round(Math.min(thickness * 0.6, 2 * S) * Math.sqrt(Math.max(0, 1 - (past / overhang) ** 2)));
    const contact = supported ? pipeTop[column] : Math.round(surface) + droop;
    let top = Math.round(surface - depth);
    // Narrow ledges keep at least a one-pixel cap.
    if (supported && settle > 0.5 && top >= contact) top = contact - 1;
    if (top >= contact + (supported ? 0 : 1)) continue;
    tops.set(column, { top: Math.max(0, top), contact, supported });
  }

  // No one-pixel bumps or dents: neighbours decide isolated columns.
  for (let pass = 0; pass < 2; pass += 1) {
    tops.forEach((entry, column) => {
      const a = tops.get(column - 1);
      const b = tops.get(column + 1);
      if (!a || !b) return;
      if (entry.top < a.top && entry.top < b.top) entry.top = Math.min(a.top, b.top);
      if (entry.top > a.top && entry.top > b.top) entry.top = Math.max(a.top, b.top);
    });
  }

  // The underside hangs unevenly: a gently waving lip all along, plus drips
  // of random depth and width here and there, each rounded.
  const sag = new Map<number, number>();
  if (run >= 8 * S) {
    const lipLength = (7 + random() * 6) * S;
    const lipPhase = random() * Math.PI * 2;
    const drips: Array<{ center: number; half: number; depth: number }> = [];
    for (let cursor = start + (3 + random() * 6) * S; cursor < end - 3 * S; cursor += (8 + random() * 12) * S) {
      drips.push({ center: cursor, half: (3 + random() * 3.5) * S, depth: (0.8 + random() * 1.6) * S });
    }
    for (let column = start; column <= end; column += 1) {
      const center = column + 0.5;
      let hang = 0.35 * S * (1 + Math.sin((center / lipLength) * Math.PI * 2 + lipPhase));
      drips.forEach((drip) => {
        const d = (center - drip.center) / drip.half;
        // Soft bulge: flat-ish bottom with rounded shoulders.
        if (Math.abs(d) < 1) hang = Math.max(hang, drip.depth * Math.sqrt(Math.sqrt(1 - d * d)));
      });
      // Taper toward the drift's ends.
      const taper = clamp(Math.min(column - start, end - column) / (3 * S), 0, 1);
      const rounded = Math.round(hang * taper);
      if (rounded > 0) sag.set(column, rounded);
    }
    // No lone one-column drips.
    sag.forEach((hang, column) => {
      const neighbour = Math.max(sag.get(column - 1) ?? 0, sag.get(column + 1) ?? 0);
      if (hang > neighbour + 1) sag.set(column, neighbour + 1);
    });
  }

  tops.forEach(({ top, contact, supported }, column) => {
    if (supported && settleAt(column) < 0.9) sag.delete(column);
    const hang = sag.get(column) ?? 0;
    const bottom = Math.min(height - 1, contact + (supported ? 1 : 0) + hang);
    const rightNeighbour = tops.get(column + 1);
    const leftNeighbour = tops.get(column - 1);
    // Only the true right end of a drift turns into shade; slopes stay even.
    const rightEdge = !rightNeighbour || (rightNeighbour.top > top + 1 && !tops.get(column + 2));
    const leftEdge = !leftNeighbour;
    snowTop[column] = top;
    for (let row = top; row <= bottom; row += 1) {
      const fromTop = row - top;
      let color = SNOW_BASE;
      if (fromTop === 0) color = rightEdge && !leftEdge ? SNOW_BASE : SNOW_LIGHT;
      if (rightEdge && !rightNeighbour && fromTop > 0) color = SNOW_SHADE;
      // Undersides: hanging lumps and the drooping ends are in shade.
      if (row >= contact + (supported ? 1 : 0) && (row === bottom || !supported)) color = SNOW_SHADE;
      if (!supported && row === bottom) color = SNOW_DEEP;
      pixels[row * width + column] = color;
    }
    // A thin line of frost where the snow meets the pipe.
    const below = (bottom + 1) * width + column;
    if (supported && bottom + 1 < height && isBody(pixels[below])) pixels[below] = FROST;
  });
}

const pipeCache = new Map<string, { canvas: HTMLCanvasElement; raster: PipeRaster }>();
const PALETTE_RGBA = PIPE_PALETTE.map((hex) => (hex === 'transparent' ? [0, 0, 0, 0] : [...nightTint(hex), 255]));

function cachedPipe(options: PipeRasterOptions) {
  const key = [options.seed, options.length.toFixed(1), options.thickness, options.rotation.toFixed(4)].join(':');
  let cached = pipeCache.get(key);
  if (!cached) {
    const raster = rasterizePipe(options);
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    const paint = canvas.getContext('2d');
    if (!paint) return null;
    const image = paint.createImageData(raster.width, raster.height);
    raster.pixels.forEach((color, index) => image.data.set(PALETTE_RGBA[color], index * 4));
    paint.putImageData(image, 0, 0);
    cached = { canvas, raster };
    pipeCache.set(key, cached);
    if (pipeCache.size > 96) pipeCache.delete(pipeCache.keys().next().value!);
  }
  return cached;
}

export function drawPipe(context: CanvasRenderingContext2D, entity: PipeAppearance, y: number) {
  const orientation = entity.pipeOrientation ?? 'vertical';
  const rotation = (orientation === 'horizontal' ? Math.PI / 2 : 0) + (entity.pipeRotation ?? 0);
  const thickness = orientation === 'horizontal' ? entity.height : entity.width;
  const length = orientation === 'horizontal' ? entity.width : entity.height;
  const cached = cachedPipe({ seed: Math.imul(entity.id + 17, 1103515245), length, thickness, rotation });
  if (!cached) return;
  const { canvas, raster } = cached;
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(canvas, entity.x + raster.originX, y + raster.originY, canvas.width * raster.pixelSize, canvas.height * raster.pixelSize);
  context.restore();
}
