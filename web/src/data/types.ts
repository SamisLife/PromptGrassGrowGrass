/**
 * The data contract between the web app and "the board".
 *
 * Today the board is simulated in the browser (data/sim). Later the UNO Q's
 * Python service implements the same shapes over REST + Socket.IO. Keep this
 * file the single description of that contract.
 */

export type ZoneId = string;
export type ProbeId = 'A' | 'B';
export type Sun = 'full' | 'partial' | 'shade';
export type DrainageClass = 'fast' | 'moderate' | 'slow' | 'very_slow';

export interface Plot {
  name: string;
  /** centimetres */
  width: number;
  length: number;
}

export interface Zone {
  id: ZoneId;
  name: string;
  probe: ProbeId;
  /** probe position in plot coordinates, cm from the plot's top-left corner */
  x: number;
  y: number;
  sun: Sun;
  ph: number | null;
}

export interface Place {
  name: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
}

export interface Calibration {
  airRaw: number | null;
  waterRaw: number | null;
  calibratedAt: number | null;
  /** 'default' = the pre-configured bench values (data/calibrationDefaults.ts); 'user' = captured in the app */
  source: 'default' | 'user';
}

export interface ZoneLive {
  t: number;
  moistureRaw: number | null;
  /** relative moisture: % of this probe's air-to-water range. Not volumetric. */
  moisturePct: number | null;
  tempC: number | null;
  moistureOnline: boolean;
  tempOnline: boolean;
}

export type PourPhase = 'idle' | 'armed' | 'running' | 'done' | 'timeout';

export interface PourState {
  phase: PourPhase;
  source: ZoneId | null;
  target: ZoneId | null;
  /** epoch ms when water reached the source probe / the target probe */
  t0: number | null;
  t1: number | null;
  distanceCm: number | null;
  rateCmMin: number | null;
  drainageClass: DrainageClass | null;
  label: string | null;
  /** moisture of each zone just before the pour, for drawing the dry field */
  baseline: Record<ZoneId, number>;
}

export interface SoilProfile {
  drainageClass: DrainageClass;
  /** e.g. "Fast draining, behaves like sandy soil" */
  label: string;
  texture: string;
  rateCmMin: number;
  distanceCm: number;
  seconds: number;
  between: [ZoneId, ZoneId];
  measuredAt: number;
  /** Texture is inferred from wetting-front speed: always an estimate. */
  estimate: true;
}

export interface FactorScore {
  key: 'drainage' | 'soil_temp' | 'sun' | 'ph' | 'season';
  label: string;
  score: number | null;
  weight: number;
  known: boolean;
  reason: string;
}

export interface CropScore {
  id: string;
  name: string;
  category: string;
  score: number;
  verdict: 'great' | 'good' | 'marginal' | 'poor';
  factors: FactorScore[];
  summary: string;
  plantableNow: boolean | null;
  confidence: 'high' | 'medium' | 'low';
  unknowns: string[];
}

export interface FrostDates {
  source: 'open-meteo-archive' | 'latitude-estimate';
  estimate: true;
  label: string;
  frostFree: boolean;
  /** day-of-year, null when frost free */
  lastSpringFrostDoy: number | null;
  firstFallFrostDoy: number | null;
  growingSeasonDays: number | null;
  yearsUsed: number;
  southern: boolean;
}

export interface PlantingWindow {
  cropId: string;
  cropName: string;
  windows: { kind: 'spring' | 'fall'; start: string; end: string; method: string }[];
  status: 'open' | 'upcoming' | 'closed' | 'year_round' | 'unknown';
  nextOpen: string | null;
  soilWarmEnough: boolean | null;
  soilTempC: number | null;
  soilTempMinC: number;
  text: string;
  estimate: true;
}

export interface ForecastDay {
  date: string;
  precipMm: number;
  precipProb: number | null;
  tmaxC: number | null;
  tminC: number | null;
}

export interface Forecast {
  source: 'open-meteo' | 'sample' | 'override';
  /** true when this is canned sample data because the network was unreachable */
  sample: boolean;
  fetchedAt: number;
  days: ForecastDay[];
  rainNext48hMm: number;
  maxPrecipProb48h: number | null;
  rainExpected: boolean;
  dryDaysAhead: number;
  text: string;
}

