import {
  BAR, BEAT, CRUISE_SPEED, WORLD_HEIGHT, PIPE_THICKNESS, PLAYER_SIZE, PIG_HEIGHT, SOLVER_STEP, readSegmentDesign,
  pigCenterY, pigPatrolHalfSpan, pipePolygon, isPipeJunction, polygonsOverlap, rectPolygon, solveSegment, fullEntry, segmentWidth,
  type CoinRole, type CoinSpec, type PipeSpec, type Point, type SegmentContent,
  type PlannedSegment, type PigSpec, type SegmentDef,
} from './levelSegments';
import { PHONE_ENTITY_SCALE } from './displayProfile';
import { PHONE_SPACE, PIG_VISUAL_ASPECT, pickupEnvelope, type PickupArt } from './gameMetrics';

export interface PickupRoute {
  id: string;
  points: Point[];
  role: CoinRole;
  main?: boolean;
  supportPipe?: number;
  emit?: boolean;
  sourceRole?: CoinRole;
  clearance?: number;
  joinGroup?: string;
  spacing?: number;
}
export interface PhoneLayoutIssue { kind: string; x: number; y: number; message: string }
type Builder = (random: () => number, mirrored: boolean) => SegmentContent;
type XY = [number, number];
const S = PHONE_ENTITY_SCALE;
const P = (x: number, y: number): Point => ({ x, y });
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Y range of an authored route while the whole character crosses a pipe. */
function routeSlab(points: Point[], left: number, right: number): [number, number] | undefined {
  const ys: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const from = Math.max(left, a.x), to = Math.min(right, b.x);
    if (from > to || b.x <= a.x) continue;
    for (const x of [from, to]) ys.push(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
  }
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : undefined;
}

/** Extend anchored gates up to their actual flight corridor. Unlike a fixed
 * oversized gap, this keeps the walls close through bends and stair steps. */
function fitRouteGates(pipes: PipeSpec[], routes: PickupRoute[]) {
  const halfCrossing = (PIPE_THICKNESS * S + 6) / 2 + PLAYER_SIZE * S / 2;
  for (const top of pipes.filter(p => p.anchor === 'ceiling')) {
    const bottom = pipes.find(p => p.anchor === 'floor' && p.x === top.x);
    if (!bottom) continue;
    const bounds = routes.filter(r => r.main && r.points[0].x <= top.x && r.points.at(-1)!.x >= top.x).flatMap(r => {
      const slab = routeSlab(r.points, top.x - halfCrossing, top.x + halfCrossing);
      const half = (r.clearance ?? PHONE_SPACE.corridor) / 2;
      return slab ? [[slab[0] - half - 8, slab[1] + half + 28]] : [];
    });
    if (!bounds.length) continue;
    Object.assign(top, ceiling(top.x, Math.min(...bounds.map(b => b[0]))));
    Object.assign(bottom, ground(bottom.x, Math.max(...bounds.map(b => b[1]))));
  }
}

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
function pointEdgeDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function polygonDistance(a: Point[], b: Point[]): number {
  if (polygonsOverlap(a, b)) return 0;
  let min = Infinity;
  for (const [source, target] of [[a, b], [b, a]]) {
    for (const p of source) for (let i = 0; i < target.length; i++) {
      min = Math.min(min, pointEdgeDistance(p, target[i], target[(i + 1) % target.length]));
    }
  }
  return min;
}

function route(id: string, points: XY[], role: CoinRole = 'guide', main = true, supportPipe?: number, emit = true): PickupRoute {
  return { id, points: points.map(([x, y]) => P(x, y)), role, main, supportPipe, emit };
}
function samples(points: Point[], spacing: number): Point[] {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0);
  const count = Math.floor(total / spacing);
  const out: Point[] = [];
  for (let i = 0; i <= count; i++) {
    let distance = (total - count * spacing) / 2 + i * spacing;
    let edge = 0;
    while (edge < lengths.length - 1 && distance > lengths[edge]) distance -= lengths[edge++];
    const ratio = distance / (lengths[edge] || 1);
    out.push(P(points[edge].x + ratio * (points[edge + 1].x - points[edge].x), points[edge].y + ratio * (points[edge + 1].y - points[edge].y)));
  }
  return out;
}
const ceiling = (x: number, end: number): PipeSpec => ({ x, y: (end - 60) / 2, length: end + 60, facing: 'down', scale: S, anchor: 'ceiling' });
const ground = (x: number, end: number): PipeSpec => ({ x, y: (end + WORLD_HEIGHT + 60) / 2, length: WORLD_HEIGHT + 60 - end, facing: 'up', scale: S, anchor: 'floor' });
const post = (x: number, y: number, length: number, tilt = 0): PipeSpec => ({ x, y, length, facing: 'up', tilt, scale: S });
/** Original author length, with exactly the same cruise conversion as desktop. */
const beam = (x: number, y: number, length: number): PipeSpec => ({ x, y, length: length * (CRUISE_SPEED / 410) * S, facing: 'right', scale: S });
const gate = (x: number, center: number, gap = 304) => [ceiling(x, center - gap / 2), ground(x, center + gap / 2)];
const pig = (pipe: number, patrol = 0.35, phase = 0): PigSpec => ({ pipe, patrol, phase, speed: patrol ? 45 : 0 });
export const walkwayRewardY = (pipe: PipeSpec) => pigCenterY(pipe) - 32;

