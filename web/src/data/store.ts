import { create } from 'zustand';
import type { BoardSource } from './source';
import { BackendBoard } from './backendBoard';
import { idlePour } from './sim/pour';
import type {
  AgentCall, BoardConfig, CropScore, Diagnosis, Forecast, FrostDates, HistorySeries, Note, Overrides, PlantingWindow,
  Plot, PourState, RegionView, SoilProfile, Zone, ZoneId, ZoneLive, ZoneReading,
} from './types';

export type Stage = 'welcome' | 'build' | 'location' | 'calibrate' | 'live';
export type View = 'field' | 'pour' | 'history' | 'network';
export type Drawer = null | 'soil' | 'plant' | 'when' | 'water' | 'diagnose';
export type Lens = 'natural' | 'moisture' | 'temperature';

export interface Answers {
  reading: ZoneReading | null;
  crops: CropScore[];
  window: PlantingWindow | null;
  forecast: Forecast | null;
  frost: FrostDates | null;
}

export interface Replay {
  active: boolean;
  playing: boolean;
  t: number;
  hours: number;
  series: Record<ZoneId, HistorySeries>;
}

interface AppState {
  board: BoardSource;
  ready: boolean;
  /** false while the live stream to the backend is down */
  backendOnline: boolean;
  config: BoardConfig | null;
  live: Record<ZoneId, ZoneLive>;
  pour: PourState;
  profile: SoilProfile | null;
  notes: Note[];
  overrides: Overrides;

  stage: Stage;
  view: View;
  drawer: Drawer;
  lens: Lens;
  selectedZone: ZoneId;
  selectedCrop: string | null;
  demoOpen: boolean;
  /** build stage edits the draft; the scene renders it live */
  draft: { plot: Plot; zones: Zone[] } | null;
  /** bumps when the field should play its "coming alive" moment */
  aliveAt: number | null;
  scanAt: number | null;

  answers: Answers;
  diagnosis: Diagnosis | null;
  replay: Replay;
  agentCalls: AgentCall[];
  glow: Record<ZoneId, number>;

  /**
   * The region is a ZOOM LEVEL of the field view, not a page: the camera is pulled up until the
   * land around the plot fills the screen. `regionOn` is that zoom level; the scene sets it too,
   * when the user scrolls out past the plot.
   */
  regionOn: boolean;
  regionData: RegionView | null;
  selectedFarm: string | null;
  hoverFarm: string | null;
  /** the farm whose message draft is open */
  contactFarm: string | null;

  goRegion(on: boolean): void;
  selectFarm(id: string | null): void;
  loadRegion(): Promise<void>;

  setStage(s: Stage): void;
  setView(v: View): void;
  openDrawer(d: Drawer): void;
  setLens(l: Lens): void;
  selectZone(id: ZoneId): void;
  selectCrop(id: string | null): void;
  toggleDemo(open?: boolean): void;
  setDraft(d: { plot: Plot; zones: Zone[] } | null): void;
  commitDraft(): void;
  finishOnboarding(): void;
  runDiagnose(): Promise<void>;
  refreshAnswers(): Promise<void>;
  openHistory(hours?: number): Promise<void>;
  setReplay(patch: Partial<Replay>): void;
  recordAgentCall(tool: string, zones: ZoneId[], summary: string): void;
}

