/**
 * The agent's tool set. Small and legible on purpose: names and descriptions
 * are what the agent reads, so they are written for a reader.
 *
 * Every tool returns plain JSON built from probe readings, calculations or
 * lookups. Nothing here invents a number. Each call is recorded in the store,
 * which makes the touched zones glow on the field and shows up in the agent
 * activity feed, so a person watching can see the tool calls land.
 *
 * `pour_water` tips the real bottle. It goes through the backend's guarded route only, and a
 * soft guard can be overridden by the PERSON pressing a button on the page, never by the agent.
 */
import { moistureWord } from '../data/sim/advice';
import { applyUiCommand, useApp, type UiCommand } from '../data/store';
import { guardedPourStatus, requestGuardedPour } from '../services/pourBridge';
import { snapshotView, useAgent } from './agentStore';
import { personBusy } from './person';
import type { ZoneId } from '../data/types';

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  readOnly: boolean;
  /** has an effect in the physical world: the browser should ask the person first */
  consequential?: boolean;
  /** what the person reads while this runs, in plain words ("Reading zone B") */
  say(args: Record<string, any>): string;
  /**
   * What the app should be showing so the screen agrees with what the agent is about to say.
   * Applied only while the person is not busy and "follow" is on (agent/webmcp.ts).
   */
  show?(args: Record<string, any>, result: any): UiCommand | null;
  run(args: Record<string, any>, ctx: { signal?: AbortSignal }): Promise<unknown>;
}

const zoneArg = { type: 'string', description: 'Zone id, e.g. "A" or "B". Use list_zones to see the ids.' };
const round = (x: number | null | undefined, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const S = () => useApp.getState();
const allZones = (): ZoneId[] => S().config?.zones.map((z) => z.id) ?? [];
const mark = (tool: string, zones: ZoneId[], summary: string) => S().recordAgentCall(tool, zones, summary);
function resolveZone(id: unknown): ZoneId {
  const zones = S().config?.zones ?? [];
  const want = String(id ?? '').trim().toLowerCase().replace(/^zone\s+/, '');
  const z = zones.find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want || x.name.toLowerCase() === 'zone ' + want);
  if (!z) throw new Error(`Unknown zone "${id}". Valid zones: ${zones.map((x) => x.id).join(', ')}.`);
  return z.id;
}

