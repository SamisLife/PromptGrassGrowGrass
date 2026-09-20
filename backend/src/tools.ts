import { HOW_TO_SAY, moistureInWords, scrub, trendInWords, type PourOutcome } from './plain.js';
import { moistureWord } from './advice.js';
import { CROPS } from './crops.js';
import type { McpBackend } from './proxy.js';
import type {
  PourCaller, SoftGuardKind, UiCommand, UiDrawer, UiLens, UiView, ZoneId, ZoneLive,
} from './types.js';

const VIEWS: readonly UiView[] = ['field', 'pour', 'history', 'network'];
const DRAWERS: readonly UiDrawer[] = ['soil', 'plant', 'when', 'water', 'diagnose', 'none'];
const LENSES: readonly UiLens[] = ['natural', 'moisture', 'temperature'];
const ZONE_IDS: readonly ZoneId[] = ['A', 'B'];

const round = (x: number | null | undefined, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export const PLOT_TOOL_NAMES = [
  'list_zones', 'read_zone', 'get_soil_profile', 'score_crops', 'get_planting_window',
  'get_forecast', 'get_history', 'add_note', 'get_readings', 'pour_water', 'get_pour_status',
] as const;

export const VOICE_ONLY_TOOLS = ['navigate'] as const;

export type PlotToolName = (typeof PLOT_TOOL_NAMES)[number];
export type VoiceToolName = PlotToolName | (typeof VOICE_ONLY_TOOLS)[number];

export interface VoiceToolHooks {
  sessionId: string;
  assertConfirmToken: (token: string) => { ok: true } | { ok: false; reason: string; code: string };
  consumeConfirmToken: (token: string) => void;
  issueConfirmToken: (input: { kind: SoftGuardKind; reason: string; reading?: ZoneLive }) => { id: string; expires_in_s: number };
  emitNavigate: (cmd: UiCommand) => void;
  onAwaitingConfirmation?: (info: { kind: SoftGuardKind; reason: string; expires_in_s: number }) => void;
  logPour: (row: Record<string, unknown>) => void;
}

export interface ToolRun {
  ok: boolean;
  payload: unknown;
  zones: ZoneId[];
  summary: string;
  error?: string;
}

/**
 * Entry point for every caller. Voice gets a plain-language view (src/plain.ts): same facts,
 * no raw sensor numbers, judgements already made. Everyone else gets the full payload.
 */
export async function runPlotTool(
  app: McpBackend,
  name: string,
  args: Record<string, unknown>,
  ctx: { caller: PourCaller; voice?: VoiceToolHooks },
): Promise<ToolRun> {
  const run = await runPlotToolFull(app, name, args, ctx);
  if (ctx.caller !== 'voice') return run;
  return { ...run, payload: run.ok ? forVoice(app, name, run.payload) : scrub(run.payload) };
}

/** The rule engine's reasons are written for a screen. Trim the jargon for the ear. */
const everyday = (text: string): string => text
  .replace(/Relative moisture/g, 'Moisture').replace(/relative moisture/g, 'moisture')
  .replace(/\s*\(sample forecast:[^)]*\)/g, ' (that forecast is only a placeholder, because no location is set)')
  .replace(/(\d+)\s*mm\b/g, '$1 millimetres').replace(/(\d+)%/g, '$1 percent');

