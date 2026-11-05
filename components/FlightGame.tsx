import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { drawPipe } from './pipeArt';
import { MEMBER_TOKENS, SUNFLOWER_PALETTE, SUNFLOWER_ROWS, drawCollectible, drawHeartPickup, drawMemberToken, drawEndingTitle, drawPig, drawSunflower } from './gameArt';
import { Effects, RAINBOW, drawBolt } from './effects';
import {
  BAR,
  COIN_PICKUP_RADIUS,
  CRUISE_SPEED,
  PIG_HEIGHT,
  PIG_HIT_SCALE,
  PIG_WIDTH,
  PIPE_THICKNESS,
  PLAYER_HIT,
  PLAYER_MIN_Y,
  PLAYER_SIZE,
  PLAYER_SPEED,
  SONG_TOTAL_BARS,
  WORLD_HEIGHT,
  barDistance,
  pigCenterY,
  pigPatrolHalfSpan,
  pipeOrientation,
  pipeDrawOrder,
  pipePolygon,
  MORPH_EVERY_BARS,
  planSong,
  polygonsOverlap,
  rectPolygon,
  type PipeSpec,
  type PlannedSegment,
} from './levelSegments';
import { KeycapButton, PixelButton, PixelFrame, PixelIcon, PixelNumber, TouchControlButton } from './PixelUI';
import { PICKUP_HEIGHT } from './gameMetrics';
import { PHONE_ENTITY_SCALE, pigScaleFor, readPhoneDevice } from './displayProfile';
import { phoneFrameSteps } from './frameTiming';

import supernaturalAudio from '../songs/Supernatural - 250 Remix.MP3';
import { SQUAD, SQUAD_FRAME_COUNT } from './flightMembers';
import ResultModal from './ResultModal';
import SupportPanel from './SupportPanel';
import { prepareResultCard } from './resultCardArt';
import bottom1 from '../NJZPowerpuffGirls/bottom1.webp';
import bottom2 from '../NJZPowerpuffGirls/bottom2.webp';
import bottom3 from '../NJZPowerpuffGirls/bottom3.webp';
import middle1 from '../NJZPowerpuffGirls/middle1.webp';
import middle2 from '../NJZPowerpuffGirls/middle2.webp';
import middle3 from '../NJZPowerpuffGirls/middle3.webp';
import topImage from '../NJZPowerpuffGirls/top.webp';

export type GamePhase = 'ready' | 'playing' | 'paused' | 'gameover';
export type EntityKind = 'obstacle' | 'collectible' | 'enemy';

export interface FlightGameStats {
  score: number;
  distance: number;
  health: number;
  collected: number;
  defeated: number;
  /** Seconds of the song played so far (keeps counting while the world brakes at the end). */
  songSeconds: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GameEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  /** Obstacle geometry; its own x/y are ignored in favour of the entity's. */
  pipe?: PipeSpec;
  pipeOrientation?: 'vertical' | 'horizontal';
  pipeRotation?: number;
  supportPipeId?: number;
  patrolSpan?: number;
  patrolSpeed?: number;
  patrolOffset?: number;
  patrolDirection?: -1 | 1;
  patrolPhase?: number;
  /** Collectible that restores a heart instead of scoring. */
  heal?: boolean;
  /** Rainbow sunflower: starts the invincible mode. */
  power?: boolean;
  /** Member token: touching it turns the player into this member (roster index). */
  morph?: number;
  damageApplied: boolean;
}

interface Projectile {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TrailParticle {
  relativeX: number;
  relativeY: number;
  size: number;
  baseSize: number;
  speed: number;
  opacity: number;
}

interface TrailPoint {
  y: number;
  age: number;
}

interface TrailSample {
  x: number;
  y: number;
}

const BOTTOM_IMAGES = [bottom1, bottom2, bottom3];
const MIDDLE_IMAGES = [middle1, middle2, middle3];
const TOP_IMAGES = [topImage];

const SNOW_FLAKE_SIZES = [2, 3, 4, 5];
const SNOW_FLAKE_COLORS = [
  'rgba(255, 255, 255, 0.9)',
  'rgba(220, 235, 255, 0.8)',
  'rgba(200, 220, 255, 0.7)',
  'rgba(180, 200, 240, 0.6)',
];
/** Five lives; a heart refills an empty one, at full health it is only points. */
const START_HEALTH = 5;
/** The rainbow sunflower makes the player invincible for this long. */
const POWER_DURATION_MS = 10000;
/** After invincibility ends, a short blinking grace so a pipe you are inside cannot hit you. */
const POWER_GRACE_MS = 1200;
/**
 * Ending: no new segments in the last bars of the outro; then the world
 * brakes to a stop with "NJZ" drifting in to the centre, the player glides to
 * centre stage and the five members pop in (puff by puff) in an arrowhead.
 * The result card opens as soon as the final member finishes appearing.
 */
const ENDING_BAR = SONG_TOTAL_BARS - 4;
const BRAKE_START_DISTANCE = barDistance(SONG_TOTAL_BARS - 2);
const BRAKE_MS = 4500;
/** Speed falls as (1 - p)^BRAKE_EASE, so the stop is slow and soft. */
const BRAKE_EASE = 1.5;
const BRAKE_DISTANCE = (CRUISE_SPEED * (BRAKE_MS / 1000)) / (BRAKE_EASE + 1);
const ENDING_POP_DELAY_MS = 350;
const ENDING_POP_STAGGER_MS = 170;
const ENDING_STAGE_Y = 450;
const ENDING_LETTERS_Y = 190;
/** Arrowhead around the front member (centre stage), front first. */
const ENDING_SLOTS = [
  { dx: 0, dy: 0 },
  { dx: -80, dy: -66 },
  { dx: -80, dy: 66 },
  { dx: -160, dy: -132 },
  { dx: -160, dy: 132 },
];
const endingFrontX = (width: number) => width / 2 + 70;
/** The member you are flies at the front of the ending formation; the rest follow in roster order. */
const endingOrder = (current: number) => [current, ...SQUAD.map((_, index) => index).filter((index) => index !== current)];

/** Shared "pop" for a member appearing: squeeze/flash first, then burst out and settle. */
function popPose(since: number): { visibleOld: boolean; scale: number; flash: number } {
  if (since < MORPH_SQUEEZE_MS) {
    const p = since / MORPH_SQUEEZE_MS;
    return { visibleOld: true, scale: 1 - 0.35 * p, flash: p };
  }
  if (since < MORPH_SQUEEZE_MS + MORPH_SETTLE_MS) {
    const p = (since - MORPH_SQUEEZE_MS) / MORPH_SETTLE_MS;
    const scale = p < 0.35 ? 0.65 + 0.57 * (p / 0.35) : 1.22 - 0.22 * (1 - (1 - (p - 0.35) / 0.65) ** 2);
    return { visibleOld: false, scale, flash: Math.max(0, 1 - p * 2.5) };
  }
  return { visibleOld: false, scale: 1, flash: 0 };
}

/** Member change pop: squeeze-and-flash, then burst out and settle. */
const MORPH_SQUEEZE_MS = 110;
const MORPH_SETTLE_MS = 320;
/**
 * Score = distance flown + light sticks + pigs, pigs weighted highest: a pig
 * is worth fifteen sticks, so leaving the guide line to shoot one pays off.
 */
const DISTANCE_PER_POINT = 100;
/** Song length from the level plan, until the audio reports its own (iOS loads it late). */
const SONG_FALLBACK_SECONDS = barDistance(SONG_TOTAL_BARS) / CRUISE_SPEED;
const STICK_POINTS = 10;
const PIG_POINTS = 150;
/**
 * Pigs shot within this long of each other form a chain. Pigs in a row stand
 * about two beats (1.1 s) apart; 2.5 s also links neighbouring pig segments.
 */
const PIG_COMBO_WINDOW_MS = 2500;
/** Points multiplier for the 1st, 2nd, 3rd-and-later pig of a chain. */
const PIG_COMBO_MULTIPLIERS = [1, 1.5, 2];
/** Chain colours: plain, then orange, pink and gold from the fourth pig. */
const PIG_COMBO_COLORS = ['#ffffff', '#ffb347', '#ff7ab8', '#ffd84a'];
const pigComboColor = (combo: number) => PIG_COMBO_COLORS[Math.min(combo, PIG_COMBO_COLORS.length) - 1];
const COMBO_NAMES = ['', '', '双连杀', '三连杀', '四连杀', '五连杀'];
const comboName = (combo: number) => COMBO_NAMES[combo] ?? `${combo}连杀`;
/** Hearts, member tokens and sunflowers; a heart past all five slots is worth double. */
const ITEM_POINTS = 50;
/**
 * Sticks eaten in a row show one total once the chain breaks. Sticks in a
 * line are 0.15 s apart (sparse guide trails up to ~0.5 s); gaps of 0.6 s
 * and more are rare, so that is where a chain ends.
 */
const STICK_COMBO_GAP_MS = 600;
const SCORE_GOLD = '#ffd84a';
/** While invincible, every light stick and pig counts this many times. */
const POWER_MULTIPLIER = 2;
/** After the last heart is lost the world freezes this long before the result card opens. */
const DEATH_PAUSE_MS = 900;
const MUSIC_VOLUME = 0.72;
const PLAYER_ACCELERATION = 1900;
const PLAYER_RELEASE_DAMPING = 8;
const PROJECTILE_SPEED = 620;
const PROJECTILE_COOLDOWN = 280;
const MAX_PROJECTILES = 6;
const DAMAGE_INVULNERABILITY_MS = 1000;
const FRAME_DURATION_MS = 90;
const HUD_SYNC_MS = 100;

const TRAIL_HISTORY_SECONDS = 0.35;
const TRAIL_SAMPLE_COUNT = 18;
const TRAIL_HEIGHT = 35;
const TRAIL_HEART_SIZES = [12, 14, 16, 18, 20] as const;
const TRAIL_HEART_SPEED = 1.2 * 120;



const FILLED_HEART_SPRITE = [
  '..oo..oo..',
  '.offooffo.',
  'offffffffo',
  'offffffffo',
  '.offffffo.',
  '..offffo..',
  '...offo...',
  '....oo....',
] as const;

const EMPTY_HEART_SPRITE = [
  '..oo..oo..',
  '.o..oo..o.',
  'o........o',
  'o........o',
  '.o......o.',
  '..o....o..',
  '...o..o...',
  '....oo....',
] as const;

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function circleRectOverlap(cx: number, cy: number, radius: number, rect: Rect): boolean {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}


/** Player's fixed screen x in world units: enough look-ahead on any aspect ratio. */
function playerXFor(width: number): number {
  // Narrow (portrait) screens move the player left so some look-ahead remains.
  return clamp(width * 0.24, Math.min(200, width * 0.22), 300);
}

// `?portrait` lets phones play upright instead of rotating to landscape (experiment).
const allowPortrait = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('portrait');
// Local development only: inspect the phone layout without changing the browser's device settings.
const phonePreview = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('device') === 'phone';

function approach(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(target, current + amount);
  if (current > target) return Math.max(target, current - amount);
  return current;
}

function interpolateTrailY(history: TrailPoint[], age: number, fallbackY: number): number {
  if (history.length === 0) return fallbackY;
  if (age <= history[0].age) return history[0].y;

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    if (age <= current.age) {
      const span = Math.max(0.0001, current.age - previous.age);
      const ratio = clamp((age - previous.age) / span, 0, 1);
      return previous.y + (current.y - previous.y) * ratio;
    }
  }

  return history[history.length - 1].y;
}

function buildTrailSamples(
  history: TrailPoint[],
  playerX: number,
  playerY: number,
  trailLength: number,
): TrailSample[] {
  return Array.from({ length: TRAIL_SAMPLE_COUNT }, (_, index) => {
    const progress = index / (TRAIL_SAMPLE_COUNT - 1);
    const age = progress * TRAIL_HISTORY_SECONDS;
    return {
      x: playerX - progress * trailLength,
      y: interpolateTrailY(history, age, playerY),
    };
  });
}

function trailYAtRelativeX(samples: TrailSample[], relativeX: number, fallbackY: number): number {
  if (samples.length === 0) return fallbackY;
  const position = clamp(1 - relativeX, 0, 1) * (samples.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(samples.length - 1, lowerIndex + 1);
  const ratio = position - lowerIndex;
  const lower = samples[lowerIndex];
  const upper = samples[upperIndex];
  return lower.y + (upper.y - lower.y) * ratio;
}

function traceTrailPath(context: CanvasRenderingContext2D, samples: TrailSample[]) {
  const points = [...samples].reverse();
  if (points.length === 0) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = (current.x + next.x) / 2;
    const midpointY = (current.y + next.y) / 2;
    context.quadraticCurveTo(current.x, current.y, midpointX, midpointY);
  }
  const last = points[points.length - 1];
  context.quadraticCurveTo(last.x, last.y, last.x, last.y);
}

