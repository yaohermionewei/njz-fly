/**
 * Pixel sprites shared by the game and the segment preview page. Palettes are
 * graded for the blue night scene (navy outlines, cool highlights) so the
 * sprites sit inside the background instead of on top of it.
 */

import { nightTint } from './nightTint';

export type Palette = Record<string, string>;

/**
 * Rasterize a character grid once into a 1-pixel-per-cell canvas. Colours get
 * the shared night tint; `light` < 1 dims the sprite (the far side of a spin).
 */
function makeSprite(rows: string[], palette: Palette, light = 1) {
  let canvas: HTMLCanvasElement | null = null;
  return () => {
    if (canvas || typeof document === 'undefined') return canvas;
    canvas = document.createElement('canvas');
    canvas.width = rows[0].length;
    canvas.height = rows.length;
    const paint = canvas.getContext('2d');
    if (!paint) return null;
    rows.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '.') return;
        const [r, g, b] = nightTint(palette[cell]).map((channel) => Math.round(channel * light));
        paint.fillStyle = `rgb(${r}, ${g}, ${b})`;
        paint.fillRect(x, y, 1, 1);
      });
    });
    return canvas;
  };
}

// Pig with glasses in three-quarter view facing right, on a fine 27×24 grid
// (generated, then hand-tuned): o outline, l/p/d light/base/dark pink, r inner
// ear, n snout, h nostril / mouth, g glasses (lenses show the face colour,
// no white fill), k pupil and
// brow, t tail, f hoof. Features sit toward the front: the near lens is wide,
// the far lens narrower; flat oval frames; the near temple runs back to the
// ear. Heavy brows and lids pressing on the pupils give an arrogant glare;
// the snout and the sneering mouth line up under the eyes.
const PIG_PALETTE: Palette = {
  o: '#43203f',
  l: '#f3bdd3',
  p: '#de8bb0',
  d: '#b9608f',
  n: '#f0a6c4',
  h: '#7a2d5a',
  g: '#2a1838',
  r: '#c76a98',
  k: '#1e1428',
  t: '#d27aa3',
  f: '#6a3152',
};
const PIG_BODY = [
  '....o..............o.......',
  '....ooo...........opo......',
  '...orllooooooooooorpo......',
  '...orrllllllllllprrppo.....',
  '...ollllllllllpppppppo.....',
  '....olllkkkllppppppppkk....',
  '...olllllllkkkpppppkkppo...',
  '...olllllgggggkkppkggggo...',
  '..olllllgppppppgppgppppgo..',
  '.ggggggggpppkkpgggpppkkggg.',
  '..ollpppgpppkkpgpgpppkpgo..',
  '..olppppggppppggppgppppgpo..',
  't.oppppppggggggppppggggpo..',
  't.opppppppppppppnnnnppppo..',
  '.toppppppppppppnnnnnnppdo..',
  '..opppppppppppnnhnnhnnddo..',
  '...opppppppppppnhnnhnddo...',
  '...oppppppppppppnnnndddo...',
  '....oppppppppppddddddho....',
  '.....opppppppddhhhhhho.....',
  '......oopppddddddddoo......',
  '........ooooooooooo........',
];
const pigFrames = [
  makeSprite([...PIG_BODY, '........odo.....odo........', '........ofo.....ofo........', '........ooo.....ooo........'], PIG_PALETTE),
  makeSprite([...PIG_BODY, '.........odo...odo.........', '.........ofo...ofo.........', '.........ooo...ooo.........'], PIG_PALETTE),
];

/** Pig centered on (x, y), `height` tall; hooves rest on y + height / 2. */
export function drawPig(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  _width: number,
  height: number,
  direction: -1 | 1,
  phase: number,
  now: number,
) {
  const frame = Math.floor(now / 160 + phase * 3) % 2;
  const sprite = pigFrames[frame]();
  if (!sprite) return;
  const pixel = height / sprite.height;
  const drawWidth = sprite.width * pixel;
  // On the stride frame the body settles one pixel onto the legs (never lifts
  // off them, which would open a gap); hooves stay planted.
  const bob = frame ? -pixel : 0;
  const bodyRows = PIG_BODY.length;
  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(x, y);
  context.scale(direction, 1);
  context.drawImage(sprite, 0, 0, sprite.width, bodyRows, -drawWidth / 2, -height / 2 - bob, drawWidth, bodyRows * pixel);
  context.drawImage(sprite, 0, bodyRows, sprite.width, sprite.height - bodyRows, -drawWidth / 2, -height / 2 + bodyRows * pixel, drawWidth, (sprite.height - bodyRows) * pixel);
  context.restore();
}

