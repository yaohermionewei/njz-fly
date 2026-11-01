import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const { outputFiles } = await build({
  stdin: { contents: "export * from './components/levelSegments'; export * from './components/phoneLayouts'; export * from './components/gameMetrics'", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const level = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const {
  BAR, SEGMENTS, SONG_TOTAL_BARS, WORLD_HEIGHT, PIPE_HIT_THICKNESS, buildSegment, createRandom, planSong,
  pipePolygon, segmentWidth, solveSegment,
} = level;

const describe = (segment, mirrored, variant) => `${segment.id}${mirrored ? ' (mirrored)' : ''} variant ${variant}`;

function assertPhoneGeometry(content, width, name) {
  assert.equal(content.entityScale, 1.5, name);
  const shapes = content.pipes.map((pipe) => {
    assert.equal(pipe.scale, 1.5, name);
    const shape = pipePolygon(pipe, pipe.x, pipe.y, level.PIPE_THICKNESS * 1.5 + 12);
    assert.ok(shape.every((point) => point.x >= 23.99 && point.x <= width - 23.99), `${name}: pipe crosses its bar`);
    return shape;
  });
  for (let a = 0; a < shapes.length; a += 1) {
    for (let b = a + 1; b < shapes.length; b += 1) {
      assert.ok(level.isPipeJunction(content.pipes, a, b) || !level.polygonsOverlap(shapes[a], shapes[b]), `${name}: enlarged pipes ${a}/${b} overlap without an authored solid junction`);
    }
  }
  for (const pig of content.pigs) {
    const support = content.pipes[pig.pipe];
    const feet = level.pigCenterY(support) + level.PIG_HEIGHT * 1.5 / 2;
    assert.ok(Math.abs(feet - (level.pipeTopY(support) - 6 * 1.5)) < 0.001, `${name}: pig floats off its snow`);
  }
}

test('all enlarged phone segment variants remain crossable, collectible and visually separate', () => {
  for (const segment of SEGMENTS) {
    for (const mirrored of segment.mirror ? [false, true] : [false]) {
      for (let variant = 0; variant < 12; variant += 1) {
        const name = describe(segment, mirrored, variant);
        const content = buildSegment(segment, mirrored, createRandom(variant * 7919 + 1), 1.5);
        const solved = solveSegment(content, segmentWidth(segment, 1.5));
        assert.ok(solved.ok, `${name}: enlarged phone route or pickup is unreachable`);
        assertPhoneGeometry(content, segmentWidth(segment, 1.5), name);
        assert.equal(typeof segment.buildPhone, 'function', `${name}: explicit phone builder`);
        assert.deepEqual(level.validatePhoneLayout(content, segmentWidth(segment, 1.5)), [], name);
      }
    }
  }
});

test('300 enlarged phone song plans chain safely with reachable powerups, hearts and morphs', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const plan = planSong(seed, 1.5);
    let entry = level.fullEntry();
    let bar = 0;
    for (const planned of plan) {
      const name = `phone seed ${seed}: ${planned.segment.id}`;
      assert.equal(planned.startBar, bar, name);
      bar += planned.segment.bars;
      assertPhoneGeometry(planned.content, segmentWidth(planned.segment, 1.5), name);
      assert.deepEqual(level.validatePhoneLayout(planned.content, segmentWidth(planned.segment, 1.5)), [], name);
      const solved = solveSegment(planned.content, segmentWidth(planned.segment, 1.5), entry);
      assert.ok(solved.ok, `${name}: cannot enter, cross or collect an item`);
      entry = solved.exit;
    }
    assert.equal(bar, SONG_TOTAL_BARS);
    for (let i = 1; i < plan.length; i++) assert.deepEqual(level.validatePhoneJoin(plan[i - 1], plan[i]), [], `phone seed ${seed}: join ${i}`);
    const coins = plan.flatMap((planned) => planned.content.coins);
    assert.equal(coins.filter((coin) => coin.role === 'power').length, 2, `phone seed ${seed}: chorus sunflowers`);
    assert.deepEqual(coins.filter((coin) => coin.role === 'morph').map((coin) => coin.member), [1, 2, 3, 4, 0, 1, 2, 3, 4], `phone seed ${seed}: member order`);
    assert.ok(new Set(plan.map((planned) => planned.segment.id)).size >= 18, `phone seed ${seed}: variety`);
  }
});

test('library has 30-40 segments covering every theme', () => {
  assert.ok(SEGMENTS.length >= 30 && SEGMENTS.length <= 40, `segment count ${SEGMENTS.length}`);
  for (const theme of ['intro', 'bonus', 'gate', 'split', 'pig', 'blocks', 'wall', 'combo']) {
    assert.ok(SEGMENTS.some((segment) => segment.theme === theme), theme);
  }
  assert.equal(new Set(SEGMENTS.map((segment) => segment.id)).size, SEGMENTS.length, 'unique ids');
});

test('phone layouts preserve stairs, waves, tilted-pipe proportions and both bunny eyes', () => {
  const phone = id => buildSegment(level.SEGMENTS_BY_ID.get(id), false, createRandom(1), 1.5);
  for (const id of ['pig-pillars']) {
    const content = phone(id);
    assert.equal(content.pipes.length, 3, `${id}: three steps`);
    assert.deepEqual(content.pigs.map(p => p.pipe), [0, 1, 2], `${id}: a pig on every step`);
    const tops = content.pipes.map(level.pipeTopY);
    for (let i = 1; i < tops.length; i++) assert.ok(tops[i - 1] - tops[i] >= 90, `${id}: substantial ascending steps`);
  }
  const parade = phone('pig-parade');
  assert.ok(parade.pipes[0].y > parade.pipes[1].y && parade.pipes[2].y > parade.pipes[1].y, 'parade restores the original high/low/high targets');
  const steps = phone('blocks-steps');
  assert.equal(steps.pipes.length, 3, 'three tilted stair posts');
  for (let i = 1; i < 3; i++) assert.ok(steps.pipes[i - 1].y - steps.pipes[i].y >= 100, 'post stairs keep their height rhythm');
  const centers = content => content.pipes.filter(p => p.anchor === 'ceiling').map(top => {
    const bottom = content.pipes.find(p => p.x === top.x && p.anchor === 'floor');
    return (top.y + top.length / 2 + bottom.y - bottom.length / 2) / 2;
  });
  for (const id of ['gate-stairs', 'combo-stairs-pig']) {
    const content = phone(id);
    // Apertures follow the full swept character and snow; their midpoints
    // need not coincide with the authored path at a bend. Test flight steps.
    const route = content.routes.find(r => r.main).points;
    const ys = content.pipes.filter(p => p.anchor === 'ceiling').map(pipe => {
      const i = route.findIndex((p, i) => i > 0 && p.x >= pipe.x);
      const a = route[i - 1], b = route[i];
      return a.y + (b.y - a.y) * (pipe.x - a.x) / (b.x - a.x);
    });
    assert.equal(ys.length, id === 'gate-stairs' ? 4 : 3, `${id}: original gate count`);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 90, `${id}: descending steps`);
  }
  assert.equal(phone('combo-stairs-pig').pigs.length, 1, 'stairs end at a shooting window');
  const tunnel = centers(phone('gate-tunnel'));
  assert.equal(tunnel.length, 7, 'seven gates in the wave tunnel');
  assert.ok(Math.max(...tunnel) - Math.min(...tunnel) >= 200, 'wave tunnel has a visible wave');
  const zipper = phone('wall-zipper');
  assert.deepEqual(zipper.pipes.map(p => p.anchor), ['ceiling', 'floor', 'ceiling']);
  const zipperY = zipper.routes[0].points.map(p => p.y);
  assert.ok(Math.max(...zipperY) - Math.min(...zipperY) >= 260, 'walls keep the large S route');
  for (const segment of SEGMENTS) {
    for (const pipe of phone(segment.id).pipes.filter(p => Math.abs(p.tilt ?? 0) > 0.01)) {
      assert.ok(pipe.length >= 160, `${segment.id}: no flattened tilted stumps`);
    }
  }
  const center = BAR * 1.5 * 1.3;
  const eyes = phone('bonus-bunny').coins.filter(c => c.y === 412 && Math.abs(c.x - center) < 200);
  assert.equal(eyes.length, 2, 'both isolated eyes remain inside the outline');
  assert.ok(eyes[0].x < center && eyes[1].x > center, 'one eye on each side');
  assert.ok(Math.abs(eyes[0].x + eyes[1].x - center * 2) < 0.001, 'eyes remain symmetric');
});

