import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig } from '../src/defaults.js';
import { env } from '../src/env.js';
import { SoilApp } from '../src/app.js';
import type { McpBackend } from '../src/proxy.js';
import { parseNavigateArgs, runPlotTool } from '../src/tools.js';
import type { PourCaller, PourGuardKind, SoftGuardKind, UiCommand, Zone, ZoneId, ZoneLive } from '../src/types.js';
import { ConfirmStore } from '../src/voice/confirm.js';
import type { VoiceClientEvent } from '../src/voice/events.js';
import { VoiceRuntime } from '../src/voice/session.js';
import { voiceStatus } from '../src/voice/status.js';

const liveWet: ZoneLive = {
  t: 1_700_000_000_000, moistureRaw: 2100, moisturePct: 82, tempC: 21,
  moistureOnline: true, tempOnline: true,
};

class FakeApp implements McpBackend {
  mode = 'board' as const;
  config = defaultConfig();
  calls: { tool: string; zones: ZoneId[]; summary: string }[] = [];
  pours: { force: boolean; caller: PourCaller }[] = [];
  wet = true;
  busy = false;
  windowFull = false;

  recordAgentCall(tool: string, zones: ZoneId[], summary: string) {
    this.calls.push({ tool, zones, summary });
    return { id: this.calls.length, t: Date.now(), tool, zones, summary };
  }
  zone(id: ZoneId): Zone {
    const z = this.config.zones.find((x) => x.id === String(id).toUpperCase().replace(/^ZONE\s+/, '') || x.id === id);
    if (!z) throw new Error(`No zone "${id}"`);
    return z;
  }
  async readZone(id: ZoneId) {
    const zone = this.zone(id);
    const live = zone.id === 'A' ? liveWet : { ...liveWet, moisturePct: 40, moistureRaw: 3000 };
    return {
      zone, live, calibrated: true, soil: null,
      water: { needsWater: false, action: 'none' as const, headline: 'wet enough', reasons: ['already wet'] },
    };
  }
  async soilProfile() { return null; }
  async scoreCrops(id: ZoneId) {
    this.zone(id);
    return [{
      id: 'carrot', name: 'Carrots', category: 'root', score: 80, verdict: 'good' as const,
      plantableNow: true, summary: 'ok', factors: [], confidence: 'medium' as const, unknowns: [],
    }];
  }
  async plantingWindow() { return null; }
  async forecast() {
    return {
      source: 'open-meteo' as const, sample: false, fetchedAt: Date.now(),
      days: [{ date: '2026-09-20', precipMm: 0, precipProb: 10, tmaxC: 22, tminC: 12 }],
      rainNext48hMm: 0, maxPrecipProb48h: 10, rainExpected: false, dryDaysAhead: 5, text: 'Dry.',
    };
  }
  async historyFor(id: ZoneId) { return { zoneId: this.zone(id).id, points: [], simulated: false }; }
  async addNote(text: string, zoneId: ZoneId | null) {
    return { id: 'n1', t: Date.now(), zoneId, text, author: 'agent' as const };
  }
  snapshotReadings() { return { zones: {} }; }
  async readings() { return { mode: this.mode, zones: { A: { moisture: { relative_moisture_pct: 82 } } } }; }
  async pourWater(opts: { holdMs?: number; force?: boolean; caller: PourCaller }) {
    this.pours.push({ force: !!opts.force, caller: opts.caller });
    if (this.busy) {
      return { result: 'busy' as const, ok: false, reason: 'still returning', guard: 'hard' as PourGuardKind };
    }
    if (this.windowFull && !opts.force) {
      return { result: 'refused' as const, ok: false, reason: 'too many pours', guard: 'soft' as PourGuardKind, softKind: 'window' as SoftGuardKind };
    }
    if (this.wet && !opts.force) {
      return {
        result: 'refused' as const, ok: false, reason: 'Zone A already reads wet (82%).',
        reading: liveWet, guard: 'soft' as PourGuardKind, softKind: 'wet' as SoftGuardKind,
      };
    }
    return { result: 'started' as const, ok: true, next: 're-read A' };
  }
  async pourStatus() { return { connected: true, phase: 'idle' as const }; }
}

function runtimeOf(app: FakeApp, confirm?: ConfirmStore) {
  const client: VoiceClientEvent[] = [];
  const provider: unknown[] = [];
  const ui: UiCommand[] = [];
  const rt = new VoiceRuntime({
    app,
    sendClient: (e) => client.push(e),
    sendProvider: (e) => provider.push(e),
    emitUiCommand: (c) => ui.push(c),
    confirm,
    sessionId: 'sess-1',
  });
  return { rt, client, provider, ui };
}