/** Slow, eased hover shared by pickups so they breathe instead of jumping. */
function hover(now: number, x: number, amplitude: number) {
  return Math.sin(now / 520 + x * 0.011) * amplitude;
}

const SPIN_FRAMES = 32;
// Fixed light in view space: upper left, mostly from the front.
const SPIN_LIGHT = (() => {
  const [x, y, z] = [-0.4, -0.45, 0.8];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
})();

/**
 * A pickup that spins about the screen's vertical axis as a rounded solid,
 * like a soft plastic charm: each cell is thick in the middle of the shape
 * and thin toward its edge (from a distance transform), so the sides curve
 * instead of being a flat wall. Every frame is rendered at sprite resolution
 * with a depth test, the surface keeps the cell's own colour (a white light
 * stick stays white all round), and brightness comes from the surface normal
 * against one fixed light, so shading moves smoothly with the turn. One clean
 * outline is traced around the silhouette. Frames are built lazily and cached.
 */
function spinningPickup(rows: string[], palette: Palette, depth: number, outline = 'o') {
  const columns = rows[0].length;
  const height = rows.length;
  // Keep the frame's spare width even so the face lands on whole pixels; a
  // half-pixel offset smears every cell over two columns and closes gaps.
  const width = columns + 2 * Math.ceil((Math.hypot(columns, depth) - columns) / 2 + 1);
  const solid = (x: number, y: number) => y >= 0 && y < height && x >= 0 && x < columns && rows[y][x] !== '.';
  // Distance from each cell to the outside, then a rounded half-thickness.
  const ROUNDING = 2.6;
  const halfThickness = rows.map((line, y) => [...line].map((cell, x) => {
    if (cell === '.') return 0;
    let nearest = Infinity;
    for (let oy = -4; oy <= 4; oy += 1) {
      for (let ox = -4; ox <= 4; ox += 1) {
        if (!solid(x + ox, y + oy)) nearest = Math.min(nearest, Math.hypot(ox, oy));
      }
    }
    const inside = Math.min(ROUNDING, Math.min(nearest, 5) - 0.5) / ROUNDING;
    return (depth / 2) * Math.sqrt(1 - (1 - inside) * (1 - inside));
  }));
  const thicknessAt = (x: number, y: number) => (solid(x, y) ? halfThickness[y][x] : 0);
  // A side facing into a notch (empty next to it, solid again a few cells on)
  // sits in a crevice: it stays dark so the notch keeps reading while turning.
  const crevice = (x: number, y: number, step: number) => {
    if (solid(x + step, y)) return false;
    for (let reach = 2; reach <= 7; reach += 1) if (solid(x + step * reach, y)) return true;
    return false;
  };
  // Outline cells become the rim of the volume, so they take the colour of the
  // nearest body cell; the silhouette outline is traced again per frame.
  // Outline cells touching empty space are the rim; the rest are drawn inner lines.
  const rim = rows.map((line, y) => [...line].map((cell, x) => cell === outline
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => !solid(x + ox, y + oy))));
  const surface = rows.map((line, y) => [...line].map((cell, x) => {
    if (cell !== outline) return cell;
    for (let reach = 1; reach <= 3; reach += 1) {
      for (let oy = -reach; oy <= reach; oy += 1) {
        for (let ox = -reach; ox <= reach; ox += 1) {
          const near = rows[y + oy]?.[x + ox];
          if (near && near !== '.' && near !== outline) return near;
        }
      }
    }
    return cell;
  }));
  const rgb = (cell: string, light = 1) => nightTint(palette[cell]).map((channel) => Math.min(255, Math.round(channel * light)));
  const frames: Array<HTMLCanvasElement | null> = [];

  const build = (frame: number) => {
    if (typeof document === 'undefined') return null;
    const angle = (frame / SPIN_FRAMES) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const colors: Array<number[] | null> = new Array(width * height).fill(null);
    const nearest = new Float32Array(width * height).fill(-Infinity);
    const samples = [1 / 6, 1 / 2, 5 / 6];
    rows.forEach((line, y) => {
      [...line].forEach((cell, x) => {
        if (cell === '.') return;
        const half = halfThickness[y][x];
        // Surface slope from the neighbours gives the normal's x/y lean.
        const slopeX = (thicknessAt(x + 1, y) - thicknessAt(x - 1, y)) / 2;
        const slopeY = (thicknessAt(x, y + 1) - thicknessAt(x, y - 1)) / 2;
        const layers = Math.max(2, Math.ceil(half * 6));
        samples.forEach((sx) => {
          for (let layer = 0; layer <= layers; layer += 1) {
            const along = layer / layers * 2 - 1; // -1 back … 1 front
            const px = x + sx - columns / 2;
            const pz = along * half;
            const u = Math.floor(px * cos + pz * sin + width / 2);
            const toward = -px * sin + pz * cos;
            const index = y * width + u;
            if (u < 0 || u >= width || toward <= nearest[index]) continue;
            nearest[index] = toward;
            // Normal leans outward with the slope and toward ±z on the faces.
            const nx = -slopeX * Math.abs(along) + (1 - Math.abs(along)) * Math.sign(-slopeX || sx - 0.5);
            const ny = -slopeY * Math.abs(along);
            const nz = along;
            const length = Math.hypot(nx, ny, nz) || 1;
            const vx = (nx * cos + nz * sin) / length;
            const vz = (-nx * sin + nz * cos) / length;
            const lit = Math.max(0, vx * SPIN_LIGHT[0] + (ny / length) * SPIN_LIGHT[1] + vz * SPIN_LIGHT[2]);
            // Four pixel-art brightness steps; full brightness when facing front.
            const level = Math.min(3, Math.floor((0.62 + 0.42 * lit - 0.7) / 0.1 + 0.5));
            // The faces keep the drawn art (inner lines included); the curved rim shows body colour.
            // The faces show the drawn art as is (no shading blotches); only
            // the curved rim takes light from the normal.
            const inCrevice = crevice(x, y, nx < 0 ? -1 : 1);
            colors[index] = Math.abs(along) > 0.8
              ? rgb(rim[y][x] ? surface[y][x] : cell, cos * along >= 0 ? 1 : 0.9)
              : inCrevice
                ? rgb(outline)
                : rgb(surface[y][x], 0.76 + Math.max(0, level) * 0.08);
          }
        });
      });
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const paint = canvas.getContext('2d');
    if (!paint) return null;
    const image = paint.createImageData(width, height);
    const line = rgb(outline);
    // Gaps that narrow while turning (the ear notch, the heart's dip) keep
    // reading as a gap: a one-pixel slit becomes a single outline-coloured
    // line, like the notch in the flat art, instead of being outlined on both
    // sides; enclosed holes are filled; then outline only against the outside.
    const slit = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let u = 1; u < width - 1; u += 1) {
        const index = y * width + u;
        if (!colors[index] && colors[index - 1] && colors[index + 1]) {
          colors[index] = line;
          slit[index] = 1;
        }
      }
    }
    const outside = new Uint8Array(width * height);
    const queue: number[] = [];
    const visit = (u: number, y: number) => {
      if (u < 0 || y < 0 || u >= width || y >= height) return;
      const index = y * width + u;
      if (outside[index] || colors[index]) return;
      outside[index] = 1;
      queue.push(index);
    };
    for (let u = 0; u < width; u += 1) { visit(u, 0); visit(u, height - 1); }
    for (let y = 0; y < height; y += 1) { visit(0, y); visit(width - 1, y); }
    while (queue.length) {
      const index = queue.pop()!;
      const u = index % width;
      const y = (index - u) / width;
      visit(u + 1, y); visit(u - 1, y); visit(u, y + 1); visit(u, y - 1);
    }
    for (let index = 0; index < colors.length; index += 1) {
      if (colors[index] || outside[index]) continue;
      colors[index] = colors[index - 1] ?? colors[index + 1] ?? colors[index - width] ?? line;
    }
    const open = (u: number, y: number) => u < 0 || y < 0 || u >= width || y >= height || outside[y * width + u] === 1;
    for (let y = 0; y < height; y += 1) {
      for (let u = 0; u < width; u += 1) {
        const color = colors[y * width + u];
        if (!color) continue;
        // One outline around the whole silhouette, whatever the angle.
        const edge = !slit[y * width + u] && (open(u - 1, y) || open(u + 1, y) || open(u, y - 1) || open(u, y + 1));
        image.data.set([...(edge ? line : color), 255], (y * width + u) * 4);
      }
    }
    paint.putImageData(image, 0, 0);
    return canvas;
  };

  return {
    rows: height,
    frame(angle: number) {
      const turn = angle / (Math.PI * 2);
      const index = ((Math.round(turn * SPIN_FRAMES) % SPIN_FRAMES) + SPIN_FRAMES) % SPIN_FRAMES;
      if (frames[index] === undefined) frames[index] = build(index);
      return frames[index];
    },
  };
}