test('phone passages retain pressure and no pipe collapses into a tiny sliver', () => {
  const paired = new Set(['gate-single', 'gate-double', 'gate-stairs', 'gate-slalom', 'gate-tunnel', 'split-floors', 'combo-gate-pig', 'combo-stairs-pig', 'combo-rush']);
  for (const segment of SEGMENTS) for (const mirrored of segment.mirror ? [false, true] : [false]) {
    const c = buildSegment(segment, mirrored, createRandom(1), 1.5);
    for (const p of c.pipes) {
      const visible = p.anchor === 'ceiling' ? p.y + p.length / 2 : p.anchor === 'floor' ? WORLD_HEIGHT - p.y + p.length / 2 : p.length;
      assert.ok(visible >= (p.anchor ? 100 : level.PIPE_THICKNESS * 1.5) - 0.01, `${segment.id}: visible shaft must have real length`);
      if (p.anchor !== 'ceiling' || !paired.has(segment.id)) continue;
      const bottom = c.pipes.find(b => b.anchor === 'floor' && b.x === p.x);
      const gap = bottom.y - bottom.length / 2 - (p.y + p.length / 2);
      assert.ok(gap >= 190 && gap <= 280, `${segment.id}: ${gap} must feel like a passage and still fit the full player`);
    }
  }
  const funnel = buildSegment(level.SEGMENTS_BY_ID.get('wall-funnel'), false, createRandom(1), 1.5);
  const gaps = [0, 2, 4].map(i => funnel.pipes[i + 1].y - funnel.pipes[i + 1].length / 2 - funnel.pipes[i].y - funnel.pipes[i].length / 2);
  assert.deepEqual(gaps, [400, 290, 220], 'the funnel visibly closes down to a deliberate neck');
});

