import { buildOriginalPhoneLayout, placePhoneItems, phoneRestAfter, validatePhoneLayout, validatePhoneJoin, type PickupRoute } from './phoneLayouts';

/**
 * Hand-authored level segments, a reachability solver and a song-aware
 * director. Everything here is expressed in world units: the playfield is
 * always WORLD_HEIGHT tall and scrolls at CRUISE_SPEED, so a segment looks and
 * plays the same on every screen. Segment x = 0 reaches the player exactly on
 * a bar line of the BGM.
 */

export const WORLD_HEIGHT = 720;
export const CRUISE_SPEED = 375;

// Supernatural - 250 Remix, measured from the audio file.
export const SONG_BPM = 109;
export const SONG_FIRST_BEAT_SECONDS = 0.54;
export const BEAT_SECONDS = 60 / SONG_BPM;
export const BAR_SECONDS = BEAT_SECONDS * 4;
export const BEAT = CRUISE_SPEED * BEAT_SECONDS;
export const BAR = BEAT * 4;
export const SONG_START_DISTANCE = CRUISE_SPEED * SONG_FIRST_BEAT_SECONDS;
/**
 * Segments are authored at this speed and squeezed horizontally to
 * CRUISE_SPEED when built, so every obstacle keeps its beat in the song.
 */
const AUTHOR_SPEED = 410;
const AUTHOR_SCALE = CRUISE_SPEED / AUTHOR_SPEED;

export const PLAYER_SIZE = 80;
export const PLAYER_HIT = PLAYER_SIZE * 0.6;
export const PLAYER_MIN_Y = PLAYER_SIZE * 0.55;
export const PLAYER_MAX_Y = WORLD_HEIGHT - PLAYER_SIZE * 0.55;
export const PLAYER_SPEED = 310;

export const PIPE_THICKNESS = 92;
/** Collision thickness sits between the pipe body and its wider cap. */
export const PIPE_HIT_THICKNESS = 72;
export const PIG_WIDTH = 52;
export const PIG_HEIGHT = 68;
export const PIG_HIT_SCALE = 0.8;
export const COIN_PICKUP_RADIUS = 20;
export const COIN_SPACING = 58;

export type PipeFacing = 'up' | 'down' | 'left' | 'right';
export type CoinRole = 'guide' | 'reward' | 'risk' | 'kill' | 'bonus' | 'heal' | 'riskHeal' | 'power' | 'morph';
export type SegmentTheme = 'intro' | 'bonus' | 'gate' | 'split' | 'pig' | 'blocks' | 'wall' | 'combo';

/** Pipe centered at (x, y); both ends are capped and `facing` sets its axis. */
export interface PipeSpec {
  x: number;
  y: number;
  length: number;
  facing: PipeFacing;
  tilt?: number;
  /** Object size, independent of the background/view scale. */
  scale?: number;
  anchor?: 'ceiling' | 'floor';
  /** Explicit solid junction, rendered behind this supporting pipe. */
  joinsTo?: number;
}

export interface PigSpec {
  /** Index into the segment's pipes; the pig stands on that pipe's top. */
  pipe: number;
  /** 0 = standing still, otherwise the fraction of the support it walks. */
  patrol: number;
  speed: number;
  phase: number;
}

export interface CoinSpec {
  x: number;
  y: number;
  role: CoinRole;
  /** For a 'morph' token: which member (index in the roster) it turns the player into. */
  member?: number;
  routeId?: string;
  patternId?: string;
  supportPipe?: number;
}

export interface SegmentContent {
  pipes: PipeSpec[];
  pigs: PigSpec[];
  coins: CoinSpec[];
  entityScale?: number;
  routes?: PickupRoute[];
  /** The director skips geometry that cannot fit enlarged objects safely. */
  layoutInvalid?: boolean;
}

export interface SegmentDef {
  id: string;
  name: string;
  theme: SegmentTheme;
  /** Kishōtenketsu step inside the theme: 1 teach, 2 develop, 3 twist. */
  tier: 1 | 2 | 3;
  intensity: 0 | 1 | 2 | 3;
  bars: 1 | 2;
  mirror: boolean;
  /** Only placed by fixed section scripts (intro / finale). */
  scripted?: boolean;
  requires?: SegmentTheme[];
  intent: string;
  build: (random: () => number) => SegmentContent;
  buildPhone?: (random: () => number, mirrored: boolean) => SegmentContent;
}

export const THEME_LABELS: Record<SegmentTheme, string> = {
  intro: '前奏教学',
  bonus: '奖励 / 休息',
  gate: '门缝',
  split: '分岔',
  pig: '打猪',
  blocks: '块阵',
  wall: '墙',
  combo: '组合高潮',
};

export const ROLE_LABELS: Record<CoinRole, string> = {
  guide: '指路',
  reward: '奖励',
  risk: '冒险',
  kill: '打猪奖励',
  bonus: '奖励屏',
  heal: '补血爱心',
  riskHeal: '冒险爱心',
  power: '无敌太阳花',
  morph: '变身头像',
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const H = WORLD_HEIGHT;
const beat = (count: number) => count * AUTHOR_SPEED * BEAT_SECONDS;
const pick = <T,>(random: () => number, values: T[]): T => values[Math.floor(random() * values.length) % values.length];

/** Pipe hanging from the ceiling down to `bottom`. */
const ceil = (x: number, bottom: number): PipeSpec => ({ x, y: (bottom - 60) / 2, length: bottom + 60, facing: 'down' });
/** Pipe standing on the floor up to `top`. */
const floor = (x: number, top: number): PipeSpec => ({ x, y: (top + H + 60) / 2, length: H + 60 - top, facing: 'up' });
/** Free-floating vertical pipe. */
const post = (x: number, y: number, length = 150, facing: PipeFacing = 'up', tilt = 0): PipeSpec => ({ x, y, length, facing, tilt });
/** Horizontal pipe; pigs can stand on it. */
const beam = (x: number, y: number, length = 280, facing: PipeFacing = 'right'): PipeSpec => ({ x, y, length, facing });
const gate = (x: number, center: number, gap: number): PipeSpec[] => [ceil(x, center - gap / 2), floor(x, center + gap / 2)];

const still = (pipe: number): PigSpec => ({ pipe, patrol: 0, speed: 0, phase: 0 });
const walker = (pipe: number, speed = 60, patrol = 0.9, phase = 0): PigSpec => ({ pipe, patrol, speed, phase });

/** Evenly spaced coins along a polyline. */
export interface DesignPath { points: Array<[number, number]>; role: CoinRole; spacing: number }
let recordingPaths: DesignPath[] | undefined;
/** Read the existing design without changing the original build's output. */
export function readSegmentDesign(segment: SegmentDef, random: () => number) {
  const previous = recordingPaths;
  const paths: DesignPath[] = [];
  recordingPaths = paths;
  try { return { content: segment.build(random), paths }; }
  finally { recordingPaths = previous; }
}
function path(points: Array<[number, number]>, role: CoinRole, spacing = COIN_SPACING): CoinSpec[] {
  recordingPaths?.push({ points: points.map(p => [...p]), role, spacing });
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const count = Math.max(1, Math.round(total / spacing));
  const coins: CoinSpec[] = [];
  for (let step = 0; step <= count; step += 1) {
    let distance = (total * step) / count;
    let index = 0;
    while (index < lengths.length - 1 && distance > lengths[index]) {
      distance -= lengths[index];
      index += 1;
    }
    const ratio = lengths[index] === 0 ? 0 : distance / lengths[index];
    const [x0, y0] = points[index];
    const [x1, y1] = points[index + 1];
    coins.push({ x: x0 + (x1 - x0) * ratio, y: y0 + (y1 - y0) * ratio, role });
  }
  return coins;
}

function grid(x0: number, y0: number, columns: number, rows: number, dx: number, dy: number, role: CoinRole): CoinSpec[] {
  const coins: CoinSpec[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) coins.push({ x: x0 + column * dx, y: y0 + row * dy, role });
  }
  return coins;
}

