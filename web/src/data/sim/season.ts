/**
 * Frost dates and planting windows from location.
 *
 * Frost dates are the MEDIAN over past years of the last spring / first fall
 * day with a minimum at or below 0 °C. A median of past years is an estimate
 * and is always labeled as one.
 */
import type { FrostDates, PlantingWindow } from '../types';
import type { Crop } from './crops';

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromDoy = (year: number, doy: number) => new Date(year, 0, doy, 12);
export const doyOf = (d: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() - new Date(d.getFullYear(), 0, 0, 12).getTime()) / DAY);
const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const wrapDoy = (d: number) => ((((d - 1) % 365) + 365) % 365) + 1;

export function frostDatesFromDaily(dates: string[], tmin: (number | null)[], lat: number): FrostDates {
  const southern = lat < 0;
  // Southern hemisphere: slide the calendar half a year so "spring" is always
  // in the first half of the (shifted) year, run the same logic, slide back.
  const shift = southern ? 182 : 0;
  const byYear = new Map<number, { spring: number | null; fall: number | null; n: number }>();
  dates.forEach((ds, i) => {
    const v = tmin[i];
    if (v == null) return;
    const d = new Date(new Date(ds + 'T12:00').getTime() + shift * DAY);
    const y = d.getFullYear(), doy = doyOf(d);
    const rec = byYear.get(y) ?? { spring: null, fall: null, n: 0 };
    rec.n++;
    if (v <= 0) {
      if (doy < 200) rec.spring = Math.max(rec.spring ?? 0, doy);
      else if (rec.fall == null) rec.fall = doy;
    }
    byYear.set(y, rec);
  });
  const full = [...byYear.values()].filter((r) => r.n >= 330);
  const springs = full.map((r) => r.spring).filter((x): x is number => x != null);
  const falls = full.map((r) => r.fall).filter((x): x is number => x != null);
  const yearsUsed = full.length;
  const label = `Estimated from ${yearsUsed} years of daily minimum temperatures (ERA5 via Open-Meteo)`;
  if (yearsUsed === 0 || springs.length < yearsUsed * 0.3 || falls.length < yearsUsed * 0.3) {
    return { source: 'open-meteo-archive', estimate: true, label, frostFree: true, lastSpringFrostDoy: null, firstFallFrostDoy: null, growingSeasonDays: null, yearsUsed, southern };
  }
  const s = median(springs), f = median(falls);
  return {
    source: 'open-meteo-archive', estimate: true, label, frostFree: false,
    lastSpringFrostDoy: wrapDoy(s - shift), firstFallFrostDoy: wrapDoy(f - shift),
    growingSeasonDays: f - s, yearsUsed, southern,
  };
}

/** Rough latitude-only estimate, used when the archive cannot be reached. */
export function fallbackFrostDates(lat: number): FrostDates {
  const a = Math.abs(lat), southern = lat < 0;
  const label = 'Rough estimate from latitude only (climate archive unreachable)';
  if (a < 23.5) return { source: 'latitude-estimate', estimate: true, label, frostFree: true, lastSpringFrostDoy: null, firstFallFrostDoy: null, growingSeasonDays: null, yearsUsed: 0, southern };
  const s = Math.round(60 + (a - 25) * 3.4), f = Math.round(330 - (a - 25) * 3.2);
  const shift = southern ? 182 : 0;
  return { source: 'latitude-estimate', estimate: true, label, frostFree: false, lastSpringFrostDoy: wrapDoy(s - shift), firstFallFrostDoy: wrapDoy(f - shift), growingSeasonDays: Math.max(0, f - s), yearsUsed: 0, southern };
}

export function seasonText(frost: FrostDates, today = new Date()): string {
  if (frost.frostFree || frost.lastSpringFrostDoy == null || frost.firstFallFrostDoy == null) return 'No regular frost here: the growing season is year-round.';
  const y = today.getFullYear();
  const s = fromDoy(y, frost.lastSpringFrostDoy), f = fromDoy(y, frost.firstFallFrostDoy);
  let next = f;
  if (next.getTime() < today.getTime()) next = fromDoy(y + 1, frost.firstFallFrostDoy);
  const days = Math.round((next.getTime() - today.getTime()) / DAY);
  return `Growing season runs about ${fmt(s)} to ${fmt(f)} (${frost.growingSeasonDays} days). First fall frost is about ${days} days away.`;
}

export function plantingWindow(crop: Crop, frost: FrostDates, today = new Date(), soilTempC: number | null = null): PlantingWindow {
  const soilWarmEnough = soilTempC == null ? null : soilTempC >= crop.tempMin;
  const soilText = soilTempC == null
    ? 'Soil temperature unknown (no probe reading).'
    : soilWarmEnough
      ? `Soil is ${soilTempC.toFixed(1)} °C today, warm enough (needs ${crop.tempMin} °C).`
      : `Soil is ${soilTempC.toFixed(1)} °C today, too cold (needs ${crop.tempMin} °C).`;
  const base = { cropId: crop.id, cropName: crop.name, soilWarmEnough, soilTempC, soilTempMinC: crop.tempMin, estimate: true as const };

  if (frost.frostFree || frost.lastSpringFrostDoy == null || frost.firstFallFrostDoy == null) {
    return { ...base, windows: [], status: 'year_round', nextOpen: null, text: `No regular frost here, so ${crop.name.toLowerCase()} can be planted any time of year. ${soilText}` };
  }

  // Build candidate windows for last year, this year and next, then classify
  // against today. This makes the logic identical in both hemispheres.
  const all: { kind: 'spring' | 'fall'; start: Date; end: Date; method: string }[] = [];
  for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    if (crop.spring) {
      const f0 = fromDoy(y, frost.lastSpringFrostDoy).getTime();
      all.push({ kind: 'spring', start: new Date(f0 + crop.spring.start * 7 * DAY), end: new Date(f0 + crop.spring.end * 7 * DAY), method: crop.spring.method });
    }
    if (crop.fall) {
      const f1 = fromDoy(y, frost.firstFallFrostDoy).getTime();
      all.push({ kind: 'fall', start: new Date(f1 - crop.fall.start * 7 * DAY), end: new Date(f1 - crop.fall.end * 7 * DAY), method: crop.fall.method });
    }
  }
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  const now = today.getTime();
  const open = all.find((w) => w.start.getTime() <= now && now <= w.end.getTime() + DAY);
  const next = all.find((w) => w.start.getTime() > now) ?? null;
  const shown = (open ? [open] : []).concat(all.filter((w) => w !== open && w.end.getTime() >= now).slice(0, open ? 1 : 2));
  const windows = shown.map((w) => ({ kind: w.kind, start: iso(w.start), end: iso(w.end), method: w.method }));

  let status: PlantingWindow['status'], text: string;
  if (open) {
    status = 'open';
    text = `${crop.name}: the ${open.kind} planting window is open now, ${fmt(open.start)} to ${fmt(open.end)} (${open.method}). ${soilText}`;
  } else if (next && next.start.getTime() - now <= 75 * DAY) {
    status = 'upcoming';
    text = `${crop.name}: the next window opens around ${fmt(next.start)} and runs to ${fmt(next.end)} (${next.method}). ${soilText}`;
  } else {
    status = 'closed';
    text = `${crop.name}: the planting window has closed for this season${next ? `; the next one opens around ${fmt(next.start)}, ${next.start.getFullYear()}` : ''}. ${soilText}`;
  }
  return { ...base, windows, status, nextOpen: open ? iso(open.start) : next ? iso(next.start) : null, text: text + ' Dates are estimates from local frost history.' };
}