function forVoice(app: McpBackend, name: string, payload: unknown): unknown {
  const outcome = (app as { pourOutcome?: () => PourOutcome | null }).pourOutcome?.() ?? null;
  const p = payload as Record<string, any>;
  if (name === 'read_zone') {
    const online = !!p.moisture?.probe_online;
    return {
      zone: p.zone,
      moisture: { in_words: moistureInWords(p.moisture?.relative_pct ?? null, online), percent: online ? p.moisture?.relative_pct ?? null : null, sensor_online: online },
      soil_temperature: { degrees_celsius: p.soil_temperature?.probe_online && p.soil_temperature?.celsius != null ? Math.round(p.soil_temperature.celsius) : null, sensor_online: !!p.soil_temperature?.probe_online },
      watering: { advice: p.watering?.headline, why: ((p.watering?.reasons ?? []) as string[]).map(everyday) },
      ...(p.zone === 'A' && outcome ? { since_last_pour: outcome } : {}),
      how_to_say: HOW_TO_SAY,
    };
  }
  if (name === 'get_readings') {
    const swing = 1517;   // counts between air and water for these probes: turns a count trend into percent
    const zones: Record<string, unknown> = {};
    for (const [id, z] of Object.entries((p.zones ?? {}) as Record<string, any>)) {
      const online = !!z.moisture?.online;
      const d = z.moisture?.trend?.delta_5min;
      zones[id] = {
        moisture: {
          in_words: moistureInWords(z.moisture?.relative_moisture_pct ?? null, online),
          percent: online && z.moisture?.relative_moisture_pct != null ? Math.round(z.moisture.relative_moisture_pct) : null,
          sensor_online: online,
          last_5_minutes: trendInWords(typeof d === 'number' ? (-d / swing) * 100 : null),
        },
        soil_temperature: { degrees_celsius: z.temperature?.online && z.temperature?.celsius != null ? Math.round(z.temperature.celsius) : null, sensor_online: !!z.temperature?.online },
      };
    }
    return { zones, boards_missing: p.boards?.missing ?? [], ...(outcome ? { since_last_pour: outcome } : {}), how_to_say: HOW_TO_SAY };
  }
  if (name === 'get_pour_status') return { ...(scrub(p) as object), since_last_pour: outcome, how_to_say: HOW_TO_SAY };
  if (name === 'pour_water') {
    const out = scrub(p) as Record<string, unknown>;
    if (out.result === 'started') out.next = 'Tell the user the water is pouring. Wait about 15 seconds, call read_zone for zone A, and say what since_last_pour.plain says.';
    return out;
  }
  return scrub(p);
}

