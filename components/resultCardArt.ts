import skylineUrl from '../assets/result-card-skyline.webp';
import cloudsUrl from '../assets/result-card-clouds.webp';
import gradientUrl from '../assets/result-card-gradient.webp';
import { SQUAD } from './flightMembers';
import { digitsWidth, DIGIT_GLYPHS } from './pixelDigits';
import { RESULT_LAND_MS, RESULT_TALLY_MS, resultTallyAt, resultTitle, type ResultRecord, type ResultTally } from './resultTally';

const STICK = ['.o...o.', 'owo.owo', 'owwowwo', 'owkwkwo', 'owwwwwo', '.owwwo.', '..owo..', '..owo..', '..ooo..'];
const PIG = ['.oo...oo.', 'oppoooppo', 'opppppppo', 'opkpppkpo', 'oppnnnnpo', 'oppnhnhpo', 'opppppppo', '.ooooooo.'];
const MUSIC = ['.....##..', '...####..', '...#..#..', '...#..#..', '.###.##..', '###.###..', '.##..#...'];
const ICON_COLORS: Record<string, string> = { o: '#9faed5', w: '#f6f7ff', k: '#253258', p: '#e8a7c7', n: '#dc8bad', h: '#8b476c', '#': '#a9bfe9' };
type Sprite = { image: HTMLImageElement; x: number; y: number; width: number; height: number };
type ResultAssets = { sky: HTMLImageElement; members: Sprite[][]; clouds: HTMLImageElement; gradient: HTMLImageElement };
let prepared: Promise<ResultAssets> | undefined;
export const RESULT_MODAL_WIDTH = 760;
export const RESULT_MODAL_HEIGHT = 360;
/** Content is arranged first: the full block occupies y=36–324, centred at 180. */
export const RESULT_MODAL_CONTENT = {
  right: 720,
  titleTop: 36,
  scoreLabelTop: 84,
  scoreTop: 110,
  statIconTop: 200,
  statLabelTop: 202,
  statValueTop: 230,
  actionsTop: 280,
} as const;
export type ResultTexturePosition = 'top' | 'bottom';
const modalBackdrops = new WeakMap<HTMLImageElement, Partial<Record<ResultTexturePosition, HTMLCanvasElement>>>();
const portraitBackdrops = new WeakMap<HTMLImageElement, Partial<Record<ResultTexturePosition, HTMLCanvasElement>>>();

