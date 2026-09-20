/**
 * Crop rules engine (browser stand-in for the board's Python engine).
 *
 * Deterministic and explainable: a crop table checked against readings. Every
 * factor returns a score AND the sentence that justifies it, with the actual
 * numbers in it. Unknown inputs are excluded from the score and reported as
 * unknown; they are never silently defaulted.
 */
import type { CropScore, DrainageClass, FactorScore, FrostDates, PlantingWindow, Sun } from './types.js';
import { plantingWindow } from './season.js';

export interface Crop {
  id: string;
  name: string;
  category: string;
  tempMin: number; // minimum soil temperature to sow/plant, deg C
  tempOpt: [number, number];
  drainage: Record<DrainageClass, number>;
  drainageNote: Partial<Record<DrainageClass, string>>;
  sun: Record<Sun, number>;
  ph: [number, number];
  frost: 'hardy' | 'half_hardy' | 'tender';
  /** spring sowing window, weeks relative to average last spring frost */
  spring: { start: number; end: number; method: string } | null;
  /** fall window, weeks BEFORE average first fall frost */
  fall: { start: number; end: number; method: string } | null;
  maturity: [number, number];
}

const D = (fast: number, moderate: number, slow: number, very_slow: number) => ({ fast, moderate, slow, very_slow });
const S = (full: number, partial: number, shade: number) => ({ full, partial, shade });