async function runPlotToolFull(
  app: McpBackend,
  name: string,
  args: Record<string, unknown>,
  ctx: { caller: PourCaller; voice?: VoiceToolHooks },
): Promise<ToolRun> {
  const allZones = (): ZoneId[] => app.config.zones.map((z) => z.id);
  try {
    switch (name) {
      case 'list_zones': {
        const zones = await Promise.all(app.config.zones.map(async (z) => {
          const r = await app.readZone(z.id);
          return {
            id: z.id, name: z.name, probe_position_cm: { x: round(z.x), y: round(z.y) }, sun: z.sun,
            relative_moisture_pct: round(r.live.moisturePct, 0), moisture_state: moistureWord(r.live.moisturePct),
            soil_temp_c: round(r.live.tempC), needs_water: r.water.needsWater, status: r.water.headline,
            moisture_probe_online: r.live.moistureOnline, temp_probe_online: r.live.tempOnline,
          };
        }));
        app.recordAgentCall('list_zones', allZones(), 'Listed zones');
        return {
          ok: true, zones: allZones(), summary: 'Listed zones',
          payload: { mode: app.mode, plot: { name: app.config.plot.name, width_cm: app.config.plot.width, length_cm: app.config.plot.length }, location: app.config.place?.name ?? null, zones },
        };
      }
      case 'read_zone': {
        const r = await app.readZone(String(args.zone ?? ''));
        app.recordAgentCall('read_zone', [r.zone.id], `Read zone ${r.zone.id}`);
        return {
          ok: true, zones: [r.zone.id], summary: `Read zone ${r.zone.id}`,
          payload: {
            mode: app.mode,
            zone: r.zone.id,
            moisture: {
              raw_adc_counts: r.live.moistureRaw,
              relative_pct: round(r.live.moisturePct, 0),
              state: moistureWord(r.live.moisturePct),
              probe_online: r.live.moistureOnline,
              calibrated: r.calibrated,
              note: "Percent of this probe's air-to-water range (relative moisture), not volumetric water content. Raw rises as the soil dries. null means unknown, not zero.",
            },
            soil_temperature: { celsius: round(r.live.tempC), probe_online: r.live.tempOnline, depth_cm: 5 },
            watering: { needs_water: r.water.needsWater, action: r.water.action, headline: r.water.headline, reasons: r.water.reasons },
            reading_time: new Date(r.live.t).toISOString(),
            age_ms: Date.now() - r.live.t,
          },
        };
      }
      case 'get_soil_profile': {
        const p = await app.soilProfile();
        const zones = p ? [...p.between] : allZones();
        app.recordAgentCall('get_soil_profile', zones, 'Read soil profile');
        if (!p) {
          return {
            ok: true, zones, summary: 'No soil profile yet',
            payload: { mode: app.mode, profile: null, note: 'No pour test has been run yet, so drainage is unknown. Ask the user to run the pour test, or call pour_water yourself if they agree.' },
          };
        }
        return {
          ok: true, zones, summary: 'Read soil profile',
          payload: {
            mode: app.mode,
            profile: {
              drainage_class: p.drainageClass, label: p.label, likely_texture: p.texture,
              measured: { from_zone: p.between[0], to_zone: p.between[1], distance_cm: round(p.distanceCm), seconds: round(p.seconds), speed_cm_per_min: round(p.rateCmMin) },
              measured_at: new Date(p.measuredAt).toISOString(),
              note: 'Drainage is measured. Texture is inferred from the speed, so treat it as an estimate.',
            },
          },
        };
      }
      case 'score_crops': {
        const all = await app.scoreCrops(String(args.zone ?? ''));
        const id = app.zone(String(args.zone ?? '')).id;
        app.recordAgentCall('score_crops', [id], `Scored ${all.length} crops for zone ${id}`);
        const n = Math.max(1, Math.min(30, Number(args.limit) || 8));
        const slim = (c: (typeof all)[number]) => ({
          crop: c.name, id: c.id, score: c.score, verdict: c.verdict, plantable_now: c.plantableNow, why: c.summary,
          factors: c.factors.map((f) => ({ factor: f.label, score: f.score, reason: f.reason })), confidence: c.confidence,
        });
        return {
          ok: true, zones: [id], summary: `Scored crops for zone ${id}`,
          payload: { mode: app.mode, zone: id, best: all.slice(0, n).map(slim), worst: all.slice(-3).map(slim), not_known: all[0]?.unknowns ?? [] },
        };
      }
      case 'get_planting_window': {
        const crop = String(args.crop ?? '');
        const id = args.zone ? app.zone(String(args.zone)).id : app.config.zones[0]?.id;
        if (!id) throw new Error('No zones configured.');
        const w = await app.plantingWindow(crop, id);
        app.recordAgentCall('get_planting_window', [id], `Planting window: ${crop}`);
        if (!w) {
          return {
            ok: true, zones: [id], summary: `Planting window: ${crop}`,
            payload: { mode: app.mode, window: null, note: 'The user has not set a location yet, so frost dates are unknown.' },
          };
        }
        return {
          ok: true, zones: [id], summary: `Planting window: ${crop}`,
          payload: { mode: app.mode, crop: w.cropName, status: w.status, windows: w.windows, next_open: w.nextOpen, soil_temp_c: round(w.soilTempC), soil_temp_needed_c: w.soilTempMinC, soil_warm_enough_today: w.soilWarmEnough, summary: w.text },
        };
      }
      case 'get_forecast': {
        const f = await app.forecast();
        app.recordAgentCall('get_forecast', [], 'Read forecast');
        return {
          ok: true, zones: [], summary: 'Read forecast',
          payload: {
            mode: app.mode,
            summary: f.text, rain_expected_next_48h: f.rainExpected, rain_next_48h_mm: f.rainNext48hMm, max_rain_probability_48h_pct: f.maxPrecipProb48h, dry_days_ahead: f.dryDaysAhead,
            days: f.days.map((d) => ({ date: d.date, rain_mm: d.precipMm, rain_probability_pct: d.precipProb, high_c: d.tmaxC, low_c: d.tminC })),
            source: f.sample ? 'sample data (no internet): say so if you use it' : f.source === 'override' ? 'demo override' : 'Open-Meteo forecast',
          },
        };
      }
      case 'get_history': {
        const id = app.zone(String(args.zone ?? '')).id;
        const hours = Math.max(1, Math.min(72, Number(args.hours) || 24));
        const h = await app.historyFor(id, hours);
        app.recordAgentCall('get_history', [id], `Read ${hours} h of history for zone ${id}`);
        const stat = (key: 'moisturePct' | 'tempC' | 'moistureRaw') => {
          const xs = h.points.map((p) => p[key]).filter((v): v is number => v != null);
          if (!xs.length) return null;
          return { start: round(xs[0]), end: round(xs[xs.length - 1]), min: round(Math.min(...xs)), max: round(Math.max(...xs)), change: round(xs[xs.length - 1] - xs[0]) };
        };
        const stride = Math.max(1, Math.ceil(h.points.length / 24));
        return {
          ok: true, zones: [id], summary: `Read ${hours} h of history for zone ${id}`,
          payload: {
            mode: app.mode, zone: id, hours,
            relative_moisture_pct: stat('moisturePct'),
            moisture_raw_adc: stat('moistureRaw'),
            soil_temp_c: stat('tempC'),
            series: h.points.filter((_, i) => i % stride === 0).map((p) => ({ time: new Date(p.t).toISOString(), moisture_pct: round(p.moisturePct, 0), moisture_raw: p.moistureRaw ?? null, temp_c: round(p.tempC) })),
          },
        };
      }
      case 'add_note': {
        const id = args.zone ? app.zone(String(args.zone)).id : null;
        const trimmed = String(args.text ?? '').trim();
        if (!trimmed) throw new Error('Note text is empty.');
        const n = await app.addNote(trimmed, id, 'agent');
        app.recordAgentCall('add_note', id ? [id] : [], 'Added a note');
        return {
          ok: true, zones: id ? [id] : [], summary: 'Added a note',
          payload: { mode: app.mode, saved: true, id: n.id, zone: n.zoneId, text: n.text },
        };
      }
      case 'get_readings': {
        app.recordAgentCall('get_readings', allZones(), 'Read all zones');
        return { ok: true, zones: allZones(), summary: 'Read all zones', payload: await app.readings() };
      }
      case 'get_pour_status': {
        app.recordAgentCall('get_pour_status', [], 'Read pour status');
        const actuator = await app.pourStatus();
        const readings = await app.readings() as { pour?: unknown };
        return { ok: true, zones: [], summary: 'Read pour status', payload: { mode: app.mode, actuator, pour: readings.pour } };
      }
      case 'pour_water':
        return pourWaterTool(app, args, ctx);
      case 'navigate':
        return navigateTool(app, args, ctx);
      default:
        return { ok: false, payload: { error: `Unknown tool "${name}".` }, zones: [], summary: name, error: `Unknown tool "${name}".` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, payload: { error: msg }, zones: [], summary: name, error: msg };
  }
}

async function pourWaterTool(
  app: McpBackend,
  args: Record<string, unknown>,
  ctx: { caller: PourCaller; voice?: VoiceToolHooks },
): Promise<ToolRun> {
  const holdMs = args.hold_ms != null ? Number(args.hold_ms) : args.holdMs != null ? Number(args.holdMs) : undefined;
  const voice = ctx.voice;
  app.recordAgentCall('pour_water', ['A'], 'Requested a pour');

  if (voice) {
    const token = args.confirm_token != null ? String(args.confirm_token) : '';
    if (args.force) {
      // The model does not get to force. Only a valid confirm_token does.
    }
    if (token) {
      const take = voice.assertConfirmToken(token);
      if (!take.ok) {
        voice.logPour({ t: Date.now(), caller: 'voice', result: 'refused', confirm_token: token, event: take.code, reason: take.reason, force: false, holdMs: holdMs ?? null });
        return {
          ok: true, zones: ['A'], summary: 'Pour refused (confirm token)',
          payload: {
            mode: app.mode, result: 'refused', ok: false, overridable: false,
            reason: take.reason, confirm_token: null, next: null,
          },
        };
      }
      const out = await app.pourWater({ holdMs, force: true, caller: 'voice' });
      if (out.ok) voice.consumeConfirmToken(token);
      voice.logPour({
        t: Date.now(), caller: 'voice', result: out.result, event: out.ok ? 'poured' : 'confirmed_but_blocked',
        confirm_token: token, force: true, holdMs: out.holdMsUsed ?? holdMs ?? null, reason: out.reason,
      });
      return packPour(app, out, { overridable: false, confirm_token: null, forced: true });
    }
    const out = await app.pourWater({ holdMs, force: false, caller: 'voice' });
    if (!out.ok && out.guard === 'soft' && out.softKind) {
      const spoken = voiceSoftReason(out.softKind, out.reason ?? '', out.reading);
      const issued = voice.issueConfirmToken({ kind: out.softKind, reason: spoken, reading: out.reading });
      voice.logPour({
        t: Date.now(), caller: 'voice', result: 'refused', event: 'token_issued',
        confirm_token: issued.id, force: false, holdMs: holdMs ?? null, reason: spoken, softKind: out.softKind,
      });
      voice.onAwaitingConfirmation?.({ kind: out.softKind, reason: spoken, expires_in_s: issued.expires_in_s });
      return packPour(app, { ...out, reason: spoken }, {
        overridable: true,
        confirm_token: issued.id,
        confirm_expires_in_s: issued.expires_in_s,
        forced: false,
      });
    }
    return packPour(app, out, { overridable: false, confirm_token: null, forced: false });
  }

  const out = await app.pourWater({ holdMs, force: !!args.force, caller: ctx.caller });
  return packPour(app, out, { overridable: false, confirm_token: null, forced: !!args.force });
}

function voiceSoftReason(kind: SoftGuardKind, serverReason: string, reading?: ZoneLive): string {
  if (kind === 'wet') {
    const pct = reading?.moisturePct != null ? Math.round(reading.moisturePct) : null;
    return pct != null
      ? `Zone A already reads ${pct} percent relative moisture, that's wet. Ask the user if they still want to pour. If they say yes, call pour_water with the confirm_token from this result. Do not invent a token.`
      : `Zone A already reads wet. Ask the user if they still want to pour. If they say yes, call pour_water with the confirm_token from this result. Do not invent a token.`;
  }
  return `${serverReason} This is a server-side rate limit, not firmware. Ask the user if they still want to pour. If they say yes, call pour_water with the confirm_token from this result. Do not invent a token.`;
}

function packPour(
  app: McpBackend,
  out: Awaited<ReturnType<McpBackend['pourWater']>>,
  extra: { overridable: boolean; confirm_token: string | null; confirm_expires_in_s?: number; forced: boolean },
): ToolRun {
  const next = extra.overridable
    ? 'Tell the user the reason. Wait for them to speak a confirmation. Then call pour_water with confirm_token. Do not claim they confirmed until you have the token from this result.'
    : out.next ?? (out.result === 'started' ? 'Read zone A again in 10 to 20 seconds to confirm the water arrived. Raw moisture counts should fall. If they did not, say so: the bottle may be empty, the probe may not be under the stream, or the supply may be off. The servo has no position feedback.' : null);
  return {
    ok: true,
    zones: ['A'],
    summary: out.ok ? 'Poured water' : `Pour ${out.result}`,
    payload: {
      mode: app.mode,
      result: out.result,
      ok: out.ok,
      reason: out.reason ?? null,
      zone_a: out.reading ?? null,
      overridable: extra.overridable,
      confirm_token: extra.confirm_token,
      confirm_expires_in_s: extra.confirm_expires_in_s ?? null,
      guard: out.guard ?? null,
      hold_ms_used: out.holdMsUsed ?? null,
      hold_ms_clamped: out.holdMsClamped ?? false,
      next,
    },
  };
}

export function parseNavigateArgs(args: Record<string, unknown>): { ok: true; command: UiCommand } | { ok: false; error: string } {
  const extra = Object.keys(args).filter((k) => !['view', 'drawer', 'zone', 'lens', 'crop'].includes(k));
  if (extra.length) return { ok: false, error: `Unknown navigate field(s): ${extra.join(', ')}. Allowed: view, drawer, zone, lens, crop.` };
  const command: UiCommand = {};
  if (args.view != null) {
    const v = String(args.view);
    if (!VIEWS.includes(v as UiView)) return { ok: false, error: `Unknown view "${v}". Allowed: ${VIEWS.join(', ')}.` };
    command.view = v as UiView;
  }
  if (args.drawer != null) {
    const v = String(args.drawer);
    if (!DRAWERS.includes(v as UiDrawer)) return { ok: false, error: `Unknown drawer "${v}". Allowed: ${DRAWERS.join(', ')}.` };
    command.drawer = v as UiDrawer;
  }
  if (args.zone != null) {
    const v = String(args.zone).toUpperCase().replace(/^ZONE\s+/, '');
    if (!ZONE_IDS.includes(v as ZoneId)) return { ok: false, error: `Unknown zone "${args.zone}". Allowed: A, B.` };
    command.zone = v as ZoneId;
  }
  if (args.lens != null) {
    const v = String(args.lens);
    if (!LENSES.includes(v as UiLens)) return { ok: false, error: `Unknown lens "${v}". Allowed: ${LENSES.join(', ')}.` };
    command.lens = v as UiLens;
  }
  if (args.crop != null) {
    const v = String(args.crop);
    const crop = CROPS.find((c) => c.id === v || c.name.toLowerCase() === v.toLowerCase());
    if (!crop) return { ok: false, error: `Unknown crop "${v}". Use an id from score_crops (e.g. carrot, tomato, lettuce).` };
    command.crop = crop.id;
  }
  if (!Object.keys(command).length) return { ok: false, error: 'navigate needs at least one of view, drawer, zone, lens, crop.' };
  return { ok: true, command };
}

function navigateTool(
  app: McpBackend,
  args: Record<string, unknown>,
  ctx: { caller: PourCaller; voice?: VoiceToolHooks },
): ToolRun {
  if (!ctx.voice) {
    return { ok: false, payload: { error: 'navigate is only available on the voice assistant.' }, zones: [], summary: 'navigate', error: 'navigate is only available on the voice assistant.' };
  }
  const parsed = parseNavigateArgs(args);
  if (!parsed.ok) {
    return { ok: false, payload: { error: parsed.error }, zones: [], summary: 'navigate', error: parsed.error };
  }
  ctx.voice.emitNavigate(parsed.command);
  const zones: ZoneId[] = parsed.command.zone ? [parsed.command.zone] : [];
  const bits = Object.entries(parsed.command).map(([k, v]) => `${k}=${v}`);
  app.recordAgentCall('navigate', zones, `Navigate ${bits.join(' ')}`);
  return {
    ok: true, zones, summary: `Navigate ${bits.join(' ')}`,
    payload: { ok: true, command: parsed.command },
  };
}
