import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../components/resultTally.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { resultTallyAt, RESULT_TALLY_MS, resultTitle } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const record = { failed: true, leadMember: 1, score: 1863, sticks: 155, pigs: 10, progress: .23 };

test('all four counters start together and advance before the former sequential delay', () => {
  const start = resultTallyAt(record, 0);
  assert.deepEqual([start.score, start.sticks, start.pigs, start.percent], [0, 0, 0, 0]);
  const early = resultTallyAt(record, 120);
  for (const key of ['score', 'sticks', 'pigs', 'percent']) assert.ok(early[key] > 0, `${key} starts with the card`);
  assert.equal(early.landed, false);
});

test('failure and success land on their exact data without overshooting', () => {
  for (const input of [record, { ...record, failed: false, score: 4860, sticks: 286, pigs: 24, progress: 1 }]) {
    let previous = resultTallyAt(input, 0);
    for (let time = 20; time <= RESULT_TALLY_MS; time += 20) {
      const current = resultTallyAt(input, time);
      for (const key of ['score', 'sticks', 'pigs', 'percent']) assert.ok(current[key] >= previous[key]);
      assert.equal(current.landed, time === RESULT_TALLY_MS);
      previous = current;
    }
    assert.deepEqual([previous.score, previous.sticks, previous.pigs, previous.percent], [input.score, input.sticks, input.pigs, Math.round(input.progress * 100)]);
    assert.deepEqual(resultTallyAt(input, RESULT_TALLY_MS + 5000), previous);
  }
});

test('zero-score runs finish normally, and completion stays within 0–100%', () => {
  const empty = { ...record, score: 0, sticks: 0, pigs: 0, progress: 0 };
  assert.equal(resultTallyAt(empty, 100).landed, false);
  assert.equal(resultTallyAt(empty, RESULT_TALLY_MS).landed, true);
  assert.equal(resultTallyAt({ ...record, progress: 2 }, RESULT_TALLY_MS).percent, 100);
  assert.equal(resultTallyAt({ ...record, progress: -1 }, RESULT_TALLY_MS).percent, 0);
  assert.equal(resultTitle(true), '再试一次 终将抵达');
  assert.equal(resultTitle(false), '飞越成功！');
});
