import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const { outputFiles } = await build({
  stdin: { contents: "export * from './components/levelSegments'; export * from './components/phoneLayouts'; export * from './components/gameMetrics'; export * from './components/displayProfile'", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const level = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const {
  BAR, SEGMENTS, SONG_TOTAL_BARS, WORLD_HEIGHT, PIPE_HIT_THICKNESS, buildSegment, createRandom, planSong,
  pipePolygon, segmentWidth, solveSegment,
} = level;

const describe = (segment, mirrored, variant) => `${segment.id}${mirrored ? ' (mirrored)' : ''} variant ${variant}`;

const PHONE = 1.5;
const PIG_PHONE = level.PHONE_PIG_SCALE;
const phone = (id, mirrored = false, seed = 1) => buildSegment(level.SEGMENTS_BY_ID.get(id), mirrored, createRandom(seed), PHONE);
const desktop = (id, mirrored = false, seed = 1) => buildSegment(level.SEGMENTS_BY_ID.get(id), mirrored, createRandom(seed));
const isAnchored = (pipe) => (pipe.facing === 'down' && pipe.y - pipe.length / 2 <= -59) || (pipe.facing === 'up' && pipe.y + pipe.length / 2 >= WORLD_HEIGHT + 59);
const gateGap = (content, x) => {
  const top = content.pipes.find((p) => isAnchored(p) && p.facing === 'down' && Math.abs(p.x - x) < 1);
  const bottom = content.pipes.find((p) => isAnchored(p) && p.facing === 'up' && Math.abs(p.x - x) < 1);
  return bottom.y - bottom.length / 2 - (top.y + top.length / 2);
};

function assertPhoneGeometry(content, width, name) {
  assert.equal(content.entityScale, PHONE, name);
  const shapes = content.pipes.map((pipe) => {
    assert.equal(pipe.scale, PHONE, name);
    const shape = pipePolygon(pipe, pipe.x, pipe.y, level.PIPE_THICKNESS * PHONE + 12);
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
    const feet = level.pigCenterY(support) + level.PIG_HEIGHT * PIG_PHONE / 2;
    assert.ok(Math.abs(feet - (level.pipeTopY(support) - 6 * PHONE)) < 0.001, `${name}: pig floats off its snow`);
  }
}

test('all enlarged phone segment variants remain crossable, collectible and visually separate', () => {
  for (const segment of SEGMENTS) {
    for (const mirrored of segment.mirror ? [false, true] : [false]) {
      for (let variant = 0; variant < 12; variant += 1) {
        const name = describe(segment, mirrored, variant);
        const content = buildSegment(segment, mirrored, createRandom(variant * 7919 + 1), PHONE);
        const solved = solveSegment(content, segmentWidth(segment, PHONE));
        assert.ok(solved.ok, `${name}: enlarged phone route or pickup is unreachable`);
        assertPhoneGeometry(content, segmentWidth(segment, PHONE), name);
        assert.deepEqual(level.validatePhoneLayout(content, segmentWidth(segment, PHONE)), [], name);
      }
    }
  }
});

test('300 enlarged phone song plans chain safely with reachable powerups, hearts and morphs', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const plan = planSong(seed, PHONE);
    let entry = level.fullEntry();
    let bar = 0;
    for (const planned of plan) {
      const name = `phone seed ${seed}: ${planned.segment.id}`;
      assert.equal(planned.startBar, bar, name);
      bar += planned.segment.bars;
      assertPhoneGeometry(planned.content, segmentWidth(planned.segment, PHONE), name);
      const solved = solveSegment(planned.content, segmentWidth(planned.segment, PHONE), entry);
      assert.ok(solved.ok, `${name}: cannot enter, cross or collect an item`);
      entry = solved.exit;
    }
    assert.equal(bar, SONG_TOTAL_BARS);
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

// The phone port is the desktop layout scaled by 1.5 horizontally and by a
// per-segment k (1…1.5) vertically. These checks hold it to that.
test('phone keeps every desktop pipe, pig and light stick, scaled 1.5× along the timeline', () => {
  const X = level.CRUISE_SPEED / 410;
  const POST_LENGTH = { 'blocks-weave': 1.2, 'blocks-scatter': 1.3 };
  for (const segment of SEGMENTS) for (const mirrored of segment.mirror ? [false, true] : [false]) {
    for (let seed = 1; seed <= 4; seed++) {
      const name = describe(segment, mirrored, seed);
      const d = desktop(segment.id, mirrored, seed);
      const p = phone(segment.id, mirrored, seed);
      assert.equal(p.pipes.length, d.pipes.length, `${name}: pipes`);
      assert.equal(p.pigs.length, d.pigs.length, `${name}: pigs`);
      assert.equal(p.coins.length, d.coins.length, `${name}: same number of light sticks as desktop`);
      p.pipes.forEach((pipe, i) => {
        assert.ok(Math.abs(pipe.x - d.pipes[i].x * PHONE) < 1e-6, `${name}: pipe ${i} keeps its beat`);
        assert.equal(pipe.facing, d.pipes[i].facing, `${name}: pipe ${i} direction`);
        assert.ok(Math.abs((pipe.tilt ?? 0) - (d.pipes[i].tilt ?? 0)) < 1e-9, `${name}: pipe ${i} tilt`);
        if (isAnchored(d.pipes[i])) return;
        const horizontal = pipe.facing === 'left' || pipe.facing === 'right';
        const scale = horizontal ? PHONE : POST_LENGTH[segment.id] ?? PHONE;
        assert.ok(Math.abs(pipe.length - d.pipes[i].length * scale) < 1e-6, `${name}: pipe ${i} is ${scale}× its desktop length`);
      });
      p.pigs.forEach((pig, i) => {
        assert.equal(pig.patrol, d.pigs[i].patrol, `${name}: patrol`);
        assert.equal(pig.speed, d.pigs[i].speed, `${name}: patrol speed`);
      });
      const k = p.layoutScale;
      assert.ok(k >= (segment.id === 'gate-stairs' ? 0.9 : 1) - 1e-9 && k <= PHONE + 1e-9, `${name}: layout scale ${k}`);
      // Every stick stays on the same beat as on desktop (split-floors'
      // exit string starts later on purpose).
      const sorted = (coins) => coins.map((c) => c.x).sort((a, b) => a - b);
      if (segment.id !== 'split-floors') {
        sorted(p.coins).forEach((x, i) => assert.ok(Math.abs(x - sorted(d.coins)[i] * PHONE) < 1e-6, `${name}: stick ${i} keeps its beat`));
      }
      assert.equal(X > 0, true);
    }
  }
});

test('phone keeps the shape of every route: curves still bend, nothing is flattened', () => {
  for (const segment of SEGMENTS) for (const mirrored of segment.mirror ? [false, true] : [false]) {
    const d = desktop(segment.id, mirrored);
    const p = phone(segment.id, mirrored);
    const k = p.layoutScale;
    const order = (coins) => coins.map((coin, i) => ({ coin, i })).sort((a, b) => a.coin.x - b.coin.x || a.i - b.i);
    const dd = order(d.coins), pp = order(p.coins);
    for (let i = 1; i < pp.length; i++) {
      const a = pp[i - 1].coin, b = pp[i].coin;
      const da = dd[i - 1].coin, db = dd[i].coin;
      if (a.routeId !== b.routeId || !a.routeId || ['kill', 'riskHeal'].includes(a.role) || a.role !== da.role) continue;
      if (segment.id === 'split-floors' && a.routeId === 'path-3') continue;
      // Rising stays rising, falling stays falling, by at least k × desktop.
      const rise = db.y - da.y;
      if (Math.abs(rise) > 1) assert.ok(Math.abs((b.y - a.y) - rise * k) < 1, `${segment.id}${mirrored ? ' (mirrored)' : ''}: step ${i} keeps its slope`);
    }
  }
});

test('the nine weakened motifs keep their desktop pressure on a phone', () => {
  const player = level.PLAYER_SIZE;
  // 1. Zipper: walls still overlap, so the big S is required, not decorative.
  const zipperDesk = desktop('wall-zipper');
  const zipper = phone('wall-zipper');
  const overlap = (c) => (c.pipes[0].y + c.pipes[0].length / 2) - (c.pipes[1].y - c.pipes[1].length / 2);
  assert.ok(overlap(zipper) / (player * PHONE) >= overlap(zipperDesk) / player * 0.95, `zipper overlap ${overlap(zipper)}`);
  // 2. Gatekeeper: gap in player heights within 10% of desktop, so the pig still narrows it.
  const keeperDesk = desktop('pig-gatekeeper'), keeper = phone('pig-gatekeeper');
  const ratio = (gateGap(keeper, keeper.pipes[0].x) / (player * PHONE)) / (gateGap(keeperDesk, keeperDesk.pipes[0].x) / player);
  assert.ok(ratio > 0.9 && ratio < 1.1, `gatekeeper gap ratio ${ratio}`);
  // 3. Risk/safe split: the slit's lower post is fully enlarged.
  assert.ok(Math.abs(phone('combo-split-decision').pipes[1].length - desktop('combo-split-decision').pipes[1].length * PHONE) < 1e-6);
  // 4. Pig pillars: the guide skims the pigs' heads as closely as on desktop.
  const skim = (c, scale, pigScale) => Math.min(...c.pigs.map((pig) => {
    const support = c.pipes[pig.pipe];
    const head = level.pigCenterY(support) - level.PIG_HEIGHT * pigScale / 2;
    const near = c.coins.filter((coin) => Math.abs(coin.x - support.x) < 40 * scale);
    return Math.min(...near.map((coin) => head - coin.y)) / (player * scale);
  }));
  assert.ok(skim(phone('pig-pillars'), PHONE, PIG_PHONE) <= skim(desktop('pig-pillars'), 1, 1) + 0.2, 'pillar guide stays close to the pigs');
  // 5. Parade: high-low-high keeps (at least) its desktop height difference relative to the player.
  const lift = (c) => c.pipes[0].y - c.pipes[1].y;
  assert.ok(lift(phone('pig-parade')) / PHONE >= lift(desktop('pig-parade')) * 0.95, 'parade keeps its high/low rhythm');
  // 6–7. Scatter and debris: every block fully on screen, in the same vertical order as desktop.
  for (const id of ['blocks-scatter', 'blocks-debris']) for (const mirrored of [false, true]) {
    const p = phone(id, mirrored), d = desktop(id, mirrored);
    for (const pipe of p.pipes) {
      const ys = level.pipeVisualPolygon(pipe).map((pt) => pt.y);
      assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= WORLD_HEIGHT, `${id}: block on screen`);
    }
    // Blocks stay spread over the top, middle and bottom of the screen like on desktop.
    const band = (pipe) => (pipe.y < 260 ? 'top' : pipe.y > 460 ? 'bottom' : 'middle');
    assert.deepEqual(p.pipes.map(band), d.pipes.map(band), `${id}${mirrored ? ' (mirrored)' : ''}: blocks keep their high/low arrangement`);
  }
  // 8–9. Bunny and bell: the complete desktop drawing, only scaled.
  for (const id of ['bonus-bunny', 'bonus-bell']) {
    const all = phone(id).coins;
    const p = all.filter((c) => c.patternId), d = desktop(id).coins.filter((_, i) => all[i].patternId);
    assert.equal(p.length, d.length, `${id}: every stick of the drawing`);
    const k = phone(id).layoutScale;
    p.forEach((coin, i) => assert.ok(Math.abs(coin.x - d[i].x * PHONE) < 1e-6 && Math.abs((coin.y - p[0].y) - (d[i].y - d[0].y) * k) < 1e-6, `${id}: stick ${i}`));
    const rows = (coins) => new Set(coins.map((c) => Math.round(c.y))).size;
    assert.equal(rows(p), rows(d), `${id}: all rows of the drawing`);
  }
});

test('phone funnel narrows step by step and is densest at the neck', () => {
  const funnel = phone('wall-funnel');
  const gaps = [0, 2, 4].map((i) => gateGap(funnel, funnel.pipes[i].x));
  assert.ok(gaps[0] - gaps[1] >= 60 && gaps[1] - gaps[2] >= 60, `funnel gaps ${gaps}`);
  const spacing = (role) => {
    const xs = funnel.coins.filter((c) => c.role === role).map((c) => c.x).sort((a, b) => a - b);
    return (xs.at(-1) - xs[0]) / (xs.length - 1);
  };
  assert.ok(spacing('reward') < spacing('guide') * 0.75, 'sticks bunch up at the neck');
});

test('phone runs offer as many light sticks and pigs as desktop runs', () => {
  const count = (scale) => {
    let sticks = 0, pigs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const planned of planSong(seed, scale)) {
        sticks += planned.content.coins.filter((c) => ['guide', 'reward', 'risk', 'kill', 'bonus'].includes(c.role)).length;
        pigs += planned.content.pigs.length;
      }
    }
    return { sticks, pigs };
  };
  const d = count(1), p = count(PHONE);
  assert.ok(p.sticks >= d.sticks * 0.97, `phone ${p.sticks} vs desktop ${d.sticks} sticks`);
  assert.ok(p.pigs >= d.pigs * 0.95, `phone ${p.pigs} vs desktop ${d.pigs} pigs`);
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

test('phone layout validation rejects stubs, off-screen blocks, crowded pipes and sticks on pipes', () => {
  const width = BAR * PHONE;
  const base = phone('gate-single');
  const stub = { ...base, pipes: base.pipes.map((p) => (p.anchor === 'ceiling' ? { ...p, y: (40 - 60) / 2, length: 100 } : p)) };
  assert.ok(level.validatePhoneLayout(stub, width).some((issue) => issue.kind === 'pipe-length'));
  const off = { ...base, pipes: [...base.pipes, { x: width / 2, y: 20, length: 200, facing: 'up', scale: PHONE }] };
  assert.ok(level.validatePhoneLayout(off, width).some((issue) => issue.kind === 'pipe-offscreen'));
  const crowded = { ...base, pipes: [...base.pipes, { ...base.pipes[0], x: base.pipes[0].x + 60 }] };
  assert.ok(level.validatePhoneLayout(crowded, width).some((issue) => issue.kind === 'pipe-gap'));
  const onPipe = { ...base, coins: [{ x: base.pipes[0].x, y: base.pipes[0].y + base.pipes[0].length / 2 - 20, role: 'guide' }] };
  assert.ok(level.validatePhoneLayout(onPipe, width).some((issue) => issue.kind === 'pickup-pipe'));
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

test('phone gates stay anchored and reward drawings survive special-item placement intact', () => {
  for (const segment of SEGMENTS) {
    for (const mirrored of segment.mirror ? [false, true] : [false]) {
      const content = phone(segment.id, mirrored, 3);
      for (const pipe of content.pipes) {
        if (pipe.anchor === 'ceiling') assert.ok(pipe.y - pipe.length / 2 <= -60 + 0.001);
        if (pipe.anchor === 'floor') assert.ok(pipe.y + pipe.length / 2 >= 780 - 0.001);
      }
    }
  }
  const plan = planSong(42, PHONE);
  for (const p of plan.filter((p) => p.segment.theme === 'bonus' && p.segment.id !== 'rest-breadcrumbs')) {
    const drawing = (coins) => coins.filter((c) => c.patternId).length;
    assert.ok(drawing(p.content.coins) >= drawing(phone(p.segment.id, p.mirrored).coins) - 1, `${p.segment.id}: at most one stick becomes a special item`);
  }
});
