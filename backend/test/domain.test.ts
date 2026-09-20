import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRate, PourDetector } from '../src/pourDetector.js';
import { summarizeForecast, cannedDays } from '../src/weather.js';
import { defaultGuardConfig, PourGuards } from '../src/pourGuards.js';
import type { ZoneLive } from '../src/types.js';

const live = (pct: number, online = true): ZoneLive => ({
  t: Date.now(), moistureRaw: 3000, moisturePct: pct, tempC: 21, moistureOnline: online, tempOnline: true,
});

test('1 Hz pour detector: A wets, then B 20 s later → speed and class', () => {
  const det = new PourDetector(() => 20);
  const t0 = 1_700_000_000_000;
  const values = (a: number | null, b: number | null) => ({ A: a, B: b });
  for (let i = 0; i < 25; i++) det.update(t0 + i * 1000, values(12, 11));
  assert.equal(det.state.phase, 'idle');
  for (let i = 25; i < 28; i++) det.update(t0 + i * 1000, values(40, 11));
  assert.equal(det.state.phase, 'running');
  assert.equal(det.state.source, 'A');
  for (let i = 28; i < 45; i++) det.update(t0 + i * 1000, values(42, 11));
  assert.equal(det.state.phase, 'running');
  for (let i = 45; i < 48; i++) det.update(t0 + i * 1000, values(42, 38));
  assert.equal(det.state.phase, 'done');
  assert.equal(det.state.target, 'B');
  assert.ok(det.state.rateCmMin != null);
  // ~20 s travel, 20 cm → ~60 cm/min (gravel / very fast). HOLD=2 adds a little latency.
  assert.ok(det.state.rateCmMin! > 30, `rate ${det.state.rateCmMin}`);
  assert.equal(det.state.drainageClass, 'fast');
  assert.match(det.state.label ?? '', /gravelly|Very fast/);
});

test('both zones wetting within 2 s is not a pour (reset)', () => {
  const det = new PourDetector(() => 20);
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 25; i++) det.update(t0 + i * 1000, { A: 12, B: 12 });
  for (let i = 25; i < 28; i++) det.update(t0 + i * 1000, { A: 40, B: 40 });
  assert.equal(det.state.phase, 'idle');
});

test('classifyRate bands match the frontend thresholds', () => {
  assert.equal(classifyRate(60).texture, 'gravelly or coarse sand');
  assert.equal(classifyRate(10).cls, 'fast');
  assert.equal(classifyRate(2).cls, 'moderate');
  assert.equal(classifyRate(0.5).cls, 'slow');
  assert.equal(classifyRate(0.1).cls, 'very_slow');
});

test('forecast summary: 5 mm + 60% in 48 h is rainExpected', () => {
  const rain = summarizeForecast(cannedDays('rain', Date.UTC(2026, 8, 20)), 'open-meteo', false, Date.UTC(2026, 8, 20));
  assert.equal(rain.rainExpected, true);
  assert.ok(rain.rainNext48hMm >= 5);
  const dry = summarizeForecast(cannedDays('dry', Date.UTC(2026, 8, 20)), 'sample', true, Date.UTC(2026, 8, 20));
  assert.equal(dry.rainExpected, false);
  assert.equal(dry.sample, true);
});

test('forecast: 4 mm even at 90% is not rainExpected', () => {
  const f = summarizeForecast([
    { date: '2026-09-20', precipMm: 2, precipProb: 90, tmaxC: 20, tminC: 10 },
    { date: '2026-09-21', precipMm: 2, precipProb: 90, tmaxC: 20, tminC: 10 },
  ], 'open-meteo', false);
  assert.equal(f.rainExpected, false);
});

test('pour guards: wet zone A is refused unless force=true', () => {
  const g = new PourGuards(defaultGuardConfig());
  const wet = live(90);
  const no = g.check({ zoneA: wet, force: false, boardOnline: true });
  assert.equal(no.ok, false);
  if (!no.ok) {
    assert.equal(no.result, 'refused');
    assert.match(no.reason, /wet/i);
  }
  const yes = g.check({ zoneA: wet, force: true, boardOnline: true });
  assert.equal(yes.ok, true);
});

test('pour guards: rolling window', () => {
  const g = new PourGuards(defaultGuardConfig({ maxPerWindow: 2, windowMs: 60_000 }));
  const dry = live(15);
  const t0 = 5_000_000;
  assert.equal(g.check({ now: t0, zoneA: dry, force: false, boardOnline: true }).ok, true);
  g.recordAccepted(t0);
  g.recordAccepted(t0 + 1000);
  const third = g.check({ now: t0 + 2000, zoneA: dry, force: false, boardOnline: true });
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.result, 'refused');
  const later = g.check({ now: t0 + 61_000, zoneA: dry, force: false, boardOnline: true });
  assert.equal(later.ok, true);
});

test('pour guards: board offline', () => {
  const g = new PourGuards(defaultGuardConfig());
  const r = g.check({ zoneA: live(15), force: false, boardOnline: false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.result, 'offline');
});
