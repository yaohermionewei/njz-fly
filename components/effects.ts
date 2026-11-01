/**
 * Hit feedback for the flight game: pixel sparks, star flashes, screen shake
 * and a short hit-stop. Everything lives in world
 * units and scrolls with the level; particles snap to a 3-unit grid so they
 * read as pixel art next to the sprites.
 */

// The game keeps one Effects instance in a ref; a hot update would leave it on
// the old class (missing new methods), so reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

import { digitsWidth, fillDigits } from './pixelDigits';

const GRID = 3;
const snap = (value: number) => Math.round(value / GRID) * GRID;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

interface StarFlash {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
}

const PIG_CHUNKS = ['#f3bdd3', '#de8bb0', '#de8bb0', '#b9608f', '#ffffff', '#2a1838'];
const HURT_CHUNKS = ['#ff5a76', '#ff8fa3', '#ffffff', '#ffd0dc'];
const MUZZLE_SPARKS = ['#fff3a1', '#ffffff', '#ffd98a'];
export const RAINBOW = ['#ff5a76', '#ff9a4a', '#ffd84a', '#7be08f', '#4fc3ff', '#8b7bff', '#e07bff'];

/** A picked-up item's last moment: drawn by its owner, `t` runs 0 → 1. */
interface Ghost {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  draw: (context: CanvasRenderingContext2D, x: number, y: number, t: number) => void;
}

/** A "+50" that pops up and drifts upward where points were earned. */
interface ScorePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  /** Pinned to the screen (pickups at the player) instead of the world. */
  fixed: boolean;
}

const POPUP_LIFE = 1.05;
const POPUP_HEIGHT = 36;
const POPUP_RISE = 56;

interface SpeedLine {
  x: number;
  y: number;
  length: number;
  speed: number;
}

export class Effects {
  private sparks: Spark[] = [];
  private flashes: StarFlash[] = [];
  private shakeUntil = 0;
  private shakeStart = 0;
  private shakeStrength = 0;
  private speedLines: SpeedLine[] = [];
  private ghosts: Ghost[] = [];
  private popups: ScorePopup[] = [];
  private popupSprites = new Map<string, HTMLCanvasElement>();
  /** While `now` is before this, the world holds still for impact. */
  hitStopUntil = 0;

  clear() {
    this.sparks = [];
    this.flashes = [];
    this.shakeUntil = 0;
    this.hitStopUntil = 0;
    this.speedLines = [];
    this.ghosts = [];
    this.popups = [];
  }

  /** Let a collected item swell and fade where it was picked up. */
  ghost(x: number, y: number, duration: number, draw: Ghost['draw']) {
    this.ghosts.push({ x, y, life: duration, maxLife: duration, draw });
  }

  /** Float earned points above (x, y); `fixed` keeps it on screen with the player. */
  score(x: number, y: number, points: number, color = '#ffffff', fixed = false) {
    this.popups.push({ x, y, text: `+${points}`, color, life: POPUP_LIFE, fixed });
  }