function finish(width: number, pipes: PipeSpec[], pigs: PigSpec[], routes: PickupRoute[], coins: CoinSpec[] = [], mirrored = false): SegmentContent {
  // Distance travelled per beat scales with the enlarged objects. Musical
  // duration stays unchanged; lengths above are already full physical sizes.
  width *= S;
  pipes = pipes.map(p => ({ ...p, x: p.x * S }));
  routes = routes.map(r => ({ ...r, points: r.points.map(p => ({ ...p, x: p.x * S })) }));
  coins = coins.map(c => ({ ...c, x: c.x * S }));
  let result: SegmentContent = { entityScale: S, pipes, pigs, routes, coins };
  if (mirrored) {
    const facing = { up: 'down', down: 'up', left: 'left', right: 'right' } as const;
    result = { ...result,
      pipes: pipes.map(p => ({ ...p, y: WORLD_HEIGHT - p.y, facing: facing[p.facing], tilt: p.tilt === undefined ? undefined : -p.tilt,
        ...(p.anchor ? { anchor: p.anchor === 'floor' ? 'ceiling' as const : 'floor' as const } : {}) })),
      routes: routes.map(r => ({ ...r, points: r.points.map(p => P(p.x, WORLD_HEIGHT - p.y)) })),
      coins: coins.map(c => ({ ...c, y: WORLD_HEIGHT - c.y })),
    };
  }
  for (const r of result.routes!) {
    if (r.emit === false) continue;
    // Leave enough room for the next segment and for enlarged special items at boundaries.
    const points = samples(r.points, r.spacing ?? PHONE_SPACE.pathSpacing).filter(p => p.x >= 104 && p.x <= width - 104);
    for (const p of points) {
      const coin = { ...p, role: r.role, routeId: r.id, ...(r.supportPipe === undefined ? {} : { supportPipe: r.supportPipe }) };
      // A fork's common exit is one shared string, not two overlapping ones.
      if (r.joinGroup && p.x > width - 250 && result.coins.some(c => result.routes!.find(other => other.id === c.routeId)?.joinGroup === r.joinGroup && polygonDistance(pickupPolygon(coin), pickupPolygon(c)) < PHONE_SPACE.pickupGap)) continue;
      result.coins.push(coin);
    }
  }
  return result;
}
const main = (width: number, y = 360, emit = true) => route('main', [[0, y], [width, y]], 'guide', true, undefined, emit);
function pattern(rows: string[], centerX: number, top: number, id: string, gridX: number = PHONE_SPACE.patternStepX, gridY: number = PHONE_SPACE.patternStepY): CoinSpec[] {
  const stepX = gridX / S;
  const left = centerX - (rows[0].length - 1) * stepX / 2;
  return rows.flatMap((line, row) => [...line].flatMap((cell, col) => cell === '#'
    ? [{ x: left + col * stepX, y: top + row * gridY, role: 'bonus' as const, patternId: id }] : []));
}
// The face is wider than a single grid cell: both isolated eye points fit
// between the cheeks without deleting detail or tightening the 84/104 grid.
const RABBIT = ['.###...###.', '#...#.#...#', '#....#....#', '#..#...#..#', '.#.......#.', '..#######..'];
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const BELL = ['...#...', '..#.#..', '..#.#..', '.#...#.', '#######', '...#...'];
const LETTERS = [['#..#', '##.#', '#.##', '#..#', '#..#'], ['.###', '...#', '...#', '#..#', '.##.'], ['####', '...#', '..#.', '.#..', '####']];

