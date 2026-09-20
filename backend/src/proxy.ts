import type {
  BoardConfig, CropScore, Forecast, HistorySeries, Mode, Note, PlantingWindow, PourActuatorStatus,
  PourCaller, PourGuardKind, PourResult, SoftGuardKind, SoilProfile, Zone, ZoneId, ZoneLive, ZoneReading,
} from './types.js';

/** What MCP tools need. SoilApp implements this; stdio may proxy it over HTTP. */
export interface McpBackend {
  mode: Mode;
  config: BoardConfig;
  zone(id: ZoneId): Zone;
  recordAgentCall(tool: string, zones: ZoneId[], summary: string): unknown;
  readZone(id: ZoneId): Promise<ZoneReading>;
  soilProfile(): Promise<SoilProfile | null>;
  scoreCrops(id: ZoneId): Promise<CropScore[]>;
  plantingWindow(cropId: string, zoneId: ZoneId): Promise<PlantingWindow | null>;
  forecast(): Promise<Forecast>;
  historyFor(id: ZoneId, hours: number): Promise<HistorySeries>;
  addNote(text: string, zoneId: ZoneId | null, author: 'user' | 'agent'): Promise<Note>;
  snapshotReadings(): unknown;
  readings(): Promise<unknown>;
  pourWater(opts: { holdMs?: number; force?: boolean; caller: PourCaller }): Promise<{
    result: PourResult; ok: boolean; reason?: string; reading?: ZoneLive; next?: string;
    guard?: PourGuardKind; softKind?: SoftGuardKind; holdMsUsed?: number; holdMsClamped?: boolean;
  }>;
  pourStatus(): Promise<PourActuatorStatus>;
}

export class HttpBackend implements McpBackend {
  mode: Mode = 'board';
  config: BoardConfig = { plot: { name: '', width: 0, length: 0 }, zones: [], place: null, calibration: { A: { airRaw: null, waterRaw: null, calibratedAt: null, source: 'default' }, B: { airRaw: null, waterRaw: null, calibratedAt: null, source: 'default' } }, onboarded: false };

  constructor(private base: string) {}

  async refresh(): Promise<void> {
    const j = await this.api('/api/config');
    if (j.config) this.config = j.config;
    if (j.mode) this.mode = j.mode;
  }

  zone(id: ZoneId): Zone {
    const want = String(id).toLowerCase().replace(/^zone\s+/, '');
    const z = this.config.zones.find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want || x.name.toLowerCase() === 'zone ' + want);
    if (!z) throw new Error(`No zone "${id}". Zones: ${this.config.zones.map((x) => x.id).join(', ') || '(config not loaded — call list_zones)'}`);
    return z;
  }

  recordAgentCall(tool: string, zones: ZoneId[], summary: string): void {
    void this.api('/api/agent/calls', { method: 'POST', body: JSON.stringify({ tool, zones, summary }) });
  }

  async readZone(id: ZoneId): Promise<ZoneReading> {
    await this.refresh();
    const j = await this.api(`/api/zones/${encodeURIComponent(this.zone(id).id)}`);
    return j.reading;
  }
  async soilProfile(): Promise<SoilProfile | null> {
    const j = await this.api('/api/soil-profile');
    return j.profile;
  }
  async scoreCrops(id: ZoneId): Promise<CropScore[]> {
    await this.refresh();
    const j = await this.api(`/api/zones/${encodeURIComponent(this.zone(id).id)}/crops`);
    return j.crops;
  }
  async plantingWindow(cropId: string, zoneId: ZoneId): Promise<PlantingWindow | null> {
    await this.refresh();
    const j = await this.api(`/api/zones/${encodeURIComponent(this.zone(zoneId).id)}/planting-window/${encodeURIComponent(cropId)}`);
    return j.window;
  }
  async forecast(): Promise<Forecast> {
    const j = await this.api('/api/forecast');
    return j.forecast;
  }
  async historyFor(id: ZoneId, hours: number): Promise<HistorySeries> {
    await this.refresh();
    const j = await this.api(`/api/zones/${encodeURIComponent(this.zone(id).id)}/history?hours=${hours}`);
    return j.history;
  }
  async addNote(text: string, zoneId: ZoneId | null, author: 'user' | 'agent'): Promise<Note> {
    const j = await this.api('/api/notes', { method: 'POST', body: JSON.stringify({ text, zoneId, author }) });
    return j.note;
  }
  snapshotReadings(): unknown {
    throw new Error('use readings()');
  }
  async readings(): Promise<unknown> {
    return this.api('/api/readings');
  }
  async pourWater(opts: { holdMs?: number; force?: boolean; caller: PourCaller }) {
    const j = await this.api('/api/pour', { method: 'POST', body: JSON.stringify({ holdMs: opts.holdMs, force: opts.force }) });
    return j;
  }
  async pourStatus(): Promise<PourActuatorStatus> {
    const j = await this.api('/api/pour/status');
    return j.actuator;
  }

  private async api(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Pour-Caller': 'mcp-stdio', ...(init?.headers ?? {}) },
    });
    const j = await res.json() as any;
    if (j.mode) this.mode = j.mode;
    if (!res.ok && j.error) throw new Error(j.error);
    return j;
  }
}