/** Pixel shape made of coins; '#' marks a coin. */
function shape(rows: string[], x0: number, y0: number, cell: number, role: CoinRole): CoinSpec[] {
  const coins: CoinSpec[] = [];
  rows.forEach((row, rowIndex) => {
    [...row].forEach((char, column) => {
      if (char === '#') coins.push({ x: x0 + column * cell, y: y0 + rowIndex * cell, role });
    });
  });
  return coins;
}

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const LETTERS: Record<string, string[]> = {
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  J: ['.###', '...#', '...#', '#..#', '.##.'],
  Z: ['####', '...#', '..#.', '.#..', '####'],
};
/** NewJeans rabbit head, upright, traced from the light stick's head: round ear
 * tips, a V notch, and straight sides running from the ears down to the chin. */
const BUNNY_HEAD = [
  '.###...###.',
  '#...#.#...#',
  '#...#.#...#',
  '#....#....#',
  '#.........#',
  '#..#...#..#',
  '#.........#',
  '#.........#',
  '.#.......#.',
  '..#######..',
];

/** Christmas bell: hanger loop, flared body, rim and a clapper below. */
const BELL = [
  '....#....',
  '...#.#...',
  '...###...',
  '..#...#..',
  '..#...#..',
  '.#.....#.',
  '.#.....#.',
  '#.......#',
  '#########',
  '....#....',
];

// ---------------------------------------------------------------------------
// Segment library
// ---------------------------------------------------------------------------