export const CROPS: Crop[] = [
  { id: 'carrot', name: 'Carrots', category: 'root', tempMin: 7, tempOpt: [13, 24], drainage: D(95, 90, 45, 10),
    drainageNote: { fast: 'loose, fast-draining soil lets the roots grow long and straight', slow: 'heavy soil forks and stunts the roots', very_slow: 'roots rot and fork in waterlogged, heavy soil' },
    sun: S(100, 75, 30), ph: [6.0, 7.0], frost: 'half_hardy', spring: { start: -3, end: 8, method: 'direct sow' }, fall: { start: 12, end: 9, method: 'direct sow' }, maturity: [60, 80] },
  { id: 'radish', name: 'Radishes', category: 'root', tempMin: 5, tempOpt: [10, 24], drainage: D(92, 95, 55, 15),
    drainageNote: { fast: 'quick roots swell cleanly in loose, fast-draining soil', very_slow: 'roots crack and rot when the soil stays wet' },
    sun: S(100, 80, 35), ph: [6.0, 7.0], frost: 'hardy', spring: { start: -5, end: 4, method: 'direct sow' }, fall: { start: 8, end: 4, method: 'direct sow' }, maturity: [22, 35] },
  { id: 'lettuce', name: 'Lettuce', category: 'leafy', tempMin: 2, tempOpt: [10, 21], drainage: D(45, 95, 70, 25),
    drainageNote: { fast: 'shallow roots dry out quickly in fast-draining soil, so it needs near-daily water', moderate: 'even moisture keeps the leaves sweet', very_slow: 'crowns rot in soggy soil' },
    sun: S(85, 100, 60), ph: [6.0, 7.0], frost: 'half_hardy', spring: { start: -5, end: 3, method: 'direct sow or transplant' }, fall: { start: 10, end: 5, method: 'direct sow' }, maturity: [35, 60] },
  { id: 'spinach', name: 'Spinach', category: 'leafy', tempMin: 2, tempOpt: [7, 20], drainage: D(50, 95, 70, 25),
    drainageNote: { fast: 'dries out and bolts early in fast-draining soil', moderate: 'steady moisture gives tender leaves' },
    sun: S(85, 100, 65), ph: [6.5, 7.5], frost: 'hardy', spring: { start: -7, end: 1, method: 'direct sow' }, fall: { start: 9, end: 4, method: 'direct sow' }, maturity: [38, 50] },
  { id: 'kale', name: 'Kale', category: 'leafy', tempMin: 5, tempOpt: [10, 24], drainage: D(60, 95, 75, 30),
    drainageNote: { fast: 'manages, but needs mulch and regular water in fast-draining soil' },
    sun: S(100, 85, 45), ph: [6.0, 7.5], frost: 'hardy', spring: { start: -5, end: 2, method: 'transplant' }, fall: { start: 13, end: 8, method: 'direct sow or transplant' }, maturity: [55, 75] },
  { id: 'pea', name: 'Peas', category: 'legume', tempMin: 4, tempOpt: [10, 21], drainage: D(65, 95, 60, 15),
    drainageNote: { very_slow: 'seeds rot before sprouting in cold, wet soil' },
    sun: S(100, 80, 35), ph: [6.0, 7.5], frost: 'hardy', spring: { start: -7, end: -1, method: 'direct sow' }, fall: { start: 11, end: 9, method: 'direct sow' }, maturity: [55, 70] },
  { id: 'beet', name: 'Beets', category: 'root', tempMin: 5, tempOpt: [10, 27], drainage: D(80, 95, 60, 20),
    drainageNote: { fast: 'roots size up well in loose soil' },
    sun: S(100, 80, 40), ph: [6.2, 7.5], frost: 'half_hardy', spring: { start: -4, end: 6, method: 'direct sow' }, fall: { start: 10, end: 7, method: 'direct sow' }, maturity: [50, 65] },
  { id: 'onion', name: 'Onions', category: 'allium', tempMin: 5, tempOpt: [13, 24], drainage: D(80, 95, 50, 10),
    drainageNote: { very_slow: 'bulbs rot in soil that stays wet' },
    sun: S(100, 60, 20), ph: [6.0, 7.0], frost: 'hardy', spring: { start: -6, end: 0, method: 'sets or transplants' }, fall: null, maturity: [90, 120] },
  { id: 'garlic', name: 'Garlic', category: 'allium', tempMin: 0, tempOpt: [4, 18], drainage: D(85, 95, 45, 10),
    drainageNote: { fast: 'cloves overwinter cleanly where water never sits', very_slow: 'cloves rot over winter in waterlogged soil' },
    sun: S(100, 65, 25), ph: [6.0, 7.5], frost: 'hardy', spring: null, fall: { start: 4, end: -3, method: 'plant cloves' }, maturity: [240, 270] },
  { id: 'potato', name: 'Potatoes', category: 'root', tempMin: 7, tempOpt: [15, 21], drainage: D(85, 95, 50, 10),
    drainageNote: { fast: 'tubers form cleanly and lift easily from loose soil', very_slow: 'tubers rot in heavy, wet soil' },
    sun: S(100, 70, 25), ph: [5.0, 6.5], frost: 'half_hardy', spring: { start: -3, end: 3, method: 'seed potatoes' }, fall: null, maturity: [80, 110] },
  { id: 'tomato', name: 'Tomatoes', category: 'fruiting', tempMin: 15, tempOpt: [18, 29], drainage: D(75, 100, 60, 15),
    drainageNote: { fast: 'fine with mulch and deep, regular watering', very_slow: 'roots suffocate and fruit cracks in wet soil' },
    sun: S(100, 55, 10), ph: [6.0, 6.800], frost: 'tender', spring: { start: 1, end: 6, method: 'transplant' }, fall: null, maturity: [65, 85] },
  { id: 'pepper', name: 'Peppers', category: 'fruiting', tempMin: 18, tempOpt: [21, 29], drainage: D(80, 100, 50, 10),
    drainageNote: { fast: 'warm, fast-draining soil suits them if watered regularly' },
    sun: S(100, 50, 10), ph: [6.0, 6.800], frost: 'tender', spring: { start: 2, end: 6, method: 'transplant' }, fall: null, maturity: [65, 90] },
  { id: 'bean', name: 'Bush beans', category: 'legume', tempMin: 15, tempOpt: [18, 29], drainage: D(80, 100, 55, 10),
    drainageNote: { very_slow: 'seeds rot in cold, wet soil' },
    sun: S(100, 65, 20), ph: [6.0, 7.0], frost: 'tender', spring: { start: 1, end: 10, method: 'direct sow' }, fall: null, maturity: [50, 60] },
  { id: 'corn', name: 'Sweet corn', category: 'grain', tempMin: 13, tempOpt: [18, 30], drainage: D(65, 100, 65, 15),
    drainageNote: { fast: 'a thirsty crop: fast-draining soil means heavy watering at tasselling' },
    sun: S(100, 40, 5), ph: [5.800, 7.0], frost: 'tender', spring: { start: 1, end: 7, method: 'direct sow' }, fall: null, maturity: [70, 95] },
  { id: 'cucumber', name: 'Cucumbers', category: 'fruiting', tempMin: 16, tempOpt: [21, 30], drainage: D(70, 100, 55, 10),
    drainageNote: { fast: 'fruit turns bitter if fast-draining soil dries between waterings' },
    sun: S(100, 60, 15), ph: [6.0, 7.0], frost: 'tender', spring: { start: 2, end: 8, method: 'direct sow or transplant' }, fall: null, maturity: [50, 70] },
  { id: 'squash', name: 'Summer squash', category: 'fruiting', tempMin: 16, tempOpt: [21, 32], drainage: D(80, 100, 55, 10),
    drainageNote: {}, sun: S(100, 55, 10), ph: [6.0, 7.5], frost: 'tender', spring: { start: 2, end: 9, method: 'direct sow' }, fall: null, maturity: [45, 60] },
  { id: 'melon', name: 'Melons', category: 'fruiting', tempMin: 18, tempOpt: [24, 32], drainage: D(100, 85, 35, 5),
    drainageNote: { fast: 'sandy, fast-draining soil warms early and makes the sweetest fruit' },
    sun: S(100, 35, 5), ph: [6.0, 7.0], frost: 'tender', spring: { start: 2, end: 6, method: 'transplant or direct sow' }, fall: null, maturity: [75, 100] },
  { id: 'sweet_potato', name: 'Sweet potatoes', category: 'root', tempMin: 18, tempOpt: [21, 30], drainage: D(100, 85, 35, 5),
    drainageNote: { fast: 'thrives in loose, sandy soil that would starve other crops' },
    sun: S(100, 45, 5), ph: [5.5, 6.5], frost: 'tender', spring: { start: 3, end: 7, method: 'slips' }, fall: null, maturity: [90, 120] },
  { id: 'basil', name: 'Basil', category: 'herb', tempMin: 15, tempOpt: [21, 29], drainage: D(75, 100, 55, 15),
    drainageNote: {}, sun: S(100, 70, 20), ph: [6.0, 7.5], frost: 'tender', spring: { start: 2, end: 10, method: 'transplant or direct sow' }, fall: null, maturity: [50, 70] },
  { id: 'rosemary', name: 'Rosemary & thyme', category: 'herb', tempMin: 13, tempOpt: [18, 28], drainage: D(100, 80, 25, 0),
    drainageNote: { fast: 'Mediterranean herbs want exactly this: soil that never stays wet', slow: 'roots rot where water lingers', very_slow: 'will not survive wet feet' },
    sun: S(100, 50, 5), ph: [6.0, 8.0], frost: 'half_hardy', spring: { start: 1, end: 10, method: 'transplant' }, fall: null, maturity: [80, 100] },
  { id: 'strawberry', name: 'Strawberries', category: 'fruit', tempMin: 7, tempOpt: [15, 26], drainage: D(80, 100, 45, 10),
    drainageNote: { very_slow: 'crowns rot in wet soil' },
    sun: S(100, 65, 15), ph: [5.5, 6.800], frost: 'hardy', spring: { start: -4, end: 3, method: 'bare-root crowns' }, fall: { start: 8, end: 4, method: 'plugs' }, maturity: [90, 120] },
  { id: 'blueberry', name: 'Blueberries', category: 'fruit', tempMin: 7, tempOpt: [13, 24], drainage: D(70, 100, 50, 10),
    drainageNote: {}, sun: S(100, 70, 20), ph: [4.5, 5.5], frost: 'hardy', spring: { start: -4, end: 4, method: 'potted shrubs' }, fall: { start: 8, end: 3, method: 'potted shrubs' }, maturity: [365, 730] },
  { id: 'celery', name: 'Celery', category: 'leafy', tempMin: 10, tempOpt: [15, 24], drainage: D(20, 80, 100, 60),
    drainageNote: { fast: 'a bog plant at heart: fast-draining soil cannot keep it wet enough', slow: 'moisture-holding soil is exactly what celery wants' },
    sun: S(100, 85, 35), ph: [6.0, 7.0], frost: 'half_hardy', spring: { start: 0, end: 4, method: 'transplant' }, fall: null, maturity: [85, 120] },
  { id: 'taro', name: 'Taro', category: 'root', tempMin: 18, tempOpt: [21, 32], drainage: D(5, 45, 90, 100),
    drainageNote: { fast: 'needs constantly wet soil; this drains far too fast', slow: 'likes soil that holds water', very_slow: 'one of the few crops that thrives in waterlogged ground' },
    sun: S(100, 85, 40), ph: [5.5, 7.0], frost: 'tender', spring: { start: 2, end: 8, method: 'corms' }, fall: null, maturity: [200, 300] },
  { id: 'mint', name: 'Mint', category: 'herb', tempMin: 7, tempOpt: [13, 24], drainage: D(40, 90, 100, 65),
    drainageNote: { slow: 'spreads happily in damp, heavy soil', fast: 'sulks unless watered often' },
    sun: S(85, 100, 70), ph: [6.0, 7.5], frost: 'hardy', spring: { start: -2, end: 12, method: 'transplant' }, fall: { start: 8, end: 4, method: 'transplant' }, maturity: [60, 90] },
  { id: 'clover', name: 'Clover (cover crop)', category: 'cover', tempMin: 4, tempOpt: [10, 24], drainage: D(65, 95, 85, 50),
    drainageNote: { slow: 'tolerates heavy soil and loosens it for next year' },
    sun: S(100, 85, 50), ph: [6.0, 7.5], frost: 'hardy', spring: { start: -4, end: 4, method: 'broadcast seed' }, fall: { start: 10, end: 4, method: 'broadcast seed' }, maturity: [60, 90] },
];