/** Compact reward drawings retain their outline, eyes, fill and lettering. */
const PHONE_PATTERNS: Record<string, Builder> = {
  'bonus-bunny': () => finish(BAR * 2, [], [], [route('entry', [[140, 360], [650, 360]])], pattern(RABBIT, BAR * 1.3, 100, 'bunny')),
  'bonus-grid': random => finish(BAR, [], [], [main(BAR, 360, false)], pattern(['######', '######', '######', '######'], BAR / 2, [220, 250, 280][Math.floor(random() * 3)], 'grid', 96 * (CRUISE_SPEED / 410) * S, 120)),
  'bonus-heart': () => finish(BAR, [], [], [main(BAR, 360, false)], pattern(HEART, BAR / 2, 100, 'heart')),
  'bonus-bell': () => finish(BAR * 2, [], [], [route('entry', [[140, 360], [650, 360]])], pattern(BELL, BAR * 1.15, 100, 'bell')),
  'bonus-njz': () => finish(BAR * 2, [], [], [main(BAR * 2, 360, false)], LETTERS.flatMap((rows, i) => pattern(rows, [250, 790, 1330][i] * (CRUISE_SPEED / 410), 152, ['N', 'J', 'Z'][i]))),
};

/** Preserve the original obstacle inventory and paths; only clearance edits
 * below may move a control point or obstacle. No substitute segment motifs. */
