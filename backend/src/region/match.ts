/**
 * Complementarity: who nearby can grow what this plot cannot, and the other way round.
 *
 * It is a set difference between two crop-score lists, both produced by the SAME rules engine
 * (src/crops.ts). Only the soil factors are compared (drainage, pH): the two plots share one
 * climate, so temperature and season cancel out, and we know nothing about a neighbour's shade.
 * No language model is involved. The sentences below are templates filled with looked-up facts.
 */
import { CROPS, scoreCrop } from '../crops.js';
import type { DrainageClass } from '../types.js';
import { cdlClass, cropWord } from './cdl.js';
import type { Region, RegionField } from './types.js';

export const CAN = 75;      // a crop "can grow" on a soil at or above this soil-only score
export const CANNOT = 50;   // and "can't" at or below this
export const MAX_MATCHES = 8;

export interface YourSoil { drainageClass: DrainageClass; ph: number | null; label: string; texture: string; plotName: string }
export interface CropGap { id: string; name: string; you: number; they: number }

export interface FarmIdentity { farm: string; person: string; note: string; illustrative: true }
export interface Match {
  fieldId: string;
  rank: number;
  /** 0-100: half from what you add, half from what they add, reduced by up to 25 % with distance */
  score: number;
  identity: FarmIdentity;
  distanceKm: number;
  bearing: string;
  theyGrow: string[];
  youNotThey: CropGap[];
  theyNotYou: CropGap[];
  /** crops from `theyNotYou` that the cropland map shows them ALREADY growing: evidence, not only a score */
  proven: string[];
  youWhy: string;
  theyWhy: string;
  sentence: string;
  draft: string;
  soil: { series: string; texture: string | null; drainagecl: string | null; ph: number | null; estimate: true };
}

const PHRASE: Record<DrainageClass, string> = {
  fast: 'fast-draining soil', moderate: 'well-draining soil', slow: 'soil that holds water', very_slow: 'heavy soil that stays wet',
};

export function soilOnlyScores(drainageClass: DrainageClass | null, ph: number | null): Map<string, number> {
  return new Map(CROPS.map((c) => [c.id, scoreCrop(c, { drainageClass, ph, soilTempC: null, sun: null, frost: null }).score]));
}