type SpinningPickup = ReturnType<typeof spinningPickup>;

function drawSpinning(context: CanvasRenderingContext2D, pickup: SpinningPickup, x: number, y: number, height: number, angle: number) {
  const frame = pickup.frame(angle);
  if (!frame) return;
  const pixel = height / pickup.rows;
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(frame, x - (frame.width * pixel) / 2, y - height / 2, frame.width * pixel, height);
  context.restore();
}

// NJZ rabbit light stick, traced from the supplied collectible art.
// o outline, w white, s shade, k eye, g ring.
const RABBIT_ROWS = [
  '..ooo......ooo..',
  '.owwwo....owwso.',
  'owwwwwo..owwwwso',
  'owwwwwo..owwwwso',
  'owwwwwo..owwwwso',
  'owwwwwwooowwwwso',
  'owwwwwwwowwwwwso',
  'owwwwwwwwwwwwwso',
  'owwwwwwwwwwwwwso',
  'owwwkkwwwwkkwwso',
  'owwwkkwwwwkkwwso',
  'owwwwwwwwwwwwwso',
  'owwwwwwwwwwwwsso',
  '.owwwwwwwwwwsso.',
  '..osswwwwwssso..',
  '...oooowwsooo...',
  '......owwso.....',
  '......owwso.....',
  '......owwso.....',
  '......owwso.....',
  '......owwso.....',
  '......owwso.....',
  '......owwso.....',
  '.....oooooo.....',
  '.....oggggo.....',
  '.....oooooo.....',
];
const RABBIT_PALETTE: Palette = { o: '#272a58', w: '#e4e9fb', s: '#a3aedb', k: '#1c1834', g: '#c2cbec' };
const RABBIT_PICKUP = spinningPickup(RABBIT_ROWS, RABBIT_PALETTE, 2.5);

