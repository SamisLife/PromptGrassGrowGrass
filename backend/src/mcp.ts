import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { McpBackend } from './proxy.js';
import { runPlotTool } from './tools.js';
import type { PourCaller } from './types.js';

const zoneArg = z.string().describe('Zone id, e.g. "A" or "B". Use list_zones to see the ids.');

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errResult(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true as const };
}

async function tool(app: McpBackend, caller: PourCaller, name: string, args: Record<string, unknown> = {}) {
  const r = await runPlotTool(app, name, args, { caller });
  if (!r.ok) return errResult(r.error ?? r.payload);
  return jsonResult(r.payload);
}

export function createSoilMcp(app: McpBackend, caller: PourCaller): McpServer {
  const server = new McpServer(
    { name: 'promptgrass', version: '0.1.0' },
    {
      instructions:
        'This server exposes live soil-probe readings and a physical pour. Quote measured numbers; label estimates. Check get_forecast before recommending water. After pour_water, re-read zone A in 10–20 seconds — the servo has no position feedback.',
    },
  );

  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    'list_zones',
    { title: 'List zones', description: "List the zones of the user's plot with a one-line live status for each (moisture, soil temperature, whether it needs water). Start here.", inputSchema: z.object({}), annotations: ro },
    async () => tool(app, caller, 'list_zones'),
  );

  server.registerTool(
    'read_zone',
    { title: 'Read a zone', description: 'Live probe readings for one zone: relative soil moisture, soil temperature at about 5 cm depth, and a watering recommendation with its reasons. The recommendation already takes the rain forecast into account, so it may say to wait for rain. Raw ADC counts are included so you can reason about change over time.', inputSchema: z.object({ zone: zoneArg }), annotations: ro },
    async ({ zone }) => tool(app, caller, 'read_zone', { zone }),
  );

  server.registerTool(
    'get_soil_profile',
    { title: 'Soil profile', description: 'What the soil is like: drainage class and likely texture, from the pour test (water poured at one probe, timed until it reaches the other). Returns the measured distance, seconds and wetting-front speed. Null profile means no pour test has been run yet.', inputSchema: z.object({}), annotations: ro },
    async () => tool(app, caller, 'get_soil_profile'),
  );

  server.registerTool(
    'score_crops',
    {
      title: 'Score crops',
      description: "Score crops 0-100 for one zone using the app's deterministic rules engine (drainage, soil temperature, season, sun, pH). Each crop comes with the reasons behind its score. Report these scores and reasons; do not invent your own.",
      inputSchema: z.object({ zone: zoneArg, limit: z.number().optional().describe('How many crops to return from the top of the ranking (default 8). The 3 lowest are always included too.') }),
      annotations: ro,
    },
    async ({ zone, limit }) => tool(app, caller, 'score_crops', { zone, limit }),
  );

  server.registerTool(
    'get_planting_window',
    {
      title: 'Planting window',
      description: "When to plant a given crop here: the planting window from the user's location (local frost history) and whether the soil in that zone is warm enough today.",
      inputSchema: z.object({ crop: z.string().describe('Crop name or id, e.g. "carrot", "tomato", "garlic".'), zone: zoneArg.optional() }),
      annotations: ro,
    },
    async ({ crop, zone }) => tool(app, caller, 'get_planting_window', { crop, zone }),
  );

  server.registerTool(
    'get_forecast',
    { title: 'Weather forecast', description: "7-day weather forecast for the plot's location: daily rain (mm and probability) and temperatures, plus whether meaningful rain is expected in the next 48 hours. Use it before recommending watering.", inputSchema: z.object({}), annotations: { ...ro, openWorldHint: true } },
    async () => tool(app, caller, 'get_forecast'),
  );

  server.registerTool(
    'get_history',
    {
      title: 'Zone history',
      description: 'Recorded moisture and soil temperature for a zone over the past hours, summarised: start, end, min, max, trend, and a thinned series. Useful for "has it been drying out?" or day/night temperature swings.',
      inputSchema: z.object({ zone: zoneArg, hours: z.number().optional().describe('How far back to look, 1-72 (default 24).') }),
      annotations: ro,
    },
    async ({ zone, hours }) => tool(app, caller, 'get_history', { zone, hours }),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add a note',
      description: "Save a short note to the plot's logbook, optionally attached to a zone: for example what was planted, or a reminder you gave the user. The note appears in the app.",
      inputSchema: z.object({ text: z.string().describe('The note, under 500 characters.'), zone: zoneArg.optional().describe('Optional zone id to attach the note to.') }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ text, zone }) => tool(app, caller, 'add_note', { text, zone }),
  );

  server.registerTool(
    'get_readings',
    { title: 'All live readings', description: 'Zone A and zone B together: raw moisture (ADC counts), relative moisture percent, short trend (change over 1, 5 and 15 minutes), temperature, online flags, data age, pour status, board presence, and mode. One call for a reasoner that has never seen this project.', inputSchema: z.object({}), annotations: ro },
    async () => tool(app, caller, 'get_readings'),
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
      annotations: { title: 'Pour water into zone A', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ hold_ms, force }) => tool(app, caller, 'pour_water', { hold_ms, force }),
  );

  server.registerTool(
    'get_pour_status',
    { title: 'Pour status', description: 'Whether the pour board is connected and what it is doing (idle, tipping, holding, returning), plus the software pour-detector state used for the soil profile.', inputSchema: z.object({}), annotations: ro },
    async () => tool(app, caller, 'get_pour_status'),
  );

  server.registerTool(
    'find_complementary_farms',
    {
      title: 'Find complementary farms nearby',
      description: "Who near this plot should the user be talking to? Returns neighbouring fields whose soil complements this one: what they grow (USDA Cropland Data Layer), what this plot could grow that they cannot and the reverse (the app's crop rules run on both soils; theirs from the USDA SSURGO survey), distance, and a one-sentence pairing. Also makes the web app zoom out over the region. Farm and contact names are illustrative, not real people: say so. Pass farm to get a first-message draft for one match.",
      inputSchema: z.object({ limit: z.number().optional().describe('How many matches to return (default 5, max 8).'), farm: z.string().optional().describe('A farm_id from a previous call: return only that farm, with a first-message draft, and glide the map to it.') }),
      annotations: { ...ro, openWorldHint: true },
    },
    async ({ limit, farm }) => tool(app, caller, 'find_complementary_farms', { limit, farm }),
  );

  server.registerPrompt(
    'diagnose_field',
    { title: 'Diagnose the plot', description: 'Walk through the four questions (soil, what to plant, when, water) using the live tools, then act only if the user asks.' },
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