test('phone bunny proportions, central stair obstacles and scatter rewards match the refined motifs', () => {
  const phone = (id, mirrored = false) => buildSegment(level.SEGMENTS_BY_ID.get(id), mirrored, createRandom(1), 1.5);
  const head = phone('bonus-bunny').coins.filter(c => c.patternId === 'bunny');
  const xs = head.map(c => c.x), ys = head.map(c => c.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  assert.ok(width / height >= 0.9 && width / height <= 1.05, 'head follows the nearly square pickup silhouette, not a wide face');
  const center = (Math.min(...xs) + Math.max(...xs)) / 2;
  const tips = head.filter(c => c.y === Math.min(...ys));
  assert.equal(tips.length, 2, 'two distinct rounded ear tips');
  assert.ok(tips[0].x < center && tips[1].x > center);
  assert.equal(head.filter(c => c.y === 308 && Math.abs(c.x - center) < 1).length, 1, 'ear gap closes in a central V');
  assert.deepEqual(phone('blocks-steps', true).pipes.map(p => p.y), [190, 290, 390], 'mirrored stairs move down together by 100');
  for (const mirror of [false, true]) {
    for (const [id, minimum] of [['blocks-scatter', 19], ['blocks-debris', 16]]) {
      const c = phone(id, mirror);
      assert.ok(c.coins.length >= minimum, `${id}: enough feedback for a harder obstacle field`);
      for (const r of c.routes.filter(r => r.role === 'reward')) {
        assert.ok(c.coins.filter(c => c.routeId === r.id).length >= 3, `${id}: optional reward is a small collectible chain, not a single lonely stick`);
      }
      assert.deepEqual(level.validatePhoneLayout(c, segmentWidth(level.SEGMENTS_BY_ID.get(id), 1.5)), []);
    }
  }
});

test('phone corridor stem grows down into a solid junction while retaining the upper route', () => {
  const segment = level.SEGMENTS_BY_ID.get('split-corridor');
  for (const mirror of [false, true]) {
    const c = buildSegment(segment, mirror, createRandom(1), 1.5), stem = c.pipes[2], beam = c.pipes[1];
    assert.equal(stem.length, 158);
    assert.equal(mirror ? stem.y + stem.length / 2 : stem.y - stem.length / 2, mirror ? 720 - 342 : 342, 'the route-side lip stays put');
    assert.ok(level.isPipeJunction(c.pipes, 1, 2));
    assert.ok(level.pipeDrawOrder(c.pipes).indexOf(2) < level.pipeDrawOrder(c.pipes).indexOf(1), 'crossbeam covers the seated back end');
    assert.ok(level.polygonsOverlap(pipePolygon(stem), pipePolygon(beam)), 'the former unusable slit is physically closed');
    assert.ok(solveSegment(c, segmentWidth(segment, 1.5)).ok, 'inside and outside rewards still lead to an exit');
    const broken = { ...c, pipes: c.pipes.map(p => ({ ...p })) };
    broken.pipes[2].y += 20;
    assert.ok(level.validatePhoneLayout(broken, segmentWidth(segment, 1.5)).some(i => i.kind === 'pipe-junction'), 'an arbitrary overlap cannot masquerade as a valid junction');
  }
});

test('phone horizontal pipes keep full original lengths and enlarged movement preserves collection cadence', () => {
  const horizontal = content => content.pipes.filter(p => p.facing === 'left' || p.facing === 'right');
  let checked = 0;
  for (const segment of SEGMENTS) {
    const desktop = horizontal(buildSegment(segment, false, createRandom(1)));
    const phone = horizontal(buildSegment(segment, false, createRandom(1), 1.5));
    phone.forEach((pipe, i) => {
      assert.ok(desktop[i], `${segment.id}: retain the original platform`);
      assert.ok(Math.abs(pipe.length - desktop[i].length * 1.5) < 1e-7, `${segment.id}: full original length enlarged 1.5x`);
      checked++;
    });
    assert.ok(Math.abs(segmentWidth(segment, 1.5) / (level.CRUISE_SPEED * 1.5) - segmentWidth(segment) / level.CRUISE_SPEED) < 1e-9, `${segment.id}: same duration and musical bar lines`);
  }
  assert.ok(checked >= 15, 'check all platform motifs, not only the screenshot');
  const rest = level.SEGMENTS_BY_ID.get('rest-breadcrumbs');
  const original = buildSegment(rest, false, createRandom(1)).coins;
  const phone = buildSegment(rest, false, createRandom(1), 1.5).coins;
  const meanInterval = (coins, speed) => coins.slice(1).reduce((sum, c, i) => sum + (c.x - coins[i].x) / speed, 0) / (coins.length - 1);
  const cadence = meanInterval(phone, level.CRUISE_SPEED * 1.5);
  assert.ok(cadence <= meanInterval(original, level.CRUISE_SPEED) * 1.02, `phone collection interval ${cadence}: no slower than original`);
  assert.ok(Math.abs(cadence - meanInterval(original, level.CRUISE_SPEED)) < 0.02, 'rest keeps its original sparse pickup rhythm');
  const intro = buildSegment(level.SEGMENTS_BY_ID.get('intro-glide'), false, createRandom(1), 1.5).coins;
  assert.ok(meanInterval(intro, level.CRUISE_SPEED * 1.5) < 0.16, 'ordinary consecutive sticks keep the current faster rhythm');
});

test('phone opening teaches a smooth rise and fall and joins the first pipe without changing cadence', () => {
  const glide = buildSegment(level.SEGMENTS_BY_ID.get('intro-glide'), false, createRandom(1), 1.5);
  const points = glide.routes[0].points;
  const ys = glide.coins.map(c => c.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) >= 160, 'opening is visibly curved rather than level');
  assert.ok(ys.some(y => y < 290) && ys.some(y => y > 430), 'teaches both up and down');
  assert.equal(points[0].y, 360);
  const design = level.readSegmentDesign(level.SEGMENTS_BY_ID.get('intro-glide'), createRandom(1));
  assert.deepEqual(points.map(p => p.y), design.paths[0].points.map(p => p[1]), 'keep all original rises, holds and descents');
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    assert.ok(Math.abs(b.y - a.y) / (b.x - a.x) < 0.55, 'original rise and fall remain comfortable');
  }
  for (let i = 1; i < glide.coins.length; i++) {
    const before = glide.coins[i - 1], after = glide.coins[i];
    const interval = (after.x - before.x) / (level.CRUISE_SPEED * 1.5);
    assert.ok(interval > 0.14 && interval < 0.16, 'keep the current smooth consecutive-pickup rhythm');
  }
  const firstPipe = buildSegment(level.SEGMENTS_BY_ID.get('intro-first-pipe'), false, createRandom(1), 1.5);
  assert.equal(firstPipe.routes[0].points.at(-1).y, 350, 'first obstacle keeps its original approach above the pipe');
  assert.deepEqual(level.validatePhoneJoin(
    { segment: level.SEGMENTS_BY_ID.get('intro-glide'), startBar: 0, content: glide },
    { segment: level.SEGMENTS_BY_ID.get('intro-first-pipe'), startBar: 2, content: firstPipe },
  ), []);
});