export interface WaterAdvice {
  needsWater: boolean | null;
  action: 'water' | 'wait_for_rain' | 'none' | 'unknown';
  headline: string;
  reasons: string[];
}

export interface ZoneReading {
  zone: Zone;
  live: ZoneLive;
  calibrated: boolean;
  water: WaterAdvice;
  soil: SoilProfile | null;
}

export interface Finding {
  key: 'drainage' | 'texture' | 'temperature' | 'water';
  status: 'good' | 'warn' | 'bad' | 'unknown';
  headline: string;
  reason: string;
}

export interface Diagnosis {
  zoneId: ZoneId;
  at: number;
  findings: Finding[];
}

export interface HistoryPoint {
  t: number;
  moisturePct: number | null;
  tempC: number | null;
}

export interface HistorySeries {
  zoneId: ZoneId;
  points: HistoryPoint[];
  /** true for generated sample history (simulated board only) */
  simulated: boolean;
}

export interface Note {
  id: string;
  t: number;
  zoneId: ZoneId | null;
  text: string;
  author: 'user' | 'agent';
}

export type LinkState = 'connected' | 'wired' | 'simulated' | 'down' | 'not_fitted';

export interface ConnLink {
  id: string;
  layer: 'probe_gateway' | 'gateway_internet';
  label: string;
  state: LinkState;
  detail: string;
  /** what it would take / what it is for */
  note: string;
  active: boolean;
}

export interface Connectivity {
  links: ConnLink[];
  internetReachable: boolean | null;
}

export interface Overrides {
  forecast: 'rain' | 'dry' | null;
  /** force a zone's moisture reading (percent) */
  zoneMoisture: Record<ZoneId, number | null>;
}

export interface AgentCall {
  id: number;
  t: number;
  tool: string;
  zones: ZoneId[];
  summary: string;
}

export interface BoardConfig {
  plot: Plot;
  zones: Zone[];
  place: Place | null;
  calibration: Record<ProbeId, Calibration>;
  onboarded: boolean;
}

// ------------------------------------------------------------ the land around the plot
/** Soil at one point, looked up in USDA SSURGO. `drainageClass` is our mapping of their class: an estimate. */
export interface RegionSoil { mukey: string; mapUnit: string; series: string; texture: string | null; drainagecl: string | null; drainageClass: DrainageClass | null; ph: number | null; ksatUmS: number | null }
export interface LegendEntry { code: number; name: string; family: string; familyLabel: string; color: string; farmed: boolean; sharePct: number }
/** A block of neighbouring grid cells where the cropland map says one crop dominates. Not a property boundary. */
export interface RegionField {
  id: string; code: number; crop: string; grows: { code: number; name: string; sharePct: number }[];
  cells: number; areaHa: number; cx: number; cy: number; lat: number; lon: number; distanceKm: number; bearing: string; soil: RegionSoil | null;
}
export interface Region {
  centre: { lat: number; lon: number }; label: string | null; year: number; halfKm: number; cellM: number; n: number;
  cells: number[]; fieldOf: number[]; fields: RegionField[]; legend: LegendEntry[];
  sources: { name: string; what: string; url: string }[]; builtAt: number; precomputed: boolean;
}
export interface CropGap { id: string; name: string; you: number; they: number }
export interface FarmMatch {
  fieldId: string; rank: number; score: number; distanceKm: number; bearing: string;
  /** made up for the demo: the cropland map knows crops, not owners */
  identity: { farm: string; person: string; note: string; illustrative: true };
  theyGrow: string[]; youNotThey: CropGap[]; theyNotYou: CropGap[]; proven: string[];
  youWhy: string; theyWhy: string; sentence: string; draft: string;
  soil: { series: string; texture: string | null; drainagecl: string | null; ph: number | null; estimate: true };
}
export interface RegionView {
  status: 'no_place' | 'loading' | 'ready' | 'unavailable';
  reason: string | null;
  region: Region | null;
  matches: FarmMatch[];
  unserved: { id: string; name: string; score: number }[];
  you: { measured: boolean; drainageClass: string | null; label: string | null; ph: number | null };
}
