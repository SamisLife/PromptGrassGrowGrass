import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { moistureWord } from './advice.js';
import type { McpBackend } from './proxy.js';
import type { PourCaller, ZoneId } from './types.js';

const zoneArg = z.string().describe('Zone id, e.g. "A" or "B". Use list_zones to see the ids.');
const round = (x: number | null | undefined, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errResult(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true as const };
}

export function createSoilMcp(app: McpBackend, caller: PourCaller): McpServer {
  const server = new McpServer(
    { name: 'promptgrass', version: '0.1.0' },
    {
      instructions:
        'This server exposes live soil-probe readings and a physical pour. Quote measured numbers; label estimates. Check get_forecast before recommending water. After pour_water, re-read zone A in 10–20 seconds — the servo has no position feedback.',
    },
  );

  const mark = (tool: string, zones: ZoneId[], summary: string) => app.recordAgentCall(tool, zones, summary);
  const allZones = (): ZoneId[] => app.config.zones.map((z) => z.id);

  server.registerTool(
    'list_zones',
    {
      title: 'List zones',
      description: "List the zones of the user's plot with a one-line live status for each (moisture, soil temperature, whether it needs water). Start here.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        mark('list_zones', allZones(), 'Listed zones');
        const zones = await Promise.all(app.config.zones.map(async (z) => {
          const r = await app.readZone(z.id);
          return {
            id: z.id, name: z.name, probe_position_cm: { x: round(z.x), y: round(z.y) }, sun: z.sun,
            relative_moisture_pct: round(r.live.moisturePct, 0), moisture_state: moistureWord(r.live.moisturePct),
            soil_temp_c: round(r.live.tempC), needs_water: r.water.needsWater, status: r.water.headline,
          };
        }));
        return jsonResult({ mode: app.mode, plot: { name: app.config.plot.name, width_cm: app.config.plot.width, length_cm: app.config.plot.length }, location: app.config.place?.name ?? null, zones });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'read_zone',
    {
      title: 'Read a zone',
      description: 'Live probe readings for one zone: relative soil moisture, soil temperature at about 5 cm depth, and a watering recommendation with its reasons. The recommendation already takes the rain forecast into account, so it may say to wait for rain. Raw ADC counts are included so you can reason about change over time.',
      inputSchema: z.object({ zone: zoneArg }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ zone }) => {
      try {
        const r = await app.readZone(zone);
        mark('read_zone', [r.zone.id], `Read zone ${r.zone.id}`);
        return jsonResult({
          mode: app.mode,
          zone: r.zone.id,
          moisture: {
            raw_adc_counts: r.live.moistureRaw,
            relative_pct: round(r.live.moisturePct, 0),
            state: moistureWord(r.live.moisturePct),
            probe_online: r.live.moistureOnline,
            calibrated: r.calibrated,
            note: "Percent of this probe's air-to-water range (relative moisture), not volumetric water content. Raw rises as the soil dries.",
          },
          soil_temperature: { celsius: round(r.live.tempC), probe_online: r.live.tempOnline, depth_cm: 5 },
          watering: { needs_water: r.water.needsWater, action: r.water.action, headline: r.water.headline, reasons: r.water.reasons },
          reading_time: new Date(r.live.t).toISOString(),
          age_ms: Date.now() - r.live.t,
        });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'get_soil_profile',
    {
      title: 'Soil profile',
      description: 'What the soil is like: drainage class and likely texture, from the pour test (water poured at one probe, timed until it reaches the other). Returns the measured distance, seconds and wetting-front speed. Null profile means no pour test has been run yet.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const p = await app.soilProfile();
        mark('get_soil_profile', p ? [...p.between] : allZones(), 'Read soil profile');
        if (!p) return jsonResult({ mode: app.mode, profile: null, note: 'No pour test has been run yet, so drainage is unknown. Ask the user to run the pour test, or call pour_water yourself if they agree.' });
        return jsonResult({
          mode: app.mode,
          profile: {
            drainage_class: p.drainageClass, label: p.label, likely_texture: p.texture,
            measured: { from_zone: p.between[0], to_zone: p.between[1], distance_cm: round(p.distanceCm), seconds: round(p.seconds), speed_cm_per_min: round(p.rateCmMin) },
            measured_at: new Date(p.measuredAt).toISOString(),
            note: 'Drainage is measured. Texture is inferred from the speed, so treat it as an estimate.',
          },
        });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'score_crops',
    {
      title: 'Score crops',
      description: "Score crops 0-100 for one zone using the app's deterministic rules engine (drainage, soil temperature, season, sun, pH). Each crop comes with the reasons behind its score. Report these scores and reasons; do not invent your own.",
      inputSchema: z.object({
        zone: zoneArg,
        limit: z.number().optional().describe('How many crops to return from the top of the ranking (default 8). The 3 lowest are always included too.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ zone, limit }) => {
      try {
        const all = await app.scoreCrops(zone);
        const id = app.zone(zone).id;
        mark('score_crops', [id], `Scored ${all.length} crops for zone ${id}`);
        const n = Math.max(1, Math.min(30, Number(limit) || 8));
        const slim = (c: (typeof all)[number]) => ({
          crop: c.name, id: c.id, score: c.score, verdict: c.verdict, plantable_now: c.plantableNow, why: c.summary,
          factors: c.factors.map((f) => ({ factor: f.label, score: f.score, reason: f.reason })), confidence: c.confidence,
        });
        return jsonResult({ mode: app.mode, zone: id, best: all.slice(0, n).map(slim), worst: all.slice(-3).map(slim), not_known: all[0]?.unknowns ?? [] });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'get_planting_window',
    {
      title: 'Planting window',
      description: "When to plant a given crop here: the planting window from the user's location (local frost history) and whether the soil in that zone is warm enough today.",
      inputSchema: z.object({
        crop: z.string().describe('Crop name or id, e.g. "carrot", "tomato", "garlic".'),
        zone: zoneArg.optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ crop, zone }) => {
      try {
        const id = zone ? app.zone(zone).id : app.config.zones[0]?.id;
        if (!id) throw new Error('No zones configured.');
        const w = await app.plantingWindow(crop, id);
        mark('get_planting_window', [id], `Planting window: ${crop}`);
        if (!w) return jsonResult({ mode: app.mode, window: null, note: 'The user has not set a location yet, so frost dates are unknown.' });
        return jsonResult({ mode: app.mode, crop: w.cropName, status: w.status, windows: w.windows, next_open: w.nextOpen, soil_temp_c: round(w.soilTempC), soil_temp_needed_c: w.soilTempMinC, soil_warm_enough_today: w.soilWarmEnough, summary: w.text });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'get_forecast',
    {
      title: 'Weather forecast',
      description: "7-day weather forecast for the plot's location: daily rain (mm and probability) and temperatures, plus whether meaningful rain is expected in the next 48 hours. Use it before recommending watering.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const f = await app.forecast();
        mark('get_forecast', [], 'Read forecast');
        return jsonResult({
          mode: app.mode,
          summary: f.text, rain_expected_next_48h: f.rainExpected, rain_next_48h_mm: f.rainNext48hMm, max_rain_probability_48h_pct: f.maxPrecipProb48h, dry_days_ahead: f.dryDaysAhead,
          days: f.days.map((d) => ({ date: d.date, rain_mm: d.precipMm, rain_probability_pct: d.precipProb, high_c: d.tmaxC, low_c: d.tminC })),
          source: f.sample ? 'sample data (no internet): say so if you use it' : f.source === 'override' ? 'demo override' : 'Open-Meteo forecast',
        });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'get_history',
    {
      title: 'Zone history',
      description: 'Recorded moisture and soil temperature for a zone over the past hours, summarised: start, end, min, max, trend, and a thinned series. Useful for "has it been drying out?" or day/night temperature swings.',
      inputSchema: z.object({
        zone: zoneArg,
        hours: z.number().optional().describe('How far back to look, 1-72 (default 24).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ zone, hours: hoursArg }) => {
      try {
        const id = app.zone(zone).id;
        const hours = Math.max(1, Math.min(72, Number(hoursArg) || 24));
        const h = await app.historyFor(id, hours);
        mark('get_history', [id], `Read ${hours} h of history for zone ${id}`);
        const stat = (key: 'moisturePct' | 'tempC' | 'moistureRaw') => {
          const xs = h.points.map((p) => p[key]).filter((v): v is number => v != null);
          if (!xs.length) return null;
          return { start: round(xs[0]), end: round(xs[xs.length - 1]), min: round(Math.min(...xs)), max: round(Math.max(...xs)), change: round(xs[xs.length - 1] - xs[0]) };
        };
        const stride = Math.max(1, Math.ceil(h.points.length / 24));
        return jsonResult({
          mode: app.mode, zone: id, hours,
          relative_moisture_pct: stat('moisturePct'),
          moisture_raw_adc: stat('moistureRaw'),
          soil_temp_c: stat('tempC'),
          series: h.points.filter((_, i) => i % stride === 0).map((p) => ({ time: new Date(p.t).toISOString(), moisture_pct: round(p.moisturePct, 0), moisture_raw: p.moistureRaw ?? null, temp_c: round(p.tempC) })),
        });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add a note',
      description: "Save a short note to the plot's logbook, optionally attached to a zone: for example what was planted, or a reminder you gave the user. The note appears in the app.",
      inputSchema: z.object({
        text: z.string().describe('The note, under 500 characters.'),
        zone: zoneArg.optional().describe('Optional zone id to attach the note to.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ text, zone }) => {
      try {
        const id = zone ? app.zone(zone).id : null;
        const trimmed = String(text ?? '').trim();
        if (!trimmed) throw new Error('Note text is empty.');
        const n = await app.addNote(trimmed, id, 'agent');
        mark('add_note', id ? [id] : [], 'Added a note');
        return jsonResult({ mode: app.mode, saved: true, id: n.id, zone: n.zoneId, text: n.text });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'get_readings',
    {
      title: 'All live readings',
      description: 'Zone A and zone B together: raw moisture (ADC counts), relative moisture percent, short trend (change over 1, 5 and 15 minutes), temperature, online flags, data age, pour status, board presence, and mode. One call for a reasoner that has never seen this project.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        mark('get_readings', allZones(), 'Read all zones');
        return jsonResult(await app.readings());
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'pour_water',
    {
      title: 'Pour water',
      description: 'Tip the real water bottle into zone A with a servo. Returns immediately with started, busy, cooldown, refused or offline. Does not wait for confirmation — the MCP client should ask the human. After started, read zone A again in 10 to 20 seconds to confirm the water arrived (moisture raw counts should fall). Optional hold_ms (200–5000). If zone A already reads wet, the server refuses unless force is true.',
      inputSchema: z.object({
        hold_ms: z.number().optional().describe('How long to hold the bottle tipped, milliseconds (firmware clamps 200–5000). Omit for the firmware default.'),
        force: z.boolean().optional().describe('Pour even if zone A already reads wet.'),
      }),
      annotations: {
        title: 'Pour water into zone A',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ hold_ms, force }) => {
      try {
        mark('pour_water', ['A'], 'Requested a pour');
        const out = await app.pourWater({ holdMs: hold_ms, force, caller });
        return jsonResult({
          mode: app.mode,
          result: out.result,
          ok: out.ok,
          reason: out.reason ?? null,
          zone_a: out.reading ?? null,
          next: out.next ?? (out.result === 'started' ? 'Read zone A again in 10 to 20 seconds to confirm the water arrived.' : null),
        });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerTool(
    'get_pour_status',
    {
      title: 'Pour status',
      description: 'Whether the pour board is connected and what it is doing (idle, tipping, holding, returning), plus the software pour-detector state used for the soil profile.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        mark('get_pour_status', [], 'Read pour status');
        const actuator = await app.pourStatus();
        const readings = await app.readings() as { pour?: unknown };
        return jsonResult({ mode: app.mode, actuator, pour: readings.pour });
      } catch (e) { return errResult(e); }
    },
  );

  server.registerPrompt(
    'diagnose_field',
    {
      title: 'Diagnose the plot',
      description: 'Walk through the four questions (soil, what to plant, when, water) using the live tools, then act only if the user asks.',
    },
    () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `You are diagnosing a small garden plot instrumented with two soil-moisture + temperature probes (zone A and zone B, about 20 cm apart) and a servo that can tip a half water bottle into zone A.

How to work:
1. Call get_readings first. Quote raw ADC counts AND relative moisture percent. Raw rises as the soil dries. If a probe is offline, say so — do not invent a value or silently reuse an old one without stating its age.
2. Call get_forecast. rain_expected_next_48h already applies the project's rule (≥ 5 mm and ≥ 60 % probability in 48 h). If source says sample data, tell the user the network was down.
3. Call get_soil_profile. Texture is an estimate inferred from wetting-front speed; drainage class is measured. If profile is null, say drainage is unknown until a pour test is run.
4. Call score_crops for zone A (and B if they differ). Report the engine's scores and reasons. Do not substitute your own ranking.
5. Optionally get_planting_window for a crop the user cares about.
6. Separate measured from estimated in your answer. Crop scores, watering advice and drainage classes come from deterministic rules; you explain them, you do not replace them.
7. Do not water just because it is dry: if the forecast says rain is coming, recommend waiting.
8. Only call pour_water if the user asks to water, or clearly confirms. The client will typically ask them first. After a pour, wait 10–20 seconds and read_zone A (or get_readings) to confirm: moisture raw counts should fall. The servo has no position feedback, so "done" is not evidence that water came out.
9. All data is from real probes. If a probe or board is offline the value is null: say so, never guess.

Answer the four questions plainly: What is my soil like? What can I plant here? When should I plant it? Does it need water right now?`,
        },
      }],
    }),
  );

  return server;
}

export function mcpHttpHandler(app: McpBackend) {
  return createMcpHandler(() => createSoilMcp(app, 'mcp-http'));
}
