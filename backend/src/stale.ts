/**
 * Drop the burst of stale console replay that the UNO Q router dumps on connect
 * (~2 s). Sensor lines carry MCU uptime (`[362s]`); a backwards jump means the
 * board rebooted and the new session is live.
 */
export class StaleFilter {
  private openedAt: number;
  private maxDuringSettle: number | null = null;
  private lastAccepted: number | null = null;
  private live = false;

  constructor(
    private readonly settleMs = 2500,
    now = Date.now(),
  ) {
    this.openedAt = now;
  }

  reset(now = Date.now()): void {
    this.openedAt = now;
    this.maxDuringSettle = null;
    this.lastAccepted = null;
    this.live = false;
  }

  /** Firmware banner: a new sketch session. Restart the settle window. */
  onBanner(now = Date.now()): void {
    this.reset(now);
  }

  /**
   * Whether a line with this uptime (seconds) should be treated as live.
   * Lines with no uptime are accepted only after the settle window.
   */
  accept(uptimeSec: number | null, now = Date.now()): boolean {
    if (now - this.openedAt < this.settleMs) {
      if (uptimeSec != null) this.maxDuringSettle = Math.max(this.maxDuringSettle ?? uptimeSec, uptimeSec);
      return false;
    }
    this.live = true;
    if (uptimeSec == null) return true;

    if (this.lastAccepted != null && uptimeSec + 2 < this.lastAccepted) {
      this.lastAccepted = uptimeSec;
      return true;
    }
    const max = this.maxDuringSettle;
    if (max != null && this.lastAccepted == null && uptimeSec + 2 < max) {
      this.lastAccepted = uptimeSec;
      return true;
    }
    if (max != null && this.lastAccepted == null && uptimeSec < max) return false;
    if (this.lastAccepted != null && uptimeSec < this.lastAccepted) return false;

    this.lastAccepted = uptimeSec;
    return true;
  }

  get isLive(): boolean {
    return this.live;
  }
}