export const SEGMENTS: SegmentDef[] = [
  // --- Intro --------------------------------------------------------------
  {
    id: 'intro-glide',
    name: '起飞',
    theme: 'intro',
    tier: 1,
    intensity: 0,
    bars: 2,
    mirror: false,
    scripted: true,
    intent: '前奏教学：应援棒先平飞，再缓缓上升、下降，教玩家按住上/下移动。没有任何障碍。',
    build: () => ({
      pipes: [],
      pigs: [],
      coins: path([[140, 360], [560, 360], [900, 240], [1150, 240], [1600, 470], [1740, 470]], 'guide'),
    }),
  },
  {
    id: 'intro-first-pipe',
    name: '第一根水管',
    theme: 'intro',
    tier: 1,
    intensity: 0,
    bars: 1,
    mirror: false,
    scripted: true,
    intent: '第一个障碍：地面伸出一根矮水管，应援棒从它上方平直飞过——"跟着应援棒走就安全"。',
    build: () => ({
      pipes: [floor(beat(2), 500)],
      pigs: [],
      coins: path([[110, 400], [300, 350], [820, 350]], 'guide'),
    }),
  },

  // --- Bonus / rest -------------------------------------------------------
  {
    id: 'rest-breadcrumbs',
    name: '面包屑',
    theme: 'bonus',
    tier: 1,
    intensity: 0,
    bars: 1,
    mirror: true,
    intent: '过渡：几根稀疏的应援棒把玩家带回画面中部，给下一段一个干净的起点。',
    build: (random) => {
      const end = pick(random, [320, 360, 400]);
      return {
        pipes: [],
        pigs: [],
        coins: path([[150, 300], [450, (300 + end) / 2], [800, end]], 'guide', 160),
      };
    },
  },
  {
    id: 'bonus-bunny',
    name: '兔头',
    theme: 'bonus',
    tier: 1,
    intensity: 0,
    bars: 2,
    mirror: false,
    intent: '奖励屏：应援棒拼成一个正立的兔头，形状照应援棒顶部的兔头：圆耳尖、中间 V 形凹口、两侧从耳朵直直地连到脸、两只眼睛，呼应 NewJeans 的兔子。一串指路应援棒把玩家引到兔头中线，再自己选择沿耳朵或脸的轮廓吃。',
    build: () => ({
      pipes: [],
      pigs: [],
      coins: [
        ...path([[140, 360], [620, 360]], 'guide'),
        ...shape(BUNNY_HEAD, 760, 360 - 4.5 * 44, 44, 'bonus'),
      ],
    }),
  },
  {
    id: 'bonus-grid',
    name: '应援方阵',
    theme: 'bonus',
    tier: 1,
    intensity: 0,
    bars: 1,
    mirror: false,
    intent: '奖励屏（参考图 #2）：4×6 的应援棒方阵，没有障碍，玩家自由挑一行扫过去，也可以斜着换行。',
    build: (random) => {
      const top = pick(random, [220, 250, 280]);
      return { pipes: [], pigs: [], coins: grid(240, top, 6, 4, 96, 80, 'bonus') };
    },
  },
  {
    id: 'bonus-heart',
    name: '爱心',
    theme: 'bonus',
    tier: 1,
    intensity: 0,
    bars: 1,
    mirror: false,
    intent: '奖励屏：应援棒拼成一颗像素爱心，纯粹的惊喜和拍照点。',
    build: () => ({ pipes: [], pigs: [], coins: shape(HEART, 300, 230, 52, 'bonus') }),
  },
  {
    id: 'bonus-bell',
    name: '圣诞铃铛',
    theme: 'bonus',
    tier: 1,
    intensity: 0,
    bars: 2,
    mirror: false,
    intent: '奖励屏：应援棒拼成一只圣诞铃铛——顶上挂环、向下张开的铃身、一条铃口和下面的铃舌，轮廓简单好认。指路应援棒把玩家带到铃铛中线。',
    build: () => ({
      pipes: [],
      pigs: [],
      coins: [...path([[140, 360], [600, 360]], 'guide'), ...shape(BELL, 800, 360 - 4.5 * 50, 50, 'bonus')],
    }),
  },
  {
    id: 'bonus-njz',
    name: 'NJZ',
    theme: 'bonus',
    tier: 1,
    intensity: 0,
    bars: 2,
    mirror: false,
    scripted: true,
    intent: '尾奏谢幕：应援棒拼出 N J Z 三个字母。',
    build: () => ({
      pipes: [],
      pigs: [],
      coins: [
        ...shape(LETTERS.N, 160, 240, 60, 'bonus'),
        ...shape(LETTERS.J, 700, 240, 60, 'bonus'),
        ...shape(LETTERS.Z, 1240, 240, 60, 'bonus'),
      ],
    }),
  },

  // --- Gates --------------------------------------------------------------
  {
    id: 'gate-single',
    name: '单门',
    theme: 'gate',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: true,
    intent: '教学：上下各一根水管围出一道宽缝，应援棒直线穿过缝中央。',
    build: (random) => {
      const center = pick(random, [300, 360, 420]);
      return {
        pipes: gate(beat(2), center, 220),
        pigs: [],
        coins: path([[100, 360], [320, center], [800, center]], 'guide'),
      };
    },
  },
  {
    id: 'gate-double',
    name: '双门换道',
    theme: 'gate',
    tier: 2,
    intensity: 2,
    bars: 1,
    mirror: true,
    intent: '发展：两道门一高一低，穿过第一道后要立刻换到另一高度。',
    build: () => ({
      pipes: [...gate(beat(1.5), 290, 200), ...gate(beat(3.5), 460, 200)],
      pigs: [],
      coins: path([[110, 330], [beat(1.5), 290], [beat(1.5) + 70, 290], [beat(3.5) - 90, 460], [860, 460]], 'guide'),
    }),
  },
  {
    id: 'gate-stairs',
    name: '门阶梯',
    theme: 'gate',
    tier: 2,
    intensity: 2,
    bars: 2,
    mirror: true,
    intent: '发展：四道门的缝逐级下降，应援棒连成一条斜线，每拍下一个台阶。',
    build: () => {
      const xs = [1.5, 3.5, 5.5, 7.5].map(beat);
      const centers = [210, 310, 410, 510];
      const slope = (centers[3] - centers[0]) / (xs[3] - xs[0]);
      return {
        pipes: xs.flatMap((x, index) => gate(x, centers[index], 200)),
        pigs: [],
        coins: path([[120, centers[0] - slope * (xs[0] - 120)], [1760, centers[3] + slope * (1760 - xs[3])]], 'guide'),
      };
    },
  },
  {
    id: 'gate-slalom',
    name: '门回旋',
    theme: 'gate',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: true,
    intent: '变化：每两拍一道门，缝高低交替，玩家要跟着节拍做 S 形回旋。',
    build: () => {
      const xs = [1.5, 3.5, 5.5, 7.5].map(beat);
      const centers = [250, 470, 250, 470];
      return {
        pipes: xs.flatMap((x, index) => gate(x, centers[index], 180)),
        pigs: [],
        coins: path([[120, 310], ...xs.map((x, index): [number, number] => [x, centers[index]]), [1760, 470]], 'guide'),
      };
    },
  },
  {
    id: 'gate-tunnel',
    name: '波浪隧道',
    theme: 'gate',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: true,
    intent: '变化：每拍一道门，缝的高度沿正弦起伏，连成一条波浪隧道；应援棒沿隧道中线。',
    build: () => {
      const points: Array<[number, number]> = [];
      const pipes: PipeSpec[] = [];
      for (let index = 1; index <= 7; index += 1) {
        const x = beat(index + 0.5);
        const center = 360 + 140 * Math.sin((index * Math.PI) / 3.5);
        pipes.push(...gate(x, center, 210));
        points.push([x, center]);
      }
      return { pipes, pigs: [], coins: path([[110, 360], ...points, [1760, 360]], 'guide') };
    },
  },

  // --- Split --------------------------------------------------------------
  {
    id: 'split-beam',
    name: '一管两路',
    theme: 'split',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: true,
    intent: '教学（参考图 #1）：一根长横管把路分成上下两条。上路应援棒多，下路更宽松——第一次让玩家做选择。',
    build: (random) => {
      const y = pick(random, [330, 360, 390]);
      return {
        pipes: [beam(520, y, 420)],
        pigs: [],
        coins: [
          ...path([[340, y - 115], [700, y - 115]], 'reward'),
          ...path([[380, y + 115], [660, y + 115]], 'guide', 140),
        ],
      };
    },
  },
  {
    id: 'split-fork',
    name: '分叉汇合',
    theme: 'split',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: false,
    intent: '教学：中间一根悬空短管，上下两道弧形应援棒绕过它，在出口汇合。两边一样好，纯粹是选择的乐趣。',
    build: () => ({
      pipes: [post(beat(2), 360, 160, 'up', 0.4)],
      pigs: [],
      coins: [
        ...path([[110, 360], [330, 235], [570, 235], [800, 360]], 'guide'),
        ...path([[330, 485], [570, 485], [770, 380]], 'guide'),
      ],
    }),
  },
  {
    id: 'split-corridor',
    name: '走廊',
    theme: 'split',
    tier: 2,
    intensity: 2,
    bars: 2,
    mirror: true,
    intent: '发展（参考图 #8）：两根长横管夹出一条走廊，里面一长串应援棒，走廊中下部悬着一截短管（和横管分开，不插在一起），要贴着走廊上沿飞；走廊外只有零星几根。',
    build: () => ({
      pipes: [beam(900, 200, 760), beam(900, 540, 760, 'left'), post(900, 425, 80)],
      pigs: [],
      coins: [
        ...path([[160, 360], [470, 320], [1260, 320]], 'risk'),
        ...path([[700, 640], [1100, 640]], 'guide', 200),
      ],
    }),
  },
  {
    id: 'split-floors',
    name: '三层楼',
    theme: 'split',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: false,
    requires: ['pig'],
    intent: '变化（参考图 #9）：两根横管把画面分成三层——顶层应援棒、中层有巡逻猪、底层安全但空。第二小节一道门把三层收拢。',
    build: () => ({
      pipes: [beam(700, 250, 600), beam(700, 480, 600, 'left'), ...gate(1460, 360, 220)],
      pigs: [walker(1, 70)],
      coins: [
        ...path([[480, 140], [920, 140]], 'reward'),
        ...path([[460, 330], [940, 330]], 'risk'),
        ...path([[520, 610], [880, 610]], 'guide', 180),
        ...path([[1180, 360], [1720, 360]], 'guide'),
      ],
    }),
  },

  // --- Pig ----------------------------------------------------------------
  {
    id: 'pig-intro',
    name: '第一只猪',
    theme: 'pig',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: false,
    intent: '教学：猪站在横管上不动。应援棒把玩家带到和猪同一高度后停下——这就是射击窗口；打掉后，猪身后的应援棒顺势可吃。',
    build: (random) => {
      const y = pick(random, [430, 470, 520]);
      const pigY = y - PIPE_THICKNESS / 2 - PIG_HEIGHT * 0.42;
      return {
        pipes: [beam(560, y, 240)],
        pigs: [still(0)],
        coins: [
          ...path([[100, 360], [330, pigY]], 'guide'),
          ...path([[640, pigY], [800, pigY]], 'kill'),
        ],
      };
    },
  },
  {
    id: 'pig-guard',
    name: '守卫猪',
    theme: 'pig',
    tier: 2,
    intensity: 2,
    bars: 1,
    mirror: false,
    intent: '发展：猪在横管上来回巡逻，守着管顶的一排应援棒。打掉猪就能收下；不想打就走管下方的安全路线。',
    build: (random) => {
      const y = pick(random, [280, 310, 340]);
      const pigY = y - PIPE_THICKNESS / 2 - PIG_HEIGHT * 0.42;
      return {
        pipes: [beam(540, y, 380)],
        pigs: [walker(0, 55)],
        coins: [
          ...path([[100, 300], [220, pigY]], 'guide'),
          ...path([[400, pigY], [680, pigY]], 'kill'),
          ...path([[380, y + 130], [700, y + 130]], 'guide', 105),
        ],
      };
    },
  },
  {
    id: 'pig-pillars',
    name: '阶梯猪',
    theme: 'pig',
    tier: 2,
    intensity: 2,
    bars: 2,
    mirror: false,
    intent: '发展（参考图 #6/#7）：三根地面短柱逐级升高，每根柱顶站一只猪。边飞边射可以贴着柱顶走，不射击就得飞得更高。',
    build: () => ({
      pipes: [floor(420, 560), floor(870, 460), floor(1320, 360)],
      pigs: [still(0), still(1), still(2)],
      coins: path([[150, 430], [1560, 190]], 'guide'),
    }),
  },
  {
    id: 'pig-high-low',
    name: '一高一低',
    theme: 'pig',
    tier: 2,
    intensity: 2,
    bars: 1,
    mirror: true,
    intent: '发展：中线是一条安全的应援棒路线，上方和下方各有一只猪。想多拿分就离开中线去射击，再回来。',
    build: () => ({
      pipes: [beam(330, 220, 220), beam(700, 540, 220, 'left')],
      pigs: [still(0), still(1)],
      coins: [
        ...path([[100, 360], [860, 360]], 'guide', 76),
        ...path([[400, 145], [430, 145]], 'kill', 30),
        ...path([[770, 465], [800, 465]], 'kill', 30),
      ],
    }),
  },
  {
    id: 'pig-parade',
    name: '猪猪游行',
    theme: 'pig',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: false,
    intent: '变化：三根短横管一字排开，每根上都有一只巡逻猪，高度一高一低一高。玩家要在移动中连续瞄准射击。',
    build: () => ({
      pipes: [beam(beat(2), 470, 260), beam(beat(4), 380, 260, 'left'), beam(beat(6), 470, 260)],
      pigs: [walker(0, 70, 0.9, 0), walker(1, 70, 0.9, 1), walker(2, 70, 0.9, 0.5)],
      coins: [
        ...path([[120, 395], [beat(2) - 230, 395]], 'guide'),
        ...path([[beat(2) - 60, 230], [beat(6) + 100, 230]], 'risk', 80),
      ],
    }),
  },
  {
    id: 'pig-rooftop',
    name: '柱顶猪',
    theme: 'pig',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: false,
    intent: '教学补充：地上一根矮柱，柱顶站一只猪。应援棒从上方安全飞过，想多拿分就压低高度先把猪打掉，再吃它身后的打猪奖励。',
    build: (random) => {
      const top = pick(random, [470, 510, 550]);
      const pigY = top - PIG_HEIGHT / 2 - 6;
      return {
        pipes: [floor(520, top)],
        pigs: [still(0)],
        coins: [
          ...path([[100, 360], [300, top - 190], [800, top - 190]], 'guide'),
          ...path([[640, pigY], [740, pigY]], 'kill'),
        ],
      };
    },
  },
  {
    id: 'pig-twin-beams',
    name: '双横管猪',
    theme: 'pig',
    tier: 2,
    intensity: 2,
    bars: 2,
    mirror: true,
    intent: '发展：一高一低两根横管，各有一只巡逻猪守着管顶的打猪奖励；中间一条安全的指路线，玩家边走边决定先打哪只。',
    build: () => {
      const highPig = 250 - PIPE_THICKNESS / 2 - PIG_HEIGHT / 2 - 6;
      const lowPig = 520 - PIPE_THICKNESS / 2 - PIG_HEIGHT / 2 - 6;
      return {
        pipes: [beam(520, 250, 320), beam(1200, 520, 320, 'left')],
        pigs: [walker(0, 60, 0.9, 0), walker(1, 60, 0.9, 0.5)],
        coins: [
          ...path([[120, 390], [1700, 390]], 'guide', 110),
          ...path([[440, highPig], [600, highPig]], 'kill'),
          ...path([[1120, lowPig], [1280, lowPig]], 'kill'),
        ],
      };
    },
  },
  {
    id: 'pig-sky-row',
    name: '空中猪台',
    theme: 'pig',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: false,
    intent: '变化：三块悬空短横管高低错落，每块上站一只猪，像一排靶子。应援棒在猪台之间上下穿行，连续开火的爽快段落。',
    build: () => {
      const xs = [2, 4, 6].map(beat);
      return {
        pipes: [beam(xs[0], 260, 200), beam(xs[1], 470, 200), beam(xs[2], 300, 200)],
        pigs: [still(0), still(1), still(2)],
        coins: path([[120, 380], [xs[0], 380], [xs[1], 610], [xs[2], 430], [1760, 380]], 'guide'),
      };
    },
  },
  {
    id: 'pig-gatekeeper',
    name: '守门猪',
    theme: 'pig',
    tier: 3,
    intensity: 3,
    bars: 1,
    mirror: false,
    requires: ['gate'],
    intent: '变化：门缝下沿站着一只猪，把通道压窄了一半。可以从猪头上小心钻过，也可以先把它打掉。',
    build: () => ({
      pipes: gate(500, 330, 240),
      pigs: [still(1)],
      coins: path([[100, 360], [300, 300], [820, 300]], 'guide'),
    }),
  },

  // --- Blocks -------------------------------------------------------------
  {
    id: 'blocks-steps',
    name: '台阶',
    theme: 'blocks',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: true,
    intent: '教学：三截悬空短管像台阶一样升高，应援棒沿台阶上沿斜着走。',
    build: () => ({
      pipes: [post(250, 520, 140, 'up', 0.3), post(500, 420, 140, 'up', -0.25), post(750, 320, 140, 'up', 0.3)],
      pigs: [],
      coins: path([[100, 420], [860, 160]], 'guide'),
    }),
  },
  {
    id: 'blocks-hook',
    name: '钩子',
    theme: 'blocks',
    tier: 2,
    intensity: 2,
    bars: 1,
    mirror: true,
    intent: '发展（参考图 #3）：天花板垂下一根水管，它右边悬着一根横管（两根分开、不叠在一起，像一个钩子的轮廓），地上再立一根，应援棒从横管下面的通道钻过去。',
    build: () => ({
      pipes: [ceil(280, 230), beam(530, 300, 330), floor(660, 570)],
      pigs: [],
      coins: path([[100, 380], [330, 445], [820, 445]], 'guide'),
    }),
  },
  {
    id: 'blocks-scatter',
    name: '散块',
    theme: 'blocks',
    tier: 2,
    intensity: 2,
    bars: 2,
    mirror: true,
    intent: '发展（参考图 #5）：六截短管错落分布，形成多条路线；应援棒三三两两藏在缝里，玩家自己找路。',
    build: () => ({
      pipes: [
        post(300, 210, 150, 'up', 0.35),
        post(540, 520, 150, 'up', -0.3),
        post(800, 330),
        post(1050, 150, 150, 'up', -0.4),
        post(1270, 560, 150, 'up', 0.3),
        post(1520, 380, 150, 'up', -0.35),
      ],
      pigs: [],
      coins: [
        ...path([[160, 380], [420, 380]], 'guide', 65),
        ...path([[640, 190], [700, 190]], 'reward', 60),
        ...path([[900, 520], [980, 520]], 'reward', 80),
        ...path([[1150, 330], [1210, 330]], 'reward', 60),
        ...path([[1380, 190], [1440, 190]], 'reward', 60),
        ...path([[1620, 560], [1700, 560]], 'reward', 80),
      ],
    }),
  },
  {
    id: 'blocks-debris',
    name: '碎片阵',
    theme: 'blocks',
    tier: 3,
    intensity: 2,
    bars: 2,
    mirror: true,
    intent: '变化（参考图 #10）：一堆倾斜的短管散落，看起来很乱，实际缝隙很宽——"看着难、其实公平"的视觉变化。',
    build: () => ({
      pipes: [
        post(320, 210, 170, 'up', 0.5),
        post(560, 530, 170, 'up', -0.4),
        post(860, 330, 170, 'up', 0.7),
        post(1110, 150, 170, 'up', -0.5),
        post(1340, 540, 170, 'up', 0.45),
        post(1580, 330, 160, 'up', -0.6),
      ],
      pigs: [],
      coins: [
        ...path([[150, 380], [440, 380]], 'guide', 72),
        ...path([[680, 220], [740, 220]], 'reward', 60),
        ...path([[980, 470], [1040, 470]], 'reward', 60),
        ...path([[1220, 330], [1260, 330]], 'reward', 40),
        ...path([[1460, 180], [1500, 180]], 'reward', 40),
      ],
    }),
  },
  {
    id: 'blocks-weave',
    name: '编织',
    theme: 'blocks',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: true,
    intent: '变化：四根长悬空管一高一低交替，每两拍一根，应援棒在它们之间编织穿行。',
    build: () => {
      const xs = [1.5, 3.5, 5.5, 7.5].map(beat);
      return {
        pipes: [post(xs[0], 240, 320, 'up', 0.2), post(xs[1], 480, 320, 'up', -0.2), post(xs[2], 240, 320, 'up', 0.2), post(xs[3], 480, 320)],
        pigs: [],
        coins: path([[120, 380], [xs[0], 470], [xs[1], 250], [xs[2], 470], [xs[3], 250], [1760, 300]], 'guide'),
      };
    },
  },

  // --- Walls --------------------------------------------------------------
  {
    id: 'wall-dive',
    name: '俯冲',
    theme: 'wall',
    tier: 1,
    intensity: 1,
    bars: 1,
    mirror: true,
    intent: '教学：天花板垂下一面长墙，只在底部留出通道，应援棒带着玩家俯冲下去再回来。',
    build: () => ({
      pipes: [ceil(520, 450)],
      pigs: [],
      coins: path([[80, 360], [400, 550], [660, 550], [860, 440]], 'guide'),
    }),
  },
  {
    id: 'wall-funnel',
    name: '漏斗',
    theme: 'wall',
    tier: 2,
    intensity: 2,
    bars: 1,
    mirror: false,
    intent: '发展：上下两排水管逐渐向中间收拢，像一个漏斗；应援棒在最窄处最密集。',
    build: () => ({
      pipes: [ceil(220, 130), floor(220, 590), ceil(420, 200), floor(420, 520), ceil(620, 260), floor(620, 460)],
      pigs: [],
      coins: [...path([[100, 360], [520, 360]], 'guide', 70), ...path([[560, 360], [840, 360]], 'reward', 46)],
    }),
  },
  {
    id: 'wall-zipper',
    name: '拉链',
    theme: 'wall',
    tier: 3,
    intensity: 3,
    bars: 2,
    mirror: true,
    intent: '变化：上墙、下墙、上墙交错出现，玩家走一个大 S 形；墙的间隔正好卡在拍子上。',
    build: () => ({
      pipes: [ceil(beat(1.5), 430), floor(beat(4), 290), ceil(beat(6.5), 430)],
      pigs: [],
      coins: path([[120, 360], [beat(1.5), 510], [beat(4), 215], [beat(6.5), 510], [1760, 420]], 'guide'),
    }),
  },

  // --- Combos -------------------------------------------------------------
  {
    id: 'combo-gate-pig',
    name: '穿门打猪',
    theme: 'combo',
    tier: 1,
    intensity: 3,
    bars: 2,
    mirror: false,
    requires: ['gate', 'pig'],
    intent: '组合：先穿过一道门，出门后应援棒把玩家带到猪的高度——门 → 射击窗口 → 打猪奖励。',
    build: () => ({
      pipes: [...gate(beat(1.5), 300, 200), beam(1060, 500, 300)],
      pigs: [walker(1, 60)],
      coins: [
        ...path([[120, 340], [beat(1.5), 300], [520, 300], [780, 425]], 'guide'),
        ...path([[1140, 425], [1260, 425]], 'kill'),
      ],
    }),
  },
  {
    id: 'combo-stairs-pig',
    name: '下台阶打猪',
    theme: 'combo',
    tier: 1,
    intensity: 3,
    bars: 2,
    mirror: false,
    requires: ['gate', 'pig'],
    intent: '组合：三道门逐级下降，最后一级正对着一只猪——走完台阶正好开火。',
    build: () => {
      const xs = [1.5, 3.5, 5.5].map(beat);
      const centers = [230, 360, 490];
      return {
        pipes: [...xs.flatMap((x, index) => gate(x, centers[index], 190)), beam(1600, 560, 260)],
        pigs: [still(6)],
        coins: [
          ...path([[120, 190], [xs[0], 230], [xs[1], 360], [xs[2], 490], [1380, 485]], 'guide'),
          ...path([[1660, 485], [1720, 485]], 'kill', 60),
        ],
      };
    },
  },
  {
    id: 'combo-split-decision',
    name: '冒险线 / 安全线',
    theme: 'combo',
    tier: 1,
    intensity: 3,
    bars: 2,
    mirror: true,
    requires: ['split', 'blocks'],
    intent: '组合：两条应援棒线分开——上线长、分多，但要钻一道窄缝；下线短、分少，但很宽敞。',
    build: () => ({
      pipes: [ceil(900, 200), post(900, 460, 160, 'up', 0.3)],
      pigs: [],
      coins: [
        ...path([[120, 360], [480, 290], [1300, 290]], 'risk'),
        ...path([[560, 620], [1240, 620]], 'guide', 170),
        ...path([[1500, 400], [1680, 400]], 'guide', 90),
      ],
    }),
  },
  {
    id: 'combo-cage-pig',
    name: '走廊猪',
    theme: 'combo',
    tier: 1,
    intensity: 3,
    bars: 2,
    mirror: false,
    requires: ['split', 'pig'],
    intent: '组合：走廊里多了一只巡逻猪，走廊里的应援棒要么贴着上沿小心拿，要么先把猪打掉。',
    build: () => ({
      pipes: [beam(900, 200, 760), beam(900, 540, 760, 'left')],
      pigs: [walker(1, 80)],
      coins: [
        ...path([[160, 360], [470, 320], [1260, 320]], 'risk'),
        ...path([[700, 640], [1100, 640]], 'guide', 200),
      ],
    }),
  },
  {
    id: 'combo-rush',
    name: '副歌冲刺',
    theme: 'combo',
    tier: 1,
    intensity: 3,
    bars: 2,
    mirror: true,
    requires: ['gate', 'blocks'],
    intent: '组合：门、悬空管、门、悬空管，每两拍一个，高低交替，应援棒连成一条贴着拍子的长曲线。',
    build: () => {
      const xs = [1.5, 3.5, 5.5, 7.5].map(beat);
      return {
        pipes: [...gate(xs[0], 260, 190), post(xs[1], 500, 200, 'up', 0.3), ...gate(xs[2], 440, 190), post(xs[3], 230, 200, 'up', -0.12)],
        pigs: [],
        coins: path([[120, 330], [xs[0], 260], [xs[1], 300], [xs[2], 440], [xs[3], 450], [1760, 420]], 'guide'),
      };
    },
  },
];

