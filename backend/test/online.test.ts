import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OnlineTracker } from '../src/online.js';

test('moisture and temperature go offline independently after 5 s', () => {
  const tr = new OnlineTracker(5000);
  const t0 = 10_000;
  tr.onMoisture(3515, t0);
  tr.onValidTemp(26.12, t0);
  assert.equal(tr.moistureOnline(t0 + 1000), true);
  assert.equal(tr.tempOnline(t0 + 1000), true);
  tr.onMoisture(3514, t0 + 1000);
  assert.equal(tr.moistureOnline(t0 + 5500), true);
  assert.equal(tr.tempOnline(t0 + 5500), false);
  assert.equal(tr.moistureOnline(t0 + 7000), false);
});

test('T0=ERR does not refresh the temperature clock', () => {
  const tr = new OnlineTracker(5000);
  const t0 = 10_000;
  tr.onValidTemp(26.1, t0);
  // ERR: caller must not call onValidTemp
  tr.onMoisture(3515, t0 + 1000);
  tr.onMoisture(3515, t0 + 2000);
  tr.onMoisture(3515, t0 + 3000);
  tr.onMoisture(3515, t0 + 4000);
  tr.onMoisture(3515, t0 + 6000);
  assert.equal(tr.moistureOnline(t0 + 6000), true);
  assert.equal(tr.tempOnline(t0 + 6000), false);
  assert.equal(tr.lastTempC, 26.1);
});

test('a vanished board is marked gone immediately', () => {
  const tr = new OnlineTracker();
  tr.onMoisture(3515, 1);
  tr.markGone();
  assert.equal(tr.moistureOnline(2), false);
  assert.equal(tr.tempOnline(2), false);
});