export function buildOriginalPhoneLayout(segment: SegmentDef, random: () => number, mirrored: boolean): SegmentContent {
  if (segment.id.startsWith('bonus-')) return PHONE_PATTERNS[segment.id](random, mirrored);
  const { content: original, paths } = readSegmentDesign(segment, random);
  const X = CRUISE_SPEED / 410;
  const pipes = original.pipes.map(p => {
    const anchor = p.facing === 'down' && p.y - p.length / 2 <= -59 ? 'ceiling'
      : p.facing === 'up' && p.y + p.length / 2 >= 779 ? 'floor' : undefined;
    const horizontal = p.facing === 'left' || p.facing === 'right';
    return { ...p, x: p.x * X, length: anchor ? p.length : p.length * S * (horizontal ? X : 1), scale: S,
      ...(anchor ? { anchor } : {}) } as PipeSpec;
  });
  for (const top of pipes.filter(p => p.anchor === 'ceiling')) {
    const bottom = pipes.find(p => p.anchor === 'floor' && p.x === top.x);
    if (!bottom) continue;
    const center = (top.y + top.length / 2 + bottom.y - bottom.length / 2) / 2;
    const gap = original.pigs.some(p => pipes[p.pipe] === bottom) ? 420 : 336;
    Object.assign(top, ceiling(top.x, center - gap / 2));
    Object.assign(bottom, ground(bottom.x, center + gap / 2));
  }
  const routes = paths.map((r, i) => {
    let support: number | undefined;
    if (r.role === 'kill' && original.pigs.length) {
      const middle = r.points.reduce((sum, p) => sum + p[0], 0) / r.points.length;
      support = [...original.pigs].sort((a, b) => Math.abs(original.pipes[a.pipe].x - middle) - Math.abs(original.pipes[b.pipe].x - middle))[0].pipe;
    }
    return { ...route(`path-${i}`, r.points.map(([x, y]): XY => [x * X, support === undefined ? y : walkwayRewardY(pipes[support])]), r.role, r.role === 'guide', support), sourceRole: r.role,
      spacing: Math.max(PHONE_SPACE.pathSpacing, r.spacing * X * S) };
  });
  const setRoute = (index: number, points: XY[]) => { routes[index].points = points.map(([x, y]) => P(x * X, y)); };
  const shiftRoute = (index: number, dy: number) => routes[index].points.forEach(p => { p.y += dy; });
  const cap = (index: number, end: number) => Object.assign(pipes[index], pipes[index].anchor === 'ceiling' ? ceiling(pipes[index].x, end) : ground(pipes[index].x, end));
  // Changes are local to the original motif: every original pipe, pig and
  // route remains. Coordinates here use the original author space for audit.
  switch (segment.id) {
    case 'gate-double':
      cap(0, 220 - 168); cap(1, 220 + 168); cap(2, 500 - 168); cap(3, 500 + 168);
      setRoute(0, [[110, 300], [1.5 * 410 * 60 / 109, 220], [1.5 * 410 * 60 / 109 + 20, 220], [3.5 * 410 * 60 / 109 - 20, 500], [860, 500]]);
      routes[0].clearance = 136;
      break;
    case 'gate-stairs':
      routes[0].clearance = 136;
      // Enter/leave level at the end steps. Continuing the diagonal beyond
      // them only made the edge pipes into stumps, especially after mirroring.
      routes[0].points = [P(routes[0].points[0].x, 208), P(pipes[0].x, 210), P(pipes[6].x, 510), P(routes[0].points.at(-1)!.x, 512)];
      break;
    case 'gate-slalom':
      for (let i = 0; i < pipes.length; i += 2) {
        const c = i % 4 ? 510 : 210;
        cap(i, c - 168); cap(i + 1, c + 168);
      }
      routes[0].points.forEach((p, i) => { p.y = i === 0 ? 300 : i % 2 ? 210 : 510; });
      routes[0].points.at(-1)!.y = 510;
      routes[0].clearance = 136;
      break;
    case 'gate-tunnel':
      for (let i = 0; i < pipes.length; i += 2) {
        const c = (pipes[i].y + pipes[i].length / 2 + pipes[i + 1].y - pipes[i + 1].length / 2) / 2;
        cap(i, c - 168); cap(i + 1, c + 168);
      }
      routes[0].clearance = 136;
      break;
    case 'split-beam': shiftRoute(0, -80); shiftRoute(1, 80); break;
    case 'split-fork':
      pipes[0].length = 210;
      setRoute(0, [[40, 360], [360, 140], [560, 140], [880, 360]]);
      setRoute(1, [[360, 580], [560, 580], [880, 360]]);
      routes.forEach(r => { r.clearance = 136; r.joinGroup = 'fork-exit'; });
      break;
    case 'split-corridor':
      pipes[0].y = 100; pipes[1].y = 500;
      // Keep the upper lip at 342. The stem now meets the lower beam, making
      // the non-traversable slit an explicit solid junction.
      pipes[2].y = 421; pipes[2].length = 158; pipes[2].joinsTo = 1;
      setRoute(0, [[160, 360], [470, 250], [1260, 250]]);
      setRoute(1, [[700, 650], [1100, 650]]);
      routes[1].clearance = 132;
      break;
    case 'split-floors':
      pipes[0].y = 224; pipes[1].y = 510;
      setRoute(0, [[480, 68], [920, 68]]);
      setRoute(1, [[460, 350], [940, 350]]);
      routes[1].role = 'kill'; routes[1].supportPipe = 1;
      setRoute(2, [[520, 650], [880, 650]]); routes[2].clearance = 136;
      setRoute(3, [[1250, 360], [1720, 360]]);
      break;
    case 'pig-intro':
      setRoute(0, [[100, 360], [310, walkwayRewardY(pipes[0])]]); break;
    case 'pig-guard':
      pipes[0].y += 40;
      setRoute(0, [[40, 300], [250, walkwayRewardY(pipes[0])]]); routes[0].clearance = 136;
      shiftRoute(2, 110); break;
    case 'pig-pillars': shiftRoute(0, -90); break;
    case 'pig-high-low': {
      pipes[0].y = mirrored ? 60 : 250; pipes[1].y = mirrored ? 470 : 660;
      // Mirroring still swaps high/low; pig walkways must stay above pipes.
      setRoute(0, [[100, mirrored ? 400 : 490], [330, mirrored ? 400 : 490], [700, mirrored ? 230 : 320], [860, mirrored ? 230 : 320]]);
      routes[0].clearance = 136;
      break;
    }
    case 'pig-parade':
      pipes.forEach(p => { p.y += 60; }); shiftRoute(1, -60); break;
    case 'pig-rooftop': shiftRoute(0, -65); break;
    case 'pig-twin-beams':
      pipes[0].y = mirrored ? 100 : 280; pipes[1].y = mirrored ? 440 : 620;
      setRoute(0, mirrored ? [[120, 330], [300, 390], [740, 390], [980, 250], [1430, 250], [1700, 330]]
        : [[120, 390], [300, 470], [740, 470], [980, 330], [1430, 330], [1700, 390]]);
      break;
    case 'pig-sky-row':
      setRoute(0, [[120, 470], [450, 500], [750, 650], [1050, 650], [1350, 530], [1760, 470]]); break;
    case 'blocks-steps':
      pipes.forEach(p => { p.y += 110; }); shiftRoute(0, -60); break;
    case 'blocks-hook':
      cap(0, 160); pipes[1].y = 245; pipes[1].x += 5 * X; cap(2, 610);
      setRoute(0, [[100, 380], [330, 450], [820, 450]]); break;
    case 'blocks-scatter':
      pipes[0].y = 130; pipes[1].y = 580; pipes[2].y = 300; pipes[3].y = 100; pipes[4].y = 620; pipes[5].y = 390;
      setRoute(0, [[160, 400], [420, 430]]);
      setRoute(1, [[640, 80], [700, 80]]);
      setRoute(2, [[900, 530], [980, 530]]);
      setRoute(3, [[1150, 350], [1210, 350]]);
      setRoute(4, [[1380, 100], [1440, 100]]);
      setRoute(5, [[1620, 640], [1700, 640]]);
      break;
    case 'blocks-debris':
      pipes[0].y = 100; pipes[1].y = 620; pipes[2].y = 350; pipes[3].y = 100; pipes[4].y = 620; pipes[5].y = 390;
      setRoute(0, [[150, 400], [400, 410]]);
      setRoute(1, [[680, 85], [740, 85]]);
      setRoute(2, [[980, 550], [1040, 550]]);
      setRoute(3, [[1220, 340], [1260, 340]]);
      setRoute(4, [[1460, 85], [1500, 85]]);
      break;
    case 'blocks-weave':
      pipes.forEach((p, i) => { p.y = i % 2 ? 550 : 170; p.length = 320; });
      setRoute(0, [[120, 420], [1.5 * 410 * 60 / 109, 510], [3.5 * 410 * 60 / 109, 210], [5.5 * 410 * 60 / 109, 510], [7.5 * 410 * 60 / 109, 210], [1760, 250]]);
      routes[0].clearance = 136;
      break;
    case 'wall-dive': cap(0, 400); shiftRoute(0, 30); break;
    case 'wall-funnel':
      [160, 215, 250].forEach((end, i) => { cap(i * 2, end); cap(i * 2 + 1, 720 - end); });
      setRoute(0, [[100, 360], [500, 360]]);
      setRoute(1, [[580, 360], [840, 360]]);
      routes[0].clearance = 180;
      break;
    case 'wall-zipper':
      cap(0, 360); cap(1, 390); cap(2, 360);
      setRoute(0, [[60, 450], [1.5 * 410 * 60 / 109, 540], [4 * 410 * 60 / 109, 170], [6.5 * 410 * 60 / 109, 540], [1760, 420]]);
      routes[0].clearance = 192;
      break;
    case 'combo-gate-pig':
      pipes[2].y = 570; setRoute(0, [[120, 340], [1.5 * 410 * 60 / 109, 300], [520, 300], [780, 409]]); break;
    case 'combo-stairs-pig':
      routes[0].clearance = 136;
      break;
    case 'combo-split-decision':
      cap(0, 160); pipes[1].y = 455; pipes[1].length = 170;
      setRoute(0, [[120, 360], [480, 260], [1300, 260]]);
      setRoute(1, [[560, 650], [1240, 650]]); routes[1].clearance = 136;
      break;
    case 'combo-cage-pig':
      pipes[0].y = 100; pipes[1].y = 500;
      setRoute(0, [[160, 360], [470, 235], [1260, 235]]);
      setRoute(1, [[700, 650], [1100, 650]]); routes[1].clearance = 136;
      break;
    case 'combo-rush':
      cap(0, 220 - 168); cap(1, 220 + 168); cap(3, 500 - 168); cap(4, 500 + 168);
      pipes[2].y = 540; pipes[5].y = 210;
      setRoute(0, [[120, 300], [1.5 * 410 * 60 / 109, 220], [3.5 * 410 * 60 / 109, 250], [5.5 * 410 * 60 / 109, 500], [7.5 * 410 * 60 / 109, 480], [1760, 450]]);
      routes[0].clearance = 136;
      break;
  }
  if (segment.id === 'combo-gate-pig') original.pigs[0] = { ...original.pigs[0], pipe: 2 };
  for (const r of routes) if (r.role === 'kill' && r.supportPipe !== undefined) r.points.forEach(p => { p.y = walkwayRewardY(pipes[r.supportPipe!]); });
  const result = finish(segment.bars * BAR, pipes, original.pigs.map(p => ({ ...p })), routes, [], mirrored);
  if (['gate-single', 'gate-double', 'gate-stairs', 'gate-slalom', 'gate-tunnel', 'split-floors', 'combo-gate-pig', 'combo-stairs-pig', 'combo-rush'].includes(segment.id)) fitRouteGates(result.pipes, result.routes!);
  if (mirrored) for (const r of result.routes ?? []) {
    if (r.role !== 'kill' || r.supportPipe === undefined) continue;
    const y = walkwayRewardY(result.pipes[r.supportPipe]);
    r.points.forEach(p => { p.y = y; });
    result.coins.filter(c => c.routeId === r.id).forEach(c => { c.y = y; });
  }
  return result;
}