for (const segment of SEGMENTS) Object.defineProperty(segment, 'buildPhone', { get: () => (random: () => number, mirrored: boolean) => buildOriginalPhoneLayout(segment, random, mirrored) });

export const SEGMENTS_BY_ID = new Map(SEGMENTS.map((segment) => [segment.id, segment]));

export function segmentWidth(segment: SegmentDef, entityScale = 1): number {
  return segment.bars * BAR * entityScale;
}

// ---------------------------------------------------------------------------
// Shared geometry: pipes, pigs and collision
// ---------------------------------------------------------------------------

export interface Point { x: number; y: number }

/** Rotation of the pipe's long axis, matching drawPipe's convention. */
export function pipeOrientation(pipe: PipeSpec): { orientation: 'vertical' | 'horizontal'; rotation: number } {
  const tilt = pipe.tilt ?? 0;
  if (pipe.facing === 'left' || pipe.facing === 'right') {
    return { orientation: 'horizontal', rotation: (pipe.facing === 'left' ? Math.PI : 0) + tilt };
  }
  return { orientation: 'vertical', rotation: (pipe.facing === 'down' ? Math.PI : 0) + tilt };
}

/** Junction stems sit behind their crossbeam; stable indices keep pig supports
 * and sprite seeds identical to the original entity list. */
