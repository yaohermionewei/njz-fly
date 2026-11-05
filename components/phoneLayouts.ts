import {
  BAR, CRUISE_SPEED, WORLD_HEIGHT, PIPE_THICKNESS, mirrorContent, readSegmentDesign,
  pigCenterY, pipePolygon, isPipeJunction, polygonsOverlap, rectPolygon, solveSegment,
  type CoinRole, type CoinSpec, type DesignPath, type PipeSpec, type Point, type SegmentContent, type SegmentDef,
} from './levelSegments';
import { PHONE_ENTITY_SCALE, pigScaleFor } from './displayProfile';
import { pickupEnvelope, type PickupArt } from './gameMetrics';

/**
 * Phone port of the desktop segments.
 *
 * A phone shows the same 720-unit-tall world, but every object is 1.5× larger,
 * and the world scrolls 1.5× further per beat. Horizontally the phone level is
 * therefore the desktop level scaled by exactly 1.5: timing, spacing between
 * light sticks and pipe lengths all keep their proportions. Vertically there
 * is not room for 1.5×: the desktop field is nine player-heights tall, the
 * phone field only six.
 *
 * So each segment gets one vertical layout scale `k` (1…1.5): every vertical
 * position is scaled by k around the middle of the screen, as large as the
 * segment allows. Shapes stay shapes (curves bend the same way, zigzags keep
 * alternating), gate gaps keep the full 1.5× (the squeeze of a gate is part of
 * its feel), and every desktop pipe, pig and light stick is carried over one
 * to one. The few segments whose desktop layout uses the full height get a
 * documented local edit in PHONE_EDITS instead of a different design.
 */

export interface PickupRoute { id: string; points: Point[]; role: CoinRole; main?: boolean }
export interface PhoneLayoutIssue { kind: string; x: number; y: number; message: string }

const S = PHONE_ENTITY_SCALE;
// levelSegments imports this module first, so its constants are read lazily.
const authorToWorld = () => CRUISE_SPEED / 410;

export const PHONE_RULES = {
  /** Ceiling and floor pipes always show a real length, never a stub. */
  anchorVisible: 100,
  /** Pickups stay below the HUD and above the touch buttons. */
  pickupTop: 70,
  pickupBottom: 650,
  /** Desktop keeps pipes 12 apart beyond their caps; scaled with the pipes. */
  pipeMargin: 12 * S,
  /** Two phone player heights: the narrowest gate a thumb should thread. */
  minGate: 240,
  /** Never squeeze a layout below its desktop spacing. */
  minLayoutScale: 1,
} as const;

export function pickupArt(coin: CoinSpec): PickupArt {
  return coin.role === 'morph' ? 'morph' : coin.role === 'power' ? 'power'
    : coin.role === 'heal' || coin.role === 'riskHeal' ? 'heal' : 'stick';
}
export function pickupPolygon(coin: CoinSpec, scale = S): Point[] {
  const box = pickupEnvelope(pickupArt(coin), scale);
  return rectPolygon(coin.x - box.width / 2, coin.y - box.height / 2, box.width, box.height);
}
/** Conservative silhouette: cap, outer pixel edge, snow crest and rounded overhang. */
export function pipeVisualPolygon(pipe: PipeSpec): Point[] {
  return pipePolygon({ ...pipe, length: pipe.length + 20 }, pipe.x, pipe.y - 10, PIPE_THICKNESS * (pipe.scale ?? 1) + 6);
}

const ceiling = (x: number, end: number): PipeSpec => ({ x, y: (end - 60) / 2, length: end + 60, facing: 'down', scale: S, anchor: 'ceiling' });
const ground = (x: number, end: number): PipeSpec => ({ x, y: (end + WORLD_HEIGHT + 60) / 2, length: WORLD_HEIGHT + 60 - end, facing: 'up', scale: S, anchor: 'floor' });
const isHorizontal = (pipe: PipeSpec) => pipe.facing === 'left' || pipe.facing === 'right';
const anchorOf = (pipe: PipeSpec) => pipe.facing === 'down' && pipe.y - pipe.length / 2 <= -59 ? 'ceiling'
  : pipe.facing === 'up' && pipe.y + pipe.length / 2 >= WORLD_HEIGHT + 59 ? 'floor' : undefined;
/** The free end of a ceiling or floor pipe. */
export const anchorEnd = (pipe: PipeSpec) => (pipe.anchor ?? anchorOf(pipe)) === 'ceiling' ? pipe.y + pipe.length / 2 : pipe.y - pipe.length / 2;