export const cropById = (id: string): Crop | undefined =>
  CROPS.find((c) => c.id === id || c.name.toLowerCase() === id.toLowerCase() || c.name.toLowerCase().replace(/s$/, '') === id.toLowerCase().replace(/s$/, ''));

export interface ScoreContext {
  drainageClass: DrainageClass | null;
  soilTempC: number | null;
  sun: Sun | null;
  ph: number | null;
  frost: FrostDates | null;
  today?: Date;
}

const WEIGHTS = { drainage: 0.35, soil_temp: 0.25, season: 0.2, sun: 0.12, ph: 0.08 } as const;
const DRAIN_WORDS: Record<DrainageClass, string> = {
  fast: 'fast-draining', moderate: 'well-draining', slow: 'slow-draining', very_slow: 'very slow-draining',
};
/** Acid-lovers (blueberries) fail in ordinary soil, so unknown pH must not look like a pass. */
const ACID_CAP = 70;
const needsAcid = (c: Crop) => c.ph[1] < 6.0;
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

function drainageFactor(c: Crop, ctx: ScoreContext): FactorScore {
  const base = { key: 'drainage' as const, label: 'Drainage', weight: WEIGHTS.drainage };
  if (!ctx.drainageClass) return { ...base, score: null, known: false, reason: 'Drainage not measured yet. Run a pour test.' };
  const score = c.drainage[ctx.drainageClass];
  const note = c.drainageNote[ctx.drainageClass];
  const verdict = score >= 85 ? 'ideal' : score >= 65 ? 'fine' : score >= 40 ? 'a stretch' : 'a poor match';
  return { ...base, score, known: true, reason: `Measured ${DRAIN_WORDS[ctx.drainageClass]} soil is ${verdict} for ${c.name.toLowerCase()}${note ? ': ' + note : ''}.` };
}