/** Rabbit light stick centered on (x, y), floating and slowly spinning. */
export function drawCollectible(context: CanvasRenderingContext2D, x: number, y: number, drawHeight: number, now = 0) {
  // A still preview (now = 0) shows the face, not a random spin phase.
  drawSpinning(context, RABBIT_PICKUP, x, y + hover(now, x, 3), drawHeight, now ? now / 760 + x * 0.004 : 0);
}

// Heart that restores one life, the same heart as the HUD lives, traced from
// the classic parametric heart on a fine 19×16 grid: a deep notch, smooth
// flanks and a one-pixel outline matching the other sprites.
// o outline, f fill, d shade, h highlight, w glint.
const HEART_ROWS = [
  '...oooo.....oooo...',
  '.oohhhho...offffoo.',
  '.ohhhhhho.offffffo.',
  'ohhwwhffo.offfffffo',
  'ohhwhffffofffffffdo',
  'ohhhfffffffffffffdo',
  '.ohfffffffffffffdo.',
  '.offfffffffffffddo.',
  '..offfffffffffddo..',
  '...offfffffffddo...',
  '....offfffffddo....',
  '.....offffffdo.....',
  '......offffdo......',
  '.......offdo.......',
  '........odo........',
  '.........o.........',
];
const HEART_PALETTE: Palette = { o: '#4a1838', f: '#ef6a7d', d: '#b8405a', h: '#ff9fb0', w: '#fff0f4' };
const HEART_PICKUP = spinningPickup(HEART_ROWS, HEART_PALETTE, 4);

