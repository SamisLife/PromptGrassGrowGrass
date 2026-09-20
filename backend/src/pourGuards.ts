import { MOISTURE } from './advice.js';
import type { PourCaller, PourGuardKind, PourResult, SoftGuardKind, ZoneLive } from './types.js';

export interface PourGuardConfig {
  /** most pours accepted per rolling window; 0 = no limit (the default) */
  maxPerWindow: number;
  windowMs: number;
  wetPct: number;
}

export interface PourRequestLog {
  t: number;
  caller: PourCaller;
  result: PourResult | string;
  holdMs: number | null;
  force: boolean;
  reason?: string;
}

export class PourGuards {
  private accepted: number[] = [];

  constructor(private cfg: PourGuardConfig) {}

  update(cfg: PourGuardConfig): void {
    this.cfg = cfg;
  }

  check(opts: {
    now?: number;
    zoneA: ZoneLive | null;
    force: boolean;
    boardOnline: boolean;
  }): { ok: true } | { ok: false; result: PourResult; reason: string; reading?: ZoneLive; guard: PourGuardKind; softKind?: SoftGuardKind } {
    const now = opts.now ?? Date.now();
    if (!opts.boardOnline) {
      return { ok: false, result: 'offline', reason: 'No board running the pour firmware is connected.', guard: 'hard' };
    }
    this.accepted = this.accepted.filter((t) => now - t < this.cfg.windowMs);
    // Off unless POUR_MAX_PER_WINDOW is set: on a demo table people pour again and again, and the firmware
    // already allows only one pour at a time.
    if (this.cfg.maxPerWindow > 0 && this.accepted.length >= this.cfg.maxPerWindow) {
      const oldest = this.accepted[0];
      const waitS = Math.ceil((this.cfg.windowMs - (now - oldest)) / 1000);
      return {
        ok: false,
        result: 'refused',
        reason: `Server limit: ${this.cfg.maxPerWindow} pours in ${Math.round(this.cfg.windowMs / 60000)} minutes. Try again in about ${waitS} s.`,
        guard: 'soft',
        softKind: 'window',
      };
    }
    const live = opts.zoneA;
    if (!opts.force && live?.moistureOnline && live.moisturePct != null && live.moisturePct >= this.cfg.wetPct) {
      return {
        ok: false,
        result: 'refused',
        reason: `Zone A already reads wet (${Math.round(live.moisturePct)}% relative moisture, threshold ${this.cfg.wetPct}%). Pass force=true to pour anyway.`,
        reading: live,
        guard: 'soft',
        softKind: 'wet',
      };
    }
    return { ok: true };
  }

  recordAccepted(now = Date.now()): void {
    this.accepted.push(now);
  }

  /** For tests: the wet threshold matches the app's "wet" band unless overridden. */
  get wetPct(): number {
    return this.cfg.wetPct;
  }
}

export const defaultGuardConfig = (over: Partial<PourGuardConfig> = {}): PourGuardConfig => ({
  maxPerWindow: 0,
  windowMs: 10 * 60 * 1000,
  wetPct: MOISTURE.wet,
  ...over,
});