const list = (names: string[]): string => (names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
const lower = (s: string) => s.toLowerCase().replace(/ \(cover crop\)/, '');

// ---- illustrative identities. Deterministic, so a farm keeps its name between runs. None of these are real people.
const PEOPLE = ['Marisol', 'Dale', 'Ximena', 'Walt', 'Priya', 'Hank', 'Lucía', 'Earl', 'Noemi', 'Gus', 'Tessa', 'Ray', 'Inés', 'Cole', 'Ruth', 'Mateo'];
const PLACES = ['Magpie Bend', 'Basalt Bench', 'Second Ditch', 'Sage Flat', 'Long Row', 'Heron Slough', 'Kestrel Hill', 'Windbreak', 'Tumbleweed', 'Quarter Section', 'Lateral Nine', 'Goldfinch', 'Rimrock', 'Coyote Wash', 'Bunchgrass', 'Headgate'];
function hash(s: string): number { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function suffix(code: number): string {
  const f = cdlClass(code).family;
  return code === 56 ? 'Hop Yard' : f === 'orchard' ? 'Orchards' : f === 'vineyard' ? 'Vineyard' : f === 'hops_herbs' ? 'Herb Farm' : f === 'hay' ? 'Hay & Forage' : f === 'vegetables' ? 'Produce' : f === 'berries' ? 'Berry Farm' : 'Farms';
}
export function identityFor(region: Region, f: RegionField): FarmIdentity {
  const h = hash(`${region.centre.lat.toFixed(2)},${region.centre.lon.toFixed(2)}:${f.id}`);
  const soil = f.soil ? ` of ${f.soil.series} ${f.soil.texture ? lower(f.soil.texture) : 'soil'}` : '';
  return {
    farm: `${PLACES[h % PLACES.length]} ${suffix(f.code)}`, person: PEOPLE[(h >>> 8) % PEOPLE.length],
    note: `Grows ${list(f.grows.map((g) => cropWord(g.code)))} on about ${f.areaHa} ha${soil}.`, illustrative: true,
  };
}

export function findMatches(region: Region, you: YourSoil): Match[] {
  const mine = soilOnlyScores(you.drainageClass, you.ph);
  const theirsCache = new Map<string, Map<string, number>>();
  const scored: Omit<Match, 'rank'>[] = [];

  for (const f of region.fields) {
    const s = f.soil;
    if (!s?.drainageClass || f.distanceKm < 0.5) continue;
    const key = `${s.drainageClass}|${s.ph ?? ''}`;
    const theirs = theirsCache.get(key) ?? soilOnlyScores(s.drainageClass, s.ph);
    theirsCache.set(key, theirs);
    const youNotThey: CropGap[] = [], theyNotYou: CropGap[] = [];
    for (const c of CROPS) {
      const a = mine.get(c.id)!, b = theirs.get(c.id)!;
      if (a >= CAN && b <= CANNOT) youNotThey.push({ id: c.id, name: c.name, you: a, they: b });
      if (b >= CAN && a <= CANNOT) theyNotYou.push({ id: c.id, name: c.name, you: a, they: b });
    }
    if (!youNotThey.length && !theyNotYou.length) continue;
    const grownHere = new Set(f.grows.map((g) => cdlClass(g.code).cropId).filter(Boolean));
    const proven = theyNotYou.filter((g) => grownHere.has(g.id));
    youNotThey.sort((p, q) => q.you - q.they - (p.you - p.they));
    theyNotYou.sort((p, q) => Number(grownHere.has(q.id)) - Number(grownHere.has(p.id)) || q.they - q.you - (p.they - p.you));
    const give = Math.min(300, youNotThey.reduce((t, g) => t + g.you - g.they, 0)), get = Math.min(300, theyNotYou.reduce((t, g) => t + g.they - g.you, 0));
    // + 10 when the map shows them already growing something this plot cannot: the pairing is proven, not only predicted
    const score = Math.min(100, Math.round(((give + get) / 6) * (1 - 0.25 * Math.min(1, f.distanceKm / region.halfKm))) + (proven.length ? 10 : 0));

    const identity = identityFor(region, f);
    const mineNames = youNotThey.slice(0, 3).map((g) => lower(g.name)), theirNames = theyNotYou.slice(0, 3).map((g) => lower(g.name));
    const youWhy = `your ${you.texture ? lower(you.texture) + ', ' : ''}${PHRASE[you.drainageClass]}`.replace('soil, fast', 'fast');
    const theyWhy = `their ${s.texture ? lower(s.texture) : 'soil'} ${s.drainageClass === 'fast' ? 'drains fast' : s.drainageClass === 'moderate' ? 'drains well' : s.drainageClass === 'slow' ? 'holds water' : 'stays wet'}`;
    const where = `${f.distanceKm} km ${f.bearing} of you`;
    const sentence = mineNames.length && theirNames.length
      ? `Your ${PHRASE[you.drainageClass]} is right for ${list(mineNames)}, which would struggle in ${identity.person}'s ${PHRASE[s.drainageClass]}; theirs is right for ${list(theirNames)}, which yours cannot support${proven.length ? `, and the cropland map shows them already growing ${list(proven.map((g) => lower(g.name)))}` : ''}. ${where[0].toUpperCase() + where.slice(1)}.`
      : mineNames.length
        ? `Your ${PHRASE[you.drainageClass]} is right for ${list(mineNames)}, which would struggle in ${identity.person}'s ${PHRASE[s.drainageClass]}, ${where}.`
        : `${identity.person}'s ${PHRASE[s.drainageClass]} is right for ${list(theirNames)}, which your ${PHRASE[you.drainageClass]} cannot support, ${where}.`;
    const grows = f.grows.map((g) => cropWord(g.code));
    const draft = [
      `Hi ${identity.person},`, '',
      `I work a plot about ${f.distanceKm} km from ${identity.farm}. I have been measuring my soil with probes: it is ${lower(you.label)}. The public soil survey describes your ground as ${s.mapUnit}${s.drainagecl ? ` (${s.drainagecl.toLowerCase()})` : ''}, and the USDA cropland map shows ${list(grows)} there.`, '',
      `That looks complementary. ${mineNames.length ? `My soil suits ${list(mineNames)}, which tend to struggle on ground like yours. ` : ''}${theirNames.length ? `Yours suits ${list(theirNames)}, which mine cannot support. ` : ''}Would you be open to talking about trading produce, sharing a market stall, or splitting a seed order?`, '',
      'Thanks,', you.plotName,
    ].join('\n');

    scored.push({
      fieldId: f.id, score, identity, distanceKm: f.distanceKm, bearing: f.bearing, theyGrow: grows, youNotThey, theyNotYou, proven: proven.map((g) => g.name), youWhy, theyWhy, sentence, draft,
      soil: { series: s.series, texture: s.texture, drainagecl: s.drainagecl, ph: s.ph, estimate: true },
    });
  }

  // best first; two-sided pairings before one-sided; then spread them out so the map does not light up one corner
  scored.sort((a, b) => Number(b.youNotThey.length > 0 && b.theyNotYou.length > 0) - Number(a.youNotThey.length > 0 && a.theyNotYou.length > 0) || b.score - a.score || a.distanceKm - b.distanceKm);
  const byId = new Map(region.fields.map((f) => [f.id, f]));
  const picked: typeof scored = [];
  for (const m of scored) {
    const f = byId.get(m.fieldId)!;
    const crowded = picked.some((p) => { const g = byId.get(p.fieldId)!; return Math.hypot(g.cx - f.cx, g.cy - f.cy) * region.cellM < 2500 || (g.code === f.code && picked.filter((x) => byId.get(x.fieldId)!.code === f.code).length >= 2); });
    if (!crowded) picked.push(m);
    if (picked.length >= MAX_MATCHES) break;
  }
  return picked.map((m, i) => ({ ...m, rank: i + 1 }));
}

/** Crops this soil suits that the cropland map shows nobody growing within the region. */
export function unservedCrops(region: Region, you: YourSoil): { id: string; name: string; score: number }[] {
  const grown = new Set(region.legend.filter((l) => l.farmed && l.sharePct >= 0.05).map((l) => cdlClass(l.code).cropId).filter(Boolean));
  const mine = soilOnlyScores(you.drainageClass, you.ph);
  return CROPS.filter((c) => mine.get(c.id)! >= CAN && !grown.has(c.id) && c.category !== 'cover').map((c) => ({ id: c.id, name: c.name, score: mine.get(c.id)! })).sort((a, b) => b.score - a.score);
}