/** Healing heart centered on (x, y), floating and spinning a little faster. */
export function drawHeartPickup(context: CanvasRenderingContext2D, x: number, y: number, drawHeight: number, now = 0) {
  drawSpinning(context, HEART_PICKUP, x, y + hover(now, x + 40, 4), drawHeight, now ? now / 520 + x * 0.004 : 0);
}

// Rainbow sunflower: picking it up starts the 10-second invincible mode.
// A-L are the twelve petal colours clockwise from the top, w face, o outline,
// r/v eyes, m mouth, b mouth line. SUNFLOWER_ICON is the small HUD version.
export const SUNFLOWER_PALETTE: Palette = {
  A: '#b04fa0',
  B: '#ef5d9b',
  C: '#ee5c3c',
  D: '#f2984c',
  E: '#f6c955',
  F: '#fbf05a',
  G: '#a8d35a',
  H: '#4aa860',
  I: '#46aaa6',
  J: '#4fb2ea',
  K: '#3a7fc6',
  L: '#55449a',
  o: '#1a1430',
  w: '#ffffff',
  m: '#f07fb0',
  b: '#3a55b0',
  r: '#d83a3a',
  v: '#45c07a',
};
export const SUNFLOWER_ROWS = [
  '.........ooo.........',
  '.....ooooAAAoooo.....',
  '....oLLoAAAAoBBBo....',
  '....oLLLoAAoBBBBo....',
  '..ooLLLLoAAoBBBoCoo..',
  '.oKKoLLLLoooBBoCCCCo.',
  '.oKKKoLoowwwooCCCCCo.',
  '.oKKKKowwwwwwwoCCCoo.',
  '.ooKKKowrwwwvwoCooDo.',
  'oJJooowwrwwwvwwoDDDDo',
  'oJJJJowwwwwwwwwoDDDDo',
  'oJJJJowbbbbbbbwoooDDo',
  '.oJooIobmmmmmboEEEoo.',
  '.ooIIIowbmmmbwoEEEEo.',
  '.oIIIIIoobbbooooEEEo.',
  '.oIIIIoHHoooFFFFoEEo.',
  '..ooIoHHHoGGoFFFFoo..',
  '....oHHHHoGGoFFFo....',
  '....oHHHoGGGGoFFo....',
  '.....ooooGGGoooo.....',
  '.........ooo.........',
];
export const SUNFLOWER_ICON = [
  '...ooooo...',
  '..oLAAABo..',
  '.oLLLABBCo.',
  'oKKLoooCCCo',
  'oJKoowooCDo',
  'oJJowwwoDDo',
  'oJIommmoEDo',
  'oIIIoooEEEo',
  '.oIHHGFFFo.',
  '..oHGGGFo..',
  '...ooooo...',
];
const SUNFLOWER_SPRITE = makeSprite(SUNFLOWER_ROWS, SUNFLOWER_PALETTE);
const SPARKLE_COLORS = ['#fff3a1', '#ffffff', '#ff9fd0', '#9fe7ff'];

