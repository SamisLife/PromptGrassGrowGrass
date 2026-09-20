import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Throwaway data folder, set BEFORE anything imports persist. Nothing here touches the network.
const dir = mkdtempSync(join(tmpdir(), 'pg-region-'));
process.env.PROMPTGRASS_DATA_DIR = dir;
process.env.HARDWARE = 'off';

const { toAlbers, fromAlbers, inConus } = await import('../src/region/albers.js');
const { buildGrid, MAX_FIELD_CELLS } = await import('../src/region/build.js');
const { drainageFromSsurgo } = await import('../src/region/fetch.js');
const { findMatches, unservedCrops, soilOnlyScores, CAN, CANNOT } = await import('../src/region/match.js');
const { RegionService, buildRegion } = await import('../src/region/index.js');
const { runPlotTool, parseNavigateArgs } = await import('../src/tools.js');
const { BACKEND_ROOT } = await import('../src/env.js');
type Region = import('../src/region/types.js').Region;
type RegionSoil = import('../src/region/types.js').RegionSoil;

test('Albers: matches the published EPSG:5070 value, and inverts', () => {
  // CDL pixel we looked up by hand: Chualar, CA reads "Developed" at this projected point
  const [x, y] = toAlbers(-121.518, 36.5705);
  assert.ok(Math.abs(x - -2235511) < 2 && Math.abs(y - 1804589) < 2, `${x}, ${y}`);
  const [lon, lat] = fromAlbers(x, y);
  assert.ok(Math.abs(lon - -121.518) < 1e-6 && Math.abs(lat - 36.5705) < 1e-6);
  assert.deepEqual(toAlbers(-96, 23).map((v) => Math.round(v)), [0, 0]);
});

test('outside the contiguous US is recognised', () => {
  assert.equal(inConus(46.42, -120.33), true);
  assert.equal(inConus(48.85, 2.35), false);      // Paris
  assert.equal(inConus(21.3, -157.8), false);     // Honolulu: the CDL does not cover Hawaii
});

/** 80 x 80 pixels, 4 x 4 grid. West half corn (1), east half apples (68) with a forest corner (142) and a mint cell (14). */
function fakeRaster() {
  const w = 80, data = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) data[y * w + x] = x < 40 ? 1 : 68;
  for (let y = 0; y < 20; y++) for (let x = 60; x < 80; x++) data[y * w + x] = 142;
  for (let y = 60; y < 80; y++) for (let x = 60; x < 80; x++) data[y * w + x] = (x + y) % 3 === 0 ? 68 : 14;   // mint 2/3, apples 1/3
  const [cx, cy] = toAlbers(-120.33, 46.42);
  return { width: w, height: w, data, bbox: [cx - 1200, cy - 1200, cx + 1200, cy + 1200] as [number, number, number, number] };
}

test('grid: dominant crop per cell, unfarmed land is never a field, big blocks are split', () => {
  const g = buildGrid(fakeRaster(), 4);
  assert.equal(g.cellM, 600);
  assert.equal(g.cells[0], 1);
  assert.equal(g.cells[3], 142);
  assert.equal(g.fieldOf[3], -1, 'forest is land, not a farm');
  assert.equal(g.cells[15], 14);
  assert.ok(g.fields.every((f) => f.cells <= MAX_FIELD_CELLS));
  assert.equal(g.fields.reduce((s, f) => s + f.cells, 0), 15, 'every farmed cell belongs to exactly one field');
  const mint = g.fields.find((f) => f.code === 14)!;
  assert.deepEqual(mint.grows.map((x) => x.name), ['Mint', 'Apples']);
  assert.equal(mint.bearing, 'SE');
  assert.ok(Math.abs(mint.lat - 46.42) < 0.02 && Math.abs(mint.lon - -120.33) < 0.02, 'field coordinates land next to the centre');
  assert.ok(g.legend[0].farmed && g.legend.some((l) => l.name === 'Evergreen Forest' && !l.farmed));
});