export function pipeDrawOrder(pipes: PipeSpec[]): number[] {
  return pipes.map((_, i) => i).sort((a, b) => Number(pipes[b].joinsTo !== undefined) - Number(pipes[a].joinsTo !== undefined));
}

/** Only a fully seated, explicitly authored T junction may overlap. */
export function isPipeJunction(pipes: PipeSpec[], a: number, b: number): boolean {
  const stem = pipes[a].joinsTo === b ? pipes[a] : pipes[b].joinsTo === a ? pipes[b] : undefined;
  if (!stem) return false;
  const beam = stem === pipes[a] ? pipes[b] : pipes[a];
  const scale = stem.scale ?? 1;
  return (stem.facing === 'up' || stem.facing === 'down') && !stem.tilt
    && (beam.facing === 'left' || beam.facing === 'right') && !beam.tilt && beam.joinsTo === undefined
    && Math.abs(stem.x - beam.x) + PIPE_THICKNESS * scale / 2 + 24 < beam.length / 2
    && Math.min(Math.abs(stem.y - stem.length / 2 - beam.y), Math.abs(stem.y + stem.length / 2 - beam.y)) < 0.01
    && stem.length >= PIPE_THICKNESS * scale;
}

/** Collision polygon of a pipe centered at (cx, cy). */
export function pipePolygon(pipe: PipeSpec, cx = pipe.x, cy = pipe.y, thickness = PIPE_HIT_THICKNESS * (pipe.scale ?? 1)): Point[] {
  const { orientation, rotation } = pipeOrientation(pipe);
  const angle = (orientation === 'horizontal' ? Math.PI / 2 : 0) + rotation;
  // Long axis direction in screen space for a vertical pipe rotated by angle.
  const ax = Math.sin(angle);
  const ay = -Math.cos(angle);
  const nx = -ay;
  const ny = ax;
  const halfLength = pipe.length / 2;
  const halfThickness = thickness / 2;
  return [
    { x: cx + ax * halfLength + nx * halfThickness, y: cy + ay * halfLength + ny * halfThickness },
    { x: cx + ax * halfLength - nx * halfThickness, y: cy + ay * halfLength - ny * halfThickness },
    { x: cx - ax * halfLength - nx * halfThickness, y: cy - ay * halfLength - ny * halfThickness },
    { x: cx - ax * halfLength + nx * halfThickness, y: cy - ay * halfLength + ny * halfThickness },
  ];
}

