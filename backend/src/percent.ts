import type { Calibration } from './types.js';

export const ADC_MAX = 4095;
/** Air and water must differ by at least 8 % of full scale or the probe is not responding. */
export const MIN_SWING = 0.08 * ADC_MAX;

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Relative moisture: percent of this probe's air-to-water range.
 * Raw rises as the soil dries, so air (high) maps to 0 % and water (low) to 100 %.
 * Never volumetric water content.
 */
export function relativeMoisturePct(raw: number, airRaw: number, waterRaw: number): number {
  const span = airRaw - waterRaw;
  if (span === 0) return 0;
  return clamp(((airRaw - raw) / span) * 100, 0, 100);
}

export function mapRaw(raw: number | null, cal: Calibration): number | null {
  if (raw == null || cal.airRaw == null || cal.waterRaw == null) return null;
  return relativeMoisturePct(raw, cal.airRaw, cal.waterRaw);
}

export function isCalibrated(cal: Calibration): boolean {
  return cal.airRaw != null && cal.waterRaw != null;
}

export function swingOk(airRaw: number, waterRaw: number): boolean {
  return airRaw - waterRaw >= MIN_SWING;
}