/** Both Canvas and the DOM return link use the title's visible centre. */
export function measureResultModalTitle(context: CanvasRenderingContext2D, failed: boolean) {
  const value = resultTitle(failed), size = failed ? 26 : 30;
  context.font = `${size}px NJZPixelZh`;
  const metrics = context.measureText(value);
  return { value, size, centerY: RESULT_MODAL_CONTENT.titleTop + (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 2 };
}

async function loadImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function cropSprite(image: HTMLImageElement): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let x0 = image.width, y0 = image.height, x1 = 0, y1 = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (pixels[(y * image.width + x) * 4 + 3]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return { image, x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Original member frames and scenery shared by the modal and 3:4 share image. */
export function prepareResultCard() {
  if (!prepared) prepared = Promise.all([
    loadImage(skylineUrl),
    Promise.all(SQUAD.map(member => Promise.all(member.frames.map(async url => cropSprite(await loadImage(url)))))),
    document.fonts.load('36px NJZPixelZh'),
    loadImage(cloudsUrl),
    loadImage(gradientUrl),
  ]).then(([sky, members, , clouds, gradient]) => ({ sky, members, clouds, gradient })).catch(error => { prepared = undefined; throw error; });
  return prepared;
}

function text(context: CanvasRenderingContext2D, value: string, x: number, top: number, size: number, color: string | CanvasGradient, align: CanvasTextAlign = 'center') {
  context.font = `${size}px NJZPixelZh`;
  context.textAlign = align;
  context.textBaseline = 'alphabetic';
  const ink = context.measureText(value);
  context.fillStyle = color;
  context.fillText(value, x, top + ink.actualBoundingBoxAscent);
}

function digits(context: CanvasRenderingContext2D, value: string, cx: number, top: number, height: number, color: string, pop: number) {
  context.save();
  context.translate(cx, top + height / 2);
  context.scale(pop, pop);
  const x = -digitsWidth(value, height) / 2;
  if (color === 'gold') {
    const gradient = context.createLinearGradient(0, -height / 2, 0, height / 2);
    gradient.addColorStop(0, '#fff3cf'); gradient.addColorStop(1, '#ffdb99');
    context.fillStyle = gradient;
  } else context.fillStyle = color;
  for (const [index, character] of [...value].entries()) for (const [a, b, w, h] of DIGIT_GLYPHS[character] ?? []) {
    const u = height / 20;
    const left = Math.round(x + (index * 15 + a) * u), y = Math.round(-height / 2 + b * u);
    context.fillRect(left, y, Math.round(x + (index * 15 + a + w) * u) - left, Math.round(-height / 2 + (b + h) * u) - y);
  }
  context.restore();
}

/** Mix neighbouring sky colours with crisp, ordered pixels instead of blur. */
function pixelSkyTransition(context: CanvasRenderingContext2D, gradient: HTMLImageElement,
  width: number, height: number, top: number, bottom: number, scenery?: HTMLImageElement) {
  const strip = document.createElement('canvas');
  strip.width = 1; strip.height = height;
  const sample = strip.getContext('2d')!;
  sample.drawImage(gradient, 0, 0, 1, strip.height);
  const pixels = sample.getImageData(0, 0, 1, strip.height).data;
  const colors = [top, bottom].map(y => {
    const offset = Math.min(y, strip.height - 1) * 4;
    return `rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`;
  });
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const cell = 2;
  // Preserve every original cloud, building, snow and star pixel. Only the
  // clear sky matching the source colour profile may receive the texture.
  let scenePixels: Uint8ClampedArray | undefined;
  if (scenery) {
    const scene = document.createElement('canvas'); scene.width = width; scene.height = height;
    const sceneContext = scene.getContext('2d')!;
    sceneContext.imageSmoothingEnabled = false;
    sceneContext.drawImage(scenery, 0, 0, width, height);
    scenePixels = sceneContext.getImageData(0, 0, width, height).data;
  }
  context.save();
  context.globalAlpha = .5;
  for (let y = top; y < bottom; y += cell) {
    const amount = (y + cell / 2 - top) / (bottom - top);
    for (let x = 0; x < width; x += cell) {
      const lighter = amount > (bayer[(y / cell) % 4][(x / cell) % 4] + .5) / 16;
      context.fillStyle = colors[lighter ? 1 : 0];
      if (!scenePixels) {
        context.fillRect(x, y, cell, cell);
      } else {
        for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) {
          const p = ((y + dy) * width + x + dx) * 4, s = (y + dy) * 4;
          if ([0, 1, 2].every(channel => Math.abs(scenePixels![p + channel] - pixels[s + channel]) <= 6)) {
            context.fillRect(x + dx, y + dy, 1, 1);
          }
        }
      }
    }
  }
  context.restore();
}

/** Static decoration has its own cached bottom layer and never changes layout. */
function modalBackdrop(clouds: HTMLImageElement, gradient: HTMLImageElement, texture: ResultTexturePosition) {
  const variants = modalBackdrops.get(gradient) ?? {};
  if (variants[texture]) return variants[texture];
  const canvas = document.createElement('canvas');
  canvas.width = RESULT_MODAL_WIDTH * 2;
  canvas.height = RESULT_MODAL_HEIGHT * 2;
  const context = canvas.getContext('2d')!;
  const w = RESULT_MODAL_WIDTH, h = RESULT_MODAL_HEIGHT;
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.imageSmoothingEnabled = false;
  context.save();
  context.beginPath();
  const corners = [[10, 0], [w - 10, 0], [w - 10, 2], [w - 4, 2], [w - 4, 4], [w - 2, 4], [w - 2, 10], [w, 10],
    [w, h - 10], [w - 2, h - 10], [w - 2, h - 4], [w - 4, h - 4], [w - 4, h - 2], [w - 10, h - 2], [w - 10, h],
    [10, h], [10, h - 2], [4, h - 2], [4, h - 4], [2, h - 4], [2, h - 10], [0, h - 10], [0, 10], [2, 10], [2, 4], [4, 4], [4, 2], [10, 2]];
  corners.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath(); context.clip();
  // Exact vertical sky profile extracted from the approved sharing artwork.
  context.drawImage(gradient, 0, 0, w, h);
  pixelSkyTransition(context, gradient, w, h, texture === 'top' ? 0 : 220, texture === 'top' ? 140 : 360);
  // Decoration fills only the space left by the centred content. This cached
  // background is always painted below every member, label, digit and button.
  context.drawImage(clouds, 620, 0, 460, 160, 193, 20, 120, 42);
  // Let the right cloud drift beyond the panel; the outline clip trims it.
  context.drawImage(clouds, 620, 0, 460, 160, 625, 101, 165, 57);
  context.fillStyle = '#d1e7ff';
  for (const [x, y] of [[36, 142], [51, 279], [251, 81], [265, 266], [67, 323], [285, 39]]) context.fillRect(x, y, 1, 1);

  // A single fine edge follows every pixel step; the lower edge is quieter.
  context.strokeStyle = '#bfd9fa'; context.lineWidth = 2;
  context.beginPath(); corners.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath(); context.stroke();
  context.fillStyle = '#e0efff80'; context.fillRect(12, 2, w - 24, 1);
  context.restore();
  variants[texture] = canvas;
  modalBackdrops.set(gradient, variants);
  return canvas;
}

function portraitBackdrop(assets: ResultAssets, texture: ResultTexturePosition) {
  const variants = portraitBackdrops.get(assets.sky) ?? {};
  if (variants[texture]) return variants[texture];
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1600;
  const context = canvas.getContext('2d')!;
  context.setTransform(2, 0, 0, 2, 0, 0); context.imageSmoothingEnabled = false;
  context.drawImage(assets.sky, 0, 0, 600, 800);
  pixelSkyTransition(context, assets.gradient, 600, 800, texture === 'top' ? 0 : 440, texture === 'top' ? 252 : 680, assets.sky);
  variants[texture] = canvas;
  portraitBackdrops.set(assets.sky, variants);
  return canvas;
}

/** Landscape stage result. The portrait drawing below is reserved for sharing. */
export function drawResultModal(canvas: HTMLCanvasElement, assets: ResultAssets, record: ResultRecord, values: ResultTally, elapsed: number, texture: ResultTexturePosition = 'top') {
  const context = canvas.getContext('2d')!;
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, RESULT_MODAL_WIDTH, RESULT_MODAL_HEIGHT);
  context.drawImage(modalBackdrop(assets.clouds, assets.gradient, texture), 0, 0, RESULT_MODAL_WIDTH, RESULT_MODAL_HEIGHT);
  const layout = RESULT_MODAL_CONTENT;
  const lead = Math.min(4, Math.max(0, Math.floor(record.leadMember)));
  const others = [0, 2, 3, 4, 1].filter(member => member !== lead);
  const members = [lead, ...others];
  const positions = [[226, 181, 69], [158, 144, 61], [158, 218, 61], [90, 108, 58], [90, 254, 58]];
  // Back to front makes a compact arrow, with only a moderate size difference.
  for (const index of [4, 3, 2, 1, 0]) {
    const member = members[index], sprite = assets.members[member][Math.floor(elapsed / 110 + member * 2) % 5];
    const [cx, cy, height] = positions[index], width = Math.round(sprite.width * height / sprite.height);
    const bob = Math.sin(elapsed / 820) * 2 + Math.sin(elapsed / 900 + index) * .65;
    context.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height,
      Math.round(cx - width / 2), Math.round(cy + bob - height / 2), width, height);
  }
  for (const [index, [x, y]] of [[49, 191], [244, 109], [219, 279]].entries()) {
    context.globalAlpha = .55 + .45 * Math.sin(elapsed / 800 + index) ** 2;
    context.fillStyle = '#dfedff'; context.fillRect(x - 1, y - 3, 2, 6); context.fillRect(x - 3, y - 1, 6, 2);
  }
  context.globalAlpha = 1;

  const { value: title, size: titleSize } = measureResultModalTitle(context, record.failed);
  const titleInk = context.createLinearGradient(0, layout.titleTop, 0, layout.titleTop + 32);
  titleInk.addColorStop(0, '#ffffff'); titleInk.addColorStop(1, '#d8edff');
  context.save();
  context.shadowColor = '#183269'; context.shadowOffsetY = 3;
  text(context, title, 338, layout.titleTop, titleSize, titleInk, 'left');
  context.restore();
  text(context, '总分', 340, layout.scoreLabelTop, 13, '#d2e5ff', 'left');
  const popTime = (elapsed - RESULT_TALLY_MS) / RESULT_LAND_MS;
  const pop = popTime >= 0 && popTime < 1 ? 1 + .08 * Math.sin(popTime * Math.PI) * (1 - popTime) : 1;
  const score = String(values.score).padStart(5, '0');
  const scoreHeight = Math.min(54, 370 * 20 / (score.length * 15 - 3));
  digits(context, score, 340 + digitsWidth(score, scoreHeight) / 2, layout.scoreTop, scoreHeight, 'gold', pop);
  [STICK, PIG, MUSIC].forEach((rows, index) => {
    const x = 340 + index * 130;
    rows.forEach((row, y) => [...row].forEach((cell, column) => {
      if (cell !== '.') { context.fillStyle = ICON_COLORS[cell]; context.fillRect(x + column * 2, layout.statIconTop + y * 2, 2, 2); }
    }));
    text(context, ['应援棒', '暴击方猪', '歌曲完成'][index], x + 25, layout.statLabelTop, 13, '#c6dbf7', 'left');
    const value = [String(values.sticks), String(values.pigs), `${values.percent}%`][index];
    const height = Math.min(28, 114 * 20 / (value.length * 15 - 3));
    digits(context, value, x + digitsWidth(value, height) / 2, layout.statValueTop, height, '#f5f9ff', pop);
  });
}