/** Draft in phone units, before mirroring. Kill sticks remember their pig. */
interface Draft {
  pipes: PipeSpec[];
  pigs: SegmentContent['pigs'];
  coins: Array<CoinSpec & { pigOffset?: number }>;
  routes: PickupRoute[];
  /** Desktop author coordinates to phone units for this draft. */
  x: (x: number) => number;
  y: (y: number) => number;
}

/** Local edits for layouts that use the whole desktop height. Coordinates are
 * phone units (x already ×1.5), unmirrored, after the scale-k transform. */
interface PhoneEdit {
  /** Lowest layout scale to try (default 1: never tighter than desktop). */
  minK?: number;
  /** Gate gap multiplier for layout scale k (default: k, like every other vertical distance). */
  gap?: (k: number) => number;
  /** Floating vertical/tilted pipe length relative to desktop (default 1.5). */
  postLength?: number;
  apply?: (draft: Draft) => void;
}

/** Desktop sticks of one path become shoot-first sticks on a pig's walkway. */
function onWalkway(draft: Draft, index: number, pipe: number) {
  for (const coin of draft.coins.filter(c => c.routeId === `path-${index}`)) {
    Object.assign(coin, { role: 'kill', supportPipe: pipe, pigOffset: WALKWAY_OFFSET, y: pigCenterY(draft.pipes[pipe]) + WALKWAY_OFFSET });
  }
  const route = draft.routes.find(r => r.id === `path-${index}`);
  if (route) Object.assign(route, { role: 'kill', main: false });
}
const WALKWAY_OFFSET = -8;

/**
 * Segments whose desktop layout fills the whole height. Indices are the
 * desktop pipe and path order in levelSegments.
 */
const PHONE_EDITS: Record<string, PhoneEdit> = {
  // Four gates, 100 apart, over the full height: steps shrink to ~90 rather
  // than gates closing below two player heights or turning into stubs.
  'gate-stairs': { minK: 0.9 },
  // Four long posts, each 1.5× as long, would cover five of the six player
  // heights and leave no weave. They keep 1.2× their desktop length.
  'blocks-weave': { postLength: 1.2 },
  // Six short blocks scattered over nine player heights: at 1.5× the top and
  // bottom ones close the gaps their sticks hide in, so they grow 1.3×.
  'blocks-scatter': { postLength: 1.3 },
  // The desktop definition stands its pig on the gate's lower pipe (index 1)
  // although the intent is the beam after the gate; the phone uses the beam.
  'combo-gate-pig': {
    apply: draft => {
      draft.pigs[0].pipe = 2;
      onWalkway(draft, 1, 2);
    },
  },
  // Three floors need four player heights plus two beams: the middle floor
  // keeps its pig and sticks, but they are now shoot-first sticks. The exit
  // string starts a little later, since the middle floor is no longer a way
  // out before the pig is shot.
  'split-floors': {
    apply: draft => {
      onWalkway(draft, 1, 1);
      reroute(draft, 3, [[draft.x(1260), draft.y(360)], [draft.x(1720), draft.y(360)]]);
    },
  },
};

