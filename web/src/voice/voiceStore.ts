import { create } from 'zustand';
import { BACKEND_URL } from '../data/backendBoard';
import { fetchVoiceStatus, VoiceClient } from './voiceClient';
import type { VoiceEvent } from './voiceClient';

/** What the orb is doing. `speaking` follows the local speaker, not the server, so the orb
 *  keeps moving until the last buffered syllable has actually played. */
export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'confirming' | 'error';

export interface ToolChip { id: number; tool: string; zones: string[]; done: boolean; ok: boolean }
export interface Confirmation { reason: string; kind: string; until: number }

interface VoiceState {
  phase: VoicePhase;
  open: boolean;                 // a session is running
  userText: string;
  assistantText: string;
  tools: ToolChip[];
  confirm: Confirmation | null;
  error: string | null;
  toggle(): Promise<void>;
  stop(): void;
  sendText(text: string): void;
}

let client: VoiceClient | null = null;
let playing = false;
let serverPhase: 'listening' | 'thinking' = 'listening';
let chipSeq = 0;
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
export const voiceStats = () => client?.stats ?? null;
export const voiceMute = (on: boolean) => { if (client) client.muted = on; };
/** For the orb's animation loop: levels live outside React state on purpose. */
export const voiceLevels = () => { client?.sampleLevels(); return { mic: client?.micLevel ?? 0, out: client?.outLevel ?? 0 }; };

const derive = (s: VoiceState): VoicePhase => (s.error ? 'error' : !s.open ? 'idle' : s.confirm ? (playing ? 'speaking' : 'confirming') : playing ? 'speaking' : serverPhase);

export const useVoice = create<VoiceState>((set, get) => {
  const refresh = () => set((s) => ({ phase: derive(s) }));
  const clearConfirm = () => { if (confirmTimer) clearTimeout(confirmTimer); confirmTimer = null; set({ confirm: null }); refresh(); };

  const onEvent = (e: VoiceEvent) => {
    switch (e.type) {
      case 'session_started': serverPhase = 'listening'; set({ error: null }); break;
      case 'listening': serverPhase = 'listening'; set({ userText: '' }); break;
      case 'user_transcript':
        // one utterance arrives in growing pieces: always REPLACE the line
        set({ userText: e.text, ...(e.final ? {} : { assistantText: '' }) });
        if (e.final && get().confirm && /\b(no|nope|stop|cancel|don'?t|never ?mind|wait)\b/i.test(e.text)) clearConfirm();
        break;
      case 'thinking': serverPhase = 'thinking'; break;
      case 'tool_call_started':
        set((s) => ({ tools: [...s.tools.filter((t) => !t.done).slice(-3), { id: ++chipSeq, tool: e.tool, zones: e.zones, done: false, ok: true }] }));
        break;
      case 'tool_call_finished':
        set((s) => {
          const i = s.tools.findIndex((t) => !t.done && t.tool === e.tool);
          const tools = i >= 0 ? s.tools.map((t, k) => (k === i ? { ...t, done: true, ok: e.ok, zones: e.zones.length ? e.zones : t.zones } : t)) : s.tools;
          return { tools };
        });
        if (e.tool === 'pour_water' && e.ok) clearConfirm();
        break;
      case 'assistant_transcript':
        set((s) => ({ assistantText: e.final ? e.text : s.assistantText + e.text }));
        break;
      case 'speaking_started': set({ assistantText: '' }); break;
      case 'speaking_ended': serverPhase = 'listening'; break;
      case 'awaiting_confirmation':
        if (confirmTimer) clearTimeout(confirmTimer);
        confirmTimer = setTimeout(clearConfirm, e.expires_in_s * 1000);
        set({ confirm: { reason: e.reason, kind: e.kind, until: Date.now() + e.expires_in_s * 1000 } });
        break;
      case 'error': set({ error: e.message }); break;
      case 'session_ended': get().stop(); return;
      default: break;
    }
    refresh();
  };

  return {
    phase: 'idle', open: false, userText: '', assistantText: '', tools: [], confirm: null, error: null,

    toggle: async () => {
      if (get().open || get().phase === 'connecting') return get().stop();
      set({ phase: 'connecting', error: null, userText: '', assistantText: '', tools: [], confirm: null });
      const status = await fetchVoiceStatus();
      if (!status.enabled) { set({ phase: 'error', error: status.reason ?? 'The voice assistant is not available.' }); return; }
      const wsUrl = status.browser?.websocket ?? BACKEND_URL.replace(/^http/, 'ws') + '/api/voice/session';
      const c = new VoiceClient(onEvent, (active) => { playing = active; refresh(); });
      try {
        await c.start(wsUrl);
        client = c; serverPhase = 'listening';
        set({ open: true }); refresh();
      } catch (err) {
        c.stop();
        const name = (err as { name?: string })?.name;
        set({
          phase: 'error', open: false,
          error: name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it for this page and tap again.'
            : name === 'NotFoundError' ? 'No microphone was found.'
            : (err as Error)?.message ?? 'Could not start the voice assistant.',
        });
      }
    },

    stop: () => {
      client?.stop(); client = null; playing = false;
      if (confirmTimer) clearTimeout(confirmTimer); confirmTimer = null;
      set((s) => ({ open: false, confirm: null, phase: s.error ? 'error' : 'idle' }));
    },

    sendText: (text) => { const t = text.trim(); if (t && client) { set({ userText: t, assistantText: '' }); client.sendText(t); } },
  };
});