export function validatePhoneLayout(content: SegmentContent, width: number): PhoneLayoutIssue[] {
  const issues: PhoneLayoutIssue[] = [];
  const add = (kind: string, p: Point, message: string) => issues.push({ kind, ...p, message });
  const pipes = content.pipes.map(pipeVisualPolygon);
  const enemies = content.pigs.map(pig => {
    const support = content.pipes[pig.pipe];
    const span = pigPatrolHalfSpan(support, pig);
    const height = PIG_HEIGHT * S, width = height * PIG_VISUAL_ASPECT;
    return rectPolygon(support.x - span - width / 2, pigCenterY(support) - height / 2, span * 2 + width, height);
  });
  for (let i = 0; i < pipes.length; i++) {
    const pipe = content.pipes[i];
    const visibleLength = pipe.anchor === 'ceiling' ? pipe.y + pipe.length / 2
      : pipe.anchor === 'floor' ? WORLD_HEIGHT - pipe.y + pipe.length / 2 : pipe.length;
    if (visibleLength < (pipe.anchor ? 100 : PIPE_THICKNESS * S) - 0.01) add('pipe-length', pipe, `水管 ${i} 可见管身过短`);
    const xs = pipes[i].map(p => p.x);
    if (Math.min(...xs) < 36 || Math.max(...xs) > width - 36) add('boundary', content.pipes[i], `水管 ${i} 越过边界留白`);
    const joined = content.pipes[i].joinsTo;
    if (joined !== undefined && (!content.pipes[joined] || joined === i || !isPipeJunction(content.pipes, i, joined))) add('pipe-junction', content.pipes[i], `水管 ${i} 未接实支撑管`);
    for (let j = i + 1; j < pipes.length; j++) if (!isPipeJunction(content.pipes, i, j) && polygonDistance(pipes[i], pipes[j]) < PHONE_SPACE.pipeGap - 0.01) add('pipe-gap', content.pipes[i], `水管 ${i}/${j} 间距不足 36`);
  }
  const pickups = content.coins.map(c => pickupPolygon(c, content.entityScale));
  for (let i = 0; i < pickups.length; i++) {
    if (pickups[i].some(p => p.x < 24 || p.x > width - 24 || p.y < 24 || p.y > WORLD_HEIGHT - 24)) add('pickup-boundary', content.coins[i], `拾取物 ${i} 动画越界`);
    for (let j = i + 1; j < pickups.length; j++) if (polygonDistance(pickups[i], pickups[j]) < PHONE_SPACE.pickupGap - 0.01) add('pickup-gap', content.coins[i], `拾取物 ${i}/${j} 间距不足 18`);
    for (let j = 0; j < pipes.length; j++) if (polygonDistance(pickups[i], pipes[j]) < PHONE_SPACE.pickupPipeGap - 0.01) add('pickup-pipe', content.coins[i], `拾取物 ${i} 太贴近水管 ${j}`);
  }
  for (const r of content.routes ?? []) {
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      if (r.main && (b.x <= a.x || Math.abs(b.y - a.y) > (b.x - a.x) * PHONE_SPACE.maxSlope + 0.01)) add('slope', b, `${r.id} 换道过急`);
      if (!r.main && !r.sourceRole || r.role === 'kill') continue;
      for (const point of samples([a, b], SOLVER_STEP)) {
        const clearance = r.clearance ?? (r.main ? PHONE_SPACE.corridor : 136);
        const corridor = rectPolygon(point.x - PLAYER_SIZE * S / 2, point.y - clearance / 2, PLAYER_SIZE * S, clearance);
        if (pipes.some(p => polygonsOverlap(p, corridor))) { add('corridor', point, `${r.id} 通道净宽不足 ${clearance}`); break; }
        const player = rectPolygon(point.x - PLAYER_SIZE * S / 2, point.y - PLAYER_SIZE * S / 2, PLAYER_SIZE * S, PLAYER_SIZE * S);
        if (enemies.some(enemy => polygonDistance(player, enemy) < PHONE_SPACE.pickupPipeGap - 0.01)) { add('guide-pig', point, `${r.id} 指路路线太靠近巡逻猪`); break; }
      }
    }
  }
  return issues;
}

