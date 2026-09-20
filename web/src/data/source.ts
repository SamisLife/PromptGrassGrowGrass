/**
 * BoardSource: everything the web app needs from "the board".
 *
 * Implementation: BackendBoard (data/backendBoard.ts), which talks to the local backend
 * that owns the three UNO Q boards. Real data only: the in-browser simulator was removed.
 *
 * The UI, the 3D scene and the WebMCP tools only ever talk to this interface.
 */
import type {
  BoardConfig, Connectivity, CropScore, Diagnosis, Forecast, FrostDates, HistorySeries, Note, Overrides, Place,
  PlantingWindow, Plot, PourState, ProbeId, RegionView, SoilProfile, Zone, ZoneId, ZoneLive, ZoneReading,
} from './types';

export type BoardEvent =
  | { type: 'config'; config: BoardConfig }
  | { type: 'sample'; t: number; zones: Record<ZoneId, ZoneLive> }
  | { type: 'pour'; pour: PourState }
  | { type: 'profile'; profile: SoilProfile | null }
  | { type: 'notes'; notes: Note[] }
  | { type: 'overrides'; overrides: Overrides }
  /** an AI agent called a tool through the backend's MCP server: make those zones glow */
  | { type: 'agent_call'; tool: string; zones: ZoneId[]; summary: string; t: number }
  /** the voice assistant asked the app to go somewhere ("show me the history") */
  | { type: 'ui_command'; view?: string; drawer?: string; zone?: string; lens?: string; crop?: string; farm?: string }
  /** the land around the plot changed state (a new place was set, or its data arrived) */
  | { type: 'region'; status: string }
  /** the live stream to the backend went up or down */
  | { type: 'link'; online: boolean };

export interface BoardSource {
  readonly mode: 'board';
  connect(listener: (e: BoardEvent) => void): void;

  // configuration
  setPlot(plot: Plot, zones: Zone[]): void;
  updateZone(id: ZoneId, patch: Partial<Pick<Zone, 'sun' | 'ph' | 'name'>>): void;
  setPlace(place: Place | null): void;
  setOnboarded(done: boolean): void;
  calibrate(probe: ProbeId, step: 'air' | 'water'): Promise<{ ok: true; raw: number } | { ok: false; error: string }>;
  /** Discard the user's calibration for this probe and go back to the pre-configured default. */
  clearCalibration(probe: ProbeId): void;

  // pour test
  armPour(): void;
  /** Cancels or re-arms the pour TEST only. The saved soil profile stays until a new test completes. */
  resetPour(): void;
  /** Deliberately forget the measured soil profile (the probes moved to different soil). */
  clearSoilProfile(): void;

  // the four answers (also the agent's tools)
  readZone(id: ZoneId): Promise<ZoneReading>;
  soilProfile(): Promise<SoilProfile | null>;
  scoreCrops(id: ZoneId): Promise<CropScore[]>;
  plantingWindow(cropId: string, zoneId: ZoneId): Promise<PlantingWindow | null>;
  forecast(): Promise<Forecast>;
  frostDates(): Promise<FrostDates | null>;
  diagnose(id: ZoneId): Promise<Diagnosis>;
  history(id: ZoneId, hours: number): Promise<HistorySeries>;
  addNote(text: string, zoneId: ZoneId | null, author: 'user' | 'agent'): Promise<Note>;
  connectivity(): Promise<Connectivity>;
  /** The land around the plot (USDA cropland map + soil survey) and the fields that complement this plot. */
  region(): Promise<RegionView>;
  /** The fixed demo coordinate, whose region data ships with the backend. */
  demoPlace(): Promise<Place>;

  // hidden demo controls
  setOverrides(o: Overrides): void;
  /** Future pump. Always refuses today: hardware not fitted. */
  runPump(seconds: number): Promise<{ ok: false; reason: string }>;
}