/** Mirroring happens on the desktop layout, before anything is fitted. */
function transform(design: ReturnType<typeof readSegmentDesign>, mirrored: boolean, k: number, shift: number, edit: PhoneEdit): Draft {
  const { content: authored, paths } = design;
  const content = mirrored ? mirrorContent(authored) : authored;
  const mid = WORLD_HEIGHT / 2;
  const X = authorToWorld();
  const scaled = (value: number) => mid + (value - mid) * k + shift;
  const flip = (value: number) => (mirrored ? WORLD_HEIGHT - value : value);
  const y = (value: number) => scaled(flip(value));
  const x = (value: number) => value * X * S;
  const pipes = content.pipes.map((pipe, index): PipeSpec => {
    const anchor = anchorOf(pipe);
    if (!anchor) {
      // A floating pipe keeps its full enlarged length; if that would leave
      // the screen, it slides in just far enough.
      const length = pipe.length * (isHorizontal(pipe) ? S * X : edit.postLength ?? S);
      return keepOnScreen({ ...pipe, x: x(pipe.x), y: scaled(pipe.y), length, scale: S });
    }
    const partner = content.pipes.find((other, j) => j !== index && Math.abs(other.x - pipe.x) < 1 && anchorOf(other) && anchorOf(other) !== anchor);
    let end = scaled(anchorEnd(pipe));
    if (partner) {
      // A gate scales like the rest of the layout, but never closes below
      // two player heights (or its fully enlarged gap, if that is smaller).
      const top = anchor === 'ceiling' ? anchorEnd(pipe) : anchorEnd(partner);
      const bottom = anchor === 'ceiling' ? anchorEnd(partner) : anchorEnd(pipe);
      const center = scaled((top + bottom) / 2);
      const gap = Math.max((bottom - top) * (edit.gap?.(k) ?? k), Math.min((bottom - top) * S, PHONE_RULES.minGate));
      end = anchor === 'ceiling' ? center - gap / 2 : center + gap / 2;
    }
    return anchor === 'ceiling' ? ceiling(x(pipe.x), end) : ground(x(pipe.x), end);
  });
  // Sticks behind a pig stay level with the pig, whose size grows less.
  const nearestPig = (coin: CoinSpec) => authored.pigs.reduce<number | undefined>((best, pig) => best === undefined
    || Math.abs(authored.pipes[pig.pipe].x - coin.x) < Math.abs(authored.pipes[best].x - coin.x) ? pig.pipe : best, undefined);
  // path() emits its sticks in call order, so the first sticks belong to the
  // first recorded path and so on; shapes come after their paths.
  const owners = paths.flatMap((path, index) => Array(pathCount(path)).fill(`path-${index}`));
  const coins = authored.coins.map((coin, index) => {
    const routeId = owners[index];
    const support = coin.role === 'kill' || coin.role === 'riskHeal' ? nearestPig(coin) : undefined;
    if (support === undefined) return { ...coin, x: x(coin.x), y: y(coin.y), ...(routeId ? { routeId } : { patternId: 'shape' }) };
    // Pigs always stand on top of their pipe, mirrored or not.
    const pigOffset = (coin.y - pigCenterY(authored.pipes[support])) * pigScaleFor(S);
    return { ...coin, x: x(coin.x), y: pigCenterY(pipes[support]) + pigOffset, supportPipe: support, pigOffset, ...(routeId ? { routeId } : {}) };
  });
  const routes = paths.map((path, index) => ({
    id: `path-${index}`, role: path.role, main: path.role === 'guide',
    points: path.points.map(([px, py]) => ({ x: x(px), y: y(py) })),
  }));
  return { pipes, pigs: content.pigs.map(pig => ({ ...pig })), coins, routes, x, y };
}

function keepOnScreen(pipe: PipeSpec) {
  const ys = pipeVisualPolygon(pipe).map(p => p.y);
  pipe.y += Math.max(0, 16 - Math.min(...ys)) - Math.max(0, Math.max(...ys) - (WORLD_HEIGHT - 16));
  return pipe;
}

/** Same count as levelSegments' path(). */
function pathCount(path: DesignPath) {
  const total = path.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path.points[i][0], p[1] - path.points[i][1]), 0);
  return Math.max(1, Math.round(total / path.spacing)) + 1;
}

/** Moves one desktop route to new phone points, keeping its number of sticks. */
function reroute(draft: Draft, index: number, points: Array<[number, number]>) {
  const id = `path-${index}`;
  const coins = draft.coins.filter(coin => coin.routeId === id);
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  coins.forEach((coin, n) => {
    let distance = coins.length > 1 ? total * n / (coins.length - 1) : 0;
    let i = 0;
    while (i < lengths.length - 1 && distance > lengths[i]) distance -= lengths[i++];
    const t = lengths[i] ? distance / lengths[i] : 0;
    coin.x = points[i][0] + (points[i + 1][0] - points[i][0]) * t;
    coin.y = points[i][1] + (points[i + 1][1] - points[i][1]) * t;
  });
  const route = draft.routes.find(r => r.id === id);
  if (route) route.points = points.map(([x, y]) => ({ x, y }));
}

function toContent(draft: Draft, layoutScale: number): SegmentContent {
  return {
    entityScale: S,
    layoutScale,
    pipes: draft.pipes,
    pigs: draft.pigs,
    coins: draft.coins.map(({ pigOffset: _, ...coin }) => coin),
    routes: draft.routes,
  };
}

