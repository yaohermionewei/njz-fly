import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const transpile = (name) => ts.transpileModule(readFileSync(new URL(`../components/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
// Inline the one local import so the module loads from a data URL.
const outputText = transpile('pipeArt').replace(/import \{ nightTint \} from '\.\/nightTint';/, transpile('nightTint'));
const { rasterizePipe } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const SNOW = new Set([11, 12, 13, 14]);
const PIPE = { has: (color) => color !== 0 && !SNOW.has(color) };
const UP = 0;
const DOWN = Math.PI;
const RIGHT = Math.PI / 2;
const LEFT = -Math.PI / 2;

function columns(raster) {
  const { width, height, pixels } = raster;
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) => pixels[y * width + x]));
}

test('snow only lies on top of the pipe as one unbroken drift per column', () => {
  for (const rotation of [UP, DOWN, RIGHT, LEFT, RIGHT + 0.35, RIGHT - 0.5, 0.4, RIGHT + 1.0]) {
    for (let seed = 1; seed <= 40; seed += 1) {
      const raster = rasterizePipe({ seed, length: 140 + seed * 7, thickness: 92, rotation });
      columns(raster).forEach((column, x) => {
        const snowRows = column.flatMap((color, y) => (SNOW.has(color) ? [y] : []));
        if (!snowRows.length) return;
        const first = snowRows[0];
        const last = snowRows[snowRows.length - 1];
        assert.equal(last - first + 1, snowRows.length, `column ${x}: snow must be one piece`);
        const firstPipe = column.findIndex((color) => PIPE.has(color));
        if (firstPipe >= 0) assert.ok(first < firstPipe, `column ${x}: snow starts above the pipe`);
        assert.ok(column.slice(last + 1).every((color) => !SNOW.has(color)), 'no snow under the pipe');
      });
    }
  }
});

test('level tops are covered, steep sides stay bare', () => {
  const beam = rasterizePipe({ seed: 3, length: 280, thickness: 92, rotation: RIGHT });
  const topped = Array.from(beam.pipeTop).filter((row, x) => row >= 0 && beam.snowTop[x] >= 0).length;
  const supported = Array.from(beam.pipeTop).filter((row) => row >= 0).length;
  assert.ok(topped / supported > 0.9, 'a horizontal pipe is snowed along its whole top');

  const post = rasterizePipe({ seed: 3, length: 300, thickness: 92, rotation: UP });
  const depth = Array.from(post.snowTop).map((row, x) => (row >= 0 ? post.pipeTop[x] - row : 0));
  assert.ok(Math.max(...depth) >= 4, 'a pipe cap carries a real mound');

  const steep = rasterizePipe({ seed: 3, length: 300, thickness: 92, rotation: RIGHT + 1.2 });
  // The end faces may hold snow, but the long steep flank between them is bare.
  let bare = 0;
  let longestBare = 0;
  steep.pipeTop.forEach((row, x) => {
    bare = row >= 0 && steep.snowTop[x] < 0 ? bare + 1 : 0;
    longestBare = Math.max(longestBare, bare);
  });
  assert.ok(longestBare >= 15, 'snow slides off steep slopes');
});

test('snow is stable per pipe and varies between pipes', () => {
  const options = { seed: 127, length: 280, thickness: 92, rotation: RIGHT };
  assert.deepEqual(rasterizePipe(options).pixels, rasterizePipe(options).pixels);
  const variants = new Set(Array.from({ length: 20 }, (_, seed) => Buffer.from(rasterizePipe({ ...options, seed: seed + 1 }).snowTop.buffer).toString('base64')));
  assert.ok(variants.size >= 15);
});

test('all pipe orientations finish both ends with full-width collars, including horizontal and upright pipes', () => {
  for (const tilt of [-0.7, -0.4, -0.2, 0, 0.2, 0.3, 0.5, 0.7]) {
    for (const facing of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      for (const scale of [1, 1.5]) {
        const rotation = facing + tilt, length = 320, thickness = 92 * scale;
        const raster = rasterizePipe({ seed: 17, length, thickness, rotation });
        const ax = Math.sin(rotation), ay = -Math.cos(rotation);
        const nx = Math.cos(rotation), ny = Math.sin(rotation);
        for (const end of [-1, 1]) {
          const a = end * (length / 2 - 12);
          for (const fraction of [-0.44, -0.4, -0.2, 0, 0.2, 0.4, 0.44]) {
            const v = thickness * fraction;
            const x = Math.floor((a * ax + v * nx - raster.originX) / raster.pixelSize);
            const y = Math.floor((a * ay + v * ny - raster.originY) / raster.pixelSize);
            assert.ok(raster.pixels[y * raster.width + x] > 0, `${rotation.toFixed(2)}, ${scale}x: end ${end} has a closed collar across ${fraction}`);
          }
        }
      }
    }
  }
});