/** Sunflower centered on (x, y): floats, breathes, and is ringed by twinkles. */
export function drawSunflower(context: CanvasRenderingContext2D, x: number, y: number, drawHeight: number, now = 0) {
  const sprite = SUNFLOWER_SPRITE();
  if (!sprite) return;
  const pulse = 1 + Math.sin(now / 260) * 0.06;
  const size = drawHeight * pulse;
  const cy = y + hover(now, x + 80, 5);
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(sprite, x - size / 2, cy - size / 2, size, size);
  // Four twinkling plus-shaped sparkles circling the flower.
  const unit = drawHeight / sprite.height;
  for (let index = 0; index < 4; index += 1) {
    const angle = now / 900 + (index * Math.PI) / 2;
    const reach = drawHeight * 0.68;
    const sx = Math.round((x + Math.cos(angle) * reach) / unit) * unit;
    const sy = Math.round((cy + Math.sin(angle) * reach) / unit) * unit;
    const on = Math.sin(now / 140 + index * 1.7) > -0.2;
    if (!on) continue;
    context.fillStyle = SPARKLE_COLORS[index];
    context.fillRect(sx - unit / 2, sy - unit * 1.5, unit, unit * 3);
    context.fillRect(sx - unit * 1.5, sy - unit / 2, unit * 3, unit);
  }
  context.restore();
}

