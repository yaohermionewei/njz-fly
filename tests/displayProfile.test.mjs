import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../components/displayProfile.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { isPhoneDevice } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const phone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', platform: 'iPhone', touchPoints: 5, screenWidth: 390, screenHeight: 844, coarsePointer: true };

test('phones keep their device profile when turned sideways', () => {
  assert.equal(isPhoneDevice(phone), true);
  assert.equal(isPhoneDevice({ ...phone, screenWidth: 844, screenHeight: 390 }), true);
  assert.equal(isPhoneDevice({ ...phone, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36' }), true);
});

test('iPads including desktop mode and split view are excluded', () => {
  assert.equal(isPhoneDevice({ ...phone, userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0)', platform: 'iPad', screenWidth: 768, screenHeight: 1024 }), false);
  assert.equal(isPhoneDevice({ ...phone, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15', platform: 'MacIntel' }), false);
});

test('Android tablets and computers are excluded even in narrow windows', () => {
  assert.equal(isPhoneDevice({ ...phone, userAgent: 'Mozilla/5.0 (Linux; Android 15) Safari/537.36' }), false);
  assert.equal(isPhoneDevice({ ...phone, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' }), false);
  assert.equal(isPhoneDevice({ ...phone, coarsePointer: false }), false);
});