test('phone adaptation preserves every original obstacle, pig, branch and route role', () => {
  for (const segment of SEGMENTS) for (const mirrored of segment.mirror ? [false, true] : [false]) {
    for (let seed = 1; seed <= 3; seed++) {
      const original = level.readSegmentDesign(segment, createRandom(seed));
      const phone = buildSegment(segment, mirrored, createRandom(seed), 1.5);
      assert.equal(phone.pipes.length, original.content.pipes.length, `${segment.id}: never delete a pipe`);
      assert.equal(phone.pigs.length, original.content.pigs.length, `${segment.id}: never delete a pig`);
      phone.pipes.forEach((pipe, i) => {
        const source = original.content.pipes[i];
        const flip = { up: 'down', down: 'up', left: 'left', right: 'right' };
        assert.equal(pipe.facing, mirrored ? flip[source.facing] : source.facing, `${segment.id}: keep pipe direction`);
        assert.ok(Math.abs((pipe.tilt ?? 0) - (source.tilt ?? 0) * (mirrored ? -1 : 1)) < 1e-9, `${segment.id}: keep tilt`);
      });
      phone.pigs.forEach((pig, i) => {
        const source = original.content.pigs[i];
        assert.equal(pig.pipe, segment.id === 'combo-gate-pig' ? 2 : source.pipe, `${segment.id}: keep its intended support`);
        assert.equal(pig.patrol, source.patrol, `${segment.id}: keep patrol behaviour`);
        assert.equal(pig.speed, source.speed, `${segment.id}: keep authored patrol speed`);
      });
      if (!segment.id.startsWith('bonus-')) {
        assert.deepEqual(phone.routes.map(r => r.sourceRole), original.paths.map(r => r.role), `${segment.id}: no branch or reward role disappears`);
      }
    }
  }
  const phone = id => buildSegment(level.SEGMENTS_BY_ID.get(id), false, createRandom(1), 1.5);
  assert.equal(phone('split-floors').pipes.length, 4, 'three floors plus the closing gate');
  assert.equal(phone('split-fork').routes.filter(r => r.role === 'guide').length, 2, 'two equal branches reunite');
  for (const id of ['blocks-scatter', 'blocks-debris']) assert.equal(phone(id).pipes.length, 6, `${id}: six varied obstacles`);
  assert.equal(phone('blocks-hook').pipes.length, 3, 'ceiling, suspended beam and floor complete the hook');
  for (const id of ['split-corridor', 'combo-cage-pig']) {
    const c = phone(id), beams = c.pipes.filter(p => ['left', 'right'].includes(p.facing));
    const inside = c.routes.find(r => r.sourceRole === 'risk').points.at(-1).y;
    const outside = c.routes.find(r => r.sourceRole === 'guide').points.at(-1).y;
    assert.ok(inside > beams[0].y + 69 && inside < beams[1].y - 69, `${id}: rewards actually run inside the tunnel`);
    assert.ok(outside > beams[1].y + 69, `${id}: separate bypass outside the tunnel`);
  }
  const grid = phone('bonus-grid').coins.filter(c => c.patternId);
  assert.equal(grid.length, 24, 'complete 4 by 6 reward grid');
  assert.equal(new Set(grid.map(c => c.x)).size, 6);
  assert.equal(new Set(grid.map(c => c.y)).size, 4);
  const funnel = phone('wall-funnel').pipes;
  const gaps = [0, 2, 4].map(i => funnel[i + 1].y - funnel[i + 1].length / 2 - funnel[i].y - funnel[i].length / 2);
  assert.ok(gaps[0] - gaps[1] >= 70 && gaps[1] - gaps[2] >= 70, 'funnel keeps its progressive squeeze');
  for (const id of ['gate-double', 'gate-stairs', 'gate-slalom', 'gate-tunnel', 'blocks-weave', 'wall-zipper', 'combo-rush']) {
    const c = phone(id);
    const blockedEvents = new Set(c.pipes.filter(p => level.polygonsOverlap(
      level.rectPolygon(p.x - level.PLAYER_HIT * 1.5 / 2, 360 - level.PLAYER_HIT * 1.5 / 2, level.PLAYER_HIT * 1.5, level.PLAYER_HIT * 1.5), level.pipePolygon(p),
    )).map(p => p.x));
    assert.ok(blockedEvents.size >= 2, `${id}: obstacles still require height changes, not only decorative curved pickups`);
  }
});