const board: BoardSource = new BackendBoard();
let callSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  board,
  ready: false,
  backendOnline: false,
  config: null,
  live: {},
  pour: idlePour(),
  profile: null,
  notes: [],
  overrides: { forecast: null, zoneMoisture: {} },

  stage: 'welcome',
  view: 'field',
  drawer: null,
  lens: 'natural',
  selectedZone: 'A',
  selectedCrop: null,
  demoOpen: false,
  draft: null,
  aliveAt: null,
  scanAt: null,

  answers: { reading: null, crops: [], window: null, forecast: null, frost: null },
  diagnosis: null,
  replay: { active: false, playing: false, t: Date.now(), hours: 36, series: {} },
  agentCalls: [],
  glow: {},
  regionOn: false,
  regionData: null,
  selectedFarm: null,
  hoverFarm: null,
  contactFarm: null,

  setStage: (stage) => {
    const { config } = get();
    set({ regionOn: false, selectedFarm: null, contactFarm: null, stage, draft: stage === 'build' && config ? { plot: { ...config.plot }, zones: config.zones.map((z) => ({ ...z })) } : null });
  },
  setView: (view) => {
    // the network panel can sit over the zoomed-out land; every other view is about the plot itself
    set((s) => ({ view, drawer: null, regionOn: view === 'network' ? s.regionOn : false, selectedFarm: null, contactFarm: null }));
    if (view === 'history') void get().openHistory();
    else set((s) => ({ replay: { ...s.replay, active: false, playing: false } }));
  },
  openDrawer: (drawer) => set((s) => ({ drawer: s.drawer === drawer ? null : drawer })),
  setLens: (lens) => set({ lens }),
  selectZone: (selectedZone) => { set({ selectedZone, diagnosis: null }); void get().refreshAnswers(); },
  selectCrop: (selectedCrop) => { set({ selectedCrop }); void get().refreshAnswers(); },
  toggleDemo: (open) => set((s) => ({ demoOpen: open ?? !s.demoOpen })),
  setDraft: (draft) => set({ draft }),
  commitDraft: () => { const d = get().draft; if (d) board.setPlot(d.plot, d.zones); },
  finishOnboarding: () => {
    board.setOnboarded(true);
    set({ stage: 'live', draft: null, aliveAt: performance.now() });
    void get().refreshAnswers();
  },

  runDiagnose: async () => {
    set({ scanAt: performance.now(), drawer: 'diagnose', diagnosis: null });
    const [d] = await Promise.all([board.diagnose(get().selectedZone), new Promise((r) => setTimeout(r, 1500))]);
    set({ diagnosis: d });
  },

  refreshAnswers: async () => {
    const { selectedZone, selectedCrop, config } = get();
    if (!config || !config.zones.some((z) => z.id === selectedZone)) return;
    try {
      const [reading, crops, forecast, frost] = await Promise.all([
        board.readZone(selectedZone), board.scoreCrops(selectedZone), board.forecast(), board.frostDates(),
      ]);
      const cropId = selectedCrop ?? crops[0]?.id ?? null;
      const window = cropId ? await board.plantingWindow(cropId, selectedZone) : null;
      set({ answers: { reading, crops, window, forecast, frost } });
    } catch (e) {
      console.warn('refreshAnswers failed', e);
    }
  },

  openHistory: async (hours = 36) => {
    const { config } = get();
    if (!config) return;
    const entries = await Promise.all(config.zones.map(async (z) => [z.id, await board.history(z.id, hours)] as const));
    set((s) => ({ replay: { ...s.replay, hours, series: Object.fromEntries(entries), active: false, playing: false, t: Date.now() } }));
  },
  setReplay: (patch) => set((s) => ({ replay: { ...s.replay, ...patch } })),

  goRegion: (on) => {
    if (get().stage !== 'live') return;
    set((s) => ({ regionOn: on, view: on && s.view !== 'network' ? 'field' : s.view === 'network' && !on ? 'field' : s.view, drawer: null, selectedFarm: null, hoverFarm: null, contactFarm: null, replay: { ...s.replay, active: false, playing: false } }));
    if (on) void get().loadRegion();
  },
  selectFarm: (selectedFarm) => set({ selectedFarm, contactFarm: null }),
  loadRegion: async () => {
    try { set({ regionData: await board.region() }); } catch (e) { console.warn('loadRegion failed', e); }
  },

  recordAgentCall: (tool, zones, summary) => {
    const now = performance.now();
    const call: AgentCall = { id: ++callSeq, t: Date.now(), tool, zones, summary };
    set((s) => ({
      agentCalls: [call, ...s.agentCalls].slice(0, 30),
      glow: { ...s.glow, ...Object.fromEntries(zones.map((z) => [z, now])) },
    }));
  },
}));