export function drawResultCard(canvas: HTMLCanvasElement, assets: ResultAssets, record: ResultRecord, values: ResultTally, elapsed: number, animate = true, texture: ResultTexturePosition = 'top') {
  const context = canvas.getContext('2d')!;
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(portraitBackdrop(assets, texture), 0, 0, 600, 800);
  const title = resultTitle(record.failed), titleSize = 36;
  const ink = context.createLinearGradient(0, 108, 0, 148);
  ink.addColorStop(0, '#ffffff'); ink.addColorStop(1, '#d6edff');
  context.save();
  context.font = `${titleSize}px NJZPixelZh`;
  context.textAlign = 'center';
  const titleY = 108 + context.measureText(title).actualBoundingBoxAscent;
  context.lineWidth = 2;
  context.strokeStyle = '#233a69'; context.strokeText(title, 300, titleY + 3);
  context.strokeStyle = '#416597'; context.strokeText(title, 300, titleY);
  context.fillStyle = ink; context.fillText(title, 300, titleY);
  context.restore();
  const order = [0, 2, 1, 3, 4], lead = Math.min(4, Math.max(0, Math.floor(record.leadMember)));
  const swap = order.indexOf(lead); [order[swap], order[2]] = [order[2], order[swap]];
  order.forEach((member, index) => {
    const frame = animate ? Math.floor(elapsed / 110 + member * 2) % 5 : 0;
    const sprite = assets.members[member][frame];
    const height = Math.round((index === 2 ? 110 : 94) * .78);
    const width = Math.round(sprite.width * height / sprite.height);
    const bob = animate ? Math.sin(elapsed / 800 + index * .8) * 2 : 0;
    const cx = 100 + index * 100, cy = [253, 216, 202, 216, 253][index] + bob;
    context.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height, Math.round(cx - width / 2), Math.round(cy - height / 2), width, height);
  });
  for (const [index, [x, y]] of [[54, 205], [546, 205], [166, 254], [434, 254]].entries()) {
    context.globalAlpha = animate ? .65 + .35 * Math.sin(elapsed / 600 + index) ** 2 : 1;
    context.fillStyle = '#d9ebff'; context.fillRect(x - 1, y - 3, 2, 6); context.fillRect(x - 3, y - 1, 6, 2);
  }
  context.globalAlpha = 1;
  text(context, '总分', 300, 270, 14, '#dce9fb');
  const popTime = (elapsed - RESULT_TALLY_MS) / RESULT_LAND_MS;
  const pop = animate && popTime >= 0 && popTime < 1 ? 1 + .08 * Math.sin(popTime * Math.PI) * (1 - popTime) : 1;
  digits(context, String(values.score).padStart(5, '0'), 300, 296, 58, 'gold', pop);
  context.fillStyle = '#9ab5dc'; context.fillRect(64, 370, 226, 1); context.fillRect(310, 370, 226, 1);
  context.beginPath(); context.moveTo(300, 367); context.lineTo(303, 370); context.lineTo(300, 373); context.lineTo(297, 370); context.fill();
  [STICK, PIG, MUSIC].forEach((rows, index) => {
    const x = 136 + index * 164, left = Math.round(x - rows[0].length * 1.5);
    rows.forEach((row, y) => [...row].forEach((cell, column) => {
      if (cell !== '.') { context.fillStyle = ICON_COLORS[cell]; context.fillRect(left + column * 3, 386 + y * 3, 3, 3); }
    }));
    text(context, ['应援棒', '暴击方猪', '歌曲完成'][index], x, 419, 14, '#dce9fb');
    digits(context, [String(values.sticks), String(values.pigs), `${values.percent}%`][index], x, 445, 30, '#f8f9ff', pop);
  });
}

export async function resultCardBlob(record: ResultRecord) {
  const assets = await prepareResultCard();
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 1600;
  drawResultCard(canvas, assets, record, resultTallyAt(record, RESULT_TALLY_MS), RESULT_TALLY_MS + RESULT_LAND_MS, false);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败')), 'image/png'));
}