test('every segment variant is crossable without shooting and every coin is collectible', () => {
  for (const segment of SEGMENTS) {
    for (const mirrored of segment.mirror ? [false, true] : [false]) {
      for (let variant = 0; variant < 12; variant += 1) {
        const content = buildSegment(segment, mirrored, createRandom(variant * 7919 + 1));
        const result = solveSegment(content, segmentWidth(segment));
        const name = describe(segment, mirrored, variant);
        assert.ok(result.reach.at(-1).some(Boolean), `${name}: no route through`);
        assert.deepEqual(
          result.unreachableCoins.map((coin) => `${coin.role}@${Math.round(coin.x)},${Math.round(coin.y)}`),
          [],
          `${name}: unreachable coins`,
        );
      }
    }
  }
});

test('obstacles stay inside their segment so neighbours never overlap', () => {
  for (const segment of SEGMENTS) {
    const content = buildSegment(segment, false, createRandom(3));
    const width = segmentWidth(segment);
    for (const pipe of content.pipes) {
      const xs = pipePolygon(pipe).map((point) => point.x);
      assert.ok(Math.min(...xs) >= 40 && Math.max(...xs) <= width - 40, `${segment.id}: pipe at x=${pipe.x} leaves the segment`);
    }
    for (const coin of content.coins) {
      assert.ok(coin.x >= 20 && coin.x <= width - 20, `${segment.id}: coin x=${Math.round(coin.x)} outside`);
      assert.ok(coin.y >= 40 && coin.y <= WORLD_HEIGHT - 40, `${segment.id}: coin y=${Math.round(coin.y)} outside`);
    }
  }
  assert.ok(PIPE_HIT_THICKNESS > 0);
});