/** Top surface a pig can stand on (uses the visual thickness). */
export function pipeTopY(pipe: PipeSpec): number {
  return pipe.facing === 'left' || pipe.facing === 'right'
    ? pipe.y - PIPE_THICKNESS * (pipe.scale ?? 1) / 2
    : pipe.y - pipe.length / 2;
}

export function pigCenterY(pipe: PipeSpec): number {
  // Hooves stand on the snow that settles on top of the pipe.
  return pipeTopY(pipe) - (PIG_HEIGHT / 2 + 6) * (pipe.scale ?? 1);
}

/** Furthest a pig may walk from its pipe's center. */
export function pigPatrolHalfSpan(pipe: PipeSpec, pig: PigSpec): number {
  if (pig.patrol <= 0) return 0;
  const scale = pipe.scale ?? 1;
  const surface = pipe.facing === 'left' || pipe.facing === 'right' ? pipe.length : PIPE_THICKNESS * 1.08 * scale;
  return Math.max(0, (surface / 2 - (PIG_WIDTH / 2 + 8) * scale) * pig.patrol);
}

export function rectPolygon(x: number, y: number, width: number, height: number): Point[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function projectPolygon(polygon: Point[], axisX: number, axisY: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  polygon.forEach((point) => {
    const value = point.x * axisX + point.y * axisY;
    min = Math.min(min, value);
    max = Math.max(max, value);
  });
  return [min, max];
}

/** Separating axis test for two convex polygons. */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const axisX = -(next.y - current.y);
      const axisY = next.x - current.x;
      const [minA, maxA] = projectPolygon(a, axisX, axisY);
      const [minB, maxB] = projectPolygon(b, axisX, axisY);
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** Vertical extent of a convex polygon inside the slab x0..x1, or null. */
function polygonSlabExtent(polygon: Point[], x0: number, x1: number): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  const include = (y: number) => {
    min = Math.min(min, y);
    max = Math.max(max, y);
  };
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (a.x >= x0 && a.x <= x1) include(a.y);
    for (const edgeX of [x0, x1]) {
      if ((a.x - edgeX) * (b.x - edgeX) < 0) include(a.y + ((edgeX - a.x) / (b.x - a.x)) * (b.y - a.y));
    }
  }
  return min <= max ? [min, max] : null;
}

// ---------------------------------------------------------------------------
// Reachability solver
// ---------------------------------------------------------------------------

const SOLVER_X_STEP = 8;
/** Comfortable climb ratio: ~82% of the true PLAYER_SPEED / CRUISE_SPEED so humans have margin. */
const SOLVER_CLIMB = 0.62 / AUTHOR_SCALE;
const SOLVER_Y_STEP = SOLVER_X_STEP * SOLVER_CLIMB;
const SOLVER_MARGIN = 6;
export const SOLVER_ROWS = Math.floor((PLAYER_MAX_Y - PLAYER_MIN_Y) / SOLVER_Y_STEP) + 1;

export function solverRowY(row: number): number {
  return PLAYER_MIN_Y + row * SOLVER_Y_STEP;
}

export interface SolveResult {
  ok: boolean;
  /** Reachable rows per column (column c sits at x = c * SOLVER_X_STEP). */
  reach: Uint8Array[];
  exit: Uint8Array;
  unreachableCoins: CoinSpec[];
}

export const SOLVER_STEP = SOLVER_X_STEP;

function blockedColumns(content: SegmentContent, width: number, includePigs: boolean): Uint8Array[] {
  const columns = Math.ceil(width / SOLVER_X_STEP) + 1;
  const blocked = Array.from({ length: columns }, () => new Uint8Array(SOLVER_ROWS));
  const scale = content.entityScale ?? 1;
  const half = PLAYER_HIT * scale / 2 + SOLVER_MARGIN;
  if (scale !== 1) {
    blocked.forEach((column) => {
      for (let row = 0; row < SOLVER_ROWS; row += 1) {
        if (solverRowY(row) < PLAYER_MIN_Y * scale || solverRowY(row) > WORLD_HEIGHT - PLAYER_MIN_Y * scale) column[row] = 1;
      }
    });
  }
  const polygons = content.pipes.map((pipe) => pipePolygon(pipe));
  if (includePigs) {
    content.pigs.forEach((pig) => {
      const support = content.pipes[pig.pipe];
      const span = pigPatrolHalfSpan(support, pig);
      const width = PIG_WIDTH * scale * PIG_HIT_SCALE;
      const height = PIG_HEIGHT * scale * PIG_HIT_SCALE;
      polygons.push(rectPolygon(support.x - span - width / 2, pigCenterY(support) - height / 2, span * 2 + width, height));
    });
  }
  for (let column = 0; column < columns; column += 1) {
    const x = column * SOLVER_X_STEP;
    polygons.forEach((polygon) => {
      const extent = polygonSlabExtent(polygon, x - half, x + half);
      if (!extent) return;
      const from = Math.max(0, Math.ceil((extent[0] - half - PLAYER_MIN_Y) / SOLVER_Y_STEP));
      const to = Math.min(SOLVER_ROWS - 1, Math.floor((extent[1] + half - PLAYER_MIN_Y) / SOLVER_Y_STEP));
      for (let row = from; row <= to; row += 1) blocked[column][row] = 1;
    });
  }
  return blocked;
}

function propagate(blocked: Uint8Array[], entry: Uint8Array): Uint8Array[] {
  const reach = blocked.map(() => new Uint8Array(SOLVER_ROWS));
  for (let row = 0; row < SOLVER_ROWS; row += 1) reach[0][row] = entry[row] && !blocked[0][row] ? 1 : 0;
  for (let column = 1; column < blocked.length; column += 1) {
    const previous = reach[column - 1];
    const current = reach[column];
    for (let row = 0; row < SOLVER_ROWS; row += 1) {
      if (blocked[column][row]) continue;
      if (previous[row] || (row > 0 && previous[row - 1]) || (row < SOLVER_ROWS - 1 && previous[row + 1])) current[row] = 1;
    }
  }
  return reach;
}

function coinReachable(coin: CoinSpec, reach: Uint8Array[], scale = 1): boolean {
  const column = Math.round(coin.x / SOLVER_X_STEP);
  if (column < 0 || column >= reach.length) return false;
  const tolerance = (PLAYER_HIT / 2 + COIN_PICKUP_RADIUS) * scale - 6;
  for (let row = 0; row < SOLVER_ROWS; row += 1) {
    if (reach[column][row] && Math.abs(solverRowY(row) - coin.y) <= tolerance) return true;
  }
  return false;
}

export function fullEntry(): Uint8Array {
  return new Uint8Array(SOLVER_ROWS).fill(1);
}

/**
 * Checks that the segment can be crossed without shooting, starting from any
 * row in `entry`, and that every coin can be collected (kill coins only need
 * and pig-walkway hearts only need to be collectible once the pigs are gone).
 */
export function solveSegment(content: SegmentContent, width: number, entry: Uint8Array = fullEntry()): SolveResult {
  const blocked = blockedColumns(content, width, true);
  const reach = propagate(blocked, entry);
  const through = (forward: Uint8Array[], occupied: Uint8Array[]) => {
    if (!content.entityScale) return forward;
    const back = propagate([...occupied].reverse(), fullEntry()).reverse();
    return forward.map((column, x) => column.map((cell, y) => cell && back[x][y] ? 1 : 0));
  };
  const complete = through(reach, blocked);
  const exit = reach[reach.length - 1];
  // Kill coins and hearts on a pig's walkway only need to be reachable once
  // the pig is gone (or by timing a pass while it walks away).
  const behindPig = (coin: CoinSpec) => coin.role === 'kill' || coin.role === 'riskHeal';
  const unreachableCoins = content.coins.filter((coin) => !behindPig(coin) && !coinReachable(coin, complete, content.entityScale));
  const killCoins = content.coins.filter(behindPig);
  if (killCoins.length > 0) {
    const piglessBlocked = blockedColumns(content, width, false);
    const pigless = through(propagate(piglessBlocked, entry), piglessBlocked);
    unreachableCoins.push(...killCoins.filter((coin) => !coinReachable(coin, pigless, content.entityScale)));
  }
  return { ok: !content.layoutInvalid && exit.some(Boolean) && unreachableCoins.length === 0, reach: complete, exit, unreachableCoins };
}

