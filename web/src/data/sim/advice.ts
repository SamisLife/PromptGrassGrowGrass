/**
 * Plain-language advice: "does it need water?" and the Diagnose findings.
 * Deterministic rules; every sentence carries the number it was based on.
 */
import type { Diagnosis, Finding, Forecast, SoilProfile, WaterAdvice, ZoneId, ZoneLive } from '../types';

/** Relative-moisture bands (% of the probe's air-to-water range). */
export const MOISTURE = { dry: 25, low: 40, wet: 78 } as const;

export function moistureWord(pct: number | null): string {
  if (pct == null) return 'unknown';
  if (pct < MOISTURE.dry) return 'dry';
  if (pct < MOISTURE.low) return 'getting dry';
  if (pct <= MOISTURE.wet) return 'moist';
  return 'wet';
}

export function waterAdvice(live: ZoneLive, calibrated: boolean, soil: SoilProfile | null, forecast: Forecast | null): WaterAdvice {
  if (!live.moistureOnline) return { needsWater: null, action: 'unknown', headline: 'Probe offline', reasons: ['The moisture probe is not reporting, so there is no reading to judge from.'] };
  if (!calibrated || live.moisturePct == null) return { needsWater: null, action: 'unknown', headline: 'Not calibrated', reasons: ['Calibrate this probe (air, then water) to turn its raw signal into moisture.'] };
  const m = Math.round(live.moisturePct);
  const reasons: string[] = [];
  // Fast-draining soil falls off quickly, so act a little earlier.
  const threshold = soil?.drainageClass === 'fast' ? MOISTURE.low : MOISTURE.dry + 5;
  if (m > MOISTURE.wet) return { needsWater: false, action: 'none', headline: 'Wet: do not water', reasons: [`Relative moisture is ${m}%, above the ${MOISTURE.wet}% where roots start to lack air.`] };
  if (m >= threshold) {
    reasons.push(`Relative moisture is ${m}%, above the ${threshold}% watering point${soil?.drainageClass === 'fast' ? ' used for fast-draining soil' : ''}.`);
    return { needsWater: false, action: 'none', headline: 'No water needed', reasons };
  }
  reasons.push(`Relative moisture is ${m}%, below the ${threshold}% watering point${soil?.drainageClass === 'fast' ? ' used for fast-draining soil' : ''}.`);
  if (forecast?.rainExpected) {
    reasons.push(`But hold off: ${forecast.text}`);
    return { needsWater: true, action: 'wait_for_rain', headline: 'Dry, but rain is coming', reasons };
  }
  if (forecast) reasons.push(forecast.text + (forecast.sample ? ' (sample forecast: no location is set, or the weather service could not be reached)' : ''));
  return { needsWater: true, action: 'water', headline: 'Needs water', reasons };
}

export function diagnose(zoneId: ZoneId, live: ZoneLive, calibrated: boolean, soil: SoilProfile | null, forecast: Forecast | null): Diagnosis {
  const findings: Finding[] = [];
  if (soil) {
    const good = soil.drainageClass === 'moderate';
    findings.push({
      key: 'drainage', status: good ? 'good' : soil.drainageClass === 'very_slow' ? 'bad' : 'warn',
      headline: soil.label.split(',')[0],
      reason: `Water travelled ${Math.round(soil.distanceCm)} cm between the probes in ${Math.round(soil.seconds)} s: ${soil.rateCmMin.toFixed(1)} cm/min.`,
    });
    findings.push({
      key: 'texture', status: 'good', headline: `Behaves like ${soil.texture} soil`,
      reason: 'Inferred from how fast the wetting front moved. An estimate, not a lab texture test.',
    });
  } else {
    findings.push({ key: 'drainage', status: 'unknown', headline: 'Drainage not measured', reason: 'Run a pour test: pour a cup of water at one probe and the app times it to the other.' });
  }
  if (live.tempOnline && live.tempC != null) {
    const t = live.tempC;
    const status = t >= 15 ? 'good' : t >= 7 ? 'warn' : 'bad';
    const headline = t >= 15 ? 'Warm enough for anything' : t >= 7 ? 'Warm enough for cool-season crops' : 'Too cold to sow most crops';
    findings.push({ key: 'temperature', status, headline, reason: `Soil is ${t.toFixed(1)} °C at probe depth. Warm-season crops want 15 °C or more; peas and spinach start around 4 °C.` });
  } else {
    findings.push({ key: 'temperature', status: 'unknown', headline: 'Soil temperature unknown', reason: 'The temperature probe for this zone is offline.' });
  }
  const w = waterAdvice(live, calibrated, soil, forecast);
  findings.push({
    key: 'water', status: w.action === 'water' ? 'bad' : w.action === 'wait_for_rain' ? 'warn' : w.action === 'none' ? 'good' : 'unknown',
    headline: w.headline, reason: w.reasons.join(' '),
  });
  return { zoneId, at: Date.now(), findings };
}