// Member transform tokens: each member's plush mascot head (generated from the
// user's plush / sketch references, then cleaned up) on a 31-wide grid. Faces
// narrow toward the chin (no chubby cheeks); whiskers start just inside the
// face and stick out past its edge:
// o outline, l/f/d light/base/dark fur, i ear (where it is outlined apart from
// the face), s embroidered stitches (the member's two letters, the centre line
// and the ω mouth), w whisker tips outside the face.
// Order matches the SQUAD roster in FlightGame: Blue, Green, Pink, Yellow, Purple.
export const MEMBER_TOKENS = [
  {
    // blue: MJ, bear
    palette: {o: '#142057', l: '#a7c6f7', f: '#7aa4ea', d: '#557fcc', i: '#6b95de', s: '#eef4ff'} as Palette,
    rows: [
      '.......oooo.........oooo.......',
      '......ollldo.......ollldo......',
      '.....olffffdo.....olffffdo.....',
      '.....olfffffdooooolfffffdo.....',
      '.....olfffffflllllffffffdo.....',
      '.....olfffffffffffffffffdo.....',
      '.....odfffffffffffffffffdo.....',
      '......olfffffffffffffffdo......',
      '.....olfsfffsffsfffsffffdo.....',
      '.....olfssfssffsfffsffffdo.....',
      '.....olfsfsfsffsfffsffffdo.....',
      '.....olfsfffsffsfsfsffffdo.....',
      '.....olfsfffsffsffsfffffdo.....',
      '.....olffffffffsffffffffdo.....',
      '.....odfffsfffsfsfffsfffdo.....',
      '......olfffsssfffsssfffdo......',
      '......odfffffffffffffffdo......',
      '.......odfffffffffffffdo.......',
      '........oddfffffffffddo........',
      '.........oodddddddddoo.........',
      '...........ooooooooo...........',
    ],
  },
  {
    // green: HR, cat
    palette: {o: '#14481f', l: '#96f2a0', f: '#55d866', d: '#36ae4a', i: '#48c45a', s: '#1d7a30', w: '#b8f8bf'} as Palette,
    rows: [
      '.......o...............o.......',
      '.......oo.............oo.......',
      '.......odo...........odo.......',
      '......olfdo.........olfdo......',
      '......olffdooooooooolffdo......',
      '......olffflllllllllfffdo......',
      '......olfffffffffffffffdo......',
      '......olfffffffffffffffdo......',
      '......olfffffffffffffffdo......',
      '......olfsffsffsfsssfffdo......',
      '.....olffsffsffsfsffsfffdo.....',
      '.....olffssssffsfsssffffdo.....',
      '..wwwwsffsffsffsfsfsffffswwww..',
      '.....olffsffsffsfsffsfffdo.....',
      '..wwwwsffffffffsffffffffswwww..',
      '......olffsfffsfsfffsffdo......',
      '...wwwwsfffsssfffsssfffswwww...',
      '.......odfffffffffffffdo.......',
      '........odfffffffffffdo........',
      '.........oddfffffffddo.........',
      '..........oodddddddoo..........',
      '............ooooooo............',
    ],
  },
  {
    // pink: HN, round-eared cat
    palette: {o: '#5a1f4a', l: '#ffb2e2', f: '#f283cc', d: '#cf5fa9', i: '#e070ba', s: '#ffe0f4', w: '#ffe0f4'} as Palette,
    rows: [
      '......ooo....ooooo....ooo......',
      '.....olddoooolllldoooodddo.....',
      '....oldoollllfffffllldooddo....',
      '....odollfffffffffffffldodo....',
      '.....oolfffffffffffffffdoo.....',
      '......olfffffffffffffffdo......',
      '......olfsffsffsfsffsffdo......',
      '.....olffsffsffsfssfsfffdo.....',
      '.....olffssssffsfsfssfffdo.....',
      '..wwwwsffsffsffsfsffsfffswwww..',
      '.....olffsffsffsfsffsfffdo.....',
      '..wwwwsffffffffsffffffffswwww..',
      '......olffsfffsfsfffsffdo......',
      '...wwwwsfffsssfffsssfffswwww...',
      '.......odfffffffffffffdo.......',
      '........odfffffffffffdo........',
      '.........oddfffffffddo.........',
      '..........oodddddddoo..........',
      '............ooooooo............',
    ],
  },
  {
    // yellow: DN, floppy-eared dog
    palette: {o: '#6a4a12', l: '#fff3a0', f: '#f7dc55', d: '#d8b532', i: '#e8c845', s: '#e8902a'} as Palette,
    rows: [
      '........oo...........oo........',
      '......ooldoo.......ooldoo......',
      '.....olliido.......oliildo.....',
      '....oliiiidoooooooooliiiido....',
      '...oliiiiidolllllldodiiiiido...',
      '...odiiiidolfffffffdodiiiido...',
      '....oddddolfffffffffdoddddo....',
      '.....oooosssfffsfsffsdoooo.....',
      '.....olllsffsffsfssfsflldo.....',
      '.....olffsffsffsfsfssfffdo.....',
      '.....olffsffsffsfsffsfffdo.....',
      '.....olffsssfffsfsffsfffdo.....',
      '.....olffffffffsffffffffdo.....',
      '.....odfffsfffsfsfffsfffdo.....',
      '......olfffsssfffsssfffdo......',
      '......odfffffffffffffffdo......',
      '.......odfffffffffffffdo.......',
      '.......ooddfffffffffddoo.......',
      '.........oodddddddddoo.........',
      '...........ooooooooo...........',
    ],
  },
  {
    // purple: HI, mouse
    palette: {o: '#4a1a5a', l: '#f0a8fb', f: '#d670ea', d: '#ab4ec6', i: '#c260da', s: '#fae0ff', w: '#fae0ff'} as Palette,
    rows: [
      '.......ooo...........ooo.......',
      '.....oolldoo.......oolldoo.....',
      '....olliiildo.....olliiildo....',
      '....oliiiiido.....oliiiiido....',
      '....oliiiiddo.....oddiiiido....',
      '....oliiidooooooooooodiiido....',
      '....oliidolllllllllldodiido....',
      '....odddolfffffffffffdodddo....',
      '.....ooolfffffffffffffdooo.....',
      '.......olsffsffsfsssffdo.......',
      '......olfsffsffsffsffffdo......',
      '......olfssssffsffsffffdo......',
      '...wwwwsfsffsffsffsffffswwww...',
      '......olfsffsffsfsssfffdo......',
      '...wwwwsfffffffsfffffffswwww...',
      '......olffsfffsfsfffsffdo......',
      '...wwwwsfffsssfffsssfffswwww...',
      '.......odfffffffffffffdo.......',
      '........odfffffffffffdo........',
      '.........oddfffffffddo.........',
      '..........oodddddddoo..........',
      '............ooooooo............',
    ],
  },
];
const MEMBER_TOKEN_SPRITES = MEMBER_TOKENS.map((token) => makeSprite(token.rows, token.palette));
/** Rows in the tallest token, so every head is drawn at the same pixel size. */
const MEMBER_TOKEN_ROWS = Math.max(...MEMBER_TOKENS.map((token) => token.rows.length));

