/**
 * Pour (infiltration) detection, ported from web/src/data/sim/pour.ts.
 *
 * Original assumed ~5 Hz samples. Hardware prints once per second, so HOLD
 * and the EMA coefficient are adapted (see comments and FIRMWARE_REQUESTS.md).
 */
import type { DrainageClass, PourState, ZoneId } from './types.js';

const RISE_PCT = 5;
const EARLY_PCT = 1.5;
/** Original HOLD=3 at ~5 Hz (~0.6 s). At 1 Hz, 3 samples is 3 s of latency on
 * a 20–40 s sand pour. HOLD=2 still rejects a single noisy sample. */
const HOLD = 2;
const BASELINE_FROM_S = 20;
const BASELINE_TO_S = 5;
const MIN_TRAVEL_S = 2;
export const POUR_TIMEOUT_S = 30 * 60;
/** Original alpha 0.4 at 5 Hz. At 1 Hz a larger alpha keeps the smoother
 * from lagging a whole sample behind a real wetting-front step. */
const EMA_ALPHA = 0.55;

export const DRAINAGE_BANDS: { min: number; cls: DrainageClass; label: string; texture: string }[] = [
  { min: 30, cls: 'fast', label: 'Very fast draining', texture: 'gravelly or coarse sand' },
  { min: 6, cls: 'fast', label: 'Fast draining', texture: 'sandy' },
  { min: 1.5, cls: 'moderate', label: 'Drains well', texture: 'loam-like' },
  { min: 0.3, cls: 'slow', label: 'Slow draining', texture: 'silty or clay loam' },
  { min: 0, cls: 'very_slow', label: 'Very slow draining', texture: 'clay-heavy' },
];

export function classifyRate(rateCmMin: number) {
  return DRAINAGE_BANDS.find((b) => rateCmMin >= b.min) ?? DRAINAGE_BANDS[DRAINAGE_BANDS.length - 1];
}

interface Track { buf: { t: number; v: number }[]; ema: number | null; run: { t: number }[]; onset: number | null }

export function idlePour(): PourState {
  return { phase: 'idle', source: null, target: null, t0: null, t1: null, distanceCm: null, rateCmMin: null, drainageClass: null, label: null, baseline: {} };
}

export class PourDetector {
  state: PourState = idlePour();
  private tracks = new Map<ZoneId, Track>();

  constructor(private distanceBetween: (a: ZoneId, b: ZoneId) => number) {}

  arm(): void { this.resetTracks(); this.state = { ...idlePour(), phase: 'armed', baseline: this.baselines() }; }
  reset(): void { this.resetTracks(); this.state = idlePour(); }

  private resetTracks() { for (const tr of this.tracks.values()) { tr.run = []; tr.onset = null; } }

  private baselineOf(tr: Track, now: number): number | null {
    const xs = tr.buf.filter((s) => s.t <= now - BASELINE_TO_S * 1000 && s.t >= now - BASELINE_FROM_S * 1000).map((s) => s.v);
    const src = xs.length >= 3 ? xs : tr.buf.slice(0, Math.max(1, tr.buf.length >> 1)).map((s) => s.v);
    if (!src.length) return null;
    const s = [...src].sort((a, b) => a - b);
    return s[s.length >> 1];
  }

  private baselines(): Record<ZoneId, number> {
    const out: Record<ZoneId, number> = {};
    const now = Date.now();
    for (const [id, tr] of this.tracks) { const b = this.baselineOf(tr, now); if (b != null) out[id] = b; }
    return out;
  }

  /** Returns true when the pour state changed. */
  update(t: number, values: Record<ZoneId, number | null>): boolean {
    let changed = false;
    for (const [id, v] of Object.entries(values)) {
      if (v == null) continue;
      let tr = this.tracks.get(id);
      if (!tr) { tr = { buf: [], ema: null, run: [], onset: null }; this.tracks.set(id, tr); }
      tr.ema = tr.ema == null ? v : tr.ema + EMA_ALPHA * (v - tr.ema);
      tr.buf.push({ t, v: tr.ema });
      while (tr.buf.length && tr.buf[0].t < t - 60000) tr.buf.shift();

      if (this.state.phase === 'done' || this.state.phase === 'timeout' || tr.onset != null) continue;
      const base = this.state.phase === 'running' || this.state.phase === 'armed' ? this.state.baseline[id] ?? this.baselineOf(tr, t) : this.baselineOf(tr, t);
      if (base == null) continue;
      const rise = tr.ema - base;
      if (rise >= EARLY_PCT) tr.run.push({ t }); else tr.run = [];
      const held = tr.buf.slice(-HOLD).every((s) => s.v - base >= RISE_PCT) && tr.buf.length >= HOLD;
      if (!held) continue;

      tr.onset = tr.run[0]?.t ?? t;
      if (this.state.phase === 'idle' || this.state.phase === 'armed') {
        const baseline = this.state.phase === 'armed' ? this.state.baseline : this.baselines();
        baseline[id] = base;
        this.state = { ...idlePour(), phase: 'running', source: id, t0: tr.onset, baseline };
        changed = true;
      } else if (this.state.phase === 'running' && id !== this.state.source) {
        const dt = (tr.onset - (this.state.t0 as number)) / 1000;
        if (dt < MIN_TRAVEL_S) {
          this.reset();
          changed = true;
          continue;
        }
        const distanceCm = this.distanceBetween(this.state.source as ZoneId, id);
        const rate = distanceCm / (dt / 60);
        const band = classifyRate(rate);
        this.state = { ...this.state, phase: 'done', target: id, t1: tr.onset, distanceCm, rateCmMin: rate, drainageClass: band.cls, label: `${band.label}, behaves like ${band.texture} soil` };
        changed = true;
      }
    }
    if (this.state.phase === 'running' && t - (this.state.t0 as number) > POUR_TIMEOUT_S * 1000) {
      this.state = { ...this.state, phase: 'timeout' };
      changed = true;
    }
    return changed;
  }
}