/** Development aid: one candidate layout and why it is rejected. */
export function explainPhoneLayout(segment: SegmentDef, random: () => number, mirrored: boolean, k: number, shift: number) {
  const design = readSegmentDesign(segment, random);
  const edit = PHONE_EDITS[segment.id] ?? {};
  const draft = transform(design, mirrored, k, shift, edit);
  edit.apply?.(draft);
  const content = toContent(draft, k);
  const width = segment.bars * BAR * S;
  return { content, issues: validatePhoneLayout(content, width), solved: solveSegment(content, width) };
}

const layoutCache = new Map<string, SegmentContent>();
/** Up to this much the whole layout may slide up or down to use empty space. */
const SHIFTS = [0, ...Array.from({ length: 12 }, (_, i) => [(i + 1) * 10, -(i + 1) * 10]).flat()];

export function buildPhoneLayout(segment: SegmentDef, random: () => number, mirrored: boolean): SegmentContent {
  const design = readSegmentDesign(segment, random);
  const key = `${segment.id}|${mirrored}|${JSON.stringify(design.content)}`;
  const cached = layoutCache.get(key);
  if (cached) return structuredClone(cached);
  const edit = PHONE_EDITS[segment.id] ?? {};
  const width = segment.bars * BAR * S;
  const make = (k: number, shift: number) => {
    const draft = transform(design, mirrored, k, shift, edit);
    edit.apply?.(draft);
    return toContent(draft, k);
  };
  // Largest vertical scale that keeps everything on screen, apart and passable.
  let result: SegmentContent | undefined;
  search: for (let k = S; k >= (edit.minK ?? PHONE_RULES.minLayoutScale) - 1e-9; k -= 0.02) {
    for (const shift of SHIFTS) {
      const content = make(k, shift);
      if (!validatePhoneLayout(content, width).length && solveSegment(content, width).ok) { result = content; break search; }
    }
  }
  result ??= make(edit.minK ?? PHONE_RULES.minLayoutScale, 0);
  layoutCache.set(key, result);
  return structuredClone(result);
}

/** Phone-only checks; distances are the desktop rules scaled with the objects. */
export function validatePhoneLayout(content: SegmentContent, width: number): PhoneLayoutIssue[] {
  const issues: PhoneLayoutIssue[] = [];
  const add = (kind: string, p: Point, message: string) => issues.push({ kind, x: p.x, y: p.y, message });
  const bodies = content.pipes.map(pipe => pipePolygon(pipe, pipe.x, pipe.y, PIPE_THICKNESS * S + PHONE_RULES.pipeMargin));
  content.pipes.forEach((pipe, i) => {
    if (pipe.anchor) {
      const visible = pipe.anchor === 'ceiling' ? anchorEnd(pipe) : WORLD_HEIGHT - anchorEnd(pipe);
      if (visible < PHONE_RULES.anchorVisible - 0.01) add('pipe-length', pipe, `水管 ${i} 露出不足 ${PHONE_RULES.anchorVisible}`);
    } else {
      const ys = pipeVisualPolygon(pipe).map(p => p.y);
      if (Math.min(...ys) < 0 || Math.max(...ys) > WORLD_HEIGHT) add('pipe-offscreen', pipe, `水管 ${i} 有一部分在屏幕外`);
    }
    if (bodies[i].some(p => p.x < 24 || p.x > width - 24)) add('boundary', pipe, `水管 ${i} 越过片段边界`);
    const joined = pipe.joinsTo;
    if (joined !== undefined && !isPipeJunction(content.pipes, i, joined)) add('pipe-junction', pipe, `水管 ${i} 未接实支撑管`);
    for (let j = i + 1; j < bodies.length; j++) {
      if (!isPipeJunction(content.pipes, i, j) && polygonsOverlap(bodies[i], bodies[j])) add('pipe-gap', pipe, `水管 ${i}/${j} 挤在一起`);
    }
  });
  content.pigs.forEach((pig) => {
    const support = content.pipes[pig.pipe];
    const top = pigCenterY(support) - 34 * pigScaleFor(S);
    if (top < 0) add('pig-offscreen', { x: support.x, y: top }, '猪在屏幕外');
  });
  const hits = content.pipes.map(pipe => pipePolygon(pipe));
  content.coins.forEach((coin, i) => {
    if (coin.y < PHONE_RULES.pickupTop || coin.y > PHONE_RULES.pickupBottom) add('pickup-edge', coin, `拾取物 ${i} 贴近屏幕边缘`);
    const shape = pickupPolygon(coin);
    if (hits.some(hit => polygonsOverlap(shape, hit))) add('pickup-pipe', coin, `拾取物 ${i} 压在水管上`);
  });
  return issues;
}