function tempFactor(c: Crop, ctx: ScoreContext): FactorScore {
  const base = { key: 'soil_temp' as const, label: 'Soil temperature', weight: WEIGHTS.soil_temp };
  const t = ctx.soilTempC;
  if (t == null) return { ...base, score: null, known: false, reason: 'No soil temperature reading (probe offline).' };
  const [lo, hi] = c.tempOpt;
  let score: number, reason: string;
  if (t < c.tempMin) {
    score = Math.max(0, Math.round(35 - (c.tempMin - t) * 7));
    reason = `Soil is ${f1(t)} °C, below the ${c.tempMin} °C it needs.`;
  } else if (t < lo) {
    score = Math.round(60 + ((t - c.tempMin) / Math.max(1, lo - c.tempMin)) * 40);
    reason = `Soil is ${f1(t)} °C: above its ${c.tempMin} °C minimum, a little under the ${lo}–${hi} °C it likes best.`;
  } else if (t <= hi) {
    score = 100;
    reason = `Soil is ${f1(t)} °C, inside its ideal ${lo}–${hi} °C range.`;
  } else {
    score = Math.max(30, Math.round(100 - (t - hi) * 8));
    reason = `Soil is ${f1(t)} °C, warmer than the ${lo}–${hi} °C it prefers${c.frost !== 'tender' ? '; cool-season crops bolt in warm soil' : ''}.`;
  }
  return { ...base, score, known: true, reason };
}

function sunFactor(c: Crop, ctx: ScoreContext): FactorScore {
  const base = { key: 'sun' as const, label: 'Sun', weight: WEIGHTS.sun };
  if (!ctx.sun) return { ...base, score: null, known: false, reason: 'Sun exposure not set for this zone.' };
  const score = c.sun[ctx.sun];
  const words = { full: 'full sun', partial: 'partial sun', shade: 'shade' }[ctx.sun];
  return { ...base, score, known: true, reason: `You said this zone gets ${words}: ${score >= 85 ? 'what it wants' : score >= 55 ? 'workable' : 'not enough light'}.` };
}