function reserveItem(content: SegmentContent, chosen: CoinSpec, role: CoinRole, member?: number): SegmentContent | undefined {
  const replacement: CoinSpec = { ...chosen, role, ...(member === undefined ? {} : { member }) };
  const shape = pickupPolygon(replacement);
  if (content.pipes.some(pipe => polygonDistance(shape, pipeVisualPolygon(pipe)) < PHONE_SPACE.pickupPipeGap)) return undefined;
  if (shape.some(p => p.y < 24 || p.y > WORLD_HEIGHT - 24 || p.x < 24)) return undefined;
  // Intentional special-item reservation, never a repair step for a broken ordinary route.
  const protectedItem = (c: CoinSpec) => c.patternId || pickupArt(c) !== 'stick';
  if (content.coins.some(c => c !== chosen && protectedItem(c) && polygonDistance(shape, pickupPolygon(c)) < PHONE_SPACE.pickupGap)) return undefined;
  const coins = content.coins.filter(c => c !== chosen && (protectedItem(c) || polygonDistance(shape, pickupPolygon(c)) >= PHONE_SPACE.pickupGap));
  return { ...content, coins: [...coins, replacement].sort((a, b) => a.x - b.x || a.y - b.y) };
}

/** Items occupy reserved space on a route; motifs are never overwritten or thinned. */
export function placePhoneItems(plan: PlannedSegment[], random: () => number, extrasOnly = false) {
  const entries = new Map<PlannedSegment, Uint8Array>();
  let entry = fullEntry();
  for (const p of plan) {
    entries.set(p, entry);
    entry = solveSegment(p.content, segmentWidth(p.segment, S), entry).exit;
  }
  const reserve = (p: PlannedSegment, coin: CoinSpec, role: CoinRole, member?: number) => {
    const content = reserveItem(p.content, coin, role, member);
    if (!content || validatePhoneLayout(content, segmentWidth(p.segment, S)).length || !solveSegment(content, segmentWidth(p.segment, S), entries.get(p)).ok) return undefined;
    return content;
  };
  for (const section of [...new Set(plan.map(p => p.section))]) {
    const entries = plan.filter(p => p.section === section);
    const walkways = entries.flatMap(p => p.content.pigs.filter(pig => pig.patrol > 0).map(pig => ({ p, pipe: pig.pipe })));
    const safe = entries.find(p => p.segment.intensity === 0 && p.content.coins.some(c => c.role === 'guide'));
    let added = false;
    if (walkways.length && (!safe || random() < 0.6)) {
      for (const { p, pipe } of walkways) {
        const chosen: CoinSpec = { x: p.content.pipes[pipe].x, y: walkwayRewardY(p.content.pipes[pipe]), role: 'kill', supportPipe: pipe };
        const content = reserve(p, chosen, 'riskHeal');
        if (content) { p.content = content; added = true; break; }
      }
    }
    if (!added && safe) {
      const guides = safe.content.coins.filter(c => c.role === 'guide');
      const content = reserve(safe, guides[Math.floor(guides.length / 2)], 'heal');
      if (content) safe.content = content;
    }
  }
  if (extrasOnly) return;
  for (const section of ['副歌 1', '副歌 2']) {
    outer: for (const p of plan.filter(p => p.section === section)) {
      for (const chosen of p.content.coins.filter(c => c.role === 'guide')) {
        const content = reserve(p, chosen, 'power');
        if (content) { p.content = content; break outer; }
      }
    }
  }
  for (let turn = 1; turn <= 9; turn++) {
    const target = turn * 8;
    const candidates = plan.flatMap(p => p.content.coins.filter(c => c.role === 'guide' && !c.patternId).map(c => ({ p, c, distance: Math.abs(p.startBar + c.x / (BAR * S) - target) })));
    candidates.sort((a, b) => a.distance - b.distance);
    for (const { p, c } of candidates) {
      const content = reserve(p, c, 'morph', turn % 5);
      if (content) { p.content = content; break; }
    }
  }
}