/** A member's head floating and breathing, with sparkles in her colour. */
export function drawMemberToken(context: CanvasRenderingContext2D, member: number, x: number, y: number, drawHeight: number, now = 0) {
  const sprite = MEMBER_TOKEN_SPRITES[member]?.();
  if (!sprite) return;
  const unit = (drawHeight / MEMBER_TOKEN_ROWS) * (1 + Math.sin(now / 300 + member) * 0.05);
  const cy = y + hover(now, x + 40, 5);
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(sprite, x - (sprite.width * unit) / 2, cy - (sprite.height * unit) / 2, sprite.width * unit, sprite.height * unit);
  const pixel = drawHeight / MEMBER_TOKEN_ROWS;
  const colors = ['#ffffff', MEMBER_TOKENS[member].palette.l];
  for (let index = 0; index < 3; index += 1) {
    const angle = now / 1100 + (index * Math.PI * 2) / 3;
    const reach = drawHeight * 0.7;
    const sx = Math.round((x + Math.cos(angle) * reach) / pixel) * pixel;
    const sy = Math.round((cy + Math.sin(angle) * reach) / pixel) * pixel;
    if (Math.sin(now / 150 + index * 2.1) < -0.2) continue;
    context.fillStyle = colors[index % 2];
    context.fillRect(sx - pixel / 2, sy - pixel * 1.5, pixel, pixel * 3);
    context.fillRect(sx - pixel * 1.5, sy - pixel / 2, pixel * 3, pixel);
  }
  context.restore();
}

// Ending title: big pixel "CLEAR!", white with a blue outline and a deep
// shadow, each letter bobbing slightly out of step, with a few twinkles.
const NJZ_GLYPHS = [
  ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
];
const NJZ_CELL = 14;
const NJZ_GAP = 1;

export function drawEndingTitle(context: CanvasRenderingContext2D, centerX: number, centerY: number, now = 0) {
  const letterWidth = 5 * NJZ_CELL;
  const total = NJZ_GLYPHS.length * letterWidth + (NJZ_GLYPHS.length - 1) * NJZ_GAP * NJZ_CELL;
  const left = centerX - total / 2;
  const cell = NJZ_CELL;
  const pad = 4;
  context.save();
  const layers: Array<[string, number, number]> = [['#151c4a', 6, pad], ['#5d78d6', 0, pad], ['#f6f8ff', 0, 0]];
  layers.forEach(([color, offset, grow]) => {
    context.fillStyle = color;
    NJZ_GLYPHS.forEach((glyph, letter) => {
      const x0 = left + letter * (letterWidth + NJZ_GAP * cell);
      const y0 = centerY - (glyph.length * cell) / 2 + Math.round(Math.sin(now / 420 + letter * 1.1) * 2) * 3;
      glyph.forEach((row, y) => [...row].forEach((filled, x) => {
        if (filled !== '#') return;
        context.fillRect(x0 + x * cell - grow + offset, y0 + y * cell - grow + offset, cell + grow * 2, cell + grow * 2);
      }));
    });
  });
  // Soft highlight on the top edge of each stroke cell.
  context.fillStyle = '#ffffff';
  NJZ_GLYPHS.forEach((glyph, letter) => {
    const x0 = left + letter * (letterWidth + NJZ_GAP * cell);
    const y0 = centerY - (glyph.length * cell) / 2 + Math.round(Math.sin(now / 420 + letter * 1.1) * 2) * 3;
    glyph.forEach((row, y) => [...row].forEach((filled, x) => {
      if (filled === '#' && (y === 0 || glyph[y - 1][x] !== '#')) context.fillRect(x0 + x * cell, y0 + y * cell, cell, 3);
    }));
  });
  for (let index = 0; index < 5; index += 1) {
    if (Math.sin(now / 170 + index * 2.3) < 0.1) continue;
    const sx = Math.round((left - 30 + ((index * 97) % (total + 60))) / 3) * 3;
    const sy = Math.round((centerY - 70 + ((index * 53) % 140)) / 3) * 3;
    context.fillStyle = SPARKLE_COLORS[index % SPARKLE_COLORS.length];
    context.fillRect(sx - 1.5, sy - 6, 3, 12);
    context.fillRect(sx - 6, sy - 1.5, 12, 3);
  }
  context.restore();
}
