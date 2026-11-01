import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../components/frameTiming.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'esm' });
const { phoneFrameSteps } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('phone scrolling covers the same distance at 120, 60, 30, 20 and 15 fps', () => {
  for (const fps of [120, 60, 30, 20, 15]) {
    let distance = 0;
    for (let frame = 1; frame <= fps * 10; frame++) {
      for (const step of phoneFrameSteps((frame - 1) * 1000 / fps, frame * 1000 / fps)) {
        assert.ok(step.dt <= 1 / 60 + 1e-9, 'collision substep stays small');
        distance += 375 * step.dt;
      }
    }
    assert.ok(Math.abs(distance - 3750) < 1e-6, `${fps} fps: ${distance} units in ten seconds`);
  }
});

test('irregular phone frames retain elapsed time and hit-stop only freezes its own duration', () => {
  let distance = 0;
  const times = [0, 16, 71, 88, 208, 240, 410, 500];
  for (let i = 1; i < times.length; i++) for (const step of phoneFrameSteps(times[i - 1], times[i])) distance += step.dt * 375;
  assert.ok(Math.abs(distance - 187.5) < 1e-6, '500 ms with dropped frames still advances 187.5 units');
  assert.deepEqual(phoneFrameSteps(0, 40, 50), [], 'hit-stop has not ended');
  assert.ok(Math.abs(phoneFrameSteps(40, 100, 50).reduce((sum, step) => sum + step.dt, 0) - 0.05) < 1e-9, 'only the remaining 50 ms advance');
  assert.deepEqual(phoneFrameSteps(100, 100), [], 'no time is invented on the first frame');
});