/** Wire the board's event stream into the store. Call once at startup. */
export function startBoard(): void {
  let first = true;
  // `?quick` skips onboarding (team shortcut): the plot, place and calibration come from the backend.
  if (new URLSearchParams(location.search).get('quick') != null) board.setOnboarded(true);
  board.connect((e) => {
    switch (e.type) {
      case 'config': {
        const prevPlace = useApp.getState().config?.place;
        if (first || prevPlace?.lat !== e.config.place?.lat || prevPlace?.lon !== e.config.place?.lon) setTimeout(() => void useApp.getState().loadRegion(), 0);
        useApp.setState((s) => ({
          config: e.config, ready: true,
          selectedZone: e.config.zones.some((z) => z.id === s.selectedZone) ? s.selectedZone : e.config.zones[0]?.id ?? 'A',
          ...(first ? { stage: e.config.onboarded ? ('live' as Stage) : ('welcome' as Stage), aliveAt: e.config.onboarded ? performance.now() : null } : {}),
        }));
        first = false;
        break;
      }
      case 'sample': useApp.setState({ live: e.zones }); break;
      case 'pour': {
        const prev = useApp.getState().pour.phase;
        useApp.setState({ pour: e.pour });
        // A pour that starts on its own (nobody pressed Arm) still takes the stage.
        if (e.pour.phase === 'running' && prev !== 'running' && useApp.getState().stage === 'live') useApp.setState({ view: 'pour', drawer: null });
        if (e.pour.phase === 'done') void useApp.getState().refreshAnswers();
        break;
      }
      case 'profile': useApp.setState({ profile: e.profile }); void useApp.getState().refreshAnswers(); void useApp.getState().loadRegion(); break;
      case 'region': void useApp.getState().loadRegion(); break;
      case 'notes': useApp.setState({ notes: e.notes }); break;
      case 'overrides': useApp.setState({ overrides: e.overrides }); void useApp.getState().refreshAnswers(); break;
      case 'agent_call': useApp.getState().recordAgentCall(e.tool, e.zones, e.summary); break;
      case 'ui_command': applyUiCommand(e); break;
      case 'link': {
        const was = useApp.getState().backendOnline;
        useApp.setState({ backendOnline: e.online, ...(e.online ? {} : { live: {} }) });   // offline: no stale readings on screen
        if (e.online && !was) { void useApp.getState().refreshAnswers(); void useApp.getState().loadRegion(); }
        break;
      }
    }
  });
  setInterval(() => { if (useApp.getState().stage === 'live') void useApp.getState().refreshAnswers(); }, 4000);
}


/** The navigation vocabulary shared by the voice assistant (SSE `ui_command`) and the page's own agent tools. */
export interface UiCommand { view?: string; drawer?: string; zone?: string; lens?: string; crop?: string; farm?: string }

/** Move the app. Every field is optional; anything we do not know is ignored. */
export function applyUiCommand(e: UiCommand): void {
  const st = useApp.getState();
  if (st.stage !== 'live') useApp.setState({ stage: 'live', draft: null });
  if (e.zone && st.config?.zones.some((z) => z.id === e.zone)) st.selectZone(e.zone);
  if (e.view === 'region' || e.farm) {
    // the agent asked about the neighbours: same zoom-out as the manual control, then glide to the farm
    if (!useApp.getState().regionOn) st.goRegion(true); else void st.loadRegion();
    if (e.farm) setTimeout(() => useApp.getState().selectFarm(e.farm!), useApp.getState().regionData ? 900 : 1800);
    return;
  }
  if (e.view && ['field', 'pour', 'history', 'network'].includes(e.view) && (e.view !== useApp.getState().view || useApp.getState().regionOn)) st.setView(e.view as View);
  if (e.lens && ['natural', 'moisture', 'temperature'].includes(e.lens)) st.setLens(e.lens as Lens);
  if (e.crop) { st.selectCrop(e.crop); if (!e.drawer) useApp.setState({ view: 'field', drawer: 'plant' }); }
  if (e.drawer) {
    const drawer = e.drawer === 'none' ? null : (['soil', 'plant', 'when', 'water', 'diagnose'].includes(e.drawer) ? (e.drawer as Drawer) : undefined);
    if (drawer !== undefined) { if (drawer && (useApp.getState().view !== 'field' || useApp.getState().regionOn)) st.setView('field'); useApp.setState({ drawer }); if (drawer === 'diagnose') void st.runDiagnose(); }
  }
}

/** Value of a history series at time t (linear interpolation). */
export function sampleSeries(series: HistorySeries | undefined, t: number): { moisturePct: number | null; tempC: number | null } {
  const pts = series?.points;
  if (!pts || !pts.length) return { moisturePct: null, tempC: null };
  let lo = 0, hi = pts.length - 1;
  if (t <= pts[0].t) return pts[0];
  if (t >= pts[hi].t) return pts[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi], k = (t - a.t) / Math.max(1, b.t - a.t);
  const mix = (x: number | null, y: number | null) => (x == null || y == null ? x ?? y : x + (y - x) * k);
  return { moisturePct: mix(a.moisturePct, b.moisturePct), tempC: mix(a.tempC, b.tempC) };
}
