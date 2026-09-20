/**
 * Pre-configured probe calibration, measured on the bench.
 *
 * These are the DEFAULTS: the app starts calibrated, nobody has to dip a probe before a
 * demo. The guided calibration still works and overrides them per probe; "Reset to
 * default" brings these values back.
 *
 * How they were measured (2026-09-19/20, UNO Q, 3.3 V supply, 12-bit ADC, each value the
 * average of 16 reads): probe held still in dry air, then dipped in water up to its
 * printed line, then back in air.
 *
 *   still air   3515   (3511-3519 across five separate sessions and two boards)
 *   water       1998   (1997-2002, +/-3 counts)
 *   back in air 3465   (22-50 counts low for a while: a water film on the probe. That is
 *                       why the air value is taken from DRY readings, not from this one.)
 *
 * Swing: 1517 counts, so 1 % relative moisture is about 15 counts and the +/-3 count
 * noise is about +/-0.2 %. Moisture is RELATIVE (percent of this probe's air-to-water
 * range), never volumetric water content.
 *
 * Capacitive probes differ from unit to unit. Probe B has not been measured yet: it
 * borrows probe A's numbers and says so (`measured: false`) until its own dip test is done.
 */
import type { ProbeId } from './types';

export interface ProbeCalibrationDefault {
  airRaw: number;
  waterRaw: number;
  /** false = placeholder copied from another probe, not measured on this one */
  measured: boolean;
  measuredOn: string | null;
  note: string;
}

export const CALIBRATION_DEFAULTS: Record<ProbeId, ProbeCalibrationDefault> = {
  A: { airRaw: 3515, waterRaw: 1998, measured: true, measuredOn: '2026-09-20', note: 'Bench dip test: air, water, air.' },
  B: { airRaw: 3515, waterRaw: 1998, measured: false, measuredOn: null, note: "Not measured yet: using probe A's values. Run the dip test on this probe." },
};

/**
 * DS18B20 probes are digital and factory calibrated (+/-0.5 C): there is nothing to
 * calibrate, only an address to assign to a zone. Known probes, by 64-bit ROM:
 */
export const KNOWN_TEMP_PROBES: Record<string, { label: string; note: string }> = {
  '28efadd575250b88': { label: 'Temp probe 1', note: 'Read 25.81 C at room temperature. Converts in ~335 ms (likely a clone chip; harmless).' },
  '284ec8de75250bb4': { label: 'Temp probe 2', note: 'Read 25.87 C at room temperature, within 0.06 C of probe 1. Converts in ~617 ms.' },
};
/** Offset added to a probe reading, by ROM. 0 until an ice-water check says otherwise. */
export const TEMP_OFFSET_C: Record<string, number> = {};
