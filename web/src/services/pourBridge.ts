/**
 * Pour actuator client.
 *
 * Talks to the backend's pour routes (POST /pour, GET /status, GET /events), which relay to
 * the pour board's console over USB. Callers (the Pour button) use `pourWater()` and
 * `onPourPhase()` and never see the transport.
 *
 * The firmware enforces the safety limits (one pour at a time, cooldown, clamped hold
 * time, always returns to rest), so a refused pour is a normal, expected answer.
 */
const BASE = (import.meta.env.VITE_POUR_BRIDGE as string | undefined) ?? (import.meta.env.VITE_BACKEND as string | undefined) ?? 'http://127.0.0.1:8787';

export type PourResult = 'started' | 'busy' | 'cooldown' | 'offline' | 'no_reply';
export type PourPhase = 'tipping' | 'holding' | 'returning' | 'done';

export interface PourActuatorStatus {
  connected: boolean;
  phase?: 'idle' | PourPhase;
  restDeg?: number;
  pourDeg?: number;
  pours?: number;
  cooldownMsLeft?: number;
}

export async function pourWater(holdMs?: number): Promise<PourResult> {
  try {
    const res = await fetch(`${BASE}/pour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holdMs ? { holdMs } : {}) });
    return ((await res.json()) as { result: PourResult }).result;
  } catch {
    return 'offline';   // bridge not running
  }
}

export async function pourActuatorStatus(): Promise<PourActuatorStatus> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(`${BASE}/status`, { signal: ctl.signal });
    clearTimeout(timer);
    return (await res.json()) as PourActuatorStatus;
  } catch {
    return { connected: false };
  }
}

/** Live phases of the physical pour. Returns an unsubscribe function. */
export function onPourPhase(cb: (phase: PourPhase) => void): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource(`${BASE}/events`);
    es.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d.phase) cb(d.phase as PourPhase); } catch { /* ignore */ } };
    es.onerror = () => { /* the browser retries by itself */ };
  } catch { /* EventSource unavailable */ }
  return () => es?.close();
}

export const POUR_RESULT_TEXT: Record<PourResult, string> = {
  started: 'Pouring…',
  busy: 'Already pouring',
  cooldown: 'Cooling down: try again in a few seconds',
  offline: 'The backend is not running (cd backend && npm start)',
  no_reply: 'The board did not answer',
};
