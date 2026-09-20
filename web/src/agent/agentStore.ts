/**
 * What the person sees of the AI: that it is acting, what it just did, and that they are
 * still in charge. Purely presentational state; no reading or advice lives here.
 */
import { create } from 'zustand';
import { applyUiCommand, useApp, type UiCommand } from '../data/store';
import type { AgentCall } from '../data/types';

export type TrailStatus = 'running' | 'done' | 'failed' | 'offered' | 'declined';
export interface TrailItem {
  id: number; t: number; tool: string; say: string; status: TrailStatus; detail?: string;
  /** 'page' = an agent in this browser (WebMCP); 'backend' = the voice assistant or an MCP client */
  source: 'page' | 'backend';
  undo?: ViewSnapshot;
}
export interface ViewSnapshot { view: string; drawer: string | null; lens: string; zone: string; crop: string | null; regionOn: boolean; farm: string | null }
export interface Suggestion { id: number; say: string; command: UiCommand; why: string; expiresAt: number }
export interface PourAsk { id: number; reason: string; expiresAt: number; resolve: (yes: boolean) => void }

interface AgentState {
  trail: TrailItem[];
  lastAt: number;
  /** when on, the app shows what the agent is reading (opens the matching drawer, selects the zone) */
  follow: boolean;
  suggestion: Suggestion | null;
  pourAsk: PourAsk | null;
  begin(tool: string, say: string): number;
  end(id: number, status: TrailStatus, detail?: string, patch?: Partial<TrailItem>): void;
  setFollow(on: boolean): void;
  offer(say: string, command: UiCommand, why: string): void;
  acceptSuggestion(): void;
  dismissSuggestion(): void;
  undo(id: number): void;
  /** Ask the PERSON, on the page, whether to pour despite a soft guard. Resolves true only from their click. */
  askPour(reason: string, ms: number, signal?: AbortSignal): Promise<boolean>;
  answerPour(yes: boolean, trusted: boolean): void;
}

let seq = 0;
const seenBackend = new Set<number>();

export function snapshotView(): ViewSnapshot {
  const s = useApp.getState();
  return { view: s.view, drawer: s.drawer, lens: s.lens, zone: s.selectedZone, crop: s.selectedCrop, regionOn: s.regionOn, farm: s.selectedFarm };
}
function restoreView(v: ViewSnapshot): void {
  const st = useApp.getState();
  if (v.regionOn) { applyUiCommand({ view: 'region', ...(v.farm ? { farm: v.farm } : {}) }); return; }
  if (st.regionOn) st.goRegion(false);
  applyUiCommand({ view: v.view, zone: v.zone, lens: v.lens, drawer: v.drawer ?? 'none' });
  if (v.crop !== useApp.getState().selectedCrop) st.selectCrop(v.crop);
  useApp.setState({ drawer: v.drawer as never });
}

export const useAgent = create<AgentState>((set, get) => ({
  trail: [], lastAt: 0, follow: true, suggestion: null, pourAsk: null,

  begin: (tool, say) => {
    const id = ++seq;
    set((s) => ({ trail: [{ id, t: Date.now(), tool, say, status: 'running' as const, source: 'page' as const }, ...s.trail].slice(0, 24), lastAt: Date.now() }));
    return id;
  },
  end: (id, status, detail, patch) => set((s) => ({ trail: s.trail.map((x) => (x.id === id ? { ...x, status, detail, ...patch } : x)), lastAt: Date.now() })),
  setFollow: (follow) => set({ follow }),

  offer: (say, command, why) => set({ suggestion: { id: ++seq, say, command, why, expiresAt: Date.now() + 20000 } }),
  acceptSuggestion: () => {
    const sg = get().suggestion;
    if (!sg) return;
    const before = snapshotView();
    applyUiCommand(sg.command);
    set((s) => ({ suggestion: null, trail: [{ id: ++seq, t: Date.now(), tool: 'navigate', say: sg.say, status: 'done' as const, detail: 'you accepted', source: 'page' as const, undo: before }, ...s.trail].slice(0, 24) }));
  },
  dismissSuggestion: () => set({ suggestion: null }),

  undo: (id) => {
    const item = get().trail.find((x) => x.id === id);
    if (!item?.undo) return;
    restoreView(item.undo);
    set((s) => ({ trail: s.trail.map((x) => (x.id === id ? { ...x, undo: undefined, detail: 'undone' } : x)) }));
  },

  askPour: (reason, ms, signal) => new Promise<boolean>((resolve) => {
    get().pourAsk?.resolve(false);                                 // one question at a time
    const id = ++seq;
    let done = false;
    const finish = (yes: boolean) => { if (done) return; done = true; clearTimeout(timer); if (get().pourAsk?.id === id) set({ pourAsk: null }); resolve(yes); };
    const timer = setTimeout(() => finish(false), ms);
    signal?.addEventListener('abort', () => finish(false), { once: true });
    set({ pourAsk: { id, reason, expiresAt: Date.now() + ms, resolve: finish } });
  }),
  // `trusted` is the browser's own flag for a real input event: a script calling .click() cannot say yes.
  answerPour: (yes, trusted) => { const ask = get().pourAsk; if (ask) ask.resolve(yes && trusted); },
}));

const BACKEND_SAY: Record<string, (c: AgentCall) => string> = {
  list_zones: () => 'Looking over the zones', read_zone: (c) => `Reading zone ${c.zones.join(' and ')}`, get_readings: () => 'Reading both zones',
  get_soil_profile: () => 'Checking the soil profile', score_crops: (c) => `Scoring crops for zone ${c.zones.join(' and ')}`,
  get_planting_window: () => 'Checking when to plant', get_forecast: () => 'Checking the forecast', get_history: (c) => `Looking back at zone ${c.zones.join(' and ')}`,
  add_note: () => 'Writing a note', pour_water: () => 'Pouring water', get_pour_status: () => 'Checking the water bottle',
  navigate: () => 'Moving the view', find_complementary_farms: () => 'Looking for farms that complement this soil',
};

/** Calls made through the backend (voice assistant, MCP clients) join the same trail. */
export function watchBackendCalls(): void {
  useApp.subscribe((s, prev) => {
    if (s.agentCalls === prev.agentCalls) return;
    const { trail } = useAgent.getState();
    for (const c of s.agentCalls.slice(0, 6).reverse()) {
      if (seenBackend.has(c.id)) continue;
      seenBackend.add(c.id);
      // a page tool marks its own zones through the same list: that call is already on the trail
      if (trail.some((x) => x.source === 'page' && x.tool === c.tool && Math.abs(x.t - c.t) < 4000)) continue;
      const say = (BACKEND_SAY[c.tool] ?? (() => c.summary || c.tool))(c);
      useAgent.setState((a) => ({ trail: [{ id: ++seq, t: c.t, tool: c.tool, say, status: 'done' as const, source: 'backend' as const }, ...a.trail].slice(0, 24), lastAt: Date.now() }));
    }
  });
  // offers do not wait forever
  setInterval(() => { const sg = useAgent.getState().suggestion; if (sg && Date.now() > sg.expiresAt) useAgent.setState({ suggestion: null }); }, 1000);
}
