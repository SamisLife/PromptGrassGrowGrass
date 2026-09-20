import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyIdentifyText, isImplausibleRaw, parsePourEvent, parsePourReply, parsePourStatus, parseSensorLine } from '../src/parse.js';

test('parses a healthy sensor line', () => {
  const s = parseSensorLine('[362s] moisture raw=3516 (2.83 V)  T0=26.12');
  assert.ok(s);
  assert.equal(s.uptimeSec, 362);
  assert.equal(s.moistureRaw, 3516);
  assert.equal(s.volts, 2.83);
  assert.equal(s.tempC, 26.12);
  assert.equal(s.tempErr, false);
});

test('parses T0=ERR as a rejected temperature, not a number', () => {
  const s = parseSensorLine('[363s] moisture raw=3515 (2.83 V)  T0=ERR');
  assert.ok(s);
  assert.equal(s.tempC, null);
  assert.equal(s.tempErr, true);
  assert.equal(s.temps.T0, 'ERR');
});

test('parses a moisture-only line with no temperature field', () => {
  const s = parseSensorLine('[364s] moisture raw=3515 (2.83 V)');
  assert.ok(s);
  assert.equal(s.moistureRaw, 3515);
  assert.equal(s.tempC, null);
  assert.equal(s.tempErr, false);
});

test('rejects non-sensor lines', () => {
  assert.equal(parseSensorLine('=== sensor_test === build Sep 20 2026 01:47:00'), null);
  assert.equal(parseSensorLine('status: idle,180,180,60,1500,4,0'), null);
});

test('parses pour status, replies and events', () => {
  const st = parsePourStatus('status: idle,180,180,60,1500,4,0');
  assert.deepEqual(st, { phase: 'idle', currentDeg: 180, restDeg: 180, pourDeg: 60, holdMs: 1500, pours: 4, cooldownMsLeft: 0 });
  assert.equal(parsePourReply('pour: accepted'), 'accepted');
  assert.equal(parsePourReply('pour: BUSY (already pouring)'), 'BUSY');
  assert.equal(parsePourReply('pour: COOLDOWN (wait a few seconds)'), 'COOLDOWN');
  const ev = parsePourEvent('[21.5s] pour: tipping');
  assert.deepEqual(ev, { uptimeSec: 21.5, phase: 'tipping' });
  assert.equal(parsePourEvent('pour: done, back at rest')?.phase, 'done');
  assert.equal(parsePourEvent('pour: accepted'), null);
});

test('identify text: pour vs sensors vs other', () => {
  assert.equal(classifyIdentifyText('=== pour firmware === build Sep 20\nstatus: idle,180,180,60,1500,0,0'), 'pour');
  assert.equal(classifyIdentifyText('[12s] moisture raw=3465 (2.79 V)  T0=25.81'), 'sensors');
  assert.equal(classifyIdentifyText('hello world'), 'other');
});

test('implausible raw: floating pin ~1100, healthy air ~3515', () => {
  assert.equal(isImplausibleRaw(1100), true);
  assert.equal(isImplausibleRaw(3515), false);
  assert.equal(isImplausibleRaw(1998), false);
  assert.equal(isImplausibleRaw(4095), true);
});
