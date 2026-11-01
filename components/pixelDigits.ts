/**
 * Shared pixel digit font: used by the HUD (`PixelNumber`) and by score
 * pop-ups drawn on the canvas.
 */
// Boxy digits after the user's arcade reference: plain rectangles on a
// 12×20 grid (1 CSS px per unit at 20px), 3-unit strokes and square corners
// that turn sharply, with no notches. Also + × % for the HUD.
export type Box = readonly [number, number, number, number];
const TOP: Box = [0, 0, 12, 3];
const MID: Box = [0, 8, 12, 3];
const BOTTOM: Box = [0, 17, 12, 3];
const LEFT: Box = [0, 0, 3, 20];
const RIGHT: Box = [9, 0, 3, 20];
const LEFT_UP: Box = [0, 0, 3, 11];
const LEFT_DOWN: Box = [0, 8, 3, 12];
const RIGHT_UP: Box = [9, 0, 3, 11];
const RIGHT_DOWN: Box = [9, 8, 3, 12];
const step = (points: Array<[number, number]>, w: number, h: number): Box[] => points.map(([x, y]) => [x, y, w, h]);
export const DIGIT_GLYPHS: Record<string, readonly Box[]> = {
  '0': [TOP, BOTTOM, LEFT, RIGHT],
  '1': [[2, 0, 4, 3], [6, 0, 3, 20]],
  '2': [TOP, RIGHT_UP, MID, LEFT_DOWN, BOTTOM],
  '3': [TOP, [2, 8, 10, 3], BOTTOM, RIGHT],
  '4': [LEFT_UP, MID, RIGHT],
  '5': [TOP, LEFT_UP, MID, RIGHT_DOWN, BOTTOM],
  '6': [TOP, LEFT, MID, RIGHT_DOWN, BOTTOM],
  '7': [TOP, [0, 0, 3, 6], RIGHT],
  '8': [TOP, MID, BOTTOM, LEFT, RIGHT],
  '9': [TOP, LEFT_UP, MID, RIGHT, BOTTOM],
  '+': [[1, 8, 10, 3], [4.5, 3.5, 3, 10]],
  '×': step([[1, 4], [3, 6], [5, 8], [7, 10], [9, 12], [1, 12], [3, 10], [7, 6], [9, 4]], 2.5, 2.5),
  '%': [[0, 1, 4, 4], [8, 15, 4, 4], ...step([[9, 1], [7, 4.5], [5, 8], [3, 11.5], [1, 15]], 3, 3.5)],
};
export const DIGIT_WIDTH = 12;
export const DIGIT_HEIGHT = 20;
export const DIGIT_GAP = 3;


/** Draws text (digits, + × %) on a canvas, `height` tall, top-left at x, y. */
export function fillDigits(context: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, grow = 0) {
  const unit = height / DIGIT_HEIGHT;
  [...text].forEach((character, index) => {
    DIGIT_GLYPHS[character]?.forEach(([bx, by, bw, bh]) => {
      context.fillRect(x + (index * (DIGIT_WIDTH + DIGIT_GAP) + bx) * unit - grow, y + by * unit - grow, bw * unit + grow * 2, bh * unit + grow * 2);
    });
  });
}

export const digitsWidth = (text: string, height: number) => (([...text].length * (DIGIT_WIDTH + DIGIT_GAP) - DIGIT_GAP) * height) / DIGIT_HEIGHT;
