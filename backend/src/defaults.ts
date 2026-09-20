import type { BoardConfig, Calibration, ProbeId } from './types.js';

export const CALIBRATION_DEFAULTS: Record<ProbeId, { airRaw: number; waterRaw: number; measured: boolean; measuredOn: string | null; note: string }> = {
  A: { airRaw: 3515, waterRaw: 1998, measured: true, measuredOn: '2026-09-20', note: 'Bench dip test: air, then water.' },
  B: { airRaw: 3515, waterRaw: 1998, measured: false, measuredOn: null, note: "Not measured yet: using probe A's values." },
};

export const defaultCal = (probe: ProbeId): Calibration => ({
  airRaw: CALIBRATION_DEFAULTS[probe].airRaw,
  waterRaw: CALIBRATION_DEFAULTS[probe].waterRaw,
  calibratedAt: CALIBRATION_DEFAULTS[probe].measuredOn ? Date.parse(CALIBRATION_DEFAULTS[probe].measuredOn as string) : null,
  source: 'default',
});

export function defaultConfig(): BoardConfig {
  return {
    plot: { name: 'Demo container', width: 30, length: 15 },
    zones: [
      { id: 'A', name: 'Zone A', probe: 'A', x: 5, y: 7.5, sun: 'full', ph: null },
      { id: 'B', name: 'Zone B', probe: 'B', x: 25, y: 7.5, sun: 'full', ph: null },
    ],
    place: null,
    calibration: { A: defaultCal('A'), B: defaultCal('B') },
    onboarded: false,
  };
}