export const TOOLS: AgentTool[] = [
  {
    name: 'list_zones',
    description: "List the zones of the user's plot with a one-line live status for each (moisture, soil temperature, whether it needs water). Start here.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    say: () => 'Looking over the zones',
    async run() {
      const { board, config } = S();
      mark('list_zones', allZones(), 'Listed zones');
      const zones = await Promise.all((config?.zones ?? []).map(async (z) => {
        const r = await board.readZone(z.id);
        return {
          id: z.id, name: z.name, probe_position_cm: { x: round(z.x), y: round(z.y) }, sun: z.sun,
          relative_moisture_pct: round(r.live.moisturePct, 0), moisture_state: moistureWord(r.live.moisturePct),
          soil_temp_c: round(r.live.tempC), needs_water: r.water.needsWater, status: r.water.headline,
        };
      }));
      return { plot: { name: config?.plot.name, width_cm: config?.plot.width, length_cm: config?.plot.length }, location: config?.place?.name ?? null, zones };
    },
  },
  {
    name: 'read_zone',
    description: 'Live probe readings for one zone: relative soil moisture, soil temperature at about 5 cm depth, and a watering recommendation with its reasons. The recommendation already takes the rain forecast into account, so it may say to wait for rain.',
    inputSchema: { type: 'object', properties: { zone: zoneArg }, required: ['zone'], additionalProperties: false },
    readOnly: true,
    say: (a) => `Reading zone ${String(a.zone ?? '').toUpperCase()}`,
    show: (_a, r) => ({ zone: r.zone }),
    async run(a) {
      const id = resolveZone(a.zone);
      const r = await S().board.readZone(id);
      mark('read_zone', [id], `Read zone ${id}`);
      return {
        zone: id,
        moisture: {
          relative_pct: round(r.live.moisturePct, 0), state: moistureWord(r.live.moisturePct), probe_online: r.live.moistureOnline, calibrated: r.calibrated,
          note: "Percent of this probe's air-to-water range (relative moisture), not volumetric water content.",
        },
        soil_temperature: { celsius: round(r.live.tempC), probe_online: r.live.tempOnline, depth_cm: 5 },
        watering: { needs_water: r.water.needsWater, action: r.water.action, headline: r.water.headline, reasons: r.water.reasons },
        reading_time: new Date(r.live.t).toISOString(),
      };
    },
  },
  {
    name: 'get_soil_profile',
    description: 'What the soil is like: drainage class and likely texture, from the pour test (water poured at one probe, timed until it reaches the other). Returns the measured distance, seconds and wetting-front speed. Null profile means no pour test has been run yet.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    say: () => 'Checking the soil profile',
    show: (_a, r) => (r.profile ? { drawer: 'soil' } : null),
    async run() {
      const p = await S().board.soilProfile();
      mark('get_soil_profile', p ? [...p.between] : allZones(), 'Read soil profile');
      if (!p) return { profile: null, note: 'No pour test has been run yet, so drainage is unknown. Ask the user to run the pour test.' };
      return {
        profile: {
          drainage_class: p.drainageClass, label: p.label, likely_texture: p.texture,
          measured: { from_zone: p.between[0], to_zone: p.between[1], distance_cm: round(p.distanceCm), seconds: round(p.seconds), speed_cm_per_min: round(p.rateCmMin) },
          measured_at: new Date(p.measuredAt).toISOString(),
          note: 'Drainage is measured. Texture is inferred from the speed, so treat it as an estimate.',
        },
      };
    },
  },
  {
    name: 'score_crops',
    description: "Score crops 0-100 for one zone using the app's deterministic rules engine (drainage, soil temperature, season, sun, pH). Each crop comes with the reasons behind its score. Report these scores and reasons; do not invent your own.",
    inputSchema: { type: 'object', properties: { zone: zoneArg, limit: { type: 'integer', minimum: 1, maximum: 30, description: 'How many crops to return from the top of the ranking (default 8). The 3 lowest are always included too.' } }, required: ['zone'], additionalProperties: false },
    readOnly: true,
    say: (a) => `Scoring crops for zone ${String(a.zone ?? '').toUpperCase()}`,
    show: (_a, r) => ({ zone: r.zone, drawer: 'plant' }),
    async run(a) {
      const id = resolveZone(a.zone);
      const all = await S().board.scoreCrops(id);
      mark('score_crops', [id], `Scored ${all.length} crops for zone ${id}`);
      const n = Math.max(1, Math.min(30, Number(a.limit) || 8));
      const slim = (c: (typeof all)[number]) => ({
        crop: c.name, id: c.id, score: c.score, verdict: c.verdict, plantable_now: c.plantableNow, why: c.summary,
        factors: c.factors.map((f) => ({ factor: f.label, score: f.score, reason: f.reason })), confidence: c.confidence,
      });
      return { zone: id, best: all.slice(0, n).map(slim), worst: all.slice(-3).map(slim), not_known: all[0]?.unknowns ?? [] };
    },
  },
  {
    name: 'get_planting_window',
    description: "When to plant a given crop here: the planting window from the user's location (local frost history) and whether the soil in that zone is warm enough today.",
    inputSchema: { type: 'object', properties: { crop: { type: 'string', description: 'Crop name or id, e.g. "carrot", "tomato", "garlic".' }, zone: { ...zoneArg, description: 'Optional zone id. Defaults to the zone the person has selected.' } }, required: ['crop'], additionalProperties: false },
    readOnly: true,
    say: (a) => `Checking when to plant ${String(a.crop ?? 'that').toLowerCase()}`,
    show: (_a, r) => (r.crop_id ? { crop: r.crop_id, zone: r.zone, drawer: 'when' } : null),
    async run(a) {
      const id = a.zone ? resolveZone(a.zone) : S().selectedZone;
      const w = await S().board.plantingWindow(String(a.crop), id);
      mark('get_planting_window', [id], `Planting window: ${a.crop}`);
      if (!w) return { window: null, note: 'The user has not set a location yet, so frost dates are unknown.' };
      return { crop: w.cropName, crop_id: w.cropId, zone: id, status: w.status, windows: w.windows, next_open: w.nextOpen, soil_temp_c: round(w.soilTempC), soil_temp_needed_c: w.soilTempMinC, soil_warm_enough_today: w.soilWarmEnough, summary: w.text };
    },
  },
  {
    name: 'get_forecast',
    description: "7-day weather forecast for the plot's location: daily rain (mm and probability) and temperatures, plus whether meaningful rain is expected in the next 48 hours. Use it before recommending watering.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    say: () => 'Checking the forecast',
    show: () => ({ drawer: 'water' }),
    async run() {
      const f = await S().board.forecast();
      mark('get_forecast', [], 'Read forecast');
      return {
        summary: f.text, rain_expected_next_48h: f.rainExpected, rain_next_48h_mm: f.rainNext48hMm, max_rain_probability_48h_pct: f.maxPrecipProb48h, dry_days_ahead: f.dryDaysAhead,
        days: f.days.map((d) => ({ date: d.date, rain_mm: d.precipMm, rain_probability_pct: d.precipProb, high_c: d.tmaxC, low_c: d.tminC })),
        source: f.sample ? 'sample data (no internet): say so if you use it' : 'Open-Meteo forecast',
      };
    },
  },
  {
    name: 'get_history',
    description: 'Recorded moisture and soil temperature for a zone over the past hours, summarised: start, end, min, max, trend, and a thinned series. Useful for "has it been drying out?" or day/night temperature swings.',
    inputSchema: { type: 'object', properties: { zone: zoneArg, hours: { type: 'integer', minimum: 1, maximum: 72, description: 'How far back to look, 1-72 (default 24).' } }, required: ['zone'], additionalProperties: false },
    readOnly: true,
    say: (a) => `Looking back at zone ${String(a.zone ?? '').toUpperCase()}`,
    show: (_a, r) => ({ view: 'history', zone: r.zone }),
    async run(a) {
      const id = resolveZone(a.zone);
      const hours = Math.max(1, Math.min(72, Number(a.hours) || 24));
      const h = await S().board.history(id, hours);
      mark('get_history', [id], `Read ${hours} h of history for zone ${id}`);
      const stat = (key: 'moisturePct' | 'tempC') => {
        const xs = h.points.map((p) => p[key]).filter((v): v is number => v != null);
        if (!xs.length) return null;
        return { start: round(xs[0]), end: round(xs[xs.length - 1]), min: round(Math.min(...xs)), max: round(Math.max(...xs)), change: round(xs[xs.length - 1] - xs[0]) };
      };
      const stride = Math.max(1, Math.ceil(h.points.length / 24));
      return {
        zone: id, hours, relative_moisture_pct: stat('moisturePct'), soil_temp_c: stat('tempC'),
        series: h.points.filter((_, i) => i % stride === 0).map((p) => ({ time: new Date(p.t).toISOString(), moisture_pct: round(p.moisturePct, 0), temp_c: round(p.tempC) })),
        ...(h.simulated ? { note: 'Simulated history (no board attached).' } : {}),
      };
    },
  },
  {
    name: 'add_note',
    description: "Save a short note to the plot's logbook, optionally attached to a zone: for example what was planted, or a reminder you gave the user. The note appears in the app.",
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The note, under 500 characters.' }, zone: { ...zoneArg, description: 'Optional zone id to attach the note to.' } }, required: ['text'], additionalProperties: false },
    readOnly: false,
    say: () => 'Writing a note',
    async run(a) {
      const id = a.zone ? resolveZone(a.zone) : null;
      const text = String(a.text ?? '').trim();
      if (!text) throw new Error('Note text is empty.');
      const n = await S().board.addNote(text, id, 'agent');
      mark('add_note', id ? [id] : [], 'Added a note');
      return { saved: true, id: n.id, zone: n.zoneId, text: n.text };
    },
  },
  {
    name: 'find_complementary_farms',
    description: "Who near this plot should the user be talking to? Finds neighbouring farms whose soil complements this one and returns, for each: what they grow (USDA Cropland Data Layer), what this plot could grow that they cannot and the reverse (the app's crop rules run on both soils; theirs comes from the USDA SSURGO soil survey), the distance, and a one-sentence pairing. Calling it also zooms the page out over the region so the user sees the matches light up. Farm and contact names are illustrative, not real people: say so. Pass `farm` to focus one match and get a first-message draft.",
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 8, description: 'How many matches to return (default 5, max 8).' }, farm: { type: 'string', description: 'A farm_id from a previous call: glide the map to it and include a first-message draft.' } }, additionalProperties: false },
    readOnly: true,
    say: (a) => (a.farm ? 'Drafting a message to a nearby farm' : 'Looking for farms that complement this soil'),
    async run(a) {
      // the page answers with the agent: same zoom-out as the manual control, unless the person is busy
      const busy = personBusy();
      if (!S().regionOn) { if (busy) useAgent.getState().offer('Show the farms around you', { view: 'region' }, busy); else S().goRegion(true); }
      await S().loadRegion();
      const r = S().regionData;
      mark('find_complementary_farms', allZones(), r?.status === 'ready' ? `Found ${r.matches.length} complementary farms` : 'Looked for complementary farms');
      if (!r || r.status !== 'ready') return { matches: [], why_empty: r?.reason ?? (r?.status === 'no_place' ? 'No location is set for this plot, so there is no region to look at.' : 'The land around this place is still loading. Ask again in a few seconds.') };
      if (!r.you.measured) return { matches: [], why_empty: "This plot's drainage has not been measured, so there is nothing honest to compare. Run the pour test first." };
      const focus = a.farm != null ? r.matches.find((m) => m.fieldId === String(a.farm) || m.identity.farm.toLowerCase() === String(a.farm).toLowerCase()) : undefined;
      if (focus && S().regionOn) S().selectFarm(focus.fieldId);
      const n = Math.max(1, Math.min(8, Number(a.limit) || 5));
      return {
        your_soil: r.you.label,
        matches: (focus ? [focus] : r.matches.slice(0, n)).map((m) => ({
          farm_id: m.fieldId, farm: m.identity.farm, contact_first_name: m.identity.person, match_score: m.score, distance_km: m.distanceKm, direction: m.bearing,
          they_grow: m.theyGrow,
          you_could_grow_they_cannot: m.youNotThey.slice(0, 4).map((g) => g.name), because_yours: m.youWhy,
          they_could_grow_you_cannot: m.theyNotYou.slice(0, 4).map((g) => g.name), because_theirs: m.theyWhy,
          already_growing_what_you_cannot: m.proven,
          their_soil: `${m.soil.series}${m.soil.texture ? ' ' + m.soil.texture.toLowerCase() : ''}${m.soil.drainagecl ? ', ' + m.soil.drainagecl.toLowerCase() : ''}`,
          in_one_sentence: m.sentence,
          ...(focus ? { first_message_draft: m.draft } : {}),
        })),
        crops_your_soil_suits_that_nobody_nearby_grows: r.unserved.slice(0, 6).map((c) => c.name),
        honesty: {
          crops: `looked up: USDA Cropland Data Layer ${r.region?.year ?? ''}`.trim(),
          their_soil: 'looked up: USDA SSURGO soil survey; their drainage class is an estimate mapped from it',
          your_soil: 'measured by the pour test', scores: "calculated by the app's crop rules, soil factors only",
          people: 'ILLUSTRATIVE. The farm names and first names are made up for this demo: the cropland map knows crops, not owners. Say so if you name one. Nothing is sent to anyone.',
        },
      };
    },
  },
  {
    name: 'navigate',
    description: "Move the app so the person sees what you are talking about. All fields are optional; send only what should change. view: field | pour | history | network | region (region pulls the camera up over the neighbouring farms). drawer: soil | plant | when | water | diagnose | none. zone: a zone id. lens: natural | moisture | temperature (how the 3D soil is coloured). crop: a crop id from score_crops (opens it in the plant list). farm: a farm_id from find_complementary_farms (glides to it). If the person is in the middle of something, the move is offered to them as a button instead of applied, and the result says so: do not call again, just tell them.",
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        view: { type: 'string', enum: ['field', 'pour', 'history', 'network', 'region'] },
        drawer: { type: 'string', enum: ['soil', 'plant', 'when', 'water', 'diagnose', 'none'] },
        zone: zoneArg,
        lens: { type: 'string', enum: ['natural', 'moisture', 'temperature'] },
        crop: { type: 'string', description: 'A crop id from score_crops, e.g. "carrot".' },
        farm: { type: 'string', description: 'A farm_id from find_complementary_farms, e.g. "f12".' },
      },
    },
    readOnly: false,
    say: (a) => describeMove(a),
    async run(a) {
      const cmd: UiCommand = {};
      const pick = (key: 'view' | 'drawer' | 'lens', allowed: string[]) => {
        if (a[key] == null) return;
        if (!allowed.includes(String(a[key]))) throw new Error(`Unknown ${key} "${a[key]}". Allowed: ${allowed.join(', ')}.`);
        cmd[key] = String(a[key]);
      };
      pick('view', ['field', 'pour', 'history', 'network', 'region']);
      pick('drawer', ['soil', 'plant', 'when', 'water', 'diagnose', 'none']);
      pick('lens', ['natural', 'moisture', 'temperature']);
      if (a.zone != null) cmd.zone = resolveZone(a.zone);
      if (a.crop != null) {
        const want = String(a.crop).toLowerCase().replace(/s$/, '');
        const crop = S().answers.crops.find((c) => c.id === want || c.name.toLowerCase().replace(/s$/, '') === want);
        if (!crop) throw new Error(`Unknown crop "${a.crop}". Use an id from score_crops, for example: ${S().answers.crops.slice(0, 4).map((c) => c.id).join(', ')}.`);
        cmd.crop = crop.id;
      }
      if (a.farm != null) {
        if (!S().regionData?.region?.fields.some((f) => f.id === String(a.farm))) throw new Error(`Unknown farm "${a.farm}". Use a farm_id from find_complementary_farms.`);
        cmd.farm = String(a.farm);
      }
      if (!Object.keys(cmd).length) throw new Error('navigate needs at least one of: view, drawer, zone, lens, crop, farm.');
      mark('navigate', cmd.zone ? [cmd.zone] : [], describeMove(cmd));
      const busy = personBusy();
      if (busy) {
        useAgent.getState().offer(describeMove(cmd), cmd, busy);
        return { applied: false, offered_to_person: true, because: `The person is ${busy} right now, so the view was not moved. A button offering "${describeMove(cmd)}" is on their screen for 20 seconds. Do not call navigate again for this; just tell them.` };
      }
      const before = snapshotView();
      applyUiCommand(cmd);
      return { applied: true, now_showing: cmd, __undo: before };
    },
  },
  {
    name: 'pour_water',
    description: "Tip the real water bottle into zone A. This moves a physical servo, once, for a few seconds. Only call it when the person asks for water to be poured. Safety limits are enforced by the hardware and the backend and cannot be overridden by anyone: one pour at a time, a cooldown between pours, the board must be connected. Two softer guards protect the soil: zone A already wet, or several pours in a short time. When one of those applies, the PAGE asks the person with a button and this call waits up to 45 seconds for their answer; you cannot answer for them and there is no argument that skips it. The servo has no position sensor: after a pour starts, wait about 15 seconds, call read_zone for zone A, and tell the person honestly whether the moisture rose.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { hold_ms: { type: 'integer', minimum: 500, maximum: 6000, description: 'Optional: how long to hold the bottle tipped, in milliseconds. The firmware clamps it. Leave it out for the normal pour.' } } },
    readOnly: false,
    consequential: true,
    say: () => 'Asking to pour water into zone A',
    async run(a, ctx) {
      const holdMs = a.hold_ms != null ? Number(a.hold_ms) : undefined;
      mark('pour_water', ['A'], 'Asked to pour water');
      let out = await requestGuardedPour({ holdMs }, ctx.signal);
      let confirmedByPerson = false;
      if (!out.ok && out.result === 'refused' && out.guard === 'soft') {
        // Only the person can override a soft guard, and only by pressing the button on the page.
        const yes = await useAgent.getState().askPour(out.reason ?? 'The soil guard advises against pouring now.', 45000, ctx.signal);
        if (!yes) return { poured: false, result: 'not_confirmed', why_it_asked: out.reason, note: 'The page asked the person and they declined or did not answer in time. Nothing moved. Do not retry unless they ask again.' };
        confirmedByPerson = true;
        out = await requestGuardedPour({ holdMs, force: true }, ctx.signal);
      }
      if (out.result === 'started') {
        return { poured: true, result: 'started', ...(confirmedByPerson ? { confirmed_by_person_on_page: true } : {}), hold_ms: out.holdMsUsed ?? null,
          next: 'The bottle is tipping now. Wait about 15 seconds, then call read_zone for zone A and report whether the moisture rose. If it did not, say so: the bottle may be empty or not over the probe.' };
      }
      const plain: Record<string, string> = {
        busy: 'It is still finishing the previous pour. Try again in a few seconds.', cooldown: 'It is cooling down between pours. Try again in a few seconds.',
        offline: 'The pour board is not connected, so nothing moved.', no_reply: 'The pour board did not answer, so nothing moved.',
        refused: 'The backend refused this pour.', unauthorized: 'This page is not allowed to pour.',
      };
      return { poured: false, result: out.result, reason: out.reason ?? plain[out.result] ?? 'Nothing moved.', can_be_overridden: false, in_plain_words: plain[out.result] ?? out.reason };
    },
  },
  {
    name: 'get_pour_status',
    description: 'Whether the water bottle\'s board is connected and what it is doing right now (idle, tipping, holding, returning), and how many seconds of cooldown are left. Use it if a pour was refused, or before promising the person a pour.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    say: () => 'Checking the water bottle',
    async run() {
      mark('get_pour_status', ['A'], 'Checked the pour board');
      const st = await guardedPourStatus();
      if (!st) return { connected: false, note: 'The backend did not answer, so the state of the pour board is unknown.' };
      const a = st.actuator;
      return { connected: a.connected, doing: a.connected ? a.phase ?? 'idle' : null, cooldown_seconds_left: a.cooldownMsLeft != null ? Math.ceil(a.cooldownMsLeft / 1000) : null, pours_since_power_on: a.pours ?? null, pour_test: S().pour.phase };
    },
  },
];

const VIEW_WORDS: Record<string, string> = { field: 'the field', pour: 'the pour test', history: 'the history', network: 'how data leaves the field', region: 'the farms around you' };
const DRAWER_WORDS: Record<string, string> = { soil: 'the soil profile', plant: 'what to plant', when: 'when to plant', water: 'the watering advice', diagnose: 'a diagnosis', none: 'the field' };
/** "Show the history", in words the person reads on the trail and on an offered button. */
export function describeMove(c: UiCommand): string {
  if (c.farm) return 'Show that farm';
  if (c.crop) return `Show ${c.crop.replace(/_/g, ' ')} in the plant list`;
  if (c.drawer) return `Show ${DRAWER_WORDS[c.drawer] ?? c.drawer}${c.zone ? ` for zone ${c.zone}` : ''}`;
  if (c.view) return `Show ${VIEW_WORDS[c.view] ?? c.view}`;
  if (c.lens) return c.lens === 'natural' ? 'Show the soil as it looks' : `Colour the soil by ${c.lens}`;
  if (c.zone) return `Select zone ${c.zone}`;
  return 'Move the view';
}