test('each chorus opens with one reachable sunflower', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const plan = planSong(seed);
    const flowers = plan.flatMap((planned) => planned.content.coins.filter((coin) => coin.role === 'power').map(() => planned));
    assert.deepEqual(flowers.map((planned) => planned.section).sort(), ['副歌 1', '副歌 2'], `seed ${seed}: one sunflower per chorus`);
    for (const planned of flowers) {
      const solved = solveSegment(planned.content, segmentWidth(planned.segment));
      assert.deepEqual(solved.unreachableCoins, [], `seed ${seed}: sunflower in ${planned.segment.id} is reachable`);
    }
  }
});

test('pipes in a segment never overlap each other (visual thickness)', () => {
  const { PIPE_THICKNESS, polygonsOverlap } = level;
  for (const segment of SEGMENTS) {
    for (const mirrored of segment.mirror ? [false, true] : [false]) {
      const content = buildSegment(segment, mirrored, createRandom(3));
      // Caps are wider than the shaft; a small margin keeps neighbours visibly apart.
      const shapes = content.pipes.map((pipe) => pipePolygon(pipe, pipe.x, pipe.y, PIPE_THICKNESS + 12));
      for (let a = 0; a < shapes.length; a += 1) {
        for (let b = a + 1; b < shapes.length; b += 1) {
          assert.ok(!polygonsOverlap(shapes[a], shapes[b]), `${segment.id}${mirrored ? ' (mirrored)' : ''}: pipes ${a} and ${b} overlap`);
        }
      }
    }
  }
});

test('song plans fill every bar, chain validly and stay varied', () => {
  const usage = new Map();
  for (let seed = 1; seed <= 300; seed += 1) {
    const plan = planSong(seed);
    let bar = 0;
    for (const planned of plan) {
      assert.equal(planned.startBar, bar, `seed ${seed}: gap before ${planned.segment.id}`);
      bar += planned.segment.bars;
      usage.set(planned.segment.id, (usage.get(planned.segment.id) ?? 0) + 1);
    }
    assert.equal(bar, SONG_TOTAL_BARS, `seed ${seed}: plan covers ${bar} bars`);
    for (let index = 1; index < plan.length; index += 1) {
      const a = plan[index - 1].segment;
      const b = plan[index].segment;
      if (!a.scripted && !b.scripted && a.theme !== 'bonus') assert.notEqual(a.theme, b.theme, `seed ${seed}: ${a.id} -> ${b.id}`);
    }
    const nonScripted = plan.filter((planned) => !planned.segment.scripted);
    const distinct = new Set(nonScripted.map((planned) => planned.segment.id)).size;
    assert.ok(distinct >= 18, `seed ${seed}: only ${distinct} distinct segments`);
  }
  const unused = SEGMENTS.filter((segment) => !usage.has(segment.id)).map((segment) => segment.id);
  assert.deepEqual(unused, [], 'every segment appears in some plan');
});

