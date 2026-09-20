/**
 * Plain-language view of tool results, for the VOICE assistant only.
 *
 * MCP clients (ChatGPT, Claude, Muse) keep the full technical payload: raw ADC counts and
 * trends are useful to a model that reasons in text. A person listening to a spoken answer
 * is not helped by "3512 ADC counts". So for voice:
 *   - raw sensor numbers and engineering notes are removed from the payload entirely
 *     (the model cannot read out what it never received, and shorter payloads cost less),
 *   - every judgement is made HERE, deterministically ("dry", "no water detected yet"),
 *     and the model only has to say it.
 * No LLM is involved in this file.
 */
import { moistureWord } from './advice.js';
import type { ZoneLive } from './types.js';

export interface PourOutcome {
  status: 'arrived' | 'too_early' | 'not_detected' | 'unknown';
  seconds_since_pour: number;
  moisture_before_pct: number | null;
  moisture_now_pct: number | null;
  /** one sentence, ready to be spoken */
  plain: string;
}

/** Counts the reading must fall (wetter = lower) before we call it "water arrived": ~8 % of a probe's range, 20x its noise. */
export const ARRIVAL_DROP_COUNTS = 120;

export function judgePour(input: {
  pouredAt: number; now: number;
  rawBefore: number | null; pctBefore: number | null;
  live: ZoneLive | null;
}): PourOutcome {
  const seconds = Math.round((input.now - input.pouredAt) / 1000);
  const pctNow = input.live?.moistureOnline && input.live.moisturePct != null ? Math.round(input.live.moisturePct) : null;
  const before = input.pctBefore == null ? null : Math.round(input.pctBefore);
  const base = { seconds_since_pour: seconds, moisture_before_pct: before, moisture_now_pct: pctNow };
  if (input.rawBefore == null || !input.live?.moistureOnline || input.live.moistureRaw == null) {
    return { ...base, status: 'unknown', plain: "I can't tell whether the water arrived, because the zone A soil sensor isn't reporting." };
  }
  const drop = input.rawBefore - input.live.moistureRaw;
  if (drop >= ARRIVAL_DROP_COUNTS) {
    return { ...base, status: 'arrived', plain: `The water reached the soil sensor in zone A. Moisture went from ${before} percent to ${pctNow} percent.` };
  }
  if (seconds < 12) {
    return { ...base, status: 'too_early', plain: `It has only been ${seconds} seconds. Water needs a moment to soak in, so check again shortly.` };
  }
  return {
    ...base, status: 'not_detected',
    plain: `I poured, but the soil sensor in zone A hasn't picked up any water yet. It still reads ${pctNow} percent. The bottle may be empty, or the water is landing away from the sensor.`,
  };
}

const TECHNICAL_KEY = /raw|adc|counts|volts|^note$|_note$|^unit$|_unit$|implausible|age_ms|unix_ms|^mode$|depth_cm|calibrated|call_id/i;

/** Remove engineering fields, recursively. */
export function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => scrub(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!TECHNICAL_KEY.test(k)) out[k] = scrub(v);
    return out as T;
  }
  return value;
}

const FRIENDLY: Record<string, string> = { dry: 'dry', 'getting dry': 'a little dry', moist: 'nicely moist', wet: 'very wet', unknown: 'unknown' };

export function moistureInWords(pct: number | null, online: boolean): string {
  if (!online || pct == null) return "unknown, the soil sensor isn't reporting";
  return FRIENDLY[moistureWord(pct)] ?? moistureWord(pct);
}

/** "getting wetter" / "drying out" / "steady", from a change in percent. */
export function trendInWords(deltaPct: number | null): string | null {
  if (deltaPct == null) return null;
  if (deltaPct >= 3) return 'getting wetter';
  if (deltaPct <= -3) return 'drying out';
  return 'steady';
}

export const HOW_TO_SAY = 'Speak in everyday words. Say moisture as a description plus a whole percent ("dry, about 12 percent"). Whole degrees for temperature. Never say sensor counts, internal names or tool names.';