test('SSURGO drainage classes map onto ours; unknown stays unknown', () => {
  assert.equal(drainageFromSsurgo('Somewhat excessively drained'), 'fast');
  assert.equal(drainageFromSsurgo('Well drained'), 'moderate');
  assert.equal(drainageFromSsurgo('Moderately well drained'), 'slow');
  assert.equal(drainageFromSsurgo('Somewhat poorly drained'), 'slow');
  assert.equal(drainageFromSsurgo('Very poorly drained'), 'very_slow');
  assert.equal(drainageFromSsurgo(null), null);
  assert.equal(drainageFromSsurgo(''), null);
});

const soil = (drainagecl: string, extra: Partial<RegionSoil> = {}): RegionSoil =>
  ({ mukey: '1', mapUnit: 'Test silt loam, 0 to 2 percent slopes', series: 'Test', texture: 'Silt loam', drainagecl, drainageClass: drainageFromSsurgo(drainagecl), ph: 7, ksatUmS: 9, ...extra });

async function fakeRegion(): Promise<Region> {
  return buildRegion({ lat: 46.42, lon: -120.33, name: 'Test valley' }, {
    raster: async () => ({ raster: fakeRaster(), year: 2024 }),
    soils: async (pts) => pts.map((_, i) => (i === 0 ? soil('Well drained') : soil('Somewhat poorly drained'))),
  });
}
const you = { drainageClass: 'fast' as const, ph: null, label: 'Fast draining, behaves like sandy soil', texture: 'sandy', plotName: 'Bench plot' };

test('complementarity is the set difference of two score lists from the same rules engine', async () => {
  const region = await fakeRegion();
  const matches = findMatches(region, you);
  assert.ok(matches.length >= 1);
  const mine = soilOnlyScores('fast', null), theirs = soilOnlyScores('slow', 7);
  for (const m of matches) {
    for (const g of m.youNotThey) { assert.ok(mine.get(g.id)! >= CAN && theirs.get(g.id)! <= CANNOT, g.name); assert.equal(g.you, mine.get(g.id)); }
    for (const g of m.theyNotYou) assert.ok(theirs.get(g.id)! >= CAN && mine.get(g.id)! <= CANNOT, g.name);
    assert.equal(m.identity.illustrative, true);
    assert.ok(m.score > 0 && m.score <= 100);
    assert.ok(!/undefined|null|NaN/.test(m.sentence + m.draft), m.sentence);
  }
  // a well-drained neighbour offers nothing a fast plot lacks at these thresholds? It offers lettuce; but never the reverse
  assert.ok(matches.every((m) => region.fields.find((f) => f.id === m.fieldId)!.soil!.drainageClass !== 'fast'));
  // the block already growing mint (which a fast soil cannot) is proven, and ranks first
  assert.deepEqual(matches[0].proven, ['Mint']);
  assert.ok(matches[0].sentence.includes('already growing mint'));
  // identities are stable between runs
  assert.equal(findMatches(region, you)[0].identity.farm, matches[0].identity.farm);
  assert.ok(unservedCrops(region, you).some((c) => c.id === 'carrot'));
  assert.ok(!unservedCrops(region, you).some((c) => c.id === 'corn'), 'corn is grown nearby, so it is not unserved');
});

test('fields without soil data are never offered as matches', async () => {
  const region = await buildRegion({ lat: 46.42, lon: -120.33 }, { raster: async () => ({ raster: fakeRaster(), year: 2024 }), soils: async () => { throw new Error('survey offline'); } });
  assert.ok(region.fields.length > 0 && region.fields.every((f) => f.soil === null), 'the land still draws');
  assert.deepEqual(findMatches(region, you), []);
});

test('service: outside the US is unavailable with a reason, and nothing is fetched', async () => {
  let calls = 0;
  const svc = new RegionService({ raster: async () => { calls++; throw new Error('no'); }, soils: async () => [] }, join(dir, 'none'));
  svc.ensure({ name: 'Paris', lat: 48.85, lon: 2.35 });
  assert.equal(svc.status, 'unavailable');
  assert.match(svc.reason!, /contiguous United States/);
  assert.equal(svc.region, null);
  assert.equal(calls, 0);
  svc.ensure(null);
  assert.equal(svc.status, 'no_place');
});

