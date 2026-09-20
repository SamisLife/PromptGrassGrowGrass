import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway data folder, set BEFORE the app is imported, so real data is never touched.
const dir = mkdtempSync(join(tmpdir(), 'pg-profile-'));
process.env.PROMPTGRASS_DATA_DIR = dir;
process.env.HARDWARE = 'off';
const { SoilApp } = await import('../src/app.js');
const { env } = await import('../src/env.js');

const profile = { drainageClass: 'fast', label: 'Fast draining, behaves like sandy soil', texture: 'sandy', rateCmMin: 30, distanceCm: 20, seconds: 40, between: ['A', 'B'], measuredAt: 1, estimate: true };

test('cancelling or re-arming a pour test keeps the measured soil profile', () => {
  const app = new SoilApp(env()) as any;
  app.profile = profile;
  app.armPour();
  app.resetPour();                                   // "Cancel" / "Reset" / "Measure again"
  assert.deepEqual(app.profile, profile, 'resetPour must not forget the measurement');
});

test('crop scores keep using the saved drainage after a reset', async () => {
  const app = new SoilApp(env()) as any;
  app.profile = profile;
  app.resetPour();
  const crops = await app.scoreCrops('A');
  assert.ok(!crops[0].unknowns.includes('drainage'), 'drainage should still be known');
});

test('only an explicit clear forgets it', () => {
  const app = new SoilApp(env()) as any;
  app.profile = profile;
  app.clearSoilProfile();
  assert.equal(app.profile, null);
});

test('a saved profile is loaded again after a restart', () => {
  const a = new SoilApp(env()) as any;
  a.detector.state = { phase: 'done', source: 'A', target: 'B', t0: 0, t1: 40000, distanceCm: 20, rateCmMin: 30, drainageClass: 'fast', label: 'Fast draining, behaves like sandy soil', baseline: {} };
  a.onPourChanged();
  const b = new SoilApp(env()) as any;               // "restart"
  assert.equal(b.profile?.drainageClass, 'fast');
  assert.ok(existsSync(join(dir, 'soil-profiles.jsonl')) && readFileSync(join(dir, 'soil-profiles.jsonl'), 'utf8').includes('"fast"'), 'every measurement is logged');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
