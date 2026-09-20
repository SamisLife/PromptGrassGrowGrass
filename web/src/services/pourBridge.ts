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

// ---------------------------------------------------------------- the guarded route (agents)
export interface GuardedPour {
  ok: boolean;
  result: PourResult | 'refused' | 'unauthorized';
  reason?: string;
  /** soft = the person may override it (zone A already wet, too many pours recently); hard = never */
  guard?: 'soft' | 'hard';
  softKind?: 'wet' | 'window';
  reading?: { moisturePct: number | null };
  holdMsUsed?: number;
}

/**
 * POST /api/pour: the backend checks that the board is alive and listening, applies the firmware
 * limits and the guards, and writes the pour log. `force` overrides SOFT guards only, and the
 * page sends it only after the person has pressed the confirm button (agent/agentStore.ts).
 */
export async function requestGuardedPour(opts: { holdMs?: number; force?: boolean }, signal?: AbortSignal): Promise<GuardedPour> {
  try {
    const res = await fetch(`${BASE}/api/pour`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(opts.holdMs ? { holdMs: opts.holdMs } : {}), ...(opts.force ? { force: true } : {}) }) });
    return (await res.json()) as GuardedPour;
  } catch {
    return { ok: false, result: 'offline', reason: 'The backend is not running, so nothing can be poured.', guard: 'hard' };
  }
}

export async function guardedPourStatus(): Promise<{ actuator: PourActuatorStatus; detector?: unknown } | null> {
  try { return (await (await fetch(`${BASE}/api/pour/status`, { signal: AbortSignal.timeout(4000) })).json()) as { actuator: PourActuatorStatus }; } catch { return null; }
}