test('service: loads, caches to disk, and a second service reads the cache without fetching', async () => {
  let calls = 0;
  const io = { raster: async () => { calls++; return { raster: fakeRaster(), year: 2024 }; }, soils: async (p: unknown[]) => p.map(() => soil('Somewhat poorly drained')) };
  const a = new RegionService(io, join(dir, 'none'));
  const ready = new Promise<void>((res) => { a.onChange = () => { if (a.status === 'ready') res(); }; });
  a.ensure({ name: 'Somewhere', lat: 40.05, lon: -76.2 });
  assert.equal(a.status, 'loading');
  await ready;
  assert.equal(a.region!.fields.length > 0, true);
  const b = new RegionService({ raster: async () => { throw new Error('must not fetch'); }, soils: async () => [] }, join(dir, 'none'));
  b.ensure({ name: 'Somewhere', lat: 40.05, lon: -76.2 });
  assert.equal(b.status, 'ready');
  assert.equal(calls, 1);
});

test('the shipped demo region is real, complete, and found by coordinate with no network', () => {
  const r = JSON.parse(readFileSync(join(BACKEND_ROOT, 'region-data', 'demo-yakima.json'), 'utf8')) as Region;
  assert.equal(r.cells.length, r.n * r.n);
  assert.ok(r.fields.length >= 50 && r.fields.filter((f) => f.soil).length / r.fields.length > 0.9);
  assert.ok(new Set(r.fields.map((f) => f.code)).size >= 8, 'a patchwork, not a sea of one crop');
  const svc = new RegionService({ raster: async () => { throw new Error('must not fetch'); }, soils: async () => [] });
  svc.ensure({ name: 'demo', lat: 46.42, lon: -120.33 });
  assert.equal(svc.status, 'ready');
  assert.equal(svc.region!.precomputed, true);
  assert.ok(findMatches(svc.region!, you).length >= 3);
});

test('agent tool: honest when empty, zooms the app out, and drafts only when asked', async () => {
  const region = await fakeRegion();
  const shown: (string | undefined)[] = [];
  const base = { mode: 'board' as const, config: { zones: [{ id: 'A' }, { id: 'B' }] }, recordAgentCall() {}, showRegion: (f?: string) => { shown.push(f); } };
  const view = (measured: boolean, status = 'ready') => ({ ...base, regionMatches: async () => ({ status, reason: null, you: { measured, drainageClass: measured ? 'fast' : null, label: measured ? you.label : null, ph: null }, matches: measured ? findMatches(region, you) : [], unserved: [], method: {}, sources: region.sources }) });

  const none = await runPlotTool(view(false) as never, 'find_complementary_farms', {}, { caller: 'mcp-http' });
  assert.match((none.payload as { why_empty: string }).why_empty, /pour test/);
  const loading = await runPlotTool(view(false, 'loading') as never, 'find_complementary_farms', {}, { caller: 'mcp-http' });
  assert.match((loading.payload as { why_empty: string }).why_empty, /loading/);

  const full = await runPlotTool(view(true) as never, 'find_complementary_farms', {}, { caller: 'mcp-http' });
  const p = full.payload as { matches: Record<string, unknown>[]; honesty: { people: string } };
  assert.ok(p.matches.length >= 1 && !('first_message_draft' in p.matches[0]));
  assert.match(p.honesty.people, /ILLUSTRATIVE/);
  assert.equal(shown.at(-1), undefined, 'zooms out without focusing a farm');

  const one = await runPlotTool(view(true) as never, 'find_complementary_farms', { farm: p.matches[0].farm_id }, { caller: 'mcp-http' });
  const q = one.payload as { matches: { first_message_draft: string }[] };
  assert.equal(q.matches.length, 1);
  assert.match(q.matches[0].first_message_draft, /^Hi /);
  assert.equal(shown.at(-1), p.matches[0].farm_id, 'glides to that farm');
});

test('navigate accepts the region view and a farm id, and rejects junk', () => {
  assert.deepEqual(parseNavigateArgs({ view: 'region' }), { ok: true, command: { view: 'region' } });
  assert.deepEqual(parseNavigateArgs({ farm: 'f12' }), { ok: true, command: { farm: 'f12', view: 'region' } });
  assert.equal(parseNavigateArgs({ farm: 'the big one' }).ok, false);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