test('voice status: no key → disabled with a reason the UI can show', () => {
  const st = voiceStatus({ key: '', publicBase: 'http://127.0.0.1:8787' });
  assert.equal(st.enabled, false);
  assert.match(st.reason ?? '', /XAI_API_KEY/);
  assert.equal(st.path, 'server-relay');
  assert.equal(st.audio.rate, 24000);
  assert.equal(st.audio.encoding, 'pcm_s16le');
  assert.match(st.browser.websocket, /\/api\/voice\/session$/);
});

test('voice status: key present → enabled, key is not in the body', () => {
  const st = voiceStatus({ key: 'xai-secret-should-not-leak', publicBase: 'http://127.0.0.1:8787' });
  assert.equal(st.enabled, true);
  assert.equal(st.reason, null);
  assert.doesNotMatch(JSON.stringify(st), /xai-secret/);
});

test('navigate: valid payload, unknown values are errors, extra keys rejected', () => {
  const ok = parseNavigateArgs({ view: 'history', zone: 'B', lens: 'temperature' });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.command, { view: 'history', zone: 'B', lens: 'temperature' });
  }
  const crop = parseNavigateArgs({ crop: 'carrot', drawer: 'plant' });
  assert.equal(crop.ok, true);
  if (crop.ok) assert.equal(crop.command.crop, 'carrot');
  const badView = parseNavigateArgs({ view: 'settings' });
  assert.equal(badView.ok, false);
  if (!badView.ok) assert.match(badView.error, /Unknown view/);
  const badCrop = parseNavigateArgs({ crop: 'dragonfruit' });
  assert.equal(badCrop.ok, false);
  const extra = parseNavigateArgs({ view: 'field', foo: 1 });
  assert.equal(extra.ok, false);
  const empty = parseNavigateArgs({});
  assert.equal(empty.ok, false);
});

test('tool layer: navigate emits ui_command vocabulary and agent_call; unknown crop is an error the model can recover from', async () => {
  const app = new FakeApp();
  const { rt, ui } = runtimeOf(app);
  const bad = await rt.runTool('navigate', { view: 'map' }, 'c0');
  assert.equal(bad.ok, false);
  assert.equal(ui.length, 0);
  const good = await rt.runTool('navigate', { view: 'history', drawer: 'when', zone: 'B' }, 'c1');
  assert.equal(good.ok, true);
  assert.deepEqual(ui[0], { view: 'history', drawer: 'when', zone: 'B' });
  assert.ok(app.calls.some((c) => c.tool === 'navigate' && c.zones.includes('B')));
});

test('tool layer: get_readings and list_zones go through the shared runner (MCP and voice)', async () => {
  const app = new FakeApp();
  const listed = await runPlotTool(app, 'list_zones', {}, { caller: 'mcp-http' });
  assert.equal(listed.ok, true);
  const payload = listed.payload as { zones: { id: string }[] };
  assert.deepEqual(payload.zones.map((z) => z.id), ['A', 'B']);
  assert.ok(app.calls.some((c) => c.tool === 'list_zones'));
});

test('confirm token: issued, bound to session, needs a user turn, single use, expires', () => {
  let now = 1_000;
  const store = new ConfirmStore({ now: () => now, ttlMs: 60_000 });
  const a = store.issue('sess-a', { kind: 'wet', reason: 'wet' });
  assert.equal(store.assertUsable('sess-a', a.id).ok, false); // not armed
  store.noteUserUtterance('sess-a', 'yes, do it', 'transcript');
  assert.equal(store.assertUsable('sess-a', a.id).ok, true);
  assert.equal(store.assertUsable('sess-b', a.id).ok, false); // other session
  store.consume(a.id);
  assert.equal(store.assertUsable('sess-a', a.id).ok, false); // used
  const b = store.issue('sess-a', { kind: 'window', reason: 'limit' });
  store.noteUserUtterance('sess-a', 'go ahead', 'transcript');
  now += 61_000;
  const expired = store.assertUsable('sess-a', b.id);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.code, 'expired');
  assert.equal(store.assertUsable('sess-a', 'invented').ok, false);
});