function drawTrailHeart(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const drawX = Math.floor(x);
  const drawY = Math.floor(y);
  const pixelSize = Math.max(2, Math.floor(size));

  if (pixelSize <= 12) {
    context.fillRect(drawX - 4, drawY - 3, 3, 2);
    context.fillRect(drawX + 1, drawY - 3, 3, 2);
    context.fillRect(drawX - 4, drawY - 1, 9, 2);
    context.fillRect(drawX - 3, drawY + 1, 7, 1);
    context.fillRect(drawX - 2, drawY + 2, 5, 1);
    context.fillRect(drawX - 1, drawY + 3, 3, 1);
    context.fillRect(drawX, drawY + 4, 1, 1);
  } else if (pixelSize <= 16) {
    context.fillRect(drawX - 5, drawY - 4, 4, 2);
    context.fillRect(drawX + 1, drawY - 4, 4, 2);
    context.fillRect(drawX - 5, drawY - 2, 11, 3);
    context.fillRect(drawX - 4, drawY + 1, 9, 2);
    context.fillRect(drawX - 3, drawY + 3, 7, 1);
    context.fillRect(drawX - 2, drawY + 4, 5, 1);
    context.fillRect(drawX - 1, drawY + 5, 3, 1);
    context.fillRect(drawX, drawY + 6, 1, 1);
  } else {
    context.fillRect(drawX - 6, drawY - 5, 5, 2);
    context.fillRect(drawX + 1, drawY - 5, 5, 2);
    context.fillRect(drawX - 6, drawY - 3, 13, 4);
    context.fillRect(drawX - 5, drawY + 1, 11, 2);
    context.fillRect(drawX - 4, drawY + 3, 9, 1);
    context.fillRect(drawX - 3, drawY + 4, 7, 1);
    context.fillRect(drawX - 2, drawY + 5, 5, 1);
    context.fillRect(drawX - 1, drawY + 6, 3, 1);
    context.fillRect(drawX, drawY + 7, 1, 1);
  }
}

// Small HUD counters: a light stick and a pig face, drawn like the hearts.
const STICK_ICON_SPRITE = [
  '.o...o.',
  'owo.owo',
  'owwowwo',
  'owkwkwo',
  'owwwwwo',
  '.owwwo.',
  '..owo..',
  '..owo..',
  '..ooo..',
] as const;
const PIG_ICON_SPRITE = [
  '.oo...oo.',
  'oppoooppo',
  'opppppppo',
  'opkpppkpo',
  'oppnnnnpo',
  'oppnhnhpo',
  'opppppppo',
  '.ooooooo.',
] as const;
const HEART_COLORS: Record<string, string> = { f: '#ef6a7d', o: '#ffd0dc' };
const STICK_ICON_COLORS: Record<string, string> = { o: '#b9c4ee', w: '#f4f7ff', k: '#272a58' };
const PIG_ICON_COLORS: Record<string, string> = { o: '#c7739e', p: '#f3bdd3', k: '#2a1838', n: '#de8bb0', h: '#7a2d5a' };

