/**
 * BackendBoard: the real data source. Implements BoardSource against the backend
 * (`backend/`, a local Node process that owns the three UNO Q boards).
 *
 *   live data   Server-Sent Events from GET /api/events (named events: config, sample,
 *               pour, profile, notes, overrides, agent_call, ui_command)
 *   everything  plain REST, one route per BoardSource method
 *
 * There is no simulator. If the backend is not running the app says so, and every probe
 * reads offline. Start it with:  cd backend && npm start
 */
import type { BoardEvent, BoardSource } from './source';
import type {
  Connectivity, CropScore, RegionView, Diagnosis, Forecast, FrostDates, HistorySeries, Note, Overrides, Place, PlantingWindow, Plot,
  ProbeId, SoilProfile, Zone, ZoneId, ZoneReading,
} from './types';

export const BACKEND_URL = ((import.meta.env.VITE_BACKEND as string | undefined) ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

const STREAMED = ['config', 'sample', 'pour', 'profile', 'notes', 'overrides', 'agent_call', 'ui_command', 'region'] as const;

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(BACKEND_URL + path, {
    ...init,
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && body?.ok === undefined) throw new Error(body?.error ?? `Backend answered ${res.status}`);
  return body as T;
}
const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
/** Fire-and-forget commands: the resulting state comes back on the event stream. */
const send = (p: Promise<unknown>) => void p.catch((e) => console.warn('[backend]', e instanceof Error ? e.message : e));

export class BackendBoard implements BoardSource {
  readonly mode = 'board' as const;
  private listener: (e: BoardEvent) => void = () => {};
  private stream: EventSource | null = null;

  connect(listener: (e: BoardEvent) => void): void {
    this.listener = listener;
    this.open();
  }

  private open(): void {
    const es = new EventSource(`${BACKEND_URL}/api/events`);
    this.stream = es;
    es.onopen = () => this.listener({ type: 'link', online: true });
    // The browser reconnects by itself (the server asks for a 2 s retry). We only report state.
    es.onerror = () => this.listener({ type: 'link', online: false });
    for (const type of STREAMED) {
      es.addEventListener(type, (m) => {
        try { this.listener(JSON.parse((m as MessageEvent).data) as BoardEvent); }
        catch (e) { console.warn('[backend] bad event', type, e); }
      });
    }
  }

  // ------------------------------------------------------------------ configuration
  setPlot(plot: Plot, zones: Zone[]): void { send(put('/api/config/plot', { plot, zones })); }
  updateZone(id: ZoneId, patch: Partial<Pick<Zone, 'sun' | 'ph' | 'name'>>): void { send(api(`/api/zones/${encodeURIComponent(id)}`, { method: 'PATCH', json: patch })); }
  setPlace(place: Place | null): void { send(put('/api/config/place', { place })); }
  setOnboarded(done: boolean): void { send(post('/api/config/onboarded', { done })); }
  async calibrate(probe: ProbeId, step: 'air' | 'water') {
    try { return await post<{ ok: true; raw: number } | { ok: false; error: string }>(`/api/calibrate/${probe}`, { step }); }
    catch { return { ok: false as const, error: 'The backend is not reachable.' }; }
  }
  clearCalibration(probe: ProbeId): void { send(post(`/api/calibrate/${probe}/reset`)); }

  // ------------------------------------------------------------------------- pour test
  armPour(): void { send(post('/api/pour/arm')); }
  resetPour(): void { send(post('/api/pour/reset')); }
  clearSoilProfile(): void { send(post('/api/soil-profile/clear')); }

  // --------------------------------------------------------------------------- answers
  async readZone(id: ZoneId): Promise<ZoneReading> { return (await api<{ reading: ZoneReading }>(`/api/zones/${encodeURIComponent(id)}`)).reading; }
  async soilProfile(): Promise<SoilProfile | null> { return (await api<{ profile: SoilProfile | null }>('/api/soil-profile')).profile; }
  async scoreCrops(id: ZoneId): Promise<CropScore[]> { return (await api<{ crops: CropScore[] }>(`/api/zones/${encodeURIComponent(id)}/crops`)).crops; }
  async plantingWindow(cropId: string, zoneId: ZoneId): Promise<PlantingWindow | null> {
    return (await api<{ window: PlantingWindow | null }>(`/api/zones/${encodeURIComponent(zoneId)}/planting-window/${encodeURIComponent(cropId)}`)).window;
  }
  async forecast(): Promise<Forecast> { return (await api<{ forecast: Forecast }>('/api/forecast')).forecast; }
  async frostDates(): Promise<FrostDates | null> { return (await api<{ frost: FrostDates | null }>('/api/frost-dates')).frost; }
  async diagnose(id: ZoneId): Promise<Diagnosis> { return (await api<{ diagnosis: Diagnosis }>(`/api/zones/${encodeURIComponent(id)}/findings`)).diagnosis; }
  async history(id: ZoneId, hours: number): Promise<HistorySeries> { return (await api<{ history: HistorySeries }>(`/api/zones/${encodeURIComponent(id)}/history?hours=${hours}`)).history; }
  async addNote(text: string, zoneId: ZoneId | null, author: 'user' | 'agent'): Promise<Note> { return (await post<{ note: Note }>('/api/notes', { text, zoneId, author })).note; }
  async connectivity(): Promise<Connectivity> { return (await api<{ connectivity: Connectivity }>('/api/connectivity')).connectivity; }
  async region(): Promise<RegionView> { return api<RegionView>('/api/region'); }
  async demoPlace(): Promise<Place> { return (await api<{ place: Place }>('/api/region/demo-place')).place; }

  // ------------------------------------------------------------------- demo controls
  setOverrides(o: Overrides): void { send(put('/api/overrides', o)); }
  async runPump(): Promise<{ ok: false; reason: string }> { return { ok: false, reason: 'No pump fitted. Water is poured by the servo: use the Pour water button.' }; }
}