test('confirm token: "no" revokes; inventing a token never pours', async () => {
  const app = new FakeApp();
  const { rt } = runtimeOf(app);
  const refused = await rt.runTool('pour_water', {}, 'c1');
  const token = (refused.payload as { confirm_token: string }).confirm_token;
  assert.ok(token);
  rt.noteUserText('no, stop');
  const again = await rt.runTool('pour_water', { confirm_token: token }, 'c2');
  assert.equal((again.payload as { ok: boolean }).ok, false);
  const fake = await rt.runTool('pour_water', { confirm_token: 'pgc_forged' }, 'c3');
  assert.equal((fake.payload as { ok: boolean }).ok, false);
  assert.equal(app.pours.filter((p) => p.force).length, 0);
});

test('hard limits never get a confirm_token (busy)', async () => {
  const app = new FakeApp();
  app.wet = false;
  app.busy = true;
  const { rt, client } = runtimeOf(app);
  const out = await rt.runTool('pour_water', {}, 'c1');
  const p = out.payload as { overridable: boolean; confirm_token: string | null; result: string };
  assert.equal(p.result, 'busy');
  assert.equal(p.overridable, false);
  assert.equal(p.confirm_token, null);
  assert.ok(!client.some((e) => e.type === 'awaiting_confirmation'));
});

test('voice ignores model force=true; only a confirm_token after a user turn pours', async () => {
  const app = new FakeApp();
  const { rt } = runtimeOf(app);
  const forced = await rt.runTool('pour_water', { force: true }, 'c0');
  const p0 = forced.payload as { ok: boolean; confirm_token: string | null; overridable: boolean };
  assert.equal(p0.ok, false);
  assert.equal(p0.overridable, true);
  assert.ok(p0.confirm_token);
  assert.equal(app.pours.at(-1)?.force, false);
});

test('event sequence: refuse → confirm → pour (soft wet guard)', async () => {
  const app = new FakeApp();
  const { rt, client, provider } = runtimeOf(app);
  rt.start();
  assert.equal(client[0]?.type, 'session_started');

  const refused = await rt.runTool('pour_water', {}, 'call-1');
  const p1 = refused.payload as { ok: boolean; overridable: boolean; confirm_token: string; guard: string };
  assert.equal(p1.ok, false);
  assert.equal(p1.overridable, true);
  assert.equal(p1.guard, 'soft');
  const token = p1.confirm_token;
  assert.match(token, /^pgc_/);

  const types1 = client.map((e) => e.type);
  assert.ok(types1.includes('tool_call_started'));
  assert.ok(types1.includes('tool_call_finished'));
  assert.ok(types1.includes('awaiting_confirmation'));
  const wait = client.find((e) => e.type === 'awaiting_confirmation');
  assert.ok(wait && wait.type === 'awaiting_confirmation' && wait.what === 'pour_water');

  // Token is not usable until the user speaks.
  const early = await rt.runTool('pour_water', { confirm_token: token }, 'call-2');
  assert.equal((early.payload as { ok: boolean }).ok, false);
  assert.equal(app.pours.filter((p) => p.force).length, 0);

  rt.handleClientMessage({ type: 'text', text: 'Yes, do it.' });
  const afterTurn = await rt.runTool('pour_water', { confirm_token: token }, 'call-3');
  const p3 = afterTurn.payload as { ok: boolean; result: string };
  assert.equal(p3.ok, true);
  assert.equal(p3.result, 'started');
  assert.ok(app.pours.some((p) => p.force && p.caller === 'voice'));

  // Single use.
  const reuse = await rt.runTool('pour_water', { confirm_token: token }, 'call-4');
  assert.equal((reuse.payload as { ok: boolean }).ok, false);

  const started = client.find((e) => e.type === 'tool_call_started' && e.tool === 'pour_water');
  assert.ok(started && started.type === 'tool_call_started');
  assert.deepEqual(started.zones, ['A']);
  assert.ok(provider.some((m) => (m as { type?: string }).type === 'session.update'));
  assert.ok(provider.some((m) => (m as { type?: string }).type === 'conversation.item.create'));
});

test('window soft guard is also overridable; HARDWARE=off never sends a pour', async () => {
  const app = new FakeApp();
  app.wet = false;
  app.windowFull = true;
  const { rt } = runtimeOf(app);
  const refused = await rt.runTool('pour_water', {}, 'c1');
  const p = refused.payload as { overridable: boolean; confirm_token: string };
  assert.equal(p.overridable, true);
  assert.ok(p.confirm_token);

  const soil = new SoilApp({ ...env(), hardwareOff: true });
  const out = await soil.pourWater({ caller: 'voice' });
  assert.equal(out.ok, false);
  assert.equal(out.result, 'offline');
  assert.equal(out.guard, 'hard');
});