const PixelSprite: React.FC<{ rows: readonly string[]; colors: Record<string, string>; cellSize?: number; className?: string; compact?: boolean }> = ({
  rows,
  colors,
  cellSize = 2,
  className = '',
  compact = false,
}) => {
  if (compact) {
    // Keep the original pixel grid, but combine horizontal runs into one
    // path per colour instead of mounting a DOM node for every pixel.
    const paths = new Map<string, string>();
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        const color = colors[row[x]];
        let end = x + 1;
        while (end < row.length && colors[row[end]] === color) end++;
        if (color && color !== 'transparent') {
          const width = end - x;
          paths.set(color, `${paths.get(color) ?? ''}M${x} ${y}h${width}v1h-${width}z`);
        }
        x = end;
      }
    });
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        className={`pixel-sprite-compact inline-block shrink-0 ${className}`}
        width={rows[0].length * cellSize}
        height={rows.length * cellSize}
        viewBox={`0 0 ${rows[0].length} ${rows.length}`}
        shapeRendering="crispEdges"
      >
        {Array.from(paths, ([color, path]) => <path key={color} fill={color} d={path} />)}
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 ${className}`}
      style={{
        width: `${rows[0].length * cellSize}px`,
        height: `${rows.length * cellSize}px`,
        gridTemplateColumns: `repeat(${rows[0].length}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows.length}, ${cellSize}px)`,
        imageRendering: 'pixelated',
      }}
    >
      {rows.flatMap((row, rowIndex) => Array.from(row).map((pixel, columnIndex) => (
        <span key={`${rowIndex}-${columnIndex}`} style={{ width: `${cellSize}px`, height: `${cellSize}px`, backgroundColor: colors[pixel] ?? 'transparent' }} />
      )))}
    </span>
  );
};

const PixelHeart: React.FC<{ filled: boolean }> = ({ filled }) => (
  <PixelSprite rows={filled ? FILLED_HEART_SPRITE : EMPTY_HEART_SPRITE} colors={HEART_COLORS} cellSize={2.5} />
);

/** A member flapping through her five flight frames (DOM version of the canvas sprite). */
const MemberFlyer: React.FC<{ member: number; size: number; phase?: number; className?: string }> = ({ member, size, phase = 0, className = '' }) => {
  const [frame, setFrame] = useState(phase % SQUAD_FRAME_COUNT);
  useEffect(() => {
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % SQUAD_FRAME_COUNT), 110);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <img
      src={SQUAD[member].frames[frame]}
      alt=""
      draggable={false}
      className={`block select-none ${className}`}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
  );
};

/** Member names, in `SQUAD` order. */
const MEMBER_NAMES = ['Minji', 'Haerin', 'Hanni', 'Danielle', 'Hyein'] as const;

/** The small trail heart from the canvas (`drawTrailHeart`), as rows for the DOM. */
const TRAIL_HEART_SPRITE = [
  'xxx..xxx.',
  'xxx..xxx.',
  'xxxxxxxxx',
  'xxxxxxxxx',
  '.xxxxxxx.',
  '..xxxxx..',
  '...xxx...',
  '....x....',
] as const;

/** Layout height of an element, kept current (the root may be rotated, so no viewport units). */
function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(390);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setHeight(element.clientHeight || 390);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

/** Wrap a ring offset into (−2.5, 2.5]: five members, the pick at 0. */
function wrapRing(offset: number) {
  const size = SQUAD.length;
  let value = ((offset % size) + size) % size;
  if (value > size / 2) value -= size;
  return value;
}

/** The member wheel, in flyer-size units: a flat circle on the screen plane. */
const WHEEL_RADIUS = 1.9;
const WHEEL_STEP = (29 * Math.PI) / 180;

/**
 * Where a member sits on the wheel for a (fractional) ring offset. The wheel
 * is a flat circle on the screen (no depth) opening downward: the pick at
 * its highest point, the others spaced evenly down the arc on both sides;
 * past ±2 a member fades out on its way round to the other side.
 */
function wheelPose(offset: number) {
  const angle = offset * WHEEL_STEP;
  const distance = Math.abs(offset);
  return {
    x: Math.sin(angle) * WHEEL_RADIUS,
    y: (1 - Math.cos(angle)) * WHEEL_RADIUS,
    scale: 0.58 + 0.42 * Math.max(0, 1 - distance),
    opacity: distance <= 2 ? 1 - 0.15 * Math.min(1, distance) : Math.max(0, 0.85 * (2.5 - distance) * 2),
    z: 10 - Math.round(distance * 2),
  };
}

/** Turns the ring toward `member` along the shortest way, easing out with a light overshoot. */
function useTurntable(member: number, flyerSize: number) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const rotationRef = useRef(member);
  const [settledMember, setSettledMember] = useState<number | null>(member);
  useLayoutEffect(() => {
    // One animation owns position AND opacity. A CSS transform transition
    // would drag a wrapped member across the wheel after she has faded out.
    // Updating these five nodes also avoids rebuilding the home page every frame.
    const paint = (rotation: number) => {
      buttonsRef.current.forEach((button, index) => {
        if (!button) return;
        const pose = wheelPose(wrapRing(index - rotation));
        button.style.transform = `translate3d(calc(-50% + ${pose.x * flyerSize}px), calc(-50% + ${pose.y * flyerSize}px), 0) scale(${pose.scale})`;
        button.style.opacity = String(pose.opacity);
        button.style.zIndex = String(pose.z);
        button.style.pointerEvents = pose.opacity < 0.2 ? 'none' : '';
      });
    };
    const from = rotationRef.current;
    const to = from + wrapRing(member - from);
    paint(from);
    if (Math.abs(to - from) < 1e-3) {
      rotationRef.current = to;
      paint(to);
      setSettledMember(member);
      return;
    }
    setSettledMember(null);
    const steps = Math.abs(to - from);
    const duration = 380 + 160 * steps;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = clamp((now - start) / duration, 0, 1);
      // easeOutBack: the ring swings slightly past and settles.
      const c = 1.2;
      const eased = 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
      rotationRef.current = from + (to - from) * eased;
      paint(rotationRef.current);
      if (p < 1) frame = requestAnimationFrame(tick);
      else {
        rotationRef.current = to;
        setSettledMember(member);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [member, flyerSize]);
  return [buttonsRef, settledMember === member] as const;
}

/** Twinkling pixel stars around the picked member, in flyer-size units from her centre. */
const PICK_SPARKLES = [
  { x: -0.5, y: -0.34, delay: 0, small: false, tint: false },
  { x: 0.46, y: -0.44, delay: -0.9, small: true, tint: true },
  { x: 0.58, y: 0.2, delay: -1.6, small: false, tint: false },
  { x: -0.62, y: 0.26, delay: -0.4, small: true, tint: true },
];

/**
 * Home page over the slowly scrolling night city, laid out symmetrically:
 * title on top, the five members on a turntable in the middle (the pick in
 * front with her trail; tap another and the ring turns her to the front;
 * one is picked at random each visit) and the start button below. Enter starts.
 */
const HomeScreen: React.FC<{ member: number; isPhone: boolean; keysEnabled: boolean; onPick: (member: number) => void; onStart: () => void }> = ({ member, isPhone, keysEnabled, onPick, onStart }) => {
  const [rootRef, height] = useElementHeight<HTMLDivElement>();
  // Everything scales with the layout height: 390 is a landscape phone.
  const scale = clamp(height / 390, 1, 2);
  const titleSize = Math.round(Math.min(44 * scale, 88));
  const flyerSize = Math.round(Math.min(100 * scale, 200));
  const stageHeight = Math.round(flyerSize * 1.75);
  const [memberButtonsRef, settled] = useTurntable(member, flyerSize);
  const color = SQUAD[member].trail;

  useEffect(() => {
    if (!keysEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        onStart();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keysEnabled, onStart]);

  // The pick's slot (the top of the arch) inside the stage.
  const frontY = flyerSize * 0.55;
  const stageWidth = flyerSize * 4;
  const buttonScale = Math.min(scale, 1.3);

  return (
    <div
      ref={rootRef}
      inert={!keysEnabled}
      className="home-screen absolute inset-0 z-20 flex flex-col items-center justify-between"
      style={{
        fontFamily: 'NJZPixelZh, sans-serif',
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
        paddingTop: `calc(max(1rem, env(safe-area-inset-top)) + ${Math.round(14 * scale)}px)`,
        paddingBottom: `calc(max(1rem, env(safe-area-inset-bottom)) + ${Math.round(14 * scale)}px)`,
      }}
    >
      <div className="home-enter flex flex-col items-center text-center">
        <div className="font-pixel-en flex items-center gap-2 uppercase tracking-[0.32em] text-[#b9c6ff]" style={{ fontSize: Math.round(11 * Math.min(scale, 1.4)) }}>
          <span className="block h-[2px] w-5 bg-[#b9c6ff]/70" />
          NJZ Flight
          <span className="block h-[2px] w-5 bg-[#b9c6ff]/70" />
        </div>
        <h1 className="home-title relative mt-2 leading-none text-white" style={{ fontSize: titleSize }}>
          飞越冬夜
          <span aria-hidden="true" className="home-twinkle" style={{ left: '-0.22em', top: '-0.1em' }} />
          <span aria-hidden="true" className="home-twinkle" style={{ right: '-0.3em', top: '0.18em', animationDelay: '-0.7s' }} />
          <span aria-hidden="true" className="home-twinkle home-twinkle-small" style={{ left: '-0.45em', bottom: '0.05em', animationDelay: '-1.3s' }} />
        </h1>
      </div>

      {/* The member wheel: tap a member and the wheel turns her up to the middle. */}
      <div className="home-enter home-enter-late relative" style={{ width: stageWidth, height: stageHeight }}>
        {/* Glow, sparkles, trail and hearts belong to the front slot; they fade in once the ring settles. */}
        <div
          key={`front-${member}`}
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 transition-opacity duration-200"
          style={{ top: frontY, opacity: settled ? 1 : 0 }}
        >
          <span className="home-glow absolute -translate-x-1/2 -translate-y-1/2" style={{ width: flyerSize * 1.3, height: flyerSize * 1.3, ['--member' as string]: color.rgb }} />
          {PICK_SPARKLES.map((sparkle, index) => (
            <span
              key={index}
              className={`home-twinkle ${sparkle.small ? 'home-twinkle-small' : ''}`}
              style={{ left: sparkle.x * flyerSize, top: sparkle.y * flyerSize, animationDelay: `${sparkle.delay}s`, ['--spark' as string]: sparkle.tint ? color.hex : '#fff' }}
            />
          ))}
          <span className="member-bob absolute" style={{ animationDuration: '1.8s', animationDelay: `${member * -360}ms` }}>
            <span
              className="absolute block"
              style={{
                right: 0,
                top: 0,
                width: flyerSize * 0.75,
                height: Math.round(flyerSize * 0.27),
                transform: 'translateY(-38%)',
                background: `linear-gradient(to left, rgba(${color.rgb}, 0.85), rgba(${color.rgb}, 0.4) 55%, transparent)`,
              }}
            />
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="home-trail-heart absolute"
                style={{ right: flyerSize * 0.05, top: 0, animationDelay: `${index * -0.6}s`, ['--travel' as string]: `${-flyerSize * 0.65}px` }}
              >
                <PixelSprite rows={TRAIL_HEART_SPRITE} colors={{ x: color.hex }} cellSize={scale >= 1.5 ? 2 : 1.5} />
              </span>
            ))}
          </span>
        </div>

        <div role="radiogroup" aria-label="选择出发成员">
          {SQUAD.map((_, index) => {
            const selected = index === member;
            return (
              <button
                key={index}
                ref={(button) => { memberButtonsRef.current[index] = button; }}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={MEMBER_NAMES[index]}
                title={MEMBER_NAMES[index]}
                onClick={() => onPick(index)}
                className="home-member absolute left-1/2"
                style={{ top: frontY }}
              >
                <span className="member-bob block" style={{ animationDuration: '1.8s', animationDelay: `${index * -360}ms` }}>
                  <MemberFlyer member={index} size={flyerSize} phase={index * 2} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="absolute inset-x-0 flex justify-center" style={{ top: frontY + flyerSize * 0.52 }}>
          <div key={`name-${member}`} className="home-name font-pixel-en uppercase leading-none tracking-[0.18em]" style={{ color: color.hex, fontSize: Math.round(18 * Math.min(scale, 1.5)) }}>
            {MEMBER_NAMES[member]}
          </div>
        </div>
        <div className="absolute inset-x-0 text-center text-white/45" style={{ top: frontY + flyerSize * 0.52 + Math.round(18 * Math.min(scale, 1.5)) + 8, fontSize: Math.round(11 * Math.min(scale, 1.4)) }}>
          选择出发成员
        </div>
      </div>

      {/* Start button, with the keyboard controls either side where there is a keyboard. */}
      <div className="home-enter home-enter-late flex items-center gap-5">
        {!isPhone && <span className="mouse-only w-24 items-center justify-end gap-1 text-[11px] text-white/60"><kbd className="home-key">↑</kbd><kbd className="home-key">↓</kbd>移动</span>}
        <KeycapButton
          onClick={onStart}
          width={Math.round(184 * buttonScale)}
          height={Math.round(52 * buttonScale)}
          cell={buttonScale >= 1.25 ? 3 : 2}
          className="home-start shrink-0 text-white"
          style={{ fontSize: Math.round(20 * buttonScale) }}
          aria-label="立即开始"
          title="立即开始"
        >
          <span className="home-start-arrow flex"><PixelIcon name="play" size={18} /></span>
          立即开始
        </KeycapButton>
        {!isPhone && <span className="mouse-only w-24 items-center justify-start gap-1 text-[11px] text-white/60"><kbd className="home-key">空格</kbd>发射</span>}
      </div>
    </div>
  );
};

/** How to play and how points are scored, opened from the home page's info button. */
const HelpPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const powerCells = Math.ceil(POWER_DURATION_MS / 1000);
  const rows: Array<{ icon: React.ReactNode; title: string; points?: string; text: string }> = [
    { icon: <PixelSprite compact rows={STICK_ICON_SPRITE} colors={STICK_ICON_COLORS} cellSize={2} />, title: '应援棒', points: `+${STICK_POINTS}`, text: '一串连着吃，吃完这一串再一起显示得分。' },
    { icon: <PixelSprite compact rows={PIG_ICON_SPRITE} colors={PIG_ICON_COLORS} cellSize={2} />, title: '暴击方猪', points: `+${PIG_POINTS}`, text: `发射子弹打倒站在水管上的猪；撞到它会掉血。${PIG_COMBO_WINDOW_MS / 1000} 秒内接着打倒下一只就是连杀：第 2 只 ×${PIG_COMBO_MULTIPLIERS[1]}，第 3 只起 ×${PIG_COMBO_MULTIPLIERS[2]}。` },
    { icon: <PixelSprite compact rows={FILLED_HEART_SPRITE} colors={HEART_COLORS} cellSize={2} />, title: '爱心', points: `+${ITEM_POINTS}`, text: `补回一颗空心（最多 ${START_HEALTH} 颗）；血满时只加分。` },
    { icon: <PixelSprite compact rows={SUNFLOWER_ROWS} colors={SUNFLOWER_PALETTE} cellSize={1.2} />, title: '太阳花', points: `+${ITEM_POINTS}`, text: `进入无敌时间 ${POWER_DURATION_MS / 1000} 秒，详见下方。` },
    { icon: <PixelSprite compact rows={MEMBER_TOKENS[2].rows} colors={MEMBER_TOKENS[2].palette} cellSize={0.8} />, title: '变身头像', points: `+${ITEM_POINTS}`, text: '换成下一位成员，五人按顺序轮流上场。' },
  ];
  return (
    <div className="help-backdrop absolute inset-0 z-50 flex items-center justify-center bg-[#060a22]/60" role="dialog" aria-modal="true" aria-label="玩法说明" onClick={onClose}>
      <div className="help-card relative flex max-h-full w-full max-w-[640px] flex-col px-5 pb-4 pt-3 sm:px-7 sm:pb-5 sm:pt-4" style={{ fontFamily: 'NJZPixelZh, sans-serif' }} onClick={(event) => event.stopPropagation()}>
        <PixelFrame tone="panel" units={[320, 180]} />
        <div className="relative flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between">
            <h2 className="text-[20px] text-white sm:text-[24px]">玩法说明</h2>
            <PixelButton onClick={onClose} className="-mr-2 h-10 w-10 text-white/85" aria-label="关闭说明" title="关闭说明">
              <PixelIcon name="close" size={18} />
            </PixelButton>
          </div>
          <div className="help-scroll mt-1 min-h-0 overflow-y-auto pr-1 text-left" tabIndex={0} role="region" aria-label="玩法说明正文">
            <p className="text-[13px] leading-6 text-white/80">
              整局跟着歌曲 Supernatural 飞行，歌放完就是通关。按住 <b className="text-white">↑ / ↓</b>（或 W / S、屏幕左下按钮）上下移动，
              <b className="text-white">空格</b>（或右下按钮）发射子弹。撞到水管或方猪会掉一颗心。
            </p>
            <div className="mt-2 text-[12px] tracking-[0.2em] text-[#9fb0ff]">怎么得分</div>
            <div className="help-pickups mt-1 grid grid-cols-1 gap-x-6">
              {rows.map((row) => (
                <div key={row.title} className="flex items-start gap-3 border-b border-white/10 py-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center">{row.icon}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[15px] text-white">
                      {row.title}
                      {row.points && <span className="text-[14px] leading-none text-[#ffd84a]"><PixelNumber text={row.points} /></span>}
                    </div>
                    <div className="mt-0.5 text-[12px] leading-5 text-white/65">{row.text}</div>
                  </div>
                </div>
              ))}
              <div className="flex items-start gap-3 border-b border-white/10 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center text-[#cfd8ff]"><PixelIcon name="music" size={22} /></div>
                <div className="min-w-0">
                  <div className="text-[15px] text-white">飞行距离</div>
                  <div className="mt-0.5 text-[12px] leading-5 text-white/65">飞得越远分越多，坚持到歌曲结束可拿满距离分。</div>
                </div>
              </div>
            </div>
            {/* Invincible time gets its own block: it changes how you play, not just the score. */}
            <div className="relative mt-3 px-3 pb-2.5 pt-2">
              <PixelFrame tone="gold" units={[300, 80]} />
              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <PixelSprite compact rows={SUNFLOWER_ROWS} colors={SUNFLOWER_PALETTE} cellSize={1.2} />
                  <span className="text-[15px] text-white">无敌时间</span>
                  <span className="double-badge-text text-[13px]">奖励翻倍</span>
                  <div className="ml-auto flex gap-[2px]" aria-hidden="true">
                    {Array.from({ length: powerCells }, (_, index) => (
                      <span key={index} className="block h-[10px] w-[6px] border border-white/60" style={{ background: RAINBOW[Math.floor((index * RAINBOW.length) / powerCells)] }} />
                    ))}
                  </div>
                </div>
                <ul className="mt-1.5 space-y-1 text-[12px] leading-5 text-white/70">
                  <li><b className="font-normal text-white">怎么拿到：</b>每首歌两朵太阳花，两段副歌各一朵，跟着指路的应援棒飞就能吃到。</li>
                  <li><b className="font-normal text-white">持续 {powerCells} 秒：</b>不会掉血，直接穿过水管，撞到方猪会把它撞飞（也算一次暴击方猪）。</li>
                  <li><b className="font-normal text-[#ffd84a]">得分 ×{POWER_MULTIPLIER}：</b>这期间应援棒和暴击方猪都按双倍计算，分数显示成金色。</li>
                  <li><b className="font-normal text-white">看倒计时：</b>屏幕顶部的太阳花旁有 {powerCells} 格彩虹，每秒灭一格；最后 2 秒会闪烁，提前飞回水管之间的空隙。</li>
                  <li><b className="font-normal text-white">结束保护：</b>无敌结束后还有 {POWER_GRACE_MS / 1000} 秒闪烁保护，不会因为正卡在水管里立刻掉血。暂停时无敌时间也会暂停。</li>
                </ul>
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-white/60">总分 =应援棒 + 暴击方猪 + 道具 + 飞行距离。结算时显示总分、应援棒数、暴击方猪数和歌曲完成度。</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const FlightGame: React.FC = () => {
  const [isPhone, setIsPhone] = useState(() => phonePreview || readPhoneDevice());
  const entityScale = isPhone ? PHONE_ENTITY_SCALE : 1;
  const playerSize = PLAYER_SIZE * entityScale;
  const playerHit = PLAYER_HIT * entityScale;
  const playerMinY = PLAYER_MIN_Y * entityScale;
  const playerMaxY = WORLD_HEIGHT - playerMinY;
  useEffect(() => {
    const updateDevice = () => setIsPhone(phonePreview || readPhoneDevice());
    const pointer = window.matchMedia('(pointer: coarse)');
    window.addEventListener('resize', updateDevice);
    pointer.addEventListener('change', updateDevice);
    return () => {
      window.removeEventListener('resize', updateDevice);
      pointer.removeEventListener('change', updateDevice);
    };
  }, []);
  useEffect(() => { void prepareResultCard().catch(() => {}); }, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>(0);
  const phaseRef = useRef<GamePhase>('ready');
  const inputRef = useRef({ up: false, down: false });
  const audioContextRef = useRef<AudioContext | null>(null);
  const musicMutedRef = useRef(false);
  const effectsMutedRef = useRef(false);
  const sizeRef = useRef({ width: 1, height: 1 });
  const playerRef = useRef({ y: 0, velocityY: 0 });
  const entitiesRef = useRef<GameEntity[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const effectsRef = useRef(new Effects());
  const outlineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pausedAtRef = useRef(0);
  const simulationSinceRef = useRef(0);
  const entityClockRef = useRef(0);
  const imagesRef = useRef<HTMLImageElement[][]>([]);
  const backgroundImagesRef = useRef({
    bottom: [] as HTMLImageElement[],
    middle: [] as HTMLImageElement[],
    top: [] as HTMLImageElement[],
  });
  const trailHistoryRef = useRef<TrailPoint[]>([]);
  const trailParticlesRef = useRef<TrailParticle[]>([]);
  const snowRef = useRef<Array<{ x: number; y: number; size: number; speed: number; drift: number; sway: number; color: string }>>([]);
  const gameRef = useRef({
    distance: 0,
    elapsed: 0,
    speed: CRUISE_SPEED,
    bonusScore: 0,
    stickCombo: 0,
    stickComboDoubled: false,
    stickComboAt: 0,
    pigCombo: 0,
    pigComboAt: 0,
    health: START_HEALTH,
    collected: 0,
    defeated: 0,
    songSeconds: 0,
    planIndex: 0,
    seed: 1,
    nextEntityId: 1,
    nextProjectileId: 1,
    invulnerableUntil: 0,
    invincibleUntil: 0,
    powerEnded: false,
    powerSecondsShown: 0,
    member: 0,
    /** Who the run started as: the result card puts her in the middle. */
    startMember: 0,
    /** When the last heart was lost (0 while alive); the world freezes, then the card opens. */
    deadAt: 0,
    morphFrom: 0,
    morphAt: -Infinity,
    ending: { brakeAt: 0, brakeFrom: 0, startX: 0, startY: 0, stoppedAt: 0, popAt: 0, popped: 0, shiftX: 0 },
    lastShotAt: -Infinity,
    lastCollectAt: -Infinity,
    collectStreak: 0,
    frameTimer: 0,
    frameIndex: 0,
    bottomOffset: 0,
    middleOffset: 0,
    topOffset: 0,
  });
  const hudSyncRef = useRef(0);
  const planRef = useRef<PlannedSegment[]>([]);
  const renderScaleRef = useRef(1);

  const [phase, setPhase] = useState<GamePhase>('ready');
  const [stats, setStats] = useState<FlightGameStats>({
    score: 0,
    distance: 0,
    health: START_HEALTH,
    collected: 0,
    defeated: 0,
    songSeconds: 0,
  });
  const [musicMuted, setMusicMuted] = useState(false);
  // Home page: who flies first (random each visit, the player may change it).
  const [homeMember, setHomeMember] = useState(() => Math.floor(Math.random() * SQUAD.length));
  const homeMemberRef = useRef(homeMember);
  homeMemberRef.current = homeMember;
  const [helpOpen, setHelpOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const supportEntryRef = useRef<HTMLButtonElement | null>(null);
  const closeSupport = useCallback(() => {
    setSupportOpen(false);
    requestAnimationFrame(() => supportEntryRef.current?.focus({ preventScroll: true }));
  }, []);
  /** The run ended by running out of hearts (the card cheers instead of celebrating). */
  const [failed, setFailed] = useState(false);
  const [effectsMuted, setEffectsMuted] = useState(false);
  /** The heart that was just gained, so it can pop. */
  const [heartGain, setHeartGain] = useState<{ id: number; slot: number } | null>(null);
  /** Bumped on every hit so the red screen-edge flash replays. */
  const [damageFlash, setDamageFlash] = useState(0);
  /** Bumped on every pickup / pig kill so that HUD counter pops; `gain` is 2 in invincible mode. */
  const [stickPop, setStickPop] = useState({ id: 0, gain: 1 });
  const [pigPop, setPigPop] = useState({ id: 0, gain: 1 });
  /** Latest pig chain, shown beside the pig counter while it can still grow. */
  const [pigCombo, setPigCombo] = useState({ id: 0, combo: 0 });
  useEffect(() => {
    if (pigCombo.combo < 2) return;
    // The badge goes when the chain can no longer grow.
    const timer = window.setTimeout(() => setPigCombo((shown) => (shown.id === pigCombo.id ? { ...shown, combo: 0 } : shown)), PIG_COMBO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [pigCombo]);
  /** Whole seconds of invincibility left (0 when not powered), for the centre countdown. */
  const [powerLeft, setPowerLeft] = useState(0);
  /** Bumped when invincibility starts so its "×2" banner plays once. */
  const [powerBanner, setPowerBanner] = useState(0);
  /** BGM length in seconds, for the song countdown bar along the top edge. */
  const [songDuration, setSongDuration] = useState(0);
  const songProgress = clamp(stats.songSeconds / (songDuration || SONG_FALLBACK_SECONDS), 0, 1);
  /**
   * Invincible-mode HUD: when it ends and how long was left when the timer
   * (re)started, fixed per start so the CSS countdown keeps a steady pace.
   */
  const [powerTimer, setPowerTimer] = useState<{ until: number; duration: number } | null>(null);
  const setPowerUntil = useCallback((until: number) => {
    setPowerTimer(until ? { until, duration: Math.max(0, until - performance.now()) } : null);
  }, []);

  const setGamePhase = useCallback((next: GamePhase) => {
    simulationSinceRef.current = performance.now();
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const syncHud = useCallback(() => {
    const game = gameRef.current;
    setStats({
      score: Math.floor(game.distance / DISTANCE_PER_POINT) + game.bonusScore,
      distance: Math.floor(game.distance),
      health: game.health,
      collected: game.collected,
      defeated: game.defeated,
      songSeconds: game.songSeconds,
    });
  }, []);

  const resetGame = useCallback(() => {
    const previewSeed = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('seed')) >>> 0 : 0;
    const seed = previewSeed || (Math.random() * 0xffffffff) >>> 0;
    planRef.current = planSong(seed, entityScale);
    setHeartGain(null);
    setPowerUntil(0);
    setPowerLeft(0);
    setPigCombo({ id: 0, combo: 0 });
    gameRef.current = {
      distance: 0,
      elapsed: 0,
      speed: CRUISE_SPEED,
      bonusScore: 0,
    stickCombo: 0,
    stickComboDoubled: false,
    stickComboAt: 0,
      pigCombo: 0,
      pigComboAt: 0,
      health: START_HEALTH,
      collected: 0,
      defeated: 0,
      songSeconds: 0,
      planIndex: 0,
      seed,
      nextEntityId: 1,
      nextProjectileId: 1,
      invulnerableUntil: 0,
    invincibleUntil: 0,
    powerEnded: false,
    powerSecondsShown: 0,
    member: 0,
    /** Who the run started as: the result card puts her in the middle. */
    startMember: 0,
    /** When the last heart was lost (0 while alive); the world freezes, then the card opens. */
    deadAt: 0,
    morphFrom: 0,
    morphAt: -Infinity,
    ending: { brakeAt: 0, brakeFrom: 0, startX: 0, startY: 0, stoppedAt: 0, popAt: 0, popped: 0, shiftX: 0 },
      lastShotAt: -Infinity,
      lastCollectAt: -Infinity,
      collectStreak: 0,
      frameTimer: 0,
      frameIndex: 0,
      bottomOffset: 0,
      middleOffset: 0,
      topOffset: 0,
    };
    playerRef.current = { y: WORLD_HEIGHT * 0.5, velocityY: 0 };
    inputRef.current = { up: false, down: false };
    entitiesRef.current = [];
    projectilesRef.current = [];
    effectsRef.current.clear();
    trailHistoryRef.current = [];
    trailParticlesRef.current = [];
    syncHud();
  }, [entityScale, syncHud]);

  const startGame = useCallback(() => {
    resetGame();
    // Dev aid: `?bar=36` starts the run (music and level) at that bar;
    // `?flower` starts one bar before this run's first sunflower.
    const params = new URLSearchParams(window.location.search);
    const flowerSegment = params.has('flower') ? planRef.current.find((planned) => planned.content.coins.some((coin) => coin.role === 'power')) : undefined;
    const startBar = flowerSegment ? Math.max(0, flowerSegment.startBar - 1) : Math.max(0, Math.floor(Number(params.get('bar')) || 0));
    if (startBar > 0) {
      const game = gameRef.current;
      game.distance = barDistance(startBar) - BAR * 0.25;
      const firstIndex = planRef.current.findIndex((planned) => planned.startBar + planned.segment.bars > startBar);
      game.planIndex = firstIndex < 0 ? planRef.current.length : firstIndex;
    }
    // Dev aid: `?power=1` starts the run in invincible mode.
    if (new URLSearchParams(window.location.search).has('power')) {
      gameRef.current.invincibleUntil = performance.now() + POWER_DURATION_MS;
      setPowerUntil(gameRef.current.invincibleUntil);
      setPowerBanner((count) => count + 1);
    }
    // Dev aid: `?member=2` starts as that member (0 Blue, 1 Green, 2 Pink, 3 Yellow, 4 Purple).
    // Jumping in with `?bar` starts as whoever's turn it would be by then.
    const startMember = params.has('member')
      ? Math.floor(Number(params.get('member')) || 0)
      : startBar > 0 ? Math.floor(startBar / MORPH_EVERY_BARS) % SQUAD.length : homeMemberRef.current;
    gameRef.current.member = clamp(startMember, 0, SQUAD.length - 1);
    gameRef.current.startMember = gameRef.current.member;
    // Dev aid: `?health=1` starts with fewer red hearts (to try the failure card).
    const health = Math.floor(Number(params.get('health')) || 0);
    if (health > 0) gameRef.current.health = Math.min(START_HEALTH, health);
    setGamePhase('playing');
    // Create/resume the effects context from the same user gesture that starts
    // the game. This avoids Safari/macOS keeping later keyboard effects silent.
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      try {
        const audioContext = audioContextRef.current ?? new AudioContextClass();
        audioContextRef.current = audioContext;
        if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
      } catch {
        // Effects remain optional if the browser does not expose Web Audio.
      }
    }
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = gameRef.current.distance / CRUISE_SPEED;
      audio.loop = false;
      audio.volume = MUSIC_VOLUME;
      audio.muted = musicMutedRef.current;
      void audio.play().catch(() => {
        // The game remains playable if a browser rejects media playback.
      });
    }
  }, [resetGame, setGamePhase, syncHud]);

  const pauseGame = useCallback(() => {
    if (phaseRef.current !== 'playing' || gameRef.current.deadAt) return;
    inputRef.current = { up: false, down: false };
    setGamePhase('paused');
    pausedAtRef.current = performance.now();
    audioRef.current?.pause();
  }, [setGamePhase]);

  useEffect(() => {
    if (entityScale <= 1) return;
    const onVisibility = () => { if (document.hidden) pauseGame(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [entityScale, pauseGame]);

  const resumeGame = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    // Timers are wall-clock times: push them back by the time spent paused.
    const pausedFor = performance.now() - pausedAtRef.current;
    const game = gameRef.current;
    if (game.invincibleUntil) {
      game.invincibleUntil += pausedFor;
      setPowerUntil(game.invincibleUntil);
    }
    game.invulnerableUntil += pausedFor;
    game.pigComboAt += pausedFor;
    setGamePhase('playing');
    const audio = audioRef.current;
    if (audio) void audio.play().catch(() => {});
  }, [setGamePhase]);

  /** Back to the home page. */
  const goHome = useCallback(() => {
    resetGame();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setHomeMember(Math.floor(Math.random() * SQUAD.length));
    setGamePhase('ready');
  }, [resetGame, setGamePhase]);

  const finishGame = useCallback((failed = false) => {
    if (phaseRef.current !== 'playing' && phaseRef.current !== 'paused') return;
    setFailed(failed === true);
    // Reaching the end of the stage counts as finishing the whole song.
    const game = gameRef.current;
    if (game.ending.stoppedAt) game.songSeconds = Math.max(game.songSeconds, audioRef.current?.duration || SONG_FALLBACK_SECONDS);
    setGamePhase('gameover');
    audioRef.current?.pause();
    syncHud();
  }, [setGamePhase, syncHud]);

  const playShootSound = useCallback(() => {
    if (effectsMutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime;
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(820, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(180, startAt + 0.11);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.13);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.14);
    } catch {
      // Audio effects are optional; a blocked audio context must not stop play.
    }
  }, []);

  const playCollectSound = useCallback((streak = 1) => {
    if (effectsMutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      // A soft upward triangle-wave chirp reads as a generic score pickup,
      // leaving the final collectible's sound identity open for later art.
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime;
      oscillator.type = 'triangle';
      const baseFrequency = 300 + Math.min(5, Math.max(0, streak - 1)) * 42;
      oscillator.frequency.setValueAtTime(baseFrequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(baseFrequency * 1.72, startAt + 0.12);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.15);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.16);
    } catch {
      // Audio effects are optional; a blocked audio context must not stop play.
    }
  }, []);

  /** Short chiptune arpeggio shared by game effects and menu feedback. */
  const playArpeggio = useCallback((notes: number[], step: number, type: OscillatorType, volume: number) => {
    if (effectsMutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
      const startAt = audioContext.currentTime;
      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const noteAt = startAt + index * step;
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, noteAt);
        gain.gain.setValueAtTime(0.0001, noteAt);
        gain.gain.exponentialRampToValueAtTime(volume, noteAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteAt + step * 1.8);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(noteAt);
        oscillator.stop(noteAt + step * 2);
      });
    } catch {
      // Audio effects are optional; a blocked audio context must not stop play.
    }
  }, []);

  // Play from the user action, so the first home-page tap also unlocks audio
  // on Safari. Automatic pauses (e.g. leaving the app) stay silent.
  const pickHomeMember = useCallback((member: number) => {
    if (member === homeMemberRef.current) return;
    homeMemberRef.current = member;
    playArpeggio([659.25, 880], 0.035, 'triangle', 0.075);
    setHomeMember(member);
  }, [playArpeggio]);

  const startFromMenu = useCallback(() => {
    playArpeggio(phaseRef.current === 'paused' ? [523.25, 659.25, 1046.5] : [659.25, 880, 1318.5], 0.055, 'square', 0.045);
    startGame();
  }, [playArpeggio, startGame]);

  const pauseFromControl = useCallback(() => {
    if (phaseRef.current !== 'playing' || gameRef.current.deadAt) return;
    playArpeggio([880, 659.25], 0.045, 'triangle', 0.075);
    pauseGame();
  }, [playArpeggio, pauseGame]);

  const resumeFromControl = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    playArpeggio([659.25, 880], 0.045, 'triangle', 0.075);
    resumeGame();
  }, [playArpeggio, resumeGame]);

  const homeFromPause = useCallback(() => {
    playArpeggio([659.25, 523.25], 0.05, 'triangle', 0.075);
    goHome();
  }, [playArpeggio, goHome]);

  const playHealSound = useCallback(() => {
    if (effectsMutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      // A quick rising major arpeggio: recovery, clearly unlike a score pickup.
      const startAt = audioContext.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const noteAt = startAt + index * 0.06;
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(frequency, noteAt);
        gain.gain.setValueAtTime(0.0001, noteAt);
        gain.gain.exponentialRampToValueAtTime(0.09, noteAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.11);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(noteAt);
        oscillator.stop(noteAt + 0.12);
      });
    } catch {
      // Audio effects are optional; a blocked audio context must not stop play.
    }
  }, []);

  const playDamageSound = useCallback(() => {
    if (effectsMutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      // A low, rough warning tone distinguishes damage from both pickups and shots.
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime;
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(190, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(62, startAt + 0.2);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.25);
    } catch {
      // Audio effects are optional; a blocked audio context must not stop play.
    }
  }, []);

  const playEnemyHitSound = useCallback((combo = 1) => {
    if (effectsMutedRef.current) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audioContext = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});

      // A bright two-part pop marks a confirmed enemy defeat, separate from
      // firing. Each pig of a chain pops a step higher (0, 4, 7, 12 semitones)
      // and adds a short chime on top.
      const lift = 2 ** ([0, 4, 7, 12][Math.min(combo, 4) - 1] / 12);
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const startAt = audioContext.currentTime;
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(620 * lift, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(250 * lift, startAt + 0.09);
      if (combo > 1) {
        const chime = audioContext.createOscillator();
        const chimeGain = audioContext.createGain();
        chime.type = 'square';
        chime.frequency.setValueAtTime(1046.5 * lift, startAt + 0.07);
        chimeGain.gain.setValueAtTime(0.0001, startAt);
        chimeGain.gain.setValueAtTime(0.07, startAt + 0.07);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.2);
        chime.connect(chimeGain);
        chimeGain.connect(audioContext.destination);
        chime.start(startAt + 0.07);
        chime.stop(startAt + 0.21);
      }
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.19, startAt + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.13);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.14);
    } catch {
      // Audio effects are optional; a blocked audio context must not stop play.
    }
  }, []);

  const shoot = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const now = performance.now();
    const game = gameRef.current;
    if (game.ending.brakeAt || game.deadAt || now - game.lastShotAt < PROJECTILE_COOLDOWN) return;
    if (projectilesRef.current.length >= MAX_PROJECTILES) return;

    const muzzleX = playerXFor(sizeRef.current.width) + playerSize * 0.35;
    projectilesRef.current.push({
      id: game.nextProjectileId++,
      x: muzzleX,
      y: playerRef.current.y,
      width: 20 * entityScale,
      height: 6 * entityScale,
    });
    effectsRef.current.muzzle(muzzleX, playerRef.current.y);
    game.lastShotAt = now;
    playShootSound();
  }, [entityScale, playerSize, playShootSound]);

  const toggleMusicMute = useCallback(() => {
    const next = !musicMutedRef.current;
    musicMutedRef.current = next;
    setMusicMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  }, []);

  const toggleEffectsMute = useCallback(() => {
    const next = !effectsMutedRef.current;
    effectsMutedRef.current = next;
    setEffectsMuted(next);
  }, []);

  useEffect(() => {
    const loadImages = (sources: string[]) => sources.map((source) => {
      const image = new Image();
      image.src = source;
      return image;
    });
    imagesRef.current = SQUAD.map((member) => loadImages([...member.frames]));
    // Decode every member's frames up front and paint each once off screen, so
    // switching member mid-run never stalls on a first-time image decode.
    const warm = document.createElement('canvas');
    warm.width = 8;
    warm.height = 8;
    const warmContext = warm.getContext('2d');
    imagesRef.current.flat().forEach((image) => {
      const paint = () => warmContext?.drawImage(image, 0, 0, 8, 8);
      if (image.decode) image.decode().then(paint).catch(() => undefined);
      else image.addEventListener('load', paint, { once: true });
    });
    backgroundImagesRef.current = {
      bottom: loadImages(BOTTOM_IMAGES),
      middle: loadImages(MIDDLE_IMAGES),
      top: loadImages(TOP_IMAGES),
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') {
        inputRef.current.up = true;
        event.preventDefault();
      } else if (key === 'arrowdown' || key === 's') {
        inputRef.current.down = true;
        event.preventDefault();
      } else if ((key === ' ' || key === 'enter') && phaseRef.current === 'playing') {
        if (!event.repeat) shoot();
        event.preventDefault();
      } else if ((key === 'p' || key === 'escape') && phaseRef.current === 'playing') {
        if (!event.repeat) pauseFromControl();
        event.preventDefault();
      } else if ((key === 'p' || key === 'escape') && phaseRef.current === 'paused') {
        if (!event.repeat) resumeFromControl();
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') inputRef.current.up = false;
      if (key === 'arrowdown' || key === 's') inputRef.current.down = false;
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pauseFromControl, resumeFromControl, shoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const resize = () => {
      // Layout size, not getBoundingClientRect: portrait phones rotate the
      // whole game with CSS and the canvas must keep its landscape size.
      const cssWidth = Math.max(1, canvas.clientWidth);
      const cssHeight = Math.max(1, canvas.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      // Background and playfield always show all 720 units. Object size is separate.
      const scale = cssHeight / WORLD_HEIGHT;
      renderScaleRef.current = scale * dpr;
      sizeRef.current = { width: cssWidth / scale, height: WORLD_HEIGHT };
      playerRef.current.y = clamp(playerRef.current.y || WORLD_HEIGHT * 0.5, playerMinY, playerMaxY);
    };

    const drawParallaxLayer = (
      images: HTMLImageElement[],
      offset: number,
      y: number,
      fillHeight: number,
      width: number,
    ) => {
      const usableImages = images.filter((image) => image.complete && image.naturalWidth > 0);
      if (usableImages.length === 0) return;
      const widths = usableImages.map((image) => (image.naturalWidth / image.naturalHeight) * fillHeight);
      const sequenceWidth = widths.reduce((sum, value) => sum + value, 0);
      if (sequenceWidth <= 0) return;

      let x = -(offset % sequenceWidth);
      while (x < width) {
        usableImages.forEach((image, index) => {
          const imageWidth = widths[index];
          if (x + imageWidth > 0 && x < width) {
            context.drawImage(image, Math.floor(x), Math.floor(y), Math.ceil(imageWidth) + 1, Math.ceil(fillHeight));
          }
          x += imageWidth;
        });
      }
    };

    const spawnSegment = (planned: PlannedSegment, originX: number) => {
      const game = gameRef.current;
      const { pipes, pigs, coins } = planned.content;
      const pipeEntities = pipes.map((pipe): GameEntity => {
        const { orientation, rotation } = pipeOrientation(pipe);
        return {
          id: game.nextEntityId++,
          kind: 'obstacle',
          x: originX + pipe.x,
          y: pipe.y,
          width: orientation === 'horizontal' ? pipe.length : PIPE_THICKNESS * entityScale,
          height: orientation === 'horizontal' ? PIPE_THICKNESS * entityScale : pipe.length,
          pipe,
          pipeOrientation: orientation,
          pipeRotation: rotation,
          damageApplied: false,
        };
      });
      const pigEntities = pigs.map((pig): GameEntity => {
        const support = pipes[pig.pipe];
        const span = pigPatrolHalfSpan(support, pig);
        const offset = span * (pig.phase * 2 - 1);
        return {
          id: game.nextEntityId++,
          kind: 'enemy',
          x: originX + support.x + offset,
          y: pigCenterY(support),
          width: PIG_WIDTH * pigScaleFor(entityScale),
          height: PIG_HEIGHT * pigScaleFor(entityScale),
          supportPipeId: pipeEntities[pig.pipe].id,
          patrolSpan: span,
          patrolSpeed: pig.speed * entityScale,
          patrolOffset: offset,
          patrolDirection: pig.phase > 0.5 ? -1 : 1,
          patrolPhase: pig.phase,
          damageApplied: false,
        };
      });
      const coinEntities = coins.map((coin): GameEntity => ({
        id: game.nextEntityId++,
        kind: 'collectible',
        x: originX + coin.x,
        y: coin.y,
        width: 24 * entityScale,
        height: 24 * entityScale,
        radius: COIN_PICKUP_RADIUS * entityScale,
        heal: coin.role === 'heal' || coin.role === 'riskHeal',
        power: coin.role === 'power',
        // A token for the member you already are shows the next one instead.
        // Always the next member in the cycle, so a missed token never skips anyone.
        morph: coin.role === 'morph' ? (game.member + 1) % SQUAD.length : undefined,
        damageApplied: false,
      }));
      entitiesRef.current.push(...pipeDrawOrder(pipes).map(i => pipeEntities[i]), ...pigEntities, ...coinEntities);
    };

    // Falling snow, carried over from the original player skin: four pixel
    // patterns by size (dot, plus, diamond, six-armed flake), four blue-white
    // tones and a gentle sway. Drawn on the screen-pixel grid so the patterns
    // stay crisp at any scale.
    const drawSnow = (width: number, height: number, dt: number, animate: boolean, now: number) => {
      if (snowRef.current.length === 0) {
        snowRef.current = Array.from({ length: 80 }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          size: SNOW_FLAKE_SIZES[Math.floor(Math.random() * SNOW_FLAKE_SIZES.length)],
          speed: 18 + Math.random() * 54,
          drift: -10 + Math.random() * 20,
          sway: Math.random() * Math.PI * 2,
          color: SNOW_FLAKE_COLORS[Math.floor(Math.random() * SNOW_FLAKE_COLORS.length)],
        }));
      }
      // One pattern cell per CSS pixel, as in the player (on a 2× screen a
      // device-pixel cell shrinks the flakes to specks).
      const cell = Math.min(2, window.devicePixelRatio || 1) / renderScaleRef.current;
      const snap = (value: number) => Math.floor(value / cell) * cell;
      snowRef.current.forEach((flake) => {
        if (animate) {
          flake.y += flake.speed * dt;
          flake.x += (flake.drift + Math.sin(now / 1000 + flake.sway) * 6) * dt;
          if (flake.y > height + 8) {
            flake.y = -8;
            flake.x = Math.random() * width;
          }
          if (flake.x < -8) flake.x = width + 8;
          if (flake.x > width + 8) flake.x = -8;
        }
        context.fillStyle = flake.color;
        const x = snap(flake.x);
        const y = snap(flake.y);
        const dot = (dx: number, dy: number, w = 1, h = 1) => context.fillRect(x + dx * cell, y + dy * cell, w * cell, h * cell);
        if (flake.size <= 2) {
          dot(0, 0, flake.size, flake.size);
        } else if (flake.size === 3) {
          dot(1, 0); dot(0, 1, 3); dot(1, 2);
        } else if (flake.size === 4) {
          dot(1, 0, 2); dot(0, 1, 4, 2); dot(1, 3, 2);
        } else {
          dot(1, 0); dot(3, 0); dot(0, 1, 5); dot(1, 2, 3); dot(0, 3, 5); dot(1, 4); dot(3, 4);
        }
      });
    };

    const drawEntity = (entity: GameEntity) => {
      if (entity.kind === 'collectible') {
        if (entity.power) drawSunflower(context, entity.x, entity.y, PICKUP_HEIGHT.power * entityScale, entityClockRef.current);
        else if (entity.morph !== undefined) drawMemberToken(context, entity.morph, entity.x, entity.y, PICKUP_HEIGHT.morph * entityScale, entityClockRef.current);
        else if (entity.heal) drawHeartPickup(context, entity.x, entity.y, PICKUP_HEIGHT.heal * entityScale, entityClockRef.current);
        else drawCollectible(context, entity.x, entity.y, PICKUP_HEIGHT.stick * entityScale, entityClockRef.current);
      } else if (entity.kind === 'obstacle') {
        drawPipe(context, entity, entity.y);
      } else {
        drawPig(context, entity.x, entity.y, entity.width, entity.height, entity.patrolDirection ?? 1, entity.patrolPhase ?? 0, entityClockRef.current);
      }
    };

    const drawPlayer = (width: number, height: number, now: number, dt: number, animate: boolean) => {
      const { ending } = gameRef.current;
      if (ending.popAt && now >= ending.popAt) {
        drawEndingSquad(width, now);
        return;
      }
      const playerX = playerXFor(width) + ending.shiftX;
      const { invincibleUntil } = gameRef.current;
      const powered = now < invincibleUntil;
      const inGrace = !powered && invincibleUntil > 0 && now < invincibleUntil + POWER_GRACE_MS;
      const invulnerable = !gameRef.current.deadAt && (now < gameRef.current.invulnerableUntil || inGrace);
      const blinkVisible = !invulnerable || Math.floor(now / 100) % 2 !== 0;
      const playerY = playerRef.current.y;
      const member = gameRef.current.member;
      const trailColor = SQUAD[member].trail;

      if (trailParticlesRef.current.length === 0) {
        trailParticlesRef.current = Array.from({ length: 3 }, () => {
          const baseSize = TRAIL_HEART_SIZES[Math.floor(Math.random() * TRAIL_HEART_SIZES.length)];
          return {
          relativeX: 0.2 + Math.random() * 0.78,
          relativeY: (Math.random() - 0.5) * 0.8,
          size: baseSize,
          baseSize,
          speed: TRAIL_HEART_SPEED * (0.7 + Math.random() * 0.6),
          opacity: 0.7 + Math.random() * 0.3,
          };
        });
      }

      // Recreate the original character tail as a delayed motion ribbon.
      const trailLength = 120 * entityScale;
      const trailHeight = TRAIL_HEIGHT * entityScale;
      const trailSamples = buildTrailSamples(
        trailHistoryRef.current,
        playerX,
        playerRef.current.y,
        trailLength,
      );
      const trailStartX = playerX - trailLength;
      const trailGradient = context.createLinearGradient(trailStartX, 0, playerX, 0);
      trailGradient.addColorStop(0, 'transparent');
      trailGradient.addColorStop(0.3, `rgba(${trailColor.rgb}, ${0x30 / 255})`);
      trailGradient.addColorStop(0.7, `rgba(${trailColor.rgb}, ${0x70 / 255})`);
      trailGradient.addColorStop(1, trailColor.hex);
      context.save();
      // Use a binary blink for both layers. A partial alpha would expose the
      // rectangular gradient edge where the ribbon meets the character.
      context.globalAlpha = blinkVisible ? 1 : 0;
      context.lineCap = 'butt';
      context.lineJoin = 'round';
      if (powered) {
        // Invincible: the tail becomes a rainbow ribbon of stacked bands.
        const band = trailHeight / RAINBOW.length;
        RAINBOW.forEach((color, index) => {
          const fade = context.createLinearGradient(trailStartX, 0, playerX, 0);
          fade.addColorStop(0, 'transparent');
          fade.addColorStop(0.35, `${color}66`);
          fade.addColorStop(1, color);
          context.save();
          context.translate(0, (index - (RAINBOW.length - 1) / 2) * band);
          traceTrailPath(context, trailSamples);
          context.strokeStyle = fade;
          context.lineWidth = band + 0.5;
          context.stroke();
          context.restore();
        });
      } else {
        traceTrailPath(context, trailSamples);
        context.strokeStyle = trailGradient;
        context.lineWidth = trailHeight;
        context.stroke();
      }

      trailParticlesRef.current.forEach((particle) => {
        if (animate) particle.relativeX -= (particle.speed * entityScale / trailLength) * dt;
        if (particle.relativeX <= 0.02) {
          particle.relativeX = 0.82 + Math.random() * 0.18;
          particle.relativeY = (Math.random() - 0.5) * 0.9;
          particle.baseSize = 8 + Math.random() * 7;
          particle.speed = 52 + Math.random() * 38;
        }
        particle.size = particle.baseSize * (0.3 + particle.relativeX * 0.7);
        particle.opacity = Math.max(0, 0.9 * particle.relativeX);
        const particleX = trailStartX + particle.relativeX * trailLength;
        const particleY = trailYAtRelativeX(trailSamples, particle.relativeX, playerRef.current.y)
          + particle.relativeY * trailHeight;
        context.fillStyle = `rgba(255, 255, 255, ${particle.opacity * 0.5})`;
        drawTrailHeart(context, particleX, particleY, particle.size * entityScale);
      });
      context.restore();

      if (!blinkVisible) return;

      // Member change "pop": the old member squeezes down and flashes white,
      // then the new one bursts out a little oversized and settles.
      const pose = popPose(now - gameRef.current.morphAt);
      const remaining = invincibleUntil - now;
      paintMember(pose.visibleOld ? gameRef.current.morphFrom : member, playerX, playerY, playerSize * pose.scale, pose.flash,
        powered && (remaining > 2000 || Math.floor(now / 90) % 2 === 0), now);
    };

    /** Draws one member sprite centred at (x, y), with optional rainbow outline and white flash. */
    const paintMember = (memberIndex: number, x: number, y: number, size: number, flash: number, rainbow: boolean, now: number) => {
      const image = imagesRef.current[memberIndex]?.[(gameRef.current.frameIndex + memberIndex) % SQUAD_FRAME_COUNT];
      const left = x - size / 2;
      const top = y - size / 2;
      if (!image?.complete || image.naturalWidth === 0) {
        context.fillStyle = SQUAD[memberIndex].trail.hex;
        context.beginPath();
        context.arc(x, y, size * 0.35, 0, Math.PI * 2);
        context.fill();
        return;
      }
      const tinted = (color: string) => {
        const canvas = outlineCanvasRef.current ?? document.createElement('canvas');
        outlineCanvasRef.current = canvas;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const paint = canvas.getContext('2d');
        if (!paint) return null;
        paint.clearRect(0, 0, canvas.width, canvas.height);
        paint.drawImage(image, 0, 0);
        paint.globalCompositeOperation = 'source-in';
        paint.fillStyle = color;
        paint.fillRect(0, 0, canvas.width, canvas.height);
        return canvas;
      };
      // Invincible: a pixel outline cycling through the rainbow.
      if (rainbow) {
        const outline = tinted(RAINBOW[Math.floor(now / 70) % RAINBOW.length]);
        const ring = 3 * entityScale;
        if (outline) {
          [[-ring, 0], [ring, 0], [0, -ring], [0, ring], [-ring, -ring], [ring, ring], [-ring, ring], [ring, -ring]].forEach(([ox, oy]) => {
            context.drawImage(outline, left + ox, top + oy, size, size);
          });
        }
      }
      context.drawImage(image, left, top, size, size);
      if (flash > 0) {
        const silhouette = tinted('#ffffff');
        if (silhouette) {
          context.save();
          context.globalAlpha = flash;
          context.drawImage(silhouette, left, top, size, size);
          context.restore();
        }
      }
    };

    /** Ending: the five members pop in one by one and hover in an arrowhead. */
    const drawEndingSquad = (width: number, now: number) => {
      const { ending, member } = gameRef.current;
      endingOrder(member).forEach((memberIndex, index) => {
        const since = now - (ending.popAt + index * ENDING_POP_STAGGER_MS);
        if (since < 0) return;
        const pose = popPose(since);
        // The front member is the player squeezing into the pop; the others appear from the puff.
        if (pose.visibleOld && index > 0) return;
        const slot = ENDING_SLOTS[index];
        const bob = Math.sin(now / 320 + index * 1.3) * 5;
        paintMember(memberIndex, endingFrontX(width) + slot.dx * entityScale, ENDING_STAGE_Y + slot.dy * entityScale + bob, playerSize * pose.scale, pose.flash, false, now);
      });
    };

    const updateGame = (dt: number, now: number, audioSeconds = audioRef.current?.currentTime ?? 0) => {
      const { width, height } = sizeRef.current;
      const game = gameRef.current;
      const ending = game.ending;
      const direction = ending.brakeAt ? 0 : (inputRef.current.down ? 1 : 0) - (inputRef.current.up ? 1 : 0);
      const targetVelocity = direction * PLAYER_SPEED * entityScale;
      const acceleration = (direction === 0 ? PLAYER_RELEASE_DAMPING * PLAYER_SPEED : PLAYER_ACCELERATION) * entityScale;
      playerRef.current.velocityY = approach(playerRef.current.velocityY, targetVelocity, acceleration * dt);
      playerRef.current.y += playerRef.current.velocityY * dt;
      playerRef.current.y = clamp(playerRef.current.y, playerMinY, playerMaxY);

      trailHistoryRef.current.forEach((point) => {
        point.age += dt;
      });
      trailHistoryRef.current.unshift({ y: playerRef.current.y, age: 0 });
      while (trailHistoryRef.current.length > 1 && trailHistoryRef.current[trailHistoryRef.current.length - 1].age > TRAIL_HISTORY_SECONDS) {
        trailHistoryRef.current.pop();
      }

      game.elapsed += dt;
      // Constant speed keeps every segment on the bar lines of the BGM. While
      // the music plays, gently pull the world towards the audio clock so
      // dropped frames never let obstacles drift off the beat.
      let advance = CRUISE_SPEED * dt;
      const audio = audioRef.current;
      if (!ending.brakeAt && game.distance >= BRAKE_START_DISTANCE) {
        ending.brakeAt = now;
        ending.brakeFrom = game.distance;
        ending.startX = playerXFor(width);
        ending.startY = playerRef.current.y;
      }
      if (ending.brakeAt) {
        // Ending: ease the world to a stop and glide the player to centre stage.
        const p = clamp((now - ending.brakeAt) / BRAKE_MS, 0, 1);
        const target = ending.brakeFrom + BRAKE_DISTANCE * (1 - (1 - p) ** (BRAKE_EASE + 1));
        advance = Math.max(0, target - game.distance);
        const glide = p * p * (3 - 2 * p);
        ending.shiftX = (endingFrontX(width) - ending.startX) * glide;
        playerRef.current.y = ending.startY + (ENDING_STAGE_Y - ending.startY) * glide;
        playerRef.current.velocityY = 0;
        if (p >= 1 && !ending.stoppedAt) {
          ending.stoppedAt = now;
          ending.popAt = now + ENDING_POP_DELAY_MS;
        }
        if (ending.popAt && ending.popped < SQUAD.length && now >= ending.popAt + ending.popped * ENDING_POP_STAGGER_MS) {
          const slot = ENDING_SLOTS[ending.popped];
          const memberIndex = endingOrder(game.member)[ending.popped];
          const { palette } = MEMBER_TOKENS[memberIndex];
          effectsRef.current.morph(endingFrontX(width) + slot.dx * entityScale, ENDING_STAGE_Y + slot.dy * entityScale, [palette.l, palette.f, '#ffffff'], now);
          playArpeggio([523.25 * 2 ** (ending.popped / 6), 784 * 2 ** (ending.popped / 6)], 0.05, 'triangle', 0.06);
          ending.popped += 1;
        }
        const lastMemberSettledAt = ending.popAt + (SQUAD.length - 1) * ENDING_POP_STAGGER_MS + MORPH_SQUEEZE_MS + MORPH_SETTLE_MS;
        if (ending.popped >= SQUAD.length && now >= lastMemberSettledAt) {
          finishGame();
          return;
        }
      } else if (audio && !audio.paused && audio.currentTime > 0) {
        const drift = CRUISE_SPEED * audioSeconds - (game.distance + advance);
        if (Math.abs(drift) < CRUISE_SPEED * 0.5) advance += drift * Math.min(1, dt * 3);
      }
      advance = Math.max(0, advance);
      // Song clock for the progress bar: the audio when it plays, otherwise
      // the distance (which tracks it) and, once braking, real time.
      if (audio && !audio.paused && audio.currentTime > 0) game.songSeconds = audio.currentTime;
      else if (ending.brakeAt) game.songSeconds = ending.brakeFrom / CRUISE_SPEED + (now - ending.brakeAt) / 1000;
      else game.songSeconds = (game.distance + advance) / CRUISE_SPEED;
      game.speed = dt > 0 ? advance / dt : CRUISE_SPEED;
      game.distance += advance;
      // Keep distance in musical units (score, bar lines and audio). Physical
      // travel follows entity size, restoring the original body-lengths/sec.
      const travel = advance * entityScale;
      game.bottomOffset += travel * 0.30;
      game.middleOffset += travel * 0.62;
      game.topOffset += travel;
      effectsRef.current.update(dt, travel);

      const playerX = playerXFor(width);
      // A stick chain has ended: float its total once, above the player.
      if (game.stickCombo > 0 && now - game.stickComboAt > STICK_COMBO_GAP_MS) {
        effectsRef.current.score(playerX, playerRef.current.y - 56 * entityScale, game.stickCombo, game.stickComboDoubled ? SCORE_GOLD : '#ffffff', true);
        game.stickCombo = 0;
        game.stickComboDoubled = false;
      }
      entitiesRef.current.forEach((entity) => {
        entity.x -= travel;
      });
      // Spawn every planned segment whose first bar is about to scroll in.
      for (;;) {
        const planned = planRef.current[game.planIndex];
        // The outro's last bars stay empty for the ending.
        if (!planned || planned.startBar >= ENDING_BAR) break;
        const originX = playerX + (barDistance(planned.startBar) - game.distance) * entityScale;
        if (originX > width + 160) break;
        spawnSegment(planned, originX);
        game.planIndex += 1;
      }

      const pipesById = new Map<number, GameEntity>();
      entitiesRef.current.forEach((entity) => {
        if (entity.kind === 'obstacle') pipesById.set(entity.id, entity);
      });
      entitiesRef.current.forEach((entity) => {
        if (entity.kind !== 'enemy' || entity.supportPipeId === undefined) return;
        const supportPipe = pipesById.get(entity.supportPipeId);
        if (!supportPipe) return;
        const span = entity.patrolSpan ?? 0;
        if (span > 0 && entity.patrolSpeed) {
          let offset = (entity.patrolOffset ?? 0) + (entity.patrolDirection === -1 ? -1 : 1) * entity.patrolSpeed * dt;
          if (offset <= -span) {
            offset = -span;
            entity.patrolDirection = 1;
          } else if (offset >= span) {
            offset = span;
            entity.patrolDirection = -1;
          }
          entity.patrolOffset = offset;
        }
        entity.x = supportPipe.x + (entity.patrolOffset ?? 0);
      });
      entitiesRef.current = entitiesRef.current.filter((entity) => entity.x + entity.width / 2 > -200);

      projectilesRef.current.forEach((projectile) => {
        projectile.x += PROJECTILE_SPEED * entityScale * dt;
      });
      projectilesRef.current = projectilesRef.current.filter((projectile) => projectile.x < width + 50);

      const playerRect: Rect = {
        x: playerX - playerHit / 2,
        y: playerRef.current.y - playerHit / 2,
        width: playerHit,
        height: playerHit,
      };
      const playerPolygon = rectPolygon(playerRect.x, playerRect.y, playerRect.width, playerRect.height);

      /** Shot or rammed: chained kills within the window score more and pop harder. */
      const defeatPig = (entity: GameEntity, gain: number) => {
        game.pigCombo = now - game.pigComboAt <= PIG_COMBO_WINDOW_MS ? game.pigCombo + 1 : 1;
        game.pigComboAt = now;
        const combo = game.pigCombo;
        const points = PIG_POINTS * PIG_COMBO_MULTIPLIERS[Math.min(combo, PIG_COMBO_MULTIPLIERS.length) - 1] * gain;
        const color = gain > 1 ? SCORE_GOLD : pigComboColor(combo);
        game.defeated += gain;
        game.bonusScore += points;
        effectsRef.current.pigPop(entity.x, entity.y, now, combo, pigComboColor(combo));
        const top = entity.y - entity.height / 2;
        // The longer the chain, the bigger its numbers.
        effectsRef.current.score(entity.x, top, points, color, false, [1, 1.3, 1.5][Math.min(combo, 3) - 1]);
        if (combo > 1) effectsRef.current.label(entity.x, top - 56 * entityScale, `${comboName(combo)}!`, pigComboColor(combo), 1.15);
        setPigPop((pop) => ({ id: pop.id + 1, gain }));
        setPigCombo((shown) => ({ id: shown.id + 1, combo }));
        syncHud();
        playEnemyHitSound(combo);
      };
      const defeatedIds = new Set<number>();
      const spentProjectileIds = new Set<number>();
      projectilesRef.current.forEach((projectile) => {
        const projectileRect: Rect = {
          x: projectile.x - projectile.width / 2,
          y: projectile.y - projectile.height / 2,
          width: projectile.width,
          height: projectile.height,
        };
        for (const entity of entitiesRef.current) {
          if (entity.kind !== 'enemy' || defeatedIds.has(entity.id)) continue;
          const enemyRect: Rect = {
            x: entity.x - entity.width / 2,
            y: entity.y - entity.height / 2,
            width: entity.width,
            height: entity.height,
          };
          if (rectsOverlap(projectileRect, enemyRect)) {
            defeatedIds.add(entity.id);
            spentProjectileIds.add(projectile.id);
            defeatPig(entity, now < game.invincibleUntil ? POWER_MULTIPLIER : 1);
            break;
          }
        }
      });
      entitiesRef.current = entitiesRef.current.filter((entity) => !defeatedIds.has(entity.id));
      projectilesRef.current = projectilesRef.current.filter((projectile) => !spentProjectileIds.has(projectile.id));

      const collectedIds = new Set<number>();
      entitiesRef.current.forEach((entity) => {
        if (entity.kind === 'collectible') {
          if (circleRectOverlap(entity.x, entity.y, entity.radius ?? COIN_PICKUP_RADIUS, playerRect)) {
            collectedIds.add(entity.id);
            if (entity.power) {
              effectsRef.current.ghost(entity.x, entity.y, 0.3, (paint, x, y, t) => {
                paint.globalAlpha = 1 - t;
                drawSunflower(paint, x, y, PICKUP_HEIGHT.power * entityScale * (1 + t * 0.7));
              });
              game.invincibleUntil = now + POWER_DURATION_MS;
              setPowerUntil(game.invincibleUntil);
              setPowerBanner((count) => count + 1);
              effectsRef.current.powerUp(entity.x, entity.y, now);
              game.bonusScore += ITEM_POINTS;
              effectsRef.current.score(playerX, playerRef.current.y - 56 * entityScale, ITEM_POINTS, SCORE_GOLD, true);
              syncHud();
              playArpeggio([523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093], 0.045, 'square', 0.08);
              return;
            }
            if (entity.morph !== undefined) {
              const token = entity.morph;
              // The head swells and fades out where it was touched...
              effectsRef.current.ghost(entity.x, entity.y, 0.3, (paint, x, y, t) => {
                paint.globalAlpha = 1 - t;
                drawMemberToken(paint, token, x, y, PICKUP_HEIGHT.morph * entityScale * (1 + t * 0.7));
              });
              // ...and the player pops into the new member (see drawPlayer).
              game.morphFrom = game.member;
              game.morphAt = now;
              game.member = token;
              const { palette } = MEMBER_TOKENS[entity.morph];
              effectsRef.current.morph(playerX, playerRef.current.y, [palette.l, palette.f, '#ffffff'], now);
              game.bonusScore += ITEM_POINTS;
              effectsRef.current.score(playerX, playerRef.current.y - 56 * entityScale, ITEM_POINTS, palette.l, true);
              syncHud();
              playArpeggio([659.25, 880, 1318.5], 0.06, 'triangle', 0.08);
              return;
            }
            if (entity.heal) {
              // A heart refills the leftmost empty life (and it pops); at full
              // health the whole row pops and it is only points.
              if (game.health < START_HEALTH) {
                game.health += 1;
                setHeartGain({ id: now, slot: game.health - 1 });
              } else {
                setHeartGain({ id: now, slot: -1 });
              }
              game.bonusScore += ITEM_POINTS;
              effectsRef.current.score(playerX, playerRef.current.y - 56 * entityScale, ITEM_POINTS, '#ff8fa3', true);
              playHealSound();
              syncHud();
              return;
            }
            const gain = now < game.invincibleUntil ? POWER_MULTIPLIER : 1;
            game.collected += gain;
            game.bonusScore += STICK_POINTS * gain;
            game.stickCombo += STICK_POINTS * gain;
            game.stickComboDoubled ||= gain > 1;
            game.stickComboAt = now;
            setStickPop((pop) => ({ id: pop.id + 1, gain }));
            syncHud();
            game.collectStreak = now - game.lastCollectAt < 420 ? Math.min(6, game.collectStreak + 1) : 1;
            game.lastCollectAt = now;
            playCollectSound(game.collectStreak);
          }
          return;
        }

        // Pipes use their true (possibly tilted) outline; pigs a slightly
        // forgiving box, matching the reachability solver.
        const hitPolygon = entity.kind === 'obstacle' && entity.pipe
          ? pipePolygon(entity.pipe, entity.x, entity.y)
          : rectPolygon(
            entity.x - (entity.width * PIG_HIT_SCALE) / 2,
            entity.y - (entity.height * PIG_HIT_SCALE) / 2,
            entity.width * PIG_HIT_SCALE,
            entity.height * PIG_HIT_SCALE,
          );
        if (now < game.invincibleUntil) {
          // Invincible: fly straight through pipes, knock pigs out of the way.
          if (!polygonsOverlap(playerPolygon, hitPolygon)) return;
          if (entity.kind === 'enemy') {
            collectedIds.add(entity.id);
            defeatPig(entity, POWER_MULTIPLIER);
          } else if (Math.random() < 0.5) {
            effectsRef.current.phase(playerX, playerRef.current.y);
          }
          return;
        }
        const graceOver = !game.invincibleUntil || now >= game.invincibleUntil + POWER_GRACE_MS;
        if (!entity.damageApplied && graceOver && now >= game.invulnerableUntil && polygonsOverlap(playerPolygon, hitPolygon)) {
          entity.damageApplied = true;
          game.health = Math.max(0, game.health - 1);
          game.invulnerableUntil = now + DAMAGE_INVULNERABILITY_MS;
          effectsRef.current.hurt(playerX, playerRef.current.y, now);
          setDamageFlash((count) => count + 1);
          playDamageSound();
          if (game.health <= 0) {
            // Out of hearts: freeze on the hit, stop the music, then open the card.
            game.deadAt = now;
            audioRef.current?.pause();
            window.setTimeout(() => finishGame(true), DEATH_PAUSE_MS);
          }
        }
      });
      entitiesRef.current = entitiesRef.current.filter((entity) => !collectedIds.has(entity.id));

      const powered = now < game.invincibleUntil;
      if (powered) effectsRef.current.powerTrail(playerX, playerRef.current.y, now);
      effectsRef.current.updateSpeedLines(dt, powered, width, height);
      if (game.invincibleUntil && !powered && !game.powerEnded) {
        game.powerEnded = true;
        playArpeggio([1046.5, 783.99, 659.25, 523.25], 0.07, 'triangle', 0.08);
        setPowerUntil(0);
      }
      if (powered) game.powerEnded = false;
      const secondsLeft = powered ? Math.ceil((game.invincibleUntil - now) / 1000) : 0;
      if (secondsLeft !== game.powerSecondsShown) {
        game.powerSecondsShown = secondsLeft;
        setPowerLeft(secondsLeft);
      }

      game.frameTimer += dt * 1000;
      while (game.frameTimer >= FRAME_DURATION_MS) {
        game.frameTimer -= FRAME_DURATION_MS;
        game.frameIndex = (game.frameIndex + 1) % SQUAD_FRAME_COUNT;
      }

      if (now - hudSyncRef.current >= HUD_SYNC_MS) {
        hudSyncRef.current = now;
        syncHud();
      }
    };

    const draw = (now: number) => {
      animationRef.current = requestAnimationFrame(draw);
      const currentNow = Number.isFinite(now) ? now : performance.now();
      const previousNow = (draw as typeof draw & { previousNow?: number }).previousNow ?? currentNow;
      (draw as typeof draw & { previousNow?: number }).previousNow = currentNow;
      const dt = clamp((currentNow - previousNow) / 1000, 0, entityScale > 1 ? 0.25 : 1 / 30);
      const { width, height } = sizeRef.current;
      const currentPhase = phaseRef.current;

      // A few frames of hit-stop on impacts make hits land harder.
      if (currentPhase === 'playing' && !gameRef.current.deadAt && currentNow >= effectsRef.current.hitStopUntil) {
        if (entityScale > 1) {
          const audioSeconds = audioRef.current?.currentTime ?? 0;
          for (const step of phoneFrameSteps(Math.max(previousNow, simulationSinceRef.current), currentNow, effectsRef.current.hitStopUntil)) {
            if (gameRef.current.deadAt || phaseRef.current !== 'playing') break;
            const activeFrom = Math.max(step.now - step.dt * 1000, effectsRef.current.hitStopUntil);
            if (activeFrom >= step.now) continue;
            updateGame((step.now - activeFrom) / 1000, step.now, Math.max(0, audioSeconds - (currentNow - step.now) / 1000));
          }
        } else updateGame(dt, currentNow);
      }
      // Out of hearts: the world stands still but the hit's particles settle.
      else if (gameRef.current.deadAt) effectsRef.current.update(dt, 0);
      // Development measurements use the actual world advance, not HUD score
      // (which also includes pickups). No production UI or state is exposed.
      if (import.meta.env.DEV) {
        canvas.dataset.worldDistance = gameRef.current.distance.toFixed(3);
        canvas.dataset.travelDistance = (gameRef.current.distance * entityScale).toFixed(3);
        canvas.dataset.phase = phaseRef.current;
      }
      // Pickups and pigs animate on their own clock, which stands still while paused.
      if (currentPhase !== 'paused') entityClockRef.current += currentNow - previousNow;

      // Everything below is drawn in world units.
      const renderScale = renderScaleRef.current;
      const [shakeX, shakeY] = currentPhase === 'playing' ? effectsRef.current.shakeOffset(currentNow) : [0, 0];
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(renderScale, 0, 0, renderScale, shakeX * renderScale, shakeY * renderScale);
      context.fillStyle = '#101a3b';
      context.fillRect(0, 0, width, height);

      const game = gameRef.current;
      // Home page: the city keeps drifting by at an easy pace.
      if (currentPhase === 'ready') {
        const drift = CRUISE_SPEED * 0.45 * dt;
        game.bottomOffset += drift * 0.30;
        game.middleOffset += drift * 0.62;
        game.topOffset += drift;
      }
      drawParallaxLayer(backgroundImagesRef.current.bottom, game.bottomOffset, 0, height, width);
      const middleHeight = height * 0.60;
      drawParallaxLayer(backgroundImagesRef.current.middle, game.middleOffset, height - middleHeight, middleHeight, width);
      const topHeight = height * 0.30;
      drawParallaxLayer(backgroundImagesRef.current.top, game.topOffset, height - topHeight, topHeight, width);

      // Night tint keeps the middle skyline atmospheric and leaves gameplay entities dominant.
      context.fillStyle = 'rgba(12, 20, 58, 0.30)';
      context.fillRect(0, 0, width, height);
      context.fillStyle = 'rgba(67, 46, 126, 0.14)';
      context.fillRect(0, height - middleHeight, width, middleHeight);

      effectsRef.current.drawSpeedLines(context);
      entitiesRef.current.forEach((entity) => drawEntity(entity));
      // Ending: big "NJZ" drifting in, landing at the centre when the world stops.
      const lettersX = width / 2 + ((gameRef.current.ending.brakeFrom || BRAKE_START_DISTANCE) + BRAKE_DISTANCE - gameRef.current.distance) * entityScale;
      if (lettersX < width + 300) drawEndingTitle(context, lettersX, ENDING_LETTERS_Y, currentNow);
      projectilesRef.current.forEach((projectile) => {
        context.save();
        context.translate(projectile.x, projectile.y);
        context.scale(entityScale, entityScale);
        drawBolt(context, 0, 0);
        context.restore();
      });
      if (currentPhase !== 'ready') drawPlayer(width, height, currentNow, dt, currentPhase === 'playing' && !game.deadAt);
      effectsRef.current.draw(context);
      drawSnow(width, height, dt, currentPhase !== 'paused', currentNow);
    };

    resize();
    window.addEventListener('resize', resize);
    animationRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [entityScale, playerSize, playerHit, playerMinY, playerMaxY, finishGame, playArpeggio, playCollectSound, playDamageSound, playEnemyHitSound, playHealSound, syncHud]);

  const setMoveInput = (direction: 'up' | 'down', active: boolean) => {
    inputRef.current[direction] = active;
  };

  const movementButtonProps = (direction: 'up' | 'down') => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setMoveInput(direction, true);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setMoveInput(direction, false);
    },
    onPointerCancel: () => setMoveInput(direction, false),
    onLostPointerCapture: () => setMoveInput(direction, false),
    onPointerLeave: () => setMoveInput(direction, false),
  });

  return (
    <main
      className={`game-root ${isPhone ? 'phone-device ' : ''}${phonePreview ? 'phone-preview ' : ''}${allowPortrait ? 'allow-portrait ' : ''}overflow-hidden bg-[#081725] text-white select-none`}
      style={{
        touchAction: helpOpen || supportOpen ? 'auto' : 'none',
        fontFamily: 'NJZPixelZh, NJZPixelEn, monospace',
        fontSynthesis: 'none',
        textRendering: 'geometricPrecision',
      }}
    >
      <audio ref={audioRef} src={supernaturalAudio} preload="auto" onLoadedMetadata={(event) => setSongDuration(event.currentTarget.duration || 0)} onDurationChange={(event) => setSongDuration(event.currentTarget.duration || 0)} />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ imageRendering: 'pixelated' }} />
      {damageFlash > 0 && <div key={damageFlash} aria-hidden="true" className="damage-vignette pointer-events-none absolute inset-0 z-10" />}
      {powerTimer && (phase === 'playing' || phase === 'paused') && (
        <div
          key={`glow-${powerTimer.until}`}
          aria-hidden="true"
          className="power-glow pointer-events-none absolute inset-0 z-10"
          style={{ animationPlayState: phase === 'paused' ? 'paused' : 'running', ['--warn-delay' as string]: `${Math.max(0, powerTimer.duration - 2000)}ms` }}
        />
      )}

      {/* Song progress: a faint full-width bar along the top edge that fills as the song plays. */}
      {(phase === 'playing' || phase === 'paused') && (
        <div aria-label="歌曲进度" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[4px] bg-white/15">
          <div className="h-full bg-white/60" style={{ width: `${songProgress * 100}%`, transition: 'width 100ms linear' }} />
        </div>
      )}
      {/* Invincible-mode banner, mid-screen above the action so it is not missed. */}
      {powerBanner > 0 && powerLeft > 0 && (
        <div key={`banner-${powerBanner}`} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex justify-center">
          <div className="power-banner whitespace-nowrap text-[34px] leading-none text-white sm:text-[46px]" style={{ fontFamily: 'NJZPixelZh, sans-serif', textShadow: '0 3px 0 rgba(6, 10, 32, 0.75)' }}>
            无敌模式 · <span className="double-badge-text">奖励翻倍</span>
          </div>
        </div>
      )}
      <div inert={supportOpen} className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-4 sm:p-6" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className={`flex flex-col items-start gap-1 ${phase === 'ready' ? 'invisible' : ''}`} style={{ filter: 'drop-shadow(0 2px 0 rgba(6, 10, 32, 0.55))' }}>
          {/* Row 1: the lives; lost ones keep their outline so you can see what a heart refills.
              Every top row is 44px tall (h-11) so hearts, counters and buttons share one centre line. */}
          <div className="flex h-11 items-center gap-1" aria-label={`${stats.health} 条命`}>
            {Array.from({ length: START_HEALTH }, (_, index) => {
              const popping = heartGain && (heartGain.slot === index || heartGain.slot === -1);
              return (
                <span key={popping ? `${index}-${heartGain.id}` : index} className={`flex ${popping ? 'hud-bump' : ''}`}>
                  <PixelHeart filled={index < stats.health} />
                </span>
              );
            })}
          </div>
          {/* Row 2: total score (light sticks and pigs live in the centre). */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Total score, zero-padded like an arcade counter. */}
            <div className="text-[20px] leading-none text-white/90" aria-label={`总分 ${stats.score}`}>
              <PixelNumber text={String(stats.score).padStart(5, '0')} />
            </div>
          </div>
        </div>

        {/* Centre: the counters players chase, then the invincible countdown. */}
        <div className={`absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center gap-2 ${phase === 'ready' ? 'hidden' : ''}`} style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', filter: 'drop-shadow(0 2px 0 rgba(6, 10, 32, 0.55))' }}>
          <div className="flex h-11 items-center gap-5 sm:gap-6">
            {([
              { key: 'stick', label: `应援棒 ${stats.collected} 根`, value: stats.collected, pop: stickPop, sprite: STICK_ICON_SPRITE, colors: STICK_ICON_COLORS },
              { key: 'pig', label: `暴击方猪 ${stats.defeated} 只`, value: stats.defeated, pop: pigPop, sprite: PIG_ICON_SPRITE, colors: PIG_ICON_COLORS },
            ] as const).map((counter) => (
              <div key={counter.key} className="relative flex items-center gap-2" aria-label={counter.label}>
                <PixelSprite rows={counter.sprite} colors={counter.colors} cellSize={2.5} />
                {/* Only the number pops; the icon stays still. */}
                <span className="relative">
                  <span key={counter.pop.id} className={`block text-[20px] leading-none ${counter.pop.id ? 'count-pop' : ''} ${powerLeft ? 'text-[#ffd84a]' : 'text-white'}`}><PixelNumber text={counter.value} /></span>
                  {counter.pop.gain > 1 && <span key={`float-${counter.pop.id}`} aria-hidden="true" className="count-float text-[15px] leading-none"><PixelNumber text={`+${counter.pop.gain}`} /></span>}
                </span>
                {powerLeft > 0 && <span aria-hidden="true" className="double-badge ml-1.5 text-[15px] leading-none"><PixelNumber text={`×${POWER_MULTIPLIER}`} /></span>}
                {counter.key === 'pig' && pigCombo.combo >= 2 && (
                  <span key={`combo-${pigCombo.id}`} className="combo-badge absolute left-full top-1/2 ml-2 whitespace-nowrap text-[17px] leading-none" style={{ color: pigComboColor(pigCombo.combo), animationPlayState: phase === 'paused' ? 'paused' : 'running' }}>
                    {comboName(pigCombo.combo)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* Invincible mode: a large sunflower and ten cells, one lost per second. */}
          {powerLeft > 0 && (
            <div
              className={`flex items-center gap-3 ${powerLeft <= 2 ? 'power-warn-blink' : ''}`}
              aria-label={`无敌模式，剩 ${powerLeft} 秒，应援棒和小猪双倍`}
              style={{ animationPlayState: phase === 'paused' ? 'paused' : 'running' }}
            >
              <PixelSprite rows={SUNFLOWER_ROWS} colors={SUNFLOWER_PALETTE} cellSize={2.5} className="sm:hidden" />
              <PixelSprite rows={SUNFLOWER_ROWS} colors={SUNFLOWER_PALETTE} cellSize={3} className="hidden sm:inline-grid" />
              <div className="flex gap-[3px]">
                {Array.from({ length: Math.ceil(POWER_DURATION_MS / 1000) }, (_, index) => (
                  <span
                    key={index}
                    className="block h-[18px] w-[12px] border border-white/60 sm:h-[22px] sm:w-[16px]"
                    style={{ background: index < powerLeft ? RAINBOW[Math.floor((index * RAINBOW.length) / Math.ceil(POWER_DURATION_MS / 1000))] : 'rgba(6, 10, 32, 0.35)' }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-1" style={{ filter: 'drop-shadow(0 2px 0 rgba(6, 10, 32, 0.55))' }}>
          {phase === 'ready' && (
            <PixelButton onClick={event => { supportEntryRef.current = event.currentTarget; setHelpOpen(false); setSupportOpen(true); }} className="home-support h-11 px-2 text-[#e8efff]" aria-label="赞赏作者" title="赞赏作者">
              <PixelIcon name="heart" size={20} /><span>赞赏作者</span>
            </PixelButton>
          )}
          {phase === 'ready' && (
            <PixelButton onClick={() => setHelpOpen(true)} className="h-11 w-11 text-[#e8efff]" aria-label="玩法说明" title="玩法说明">
              <PixelIcon name="info" size={22} />
            </PixelButton>
          )}
          {(phase === 'playing' || phase === 'paused') && (
            <PixelButton
              onClick={phase === 'paused' ? resumeFromControl : pauseFromControl}
              className="h-11 w-11 text-[#e8efff]"
              aria-label={phase === 'paused' ? '继续游戏' : '暂停游戏'}
              title={phase === 'paused' ? '继续游戏' : '暂停游戏'}
              aria-pressed={phase === 'paused'}
            >
              <PixelIcon name="pause" size={22} />
            </PixelButton>
          )}
          <PixelButton
            onClick={toggleMusicMute}
            className="h-11 w-11 text-[#e8efff]"
            aria-label={musicMuted ? '打开背景音乐' : '关闭背景音乐'}
            title={musicMuted ? '打开背景音乐' : '关闭背景音乐'}
            aria-pressed={musicMuted}
          >
            <PixelIcon name="music" size={22} slashed={musicMuted} />
          </PixelButton>
          <PixelButton
            onClick={toggleEffectsMute}
            className="h-11 w-11 text-[#e8efff]"
            aria-label={effectsMuted ? '打开游戏音效' : '关闭游戏音效'}
            title={effectsMuted ? '打开游戏音效' : '关闭游戏音效'}
            aria-pressed={effectsMuted}
          >
            <PixelIcon name="sound" size={22} slashed={effectsMuted} />
          </PixelButton>
        </div>
      </div>

      {phase === 'ready' && <HomeScreen member={homeMember} isPhone={isPhone} keysEnabled={!helpOpen && !supportOpen} onPick={pickHomeMember} onStart={startFromMenu} />}
      {phase === 'ready' && helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {phase === 'ready' && supportOpen && <SupportPanel onClose={closeSupport} />}

      {/* Pause: a dim veil over the frozen stage and three big square buttons. */}
      {phase === 'paused' && (
        <div className="result-backdrop absolute inset-0 z-40 flex items-center justify-center bg-[#060a22]/65 px-6" role="dialog" aria-modal="true" aria-label="游戏已暂停">
          {/* All three actions share the same face, outline and dimensions. */}
          <div className="pause-actions flex items-end gap-6">
          <KeycapButton variant="secondary" width={isPhone ? 53 : 76} height={isPhone ? 53 : 76} cell={isPhone ? 1 : 2} onClick={homeFromPause} aria-label="回到首页" title="回到首页">
            <PixelIcon name="homeSolid" size={isPhone ? 26 : 39} />
          </KeycapButton>
          <KeycapButton variant="secondary" width={isPhone ? 53 : 76} height={isPhone ? 53 : 76} cell={isPhone ? 1 : 2} onClick={startFromMenu} aria-label="重新开始" title="重新开始">
            <PixelIcon name="restartSolid" size={isPhone ? 26 : 39} />
          </KeycapButton>
          <KeycapButton variant="secondary" width={isPhone ? 53 : 76} height={isPhone ? 53 : 76} cell={isPhone ? 1 : 2} onClick={resumeFromControl} aria-label="继续游戏" title="继续游戏">
            <PixelIcon name="playSolid" size={isPhone ? 26 : 39} />
          </KeycapButton>
          </div>
        </div>
      )}

      {phase === 'gameover' && (
        <ResultModal
          failed={failed}
          leadMember={gameRef.current.startMember}
          score={stats.score}
          sticks={stats.collected}
          pigs={stats.defeated}
          progress={songProgress}
          onRetry={startGame}
          onHome={goHome}
          onTick={(progress) => playArpeggio([520 + progress * 780], 0.028, 'square', 0.045)}
          onDone={() => playArpeggio([783.99, 1046.5, 1318.5, 1568, 2093], 0.07, 'square', 0.08)}
        />
      )}

      {phase === 'playing' && (
        <div className="touch-controls touch-only pointer-events-none absolute inset-x-0 bottom-0 z-20 items-end justify-between">
          <div className="touch-only pointer-events-auto flex-col gap-2">
            <TouchControlButton {...movementButtonProps('up')} action="up" aria-label="向上移动" title="向上移动" />
            <TouchControlButton {...movementButtonProps('down')} action="down" aria-label="向下移动" title="向下移动" />
          </div>
          <TouchControlButton
            onPointerDown={(event) => {
              event.preventDefault();
              shoot();
            }}
            action="attack"
            aria-label="发射攻击"
            title="发射攻击"
          />
        </div>
      )}
    </main>
  );
};

export default FlightGame;