function boundaryGuide(planned: PlannedSegment, end: boolean): CoinSpec | undefined {
  // The path controls define the exit, even when sparse sampling stops early
  // or a larger special item replaces the first/last stick. Using sampled
  // coins here made item placement change the next segment's flight path.
  const controls = planned.content.routes?.filter(r => r.main).flatMap(r => {
    const point = end ? r.points.at(-1) : r.points[0];
    return point ? [{ ...point, role: 'guide' as const, routeId: r.id }] : [];
  }).sort((a, b) => a.x - b.x) ?? [];
  return end ? controls.at(-1) : controls[0];
}

export function phoneRestAfter(previous?: PlannedSegment): SegmentContent {
  const y = previous ? boundaryGuide(previous, true)?.y ?? 360 : 360;
  return finish(BAR, [], [], [{ ...route('main', [[0, y], [BAR, 360]]), spacing: 160 * (CRUISE_SPEED / 410) * S }]);
}

/** Inspect the seam, not only each segment independently. */
export function validatePhoneJoin(left: PlannedSegment, right: PlannedSegment): PhoneLayoutIssue[] {
  const offset = (right.startBar - left.startBar) * BAR * S;
  const aPipes = left.content.pipes.filter(p => p.x + p.length / 2 + 100 > offset - 300).map(pipeVisualPolygon);
  const bPipes = right.content.pipes.filter(p => p.x - p.length / 2 - 100 < 300).map(p => pipeVisualPolygon({ ...p, x: p.x + offset }));
  const aCoins = left.content.coins.filter(c => c.x > offset - 300);
  const bCoins = right.content.coins.filter(c => c.x < 300).map(c => ({ ...c, x: c.x + offset }));
  const issues: PhoneLayoutIssue[] = [];
  const report = (kind: string, p: Point, message: string) => issues.push({ kind, ...p, message });
  for (const a of aPipes) for (const b of bPipes) if (polygonDistance(a, b) < PHONE_SPACE.pipeGap - 0.01) report('join-pipes', a[0], '相邻片段水管太近');
  for (const a of aCoins) for (const b of bCoins) if (polygonDistance(pickupPolygon(a), pickupPolygon(b)) < PHONE_SPACE.pickupGap - 0.01) report('join-pickups', a, '相邻片段拾取物太近');
  for (const [coins, pipes] of [[aCoins, bPipes], [bCoins, aPipes]] as const) {
    for (const c of coins) for (const p of pipes) if (polygonDistance(pickupPolygon(c), p) < PHONE_SPACE.pickupPipeGap - 0.01) report('join-pickup-pipe', c, '相邻片段奖励太贴近水管');
  }
  const before = boundaryGuide(left, true), after = boundaryGuide(right, false);
  if (before && after) {
    const target = { ...after, x: after.x + offset };
    const beforeRoute = left.content.routes?.find(r => r.id === before.routeId);
    const afterRoute = right.content.routes?.find(r => r.id === after.routeId);
    // A narrow authored action remains narrow until the last obstacle has
    // actually been cleared. Joining a wide rest must not retroactively
    // demand a wider corridor through that obstacle.
    const clearance = Math.min(beforeRoute?.clearance ?? PHONE_SPACE.corridor, afterRoute?.clearance ?? PHONE_SPACE.corridor);
    // Some original guides are only an approach: the rest of a shooting or
    // scatter segment is free flight, already covered by the reachability
    // solver and optional reward routes. Do not invent a straight guide
    // through obstacles that come after that approach.
    const unroutedTail = left.content.pipes.filter(p => p.x > before.x);
    const approachEnd = Math.max(offset - 200, ...unroutedTail.map(pipe => Math.max(...pipeVisualPolygon(pipe).map(p => p.x)) + PLAYER_SIZE * S / 2));
    // Connect authored exit and entry controls, not sampled collectibles.
    const controls = [before, target];
    const pipes = [...aPipes, ...bPipes];
    for (let i = 1; i < controls.length; i++) {
      const a = controls[i - 1], b = controls[i];
      if (Math.abs(b.y - a.y) > (b.x - a.x) * PHONE_SPACE.maxSlope + 0.01) report('join-slope', a, '相邻指路路线换道过急');
    }
    for (const p of samples(controls, SOLVER_STEP)) {
      // Only inspect the seam here. An authored shooting approach may end
      // before its platform; its continuation is the segment's validated
      // bypass, not a new straight line through the rest of that platform.
      if (p.x < approachEnd || p.x > offset + 200) continue;
      if (pipes.some(pipe => polygonsOverlap(pipe, rectPolygon(p.x - 60, p.y - clearance / 2, 120, clearance)))) { report('join-corridor', p, `相邻指路路线通道不足 ${clearance}`); break; }
    }
  }
  return issues;
}
