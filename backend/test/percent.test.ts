import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relativeMoisturePct } from '../src/percent.js';

const AIR = 3515;
const WATER = 1998;

test('maps bench air to 0% and water to 100%', () => {
  assert.equal(relativeMoisturePct(AIR, AIR, WATER), 0);
  assert.equal(relativeMoisturePct(WATER, AIR, WATER), 100);
});

test('maps the midpoint to 50%', () => {
  const mid = (AIR + WATER) / 2;
  assert.ok(Math.abs(relativeMoisturePct(mid, AIR, WATER) - 50) < 0.05);
});

test('clamps outside the air–water range', () => {
  assert.equal(relativeMoisturePct(AIR + 40, AIR, WATER), 0);
  assert.equal(relativeMoisturePct(WATER - 40, AIR, WATER), 100);
});

test('higher raw is drier (lower percent)', () => {
  assert.ok(relativeMoisturePct(3400, AIR, WATER) < relativeMoisturePct(2500, AIR, WATER));
});