test('each run gets a few healing hearts: safe ones after hard stretches, risky ones on pig walkways', () => {
  let risky = 0;
  let safe = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const plan = planSong(seed);
    const hearts = plan.flatMap((planned) => planned.content.coins
      .filter((coin) => coin.role === 'heal' || coin.role === 'riskHeal')
      .map((coin) => ({ planned, coin })));
    assert.ok(hearts.length >= 3 && hearts.length <= 6, `seed ${seed}: ${hearts.length} hearts`);
    const sections = new Set(hearts.map(({ planned }) => planned.section));
    assert.equal(sections.size, hearts.length, `seed ${seed}: at most one heart per section`);
    for (const { planned, coin } of hearts) {
      if (coin.role === 'heal') {
        safe += 1;
        assert.equal(planned.segment.intensity, 0, `seed ${seed}: safe heart sits in a calm segment`);
      } else {
        risky += 1;
        assert.ok(planned.content.pigs.some((pig) => pig.patrol > 0), `seed ${seed}: risky heart sits on a pig walkway`);
      }
      const solved = solveSegment(planned.content, segmentWidth(planned.segment));
      assert.deepEqual(solved.unreachableCoins, [], `seed ${seed}: heart in ${planned.segment.id} is reachable`);
    }
  }
  assert.ok(risky > 300 && safe > 300, `risky ${risky}, safe ${safe}`);
});

test('member tokens come every 8 bars and cycle the five members in order', () => {
  const { MORPH_EVERY_BARS, MEMBER_COUNT, BAR } = level;
  for (let seed = 1; seed <= 300; seed += 1) {
    const plan = planSong(seed);
    const tokens = plan.flatMap((planned) => planned.content.coins.filter((coin) => coin.role === 'morph').map((coin) => ({ planned, coin })));
    assert.deepEqual(tokens.map(({ coin }) => coin.member), [1, 2, 3, 4, 0, 1, 2, 3, 4], `seed ${seed}: members in order`);
    tokens.forEach(({ planned, coin }, index) => {
      const bar = planned.startBar + coin.x / BAR;
      assert.ok(Math.abs(bar - (index + 1) * MORPH_EVERY_BARS) <= 2, `seed ${seed}: token ${index} at bar ${bar.toFixed(1)}`);
      const solved = solveSegment(planned.content, segmentWidth(planned.segment));
      assert.deepEqual(solved.unreachableCoins, [], `seed ${seed}: token in ${planned.segment.id} is reachable`);
    });
    assert.ok(MEMBER_COUNT === 5);
  }
});


test('default tablet and desktop layouts exactly match the pre-mobile-refactor baseline', () => {
  const segments = createHash('sha256');
  for (const segment of SEGMENTS) for (const mirrored of segment.mirror ? [false, true] : [false]) {
    for (let variant = 0; variant < 12; variant++) segments.update(JSON.stringify(buildSegment(segment, mirrored, createRandom(variant * 7919 + 1))));
  }
  assert.equal(segments.digest('hex'), 'f756325b4340635ac050a9b42130d4180abbda85df19a21a0c4399e014a25e06');
  const plans = createHash('sha256');
  for (let seed = 1; seed <= 300; seed++) plans.update(JSON.stringify(planSong(seed)));
  assert.equal(plans.digest('hex'), '1c922a979f1aea7994c2458a42b87aa11ff71f3b5b70d1b5c6fb0f6708ec2402');
});