// ---------------------------------------------------------------------------
// Mirroring and building
// ---------------------------------------------------------------------------

const FLIP_FACING: Record<PipeFacing, PipeFacing> = { up: 'down', down: 'up', left: 'left', right: 'right' };

export function mirrorContent(content: SegmentContent): SegmentContent {
  return {
    pipes: content.pipes.map((pipe) => ({
      ...pipe,
      y: WORLD_HEIGHT - pipe.y,
      facing: FLIP_FACING[pipe.facing],
      tilt: pipe.tilt === undefined ? undefined : -pipe.tilt,
    })),
    pigs: content.pigs.map((pig) => ({ ...pig })),
    // Pigs keep standing on the top of their (mirrored) pipe, so kill coins
    // follow the pig height rather than a flipped one.
    coins: content.coins.map((coin) => ({ ...coin, y: WORLD_HEIGHT - coin.y })),
  };
}

/** Re-anchor kill coins to the pig height after mirroring. */
function alignKillCoins(original: SegmentContent, mirrored: SegmentContent): SegmentContent {
  if (!mirrored.coins.some((coin) => coin.role === 'kill')) return mirrored;
  const shifts = original.pigs.map((pig) => pigCenterY(mirrored.pipes[pig.pipe]) - pigCenterY(original.pipes[pig.pipe]));
  const coins = mirrored.coins.map((coin, index) => {
    if (coin.role !== 'kill') return coin;
    const source = original.coins[index];
    // Attach to the nearest pig in x and keep its relative height.
    let best = 0;
    original.pigs.forEach((pig, pigIndex) => {
      const distance = Math.abs(original.pipes[pig.pipe].x - source.x);
      if (distance < Math.abs(original.pipes[original.pigs[best].pipe].x - source.x)) best = pigIndex;
    });
    return { ...coin, y: source.y + (shifts[best] ?? 0) };
  });
  return { ...mirrored, coins };
}

/** Squeeze authored x positions (and horizontal pipe lengths) to CRUISE_SPEED. */
function toCruiseScale(content: SegmentContent): SegmentContent {
  if (AUTHOR_SCALE === 1) return content;
  return {
    ...content,
    pipes: content.pipes.map((pipe) => ({
      ...pipe,
      x: pipe.x * AUTHOR_SCALE,
      length: pipe.facing === 'left' || pipe.facing === 'right' ? pipe.length * AUTHOR_SCALE : pipe.length,
    })),
    coins: content.coins.map((coin) => ({ ...coin, x: coin.x * AUTHOR_SCALE })),
  };
}

export function buildSegment(segment: SegmentDef, mirrored: boolean, random: () => number, entityScale = 1, entry: Uint8Array = fullEntry()): SegmentContent {
  if (entityScale > 1) {
    if (!segment.buildPhone) throw new Error(`Missing phone layout: ${segment.id}`);
    return segment.buildPhone(random, mirrored);
  }
  const content = toCruiseScale(segment.build(random));
  return mirrored ? alignKillCoins(content, mirrorContent(content)) : content;
}

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

export interface SongSection {
  name: string;
  bars: number;
  /** Desired intensities, cycled while filling the section. */
  wave?: Array<0 | 1 | 2 | 3>;
  /** Fixed script of segment ids. */
  script?: string[];
}

/** Bar layout measured from the BGM's bass/energy curve. */
export const SONG_SECTIONS: SongSection[] = [
  { name: '前奏', bars: 4, script: ['intro-glide', 'intro-first-pipe', 'rest-breadcrumbs'] },
  { name: '主歌 1', bars: 16, wave: [1, 1, 0, 1, 2, 1, 0, 2, 1, 2, 0] },
  { name: '过渡 1', bars: 8, wave: [1, 0, 2, 0, 1, 0] },
  { name: '副歌 1', bars: 16, wave: [2, 3, 2, 0, 3, 3, 0, 2, 3, 0] },
  { name: '间奏', bars: 8, wave: [0, 1, 0, 2, 0] },
  { name: '副歌 2', bars: 24, wave: [2, 3, 0, 2, 3, 3, 0, 3, 2, 3, 0] },
  { name: '尾奏', bars: 8, script: ['bonus-bunny', 'bonus-njz', 'rest-breadcrumbs', 'rest-breadcrumbs', 'rest-breadcrumbs', 'rest-breadcrumbs'] },
];

export const SONG_TOTAL_BARS = SONG_SECTIONS.reduce((sum, section) => sum + section.bars, 0);

export interface PlannedSegment {
  segment: SegmentDef;
  mirrored: boolean;
  startBar: number;
  section: string;
  content: SegmentContent;
}

export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

interface DirectorState {
  random: () => number;
  plan: PlannedSegment[];
  bar: number;
  entry: Uint8Array;
  maxTier: Map<SegmentTheme, number>;
  entityScale: number;
}

function tryPlace(state: DirectorState, segment: SegmentDef, section: string, mirrorFirst: boolean): boolean {
  const options = segment.mirror ? [mirrorFirst, !mirrorFirst] : [false];
  for (const mirrored of options) {
    const content = buildSegment(segment, mirrored, state.random, state.entityScale, state.entry);
    if (state.entityScale > 1 && validatePhoneLayout(content, segmentWidth(segment, state.entityScale)).length) continue;
    const previous = state.plan.at(-1);
    if (state.entityScale > 1 && previous && validatePhoneJoin(previous, { segment, mirrored, startBar: state.bar, section, content }).length) continue;
    const result = solveSegment(content, segmentWidth(segment, state.entityScale), state.entry);
    if (!result.ok) continue;
    state.plan.push({ segment, mirrored, startBar: state.bar, section, content });
    state.bar += segment.bars;
    state.entry = result.exit;
    state.maxTier.set(segment.theme, Math.max(state.maxTier.get(segment.theme) ?? 0, segment.tier));
    return true;
  }
  return false;
}

const HAS_PIGS = new Set(SEGMENTS.filter((segment) => segment.build(createRandom(1)).pigs.length > 0).map((segment) => segment.id));

function candidateWeight(state: DirectorState, segment: SegmentDef): number {
  const recent = state.plan.slice(-8);
  if (recent.some((planned) => planned.segment.id === segment.id)) return 0;
  const last = state.plan.at(-1)?.segment;
  if (last && last.theme === segment.theme) return 0;
  const seenTier = state.maxTier.get(segment.theme) ?? 0;
  if (segment.tier > seenTier + 1) return 0;
  if (segment.requires?.some((theme) => !state.maxTier.has(theme))) return 0;
  const uses = state.plan.filter((planned) => planned.segment.id === segment.id).length;
  let weight = 1 / (1 + uses * 1.5);
  // Teach before developing: the next tier of a theme is the most welcome.
  if (segment.tier === seenTier + 1) weight *= 2.2;
  if (state.plan.slice(-3).some((planned) => planned.segment.theme === segment.theme)) weight *= 0.35;
  // Shooting pigs is the most fun part of a run: favour segments that have them.
  if (HAS_PIGS.has(segment.id)) weight *= 1.8;
  return weight;
}