  private burst(x: number, y: number, colors: string[], count: number, speed: [number, number], gravity: number, size: [number, number]) {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.6;
      const velocity = speed[0] + Math.random() * (speed[1] - speed[0]);
      const life = 0.35 + Math.random() * 0.35;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - velocity * 0.35,
        life,
        maxLife: life,
        size: size[0] + Math.floor(Math.random() * (size[1] - size[0] + 1)) * GRID,
        color: colors[index % colors.length],
        gravity,
      });
    }
  }

  private shake(now: number, strength: number, duration: number) {
    if (now + duration < this.shakeUntil && strength <= this.shakeStrength) return;
    this.shakeStart = now;
    this.shakeUntil = now + duration;
    this.shakeStrength = strength;
  }

  muzzle(x: number, y: number) {
    this.flashes.push({ x, y, life: 0.09, maxLife: 0.09, radius: 12, color: '#fff3a1' });
    this.burst(x, y, MUZZLE_SPARKS, 3, [90, 160], 0, [3, 3]);
  }

  /** A pig bursts into pink chunks with a white star (the HUD pig counter bumps). */
  pigPop(x: number, y: number, now: number) {
    this.flashes.push({ x, y, life: 0.16, maxLife: 0.16, radius: 34, color: '#ffffff' });
    this.burst(x, y, PIG_CHUNKS, 16, [140, 340], 720, [3, 6]);
    this.shake(now, 5, 140);
    this.hitStopUntil = Math.max(this.hitStopUntil, now + 50);
  }

  /** The player takes a hit: red-white sparks, a heavy shake and a pause. */
  hurt(x: number, y: number, now: number) {
    this.flashes.push({ x, y, life: 0.14, maxLife: 0.14, radius: 30, color: '#ff8fa3' });
    this.burst(x, y, HURT_CHUNKS, 12, [120, 280], 520, [3, 6]);
    this.shake(now, 9, 280);
    this.hitStopUntil = Math.max(this.hitStopUntil, now + 80);
  }

  /** The sunflower is picked up: a rainbow burst and a short beat of stillness. */
  powerUp(x: number, y: number, now: number) {
    this.flashes.push({ x, y, life: 0.22, maxLife: 0.22, radius: 54, color: '#fff3a1' });
    this.burst(x, y, RAINBOW, 28, [160, 380], 260, [3, 6]);
    this.shake(now, 4, 160);
    this.hitStopUntil = Math.max(this.hitStopUntil, now + 70);
  }

  /** Turning into another member: a white puff and a burst in her colours. */
  morph(x: number, y: number, colors: string[], now: number) {
    this.flashes.push({ x, y, life: 0.22, maxLife: 0.22, radius: 52, color: '#ffffff' });
    this.burst(x, y, ['#ffffff', '#eef3ff'], 12, [70, 140], -30, [6, 7]);
    this.burst(x, y, colors, 18, [160, 320], 200, [3, 4]);
    this.shake(now, 3, 120);
  }

  /** Rainbow sparks streaming behind the invincible player. */
  powerTrail(x: number, y: number, now: number) {
    const color = RAINBOW[Math.floor(now / 60) % RAINBOW.length];
    const life = 0.3 + Math.random() * 0.25;
    this.sparks.push({ x: x - 26, y: y + (Math.random() - 0.5) * 34, vx: -140 - Math.random() * 90, vy: (Math.random() - 0.5) * 40, life, maxLife: life, size: GRID * (1 + Math.floor(Math.random() * 2)), color, gravity: 0 });
  }

  /** Starry glints while phasing through a pipe. */
  phase(x: number, y: number) {
    this.burst(x + 10, y, ['#ffffff', '#fff3a1', '#9fe7ff'], 2, [60, 140], 0, [3, 3]);
  }

  /** Streaks rushing past while invincible; they thin out once it ends. */
  updateSpeedLines(dt: number, active: boolean, width: number, height: number) {
    if (active && this.speedLines.length < 14 && Math.random() < 0.6) {
      this.speedLines.push({ x: width + 20, y: snap(Math.random() * height), length: 60 + Math.random() * 140, speed: 1100 + Math.random() * 700 });
    }
    this.speedLines.forEach((line) => { line.x -= line.speed * dt; });
    this.speedLines = this.speedLines.filter((line) => line.x + line.length > -20);
  }

  drawSpeedLines(context: CanvasRenderingContext2D) {
    if (!this.speedLines.length) return;
    context.save();
    context.fillStyle = '#ffffff';
    this.speedLines.forEach((line) => {
      context.globalAlpha = 0.22;
      context.fillRect(snap(line.x), line.y, line.length, GRID);
      context.globalAlpha = 0.45;
      context.fillRect(snap(line.x), line.y, Math.min(24, line.length), GRID);
    });
    context.restore();
  }

  /** World offset for the current frame's shake, decaying to zero. */
  shakeOffset(now: number): [number, number] {
    if (now >= this.shakeUntil) return [0, 0];
    const progress = (now - this.shakeStart) / (this.shakeUntil - this.shakeStart);
    const strength = this.shakeStrength * (1 - progress) * (1 - progress);
    return [snap((Math.random() * 2 - 1) * strength), snap((Math.random() * 2 - 1) * strength)];
  }

  /** Advance particles; `scroll` is how far the world moved left this frame. */
  update(dt: number, scroll: number) {
    this.sparks.forEach((spark) => {
      spark.x += spark.vx * dt - scroll;
      spark.y += spark.vy * dt;
      spark.vy += spark.gravity * dt;
      spark.vx *= 1 - 2.5 * dt;
      spark.life -= dt;
    });
    this.flashes.forEach((flash) => {
      flash.x -= scroll;
      flash.life -= dt;
    });
    this.ghosts.forEach((ghost) => {
      ghost.x -= scroll;
      ghost.life -= dt;
    });
    this.popups.forEach((popup) => {
      if (!popup.fixed) popup.x -= scroll;
      popup.life -= dt;
    });
    this.popups = this.popups.filter((popup) => popup.life > 0);
    this.ghosts = this.ghosts.filter((ghost) => ghost.life > 0);
    this.sparks = this.sparks.filter((spark) => spark.life > 0);
    this.flashes = this.flashes.filter((flash) => flash.life > 0);
  }

  draw(context: CanvasRenderingContext2D) {
    this.ghosts.forEach((ghost) => {
      context.save();
      ghost.draw(context, ghost.x, ghost.y, 1 - ghost.life / ghost.maxLife);
      context.restore();
    });
    context.save();
    this.flashes.forEach((flash) => {
      // A four-point pixel star that grows and thins out.
      const t = 1 - flash.life / flash.maxLife;
      const reach = snap(flash.radius * (0.45 + t * 0.55));
      const thick = t < 0.5 ? GRID * 2 : GRID;
      context.globalAlpha = 1 - t * 0.6;
      context.fillStyle = flash.color;
      const x = snap(flash.x);
      const y = snap(flash.y);
      context.fillRect(x - reach, y - thick / 2, reach * 2, thick);
      context.fillRect(x - thick / 2, y - reach, thick, reach * 2);
      const diagonal = snap(reach * 0.45);
      for (let step = GRID; step <= diagonal; step += GRID) {
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => context.fillRect(x + dx * step - GRID / 2, y + dy * step - GRID / 2, GRID, GRID));
      }
    });
    this.sparks.forEach((spark) => {
      context.globalAlpha = Math.min(1, (spark.life / spark.maxLife) * 1.6);
      context.fillStyle = spark.color;
      context.fillRect(snap(spark.x) - spark.size / 2, snap(spark.y) - spark.size / 2, spark.size, spark.size);
    });
    context.restore();
    this.drawPopups(context);
  }

  /**
   * Each pop-up is first painted fully opaque into its own small canvas at
   * the exact device-pixel size, then drawn once with its alpha. (Drawing the
   * overlapping glyph rectangles straight onto the scene with alpha made the
   * joints show through darker.)
   */
  private popupSprite(text: string, color: string, devicePx: number) {
    const key = `${text}|${color}|${devicePx}`;
    let sprite = this.popupSprites.get(key);
    if (sprite) return sprite;
    if (this.popupSprites.size > 40) this.popupSprites.clear();
    const outline = Math.max(1, Math.round(devicePx / 20));
    const shadow = Math.max(1, Math.round(devicePx / 14));
    sprite = document.createElement('canvas');
    sprite.width = Math.ceil(digitsWidth(text, devicePx)) + outline * 2 + shadow;
    sprite.height = devicePx + outline * 2 + shadow;
    const paint = sprite.getContext('2d')!;
    paint.fillStyle = '#151c4a';
    fillDigits(paint, text, outline + shadow, outline + shadow, devicePx, outline);
    fillDigits(paint, text, outline, outline, devicePx, outline);
    paint.fillStyle = color;
    fillDigits(paint, text, outline, outline, devicePx);
    this.popupSprites.set(key, sprite);
    return sprite;
  }

  private drawPopups(context: CanvasRenderingContext2D) {
    if (!this.popups.length) return;
    // World units → device pixels for the current frame.
    const deviceScale = context.getTransform().a || 1;
    // Whole device pixels per glyph unit keep every stroke edge crisp.
    const devicePx = Math.max(1, Math.round((POPUP_HEIGHT * deviceScale) / 20)) * 20;
    this.popups.forEach((popup) => {
      const t = 1 - popup.life / POPUP_LIFE;
      // Springs in (ease-out-back overshoot), glides up with a soft ease-out,
      // fades in fast and out gently while shrinking a touch.
      const enter = Math.min(1, t / 0.22);
      const back = 1 + 3.2 * (enter - 1) ** 3 + 2.2 * (enter - 1) ** 2;
      const leave = Math.max(0, (t - 0.62) / 0.38);
      const scale = (0.4 + 0.6 * back) * (1 - leave * 0.15);
      const rise = POPUP_RISE * (1 - (1 - t) ** 4);
      const sprite = this.popupSprite(popup.text, popup.color, devicePx);
      const width = (sprite.width / deviceScale) * scale;
      const height = (sprite.height / deviceScale) * scale;
      context.save();
      context.imageSmoothingEnabled = false;
      context.globalAlpha = Math.min(1, t / 0.06) * (1 - leave * leave);
      context.drawImage(sprite, popup.x - width / 2, popup.y - rise - height / 2, width, height);
      context.restore();
    });
  }

}

/** Pixel energy bolt with a fading tail of afterimages. */
export function drawBolt(context: CanvasRenderingContext2D, x: number, y: number) {
  const tail = [
    { offset: 0, width: 18, height: 6, color: '#fff3a1', alpha: 1 },
    { offset: 15, width: 12, height: 6, color: '#ffd98a', alpha: 0.7 },
    { offset: 27, width: 9, height: 3, color: '#ff9fb0', alpha: 0.5 },
    { offset: 36, width: 6, height: 3, color: '#ff9fb0', alpha: 0.28 },
  ];
  context.save();
  tail.forEach((piece) => {
    context.globalAlpha = piece.alpha;
    context.fillStyle = piece.color;
    context.fillRect(snap(x - piece.offset) - piece.width / 2, snap(y) - piece.height / 2, piece.width, piece.height);
  });
  // Hot white core and a pointed nose.
  context.globalAlpha = 1;
  context.fillStyle = '#ffffff';
  context.fillRect(snap(x) - 6, snap(y) - 1.5, 12, 3);
  context.fillStyle = '#fff3a1';
  context.fillRect(snap(x) + 9, snap(y) - 1.5, 3, 3);
  context.restore();
}