function phFactor(c: Crop, ctx: ScoreContext): FactorScore {
  const base = { key: 'ph' as const, label: 'pH', weight: WEIGHTS.ph };
  if (ctx.ph == null) {
    return {
      ...base, score: null, known: false,
      reason: needsAcid(c)
        ? `Needs acidic soil (pH ${c.ph[0]}–${c.ph[1]}), which most ground is not. pH is not measured, so the score is capped at ${ACID_CAP} until you enter it.`
        : 'pH not entered (optional, not measured by the probes).',
    };
  }
  const [lo, hi] = c.ph;
  const gap = ctx.ph < lo ? lo - ctx.ph : ctx.ph > hi ? ctx.ph - hi : 0;
  const score = Math.max(0, Math.round(100 - gap * 60));
  return { ...base, score, known: true, reason: gap === 0 ? `pH ${f1(ctx.ph)} you entered is inside its ${lo}–${hi} range.` : `pH ${f1(ctx.ph)} you entered is ${f1(gap)} outside its ${lo}–${hi} range.` };
}

function seasonFactor(c: Crop, ctx: ScoreContext, win: PlantingWindow | null): FactorScore {
  const base = { key: 'season' as const, label: 'Season', weight: WEIGHTS.season };
  if (!win || win.status === 'unknown') return { ...base, score: null, known: false, reason: 'Location not set, so the planting window is unknown.' };
  const score = win.status === 'open' || win.status === 'year_round' ? 100 : win.status === 'upcoming' ? 55 : 20;
  const next = win.nextOpen ? new Date(win.nextOpen + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  const reason =
    win.status === 'open' ? 'Its planting window is open now (estimated from local frost dates).'
    : win.status === 'year_round' ? 'No frost here, so it can go in any time.'
    : win.status === 'upcoming' ? `Window opens around ${next} (estimated from local frost dates).`
    : `Window has closed for this year${next ? `; next opens around ${next}` : ''} (estimated from local frost dates).`;
  return { ...base, score, known: true, reason };
}

export function scoreCrop(c: Crop, ctx: ScoreContext): CropScore {
  const win = ctx.frost ? plantingWindow(c, ctx.frost, ctx.today ?? new Date(), ctx.soilTempC) : null;
  const factors = [drainageFactor(c, ctx), tempFactor(c, ctx), seasonFactor(c, ctx, win), sunFactor(c, ctx), phFactor(c, ctx)];
  const known = factors.filter((f) => f.known && f.score != null);
  const wsum = known.reduce((s, f) => s + f.weight, 0);
  let score = wsum ? known.reduce((s, f) => s + f.weight * (f.score as number), 0) / wsum : 0;
  // A fatal mismatch cannot be averaged away by the other factors.
  if (known.some((f) => (f.score as number) < 25)) score = Math.min(score, 45);
  if (ctx.ph == null && needsAcid(c)) score = Math.min(score, ACID_CAP);
  score = Math.round(score);

  const unknowns = factors.filter((f) => !f.known).map((f) => f.key);
  const coreUnknown = unknowns.filter((k) => k === 'drainage' || k === 'soil_temp').length;
  const confidence = coreUnknown === 0 ? 'high' : coreUnknown === 1 ? 'medium' : 'low';

  const sorted = [...known].sort((a, b) => (b.score as number) - (a.score as number));
  const best = sorted[0], worst = sorted[sorted.length - 1];
  let summary = 'Nothing measured yet for this zone.';
  if (best) summary = best.reason + (worst && worst !== best && (worst.score as number) < 70 ? ' ' + worst.reason : '');

  const tempOk = ctx.soilTempC == null ? null : ctx.soilTempC >= c.tempMin;
  const winOpen = !win || win.status === 'unknown' ? null : win.status === 'open' || win.status === 'year_round';
  const plantableNow = tempOk == null || winOpen == null ? null : tempOk && winOpen;

  return {
    id: c.id, name: c.name, category: c.category, score,
    verdict: score >= 80 ? 'great' : score >= 60 ? 'good' : score >= 40 ? 'marginal' : 'poor',
    factors, summary, plantableNow, confidence, unknowns,
  };
}

export function scoreCrops(ctx: ScoreContext): CropScore[] {
  return CROPS.map((c) => scoreCrop(c, ctx)).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
