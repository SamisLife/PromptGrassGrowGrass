/**
 * Shapes that cross the hardware boundary. Kept field-for-field compatible
 * with web/src/data/types.ts. Differences are listed in COMPAT.md.
 */

export type ZoneId = string;
export type ProbeId = 'A' | 'B';
export type Sun = 'full' | 'partial' | 'shade';
export type DrainageClass = 'fast' | 'moderate' | 'slow' | 'very_slow';

export interface Plot {
  name: string;
  width: number;
  length: number;
}

export interface Zone {
  id: ZoneId;
  name: string;
  probe: ProbeId;
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
  source: 'default' | 'user';
}

export interface ZoneLive {
  t: number;
  moistureRaw: number | null;
  moisturePct: number | null;
  tempC: number | null;
  moistureOnline: boolean;
  tempOnline: boolean;
}

export type PourPhase = 'idle' | 'armed' | 'running' | 'done' | 'timeout';
export type ActuatorPhase = 'idle' | 'tipping' | 'holding' | 'returning';

export interface PourState {
  phase: PourPhase;
  source: ZoneId | null;
  target: ZoneId | null;
  t0: number | null;
  t1: number | null;
  distanceCm: number | null;
  rateCmMin: number | null;
  drainageClass: DrainageClass | null;
  label: string | null;
  baseline: Record<ZoneId, number>;
}

export interface SoilProfile {
  drainageClass: DrainageClass;
  label: string;
  texture: string;
  rateCmMin: number;
  distanceCm: number;
  seconds: number;
  between: [ZoneId, ZoneId];
  measuredAt: number;
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
  moistureRaw?: number | null;
}

export interface HistorySeries {
  zoneId: ZoneId;
  points: HistoryPoint[];
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
  note: string;
  active: boolean;
}

export interface Connectivity {
  links: ConnLink[];
  internetReachable: boolean | null;
}

export interface Overrides {
  forecast: 'rain' | 'dry' | null;
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

/** Real hardware only. The simulator was removed on 2026-09-20. */
export type Mode = 'board';

export type UiView = 'field' | 'pour' | 'history' | 'network';
export type UiDrawer = 'soil' | 'plant' | 'when' | 'water' | 'diagnose' | 'none';
export type UiLens = 'natural' | 'moisture' | 'temperature';

/** All fields optional. Unknown values are an error the model can recover from. */
export interface UiCommand {
  view?: UiView;
  drawer?: UiDrawer;
  zone?: ZoneId;
  lens?: UiLens;
  crop?: string;
}

export type StreamEvent =
  | { type: 'config'; config: BoardConfig; mode: Mode }
  | { type: 'sample'; t: number; zones: Record<ZoneId, ZoneLive>; mode: Mode }
  | { type: 'pour'; pour: PourState; mode: Mode }
  | { type: 'profile'; profile: SoilProfile | null; mode: Mode }
  | { type: 'notes'; notes: Note[]; mode: Mode }
  | { type: 'overrides'; overrides: Overrides; mode: Mode }
  | { type: 'agent_call'; tool: string; zones: ZoneId[]; summary: string; t: number; id: number; mode: Mode }
  | { type: 'ui_command'; view?: UiView; drawer?: UiDrawer; zone?: ZoneId; lens?: UiLens; crop?: string; t: number; mode: Mode };

export type PourCaller = 'http' | 'legacy' | 'mcp-http' | 'mcp-stdio' | 'voice';
export type PourResult = 'started' | 'busy' | 'cooldown' | 'offline' | 'no_reply' | 'refused' | 'unauthorized';
export type PourGuardKind = 'soft' | 'hard';
export type SoftGuardKind = 'wet' | 'window';

export interface PourActuatorStatus {
  connected: boolean;
  phase?: ActuatorPhase;
  currentDeg?: number;
  restDeg?: number;
  pourDeg?: number;
  holdMs?: number;
  pours?: number;
  cooldownMsLeft?: number;
  port?: string | null;
  serial?: string | null;
}

export interface DetectedBoard {
  serial: string | null;
  port: string;
  role: 'pour' | 'sensors' | 'other' | 'unknown';
  label: string | null;
  zone: ProbeId | null;
  from: '.env' | 'auto' | null;
  open: boolean;
}