function fillSection(state: DirectorState, section: SongSection) {
  const endBar = state.bar + section.bars;
  if (section.script) {
    section.script.forEach((id) => {
      const segment = SEGMENTS_BY_ID.get(id);
      if (segment && state.bar + segment.bars <= endBar) tryPlace(state, segment, section.name, false);
    });
  }
  const wave = section.wave ?? [0];
  let step = 0;
  while (state.bar < endBar) {
    const remaining = endBar - state.bar;
    const desired = wave[step % wave.length];
    step += 1;
    let placed = false;
    for (const intensity of [desired, desired - 1, desired + 1, desired - 2, 0]) {
      const candidates = SEGMENTS
        .filter((segment) => !segment.scripted && segment.intensity === intensity && segment.bars <= remaining)
        .map((segment) => ({ segment, weight: candidateWeight(state, segment) }))
        .filter((candidate) => candidate.weight > 0);
      while (candidates.length > 0 && !placed) {
        const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
        let roll = state.random() * total;
        let index = 0;
        while (index < candidates.length - 1 && roll > candidates[index].weight) {
          roll -= candidates[index].weight;
          index += 1;
        }
        const [candidate] = candidates.splice(index, 1);
        placed = tryPlace(state, candidate.segment, section.name, state.random() < 0.5);
      }
      if (placed) break;
    }
    if (!placed) {
      // The breadcrumb trail is empty space: it always fits.
      const rest = SEGMENTS_BY_ID.get('rest-breadcrumbs')!;
      const content = state.entityScale > 1 ? phoneRestAfter(state.plan.at(-1)) : buildSegment(rest, false, state.random, state.entityScale, state.entry);
      state.plan.push({ segment: rest, mirrored: false, startBar: state.bar, section: section.name, content });
      state.bar += 1;
      state.entry = solveSegment(content, segmentWidth(rest, state.entityScale), state.entry).exit;
    }
  }
}

/** Plans the whole song. Later bars (if the music cannot play) loop the chorus. */
export function planSong(seed: number, entityScale = 1): PlannedSegment[] {
  const state: DirectorState = { random: createRandom(seed), plan: [], bar: 0, entry: fullEntry(), maxTier: new Map(), entityScale };
  SONG_SECTIONS.forEach((section) => fillSection(state, section));
  if (entityScale > 1) placePhoneItems(state.plan, state.random);
  else {
    placeHearts(state.plan, state.random);
    placeSunflowers(state.plan);
    placeMorphs(state.plan);
  }
  return state.plan;
}

/**
 * At most one healing heart per section, placed one of two ways:
 * - on the walkway of a patrolling pig (a horizontal pipe): a gamble, the
 *   player can shoot the pig or time a pass while it walks away;
 * - in the first calm segment after the section's hardest stretch, replacing
 *   a pickup: a safe breather right where a heart was most likely lost.
 */
function placeHearts(plan: PlannedSegment[], random: () => number) {
  const entries = new Map<PlannedSegment, Uint8Array>();
  if (plan.some((planned) => planned.content.entityScale)) {
    let entry = fullEntry();
    for (const planned of plan) {
      entries.set(planned, entry);
      entry = solveSegment(planned.content, segmentWidth(planned.segment), entry).exit;
    }
  }
  const sections = new Map<string, PlannedSegment[]>();
  plan.forEach((planned) => sections.set(planned.section, [...(sections.get(planned.section) ?? []), planned]));
  sections.forEach((segments) => {
    const walkways = segments.flatMap((planned) => planned.content.pigs
      .filter((pig) => pig.patrol > 0 && ['left', 'right'].includes(planned.content.pipes[pig.pipe].facing))
      .map((pig) => ({ planned, pipe: planned.content.pipes[pig.pipe] })))
      .filter(({ planned, pipe }) => {
        if (!planned.content.entityScale) return true;
        const heart: CoinSpec = { x: pipe.x, y: pigCenterY(pipe), role: 'riskHeal' };
        return solveSegment({ ...planned.content, coins: [...planned.content.coins, heart] }, segmentWidth(planned.segment), entries.get(planned)).ok;
      });
    let calm: PlannedSegment | undefined;
    let afterHard = false;
    for (const planned of segments) {
      if (planned.segment.intensity >= 2) afterHard = true;
      if (afterHard && planned.segment.intensity === 0 && planned.content.coins.some(isPickup)) {
        calm = planned;
        break;
      }
    }
    if (walkways.length && (!calm || random() < 0.6)) {
      const { planned, pipe } = walkways[Math.floor(walkways.length / 2)];
      const heart: CoinSpec = { x: pipe.x, y: pigCenterY(pipe), role: 'riskHeal' };
      // The heart takes the place of the kill coins right on the walkway.
      const coins = planned.content.coins.filter((coin) => Math.hypot(coin.x - heart.x, coin.y - heart.y) > 50);
      planned.content = { ...planned.content, coins: [...coins, heart] };
    } else if (calm) {
      const pickups = calm.content.coins.filter(isPickup);
      const heart = pickups[Math.floor(pickups.length / 2)];
      calm.content = { ...calm.content, coins: calm.content.coins.map((coin) => (coin === heart ? { ...coin, role: 'heal' } : coin)) };
    }
  });
}

/** Sections that get a rainbow sunflower (10 seconds of invincibility). */
const POWER_SECTIONS = ['副歌 1', '副歌 2'];

/**
 * One sunflower opens each chorus: it replaces a guide light stick in the
 * section's first segment that has one (guide coins are always reachable),
 * so the whole chorus starts with a burst of invincibility.
 */
function placeSunflowers(plan: PlannedSegment[]) {
  POWER_SECTIONS.forEach((section) => {
    const target = plan.find((planned) => planned.section === section && planned.content.coins.some((coin) => coin.role === 'guide'));
    if (!target) return;
    const guides = target.content.coins.filter((coin) => coin.role === 'guide');
    const flower = guides[Math.min(guides.length - 1, 2)];
    target.content = { ...target.content, coins: target.content.coins.map((coin) => (coin === flower ? { ...coin, role: 'power' } : coin)) };
  });
}

/** Members in the roster; index 0 (Blue) is who the run starts as. */
export const MEMBER_COUNT = 5;

/** Bars between member tokens: 10 equal turns over the 80 playable bars. */
export const MORPH_EVERY_BARS = 8;

/**
 * A member token every 8 bars (bars 8, 16, … 72), so the five members take
 * equal turns in a fixed cycle: Blue, Green, Pink, Yellow, Purple, Blue, …
 * Each token swaps the pickup nearest its bar (guide sticks preferred), which
 * the solver already proved reachable.
 */
function placeMorphs(plan: PlannedSegment[]) {
  const lastBar = SONG_TOTAL_BARS - 4;
  for (let turn = 1; turn * MORPH_EVERY_BARS < lastBar; turn += 1) {
    const target = turn * MORPH_EVERY_BARS;
    let best: { planned: PlannedSegment; coin: CoinSpec; cost: number } | undefined;
    plan.forEach((planned) => planned.content.coins.forEach((coin) => {
      if (!isPickup(coin)) return;
      const cost = Math.abs(planned.startBar + coin.x / BAR - target) + (coin.role === 'guide' ? 0 : 0.5);
      if (!best || cost < best.cost) best = { planned, coin, cost };
    }));
    if (!best) continue;
    const { planned, coin: token } = best;
    const member = turn % MEMBER_COUNT;
    planned.content = { ...planned.content, coins: planned.content.coins.map((coin) => (coin === token ? { ...coin, role: 'morph', member } : coin)) };
  }
}

const isPickup = (coin: CoinSpec) => coin.role === 'reward' || coin.role === 'bonus' || coin.role === 'guide';

/** Continues a plan beyond the song with chorus-style sections. */
export function extendPlan(plan: PlannedSegment[], seed: number, bars = 24): PlannedSegment[] {
  const last = plan.at(-1);
  const state: DirectorState = {
    random: createRandom(seed),
    plan: [...plan],
    bar: last ? last.startBar + last.segment.bars : 0,
    entry: fullEntry(),
    maxTier: new Map(plan.map((planned) => [planned.segment.theme, 3] as const)),
    entityScale: last?.content.entityScale ?? 1,
  };
  fillSection(state, { name: '加时', bars, wave: [2, 3, 0, 2, 3, 3, 0] });
  const extension = state.plan.slice(plan.length);
  if (state.entityScale > 1) placePhoneItems(extension, state.random, true);
  else placeHearts(extension, state.random);
  return extension;
}

/** World distance at which a bar reaches the player. */
export function barDistance(bar: number): number {
  return SONG_START_DISTANCE + bar * BAR;
}
