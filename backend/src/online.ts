/** Moisture and temperature go offline independently after this many ms of silence. */
export const PROBE_TIMEOUT_MS = 5000;

export class OnlineTracker {
  lastMoistureAt: number | null = null;
  lastTempAt: number | null = null;
  lastRaw: number | null = null;
  lastTempC: number | null = null;

  constructor(private readonly timeoutMs = PROBE_TIMEOUT_MS) {}

  onMoisture(raw: number, now: number): void {
    this.lastMoistureAt = now;
    this.lastRaw = raw;
  }

  onValidTemp(tempC: number, now: number): void {
    this.lastTempAt = now;
    this.lastTempC = tempC;
  }

  /** ERR / missing T0 does not refresh the temperature clock. */
  moistureOnline(now: number): boolean {
    return this.lastMoistureAt != null && now - this.lastMoistureAt <= this.timeoutMs;
  }

  tempOnline(now: number): boolean {
    return this.lastTempAt != null && now - this.lastTempAt <= this.timeoutMs;
  }

  moistureAgeMs(now: number): number | null {
    return this.lastMoistureAt == null ? null : now - this.lastMoistureAt;
  }

  tempAgeMs(now: number): number | null {
    return this.lastTempAt == null ? null : now - this.lastTempAt;
  }

  markGone(): void {
    this.lastMoistureAt = null;
    this.lastTempAt = null;
  }
}