test('phone clearance validation rejects crowding, short gaps and steep guide routes', () => {
  const base = buildSegment(level.SEGMENTS_BY_ID.get('gate-single'), false, createRandom(1), 1.5);
  const duplicate = { ...base, coins: [...base.coins, { ...base.coins[0], x: base.coins[0].x + 8 }] };
  assert.ok(level.validatePhoneLayout(duplicate, BAR * 1.5).some(issue => issue.kind === 'pickup-gap'));
  const pipeTouch = { ...base, coins: [{ x: base.pipes[0].x, y: base.pipes[0].y, role: 'guide' }] };
  assert.ok(level.validatePhoneLayout(pipeTouch, BAR * 1.5).some(issue => issue.kind === 'pickup-pipe'));
  const narrowed = { ...base, pipes: base.pipes.map(p => ({ ...p, length: p.length + 110 })) };
  assert.ok(level.validatePhoneLayout(narrowed, BAR * 1.5).some(issue => issue.kind === 'corridor'));
  const steep = { ...base, routes: [{ id: 'bad', role: 'guide', main: true, points: [{ x: 0, y: 100 }, { x: 100, y: 600 }] }] };
  assert.ok(level.validatePhoneLayout(steep, BAR * 1.5).some(issue => issue.kind === 'slope'));
});

test('phone joins follow authored exits after special-item replacement and reject blocked seams', () => {
  const segment = level.SEGMENTS_BY_ID.get('split-beam');
  const left = { segment, startBar: 0, mirrored: true, section: 'test', content: buildSegment(segment, true, createRandom(1), 1.5) };
  const rest = level.SEGMENTS_BY_ID.get('rest-breadcrumbs');
  const right = { segment: rest, startBar: 1, mirrored: false, section: 'test', content: level.phoneRestAfter(left) };
  assert.deepEqual(level.validatePhoneJoin(left, right), [], 'do not cut down early through the tail of the horizontal pipe');
  const replaced = { ...left, content: { ...left.content, coins: left.content.coins.filter(c => c.role !== 'guide') } };
  assert.deepEqual(level.phoneRestAfter(replaced).routes, right.content.routes, 'reserved special-item space does not move the route exit');
  assert.deepEqual(level.validatePhoneJoin(replaced, right), [], 'the original path survives changes in sampled pickup points');
  const blocked = { ...right, content: { ...right.content, pipes: [{ x: 80, y: right.content.routes[0].points[0].y, length: 160, facing: 'up', scale: 1.5 }] } };
  assert.ok(level.validatePhoneJoin(left, blocked).some(i => i.kind === 'join-corridor'), 'a genuine obstacle in the seam is still rejected');
});

test('phone pickup reachability excludes a pocket that cannot lead to an exit', () => {
  const coin = { x: 800, y: 150, role: 'reward' };
  const content = { entityScale: 1.5, pigs: [], coins: [coin], pipes: [
    { x: 800, y: 360, length: 1000, facing: 'right', scale: 1.5 },
    { x: 1300, y: 150, length: 420, facing: 'down', scale: 1.5 },
  ] };
  const solved = solveSegment(content, BAR * 2);
  assert.ok(solved.exit.some(Boolean), 'there is a bypass below the platform');
  assert.ok(solved.unreachableCoins.includes(coin), 'the reward in the sealed upper pocket is rejected');
});

test('phone gates remain attached and reward patterns survive special-item placement intact', () => {
  for (const segment of SEGMENTS) {
    for (const mirrored of segment.mirror ? [false, true] : [false]) {
      const content = buildSegment(segment, mirrored, createRandom(3), 1.5);
      for (const pipe of content.pipes) {
        if (pipe.anchor === 'ceiling') assert.ok(pipe.y - pipe.length / 2 <= -60 + 0.001);
        if (pipe.anchor === 'floor') assert.ok(pipe.y + pipe.length / 2 >= 780 - 0.001);
      }
    }
  }
  const plan = planSong(42, 1.5);
  for (const p of plan.filter(p => p.segment.theme === 'bonus' && p.segment.id !== 'rest-breadcrumbs')) {
    const original = buildSegment(p.segment, p.mirrored, createRandom(1), 1.5);
    if (p.segment.id === 'bonus-grid') assert.equal(p.content.coins.filter(c => c.patternId).length, 24, 'complete original 4 by 6 grid');
    else assert.deepEqual(p.content.coins.filter(c => c.patternId).sort((a, b) => a.x - b.x || a.y - b.y), original.coins.filter(c => c.patternId).sort((a, b) => a.x - b.x || a.y - b.y), `${p.segment.id}: no shape is thinned or overwritten`);
  }
});
