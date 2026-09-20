import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StaleFilter } from '../src/stale.js';

test('drops the first ~2 s of replayed lines', () => {
  const t0 = 1_000_000;
  const f = new StaleFilter(2500, t0);
  assert.equal(f.accept(360, t0 + 100), false);
  assert.equal(f.accept(361, t0 + 1100), false);
  assert.equal(f.accept(362, t0 + 2100), false);
  assert.equal(f.accept(363, t0 + 2600), true);
  assert.equal(f.accept(364, t0 + 3600), true);
});

test('after a banner (reboot), a low uptime is live once settled', () => {
  const t0 = 1_000_000;
  const f = new StaleFilter(2500, t0);
  f.accept(362, t0 + 100);
  f.onBanner(t0 + 500);
  assert.equal(f.accept(1, t0 + 600), false);
  assert.equal(f.accept(3, t0 + 3100), true);
});

test('uptime jumping backwards after settle is treated as a new boot, not stale', () => {
  const t0 = 1_000_000;
  const f = new StaleFilter(2500, t0);
  f.accept(360, t0 + 100);
  f.accept(362, t0 + 2000);
  assert.equal(f.accept(363, t0 + 2600), true);
  assert.equal(f.accept(2, t0 + 3700), true);
});

test('lines without uptime are accepted only after settle (pour status)', () => {
  const t0 = 1_000_000;
  const f = new StaleFilter(2500, t0);
  assert.equal(f.accept(null, t0 + 100), false);
  assert.equal(f.accept(null, t0 + 2600), true);
});
