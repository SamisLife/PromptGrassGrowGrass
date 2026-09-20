/**
 * WebMCP: the page hands its tools to the browser, so an agent built into that browser
 * (ChatGPT's site tools, Chrome's agent) can work the app WITH the person, in the same tab.
 *
 * This is not our MCP server (backend `/mcp`). That one is reached over the network by a
 * client that may be anywhere, and nothing it does is visible. Here a tool is a function in
 * this page: it reads the same store the screen is drawn from, and it moves the interface.
 *
 * The API, as of September 2026 (it has been renamed once, so everything is feature-detected):
 *   document.modelContext.registerTool(tool, { signal })     abort the signal = unregister
 *   tool = { name, description, inputSchema, annotations, execute(input, { signal }) }
 *   annotations = { readOnlyHint, consequentialHint, untrustedContentHint }
 *   `navigator.modelContext` is the older name; `provideContext({ tools })` older still.
 * ChatGPT ignores the declarative form attributes and tools inside iframes; we use neither.
 *
 * SECURE CONTEXT ONLY: https://, or http://localhost. On a LAN address over plain http the API
 * is simply absent, and `webmcpStatus.reason` says so.
 */
import { applyUiCommand, useApp } from '../data/store';
import { snapshotView, useAgent, watchBackendCalls, type ViewSnapshot } from './agentStore';
import { personBusy, watchPerson } from './person';
import { TOOLS, type AgentTool } from './tools';

export interface WebMcpStatus {
  available: boolean;
  registered: number;
  api: 'document.modelContext' | 'navigator.modelContext' | null;
  reason: string;
}

export let webmcpStatus: WebMcpStatus = { available: false, registered: 0, api: null, reason: 'not initialised' };

// A burst of calls still reads as a sequence: visible effects start at least this far apart.
const PACE_MS = 420, PACE_MAX_WAIT = 1500;
let nextSlot = 0;
async function pace(): Promise<void> {
  const now = performance.now(), wait = Math.min(PACE_MAX_WAIT, Math.max(0, nextSlot - now));
  nextSlot = Math.max(now, nextSlot) + PACE_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function checkArgs(tool: AgentTool, args: Record<string, unknown>): void {
  const known = Object.keys(tool.inputSchema.properties);
  const extra = Object.keys(args).filter((k) => !known.includes(k));
  if (extra.length) throw new Error(`Unknown argument${extra.length > 1 ? 's' : ''} ${extra.map((k) => `"${k}"`).join(', ')} for ${tool.name}. ${known.length ? `It accepts: ${known.join(', ')}.` : 'It takes no arguments.'}`);
  const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] == null || args[k] === '');
  if (missing.length) throw new Error(`${tool.name} needs ${missing.map((k) => `"${k}"`).join(', ')}.`);
}

/**
 * Run one tool the way an agent does: validated, paced, shown to the person, and with the
 * screen brought into agreement with the answer when they are not busy.
 * `window.soil.call(name, args)` uses the same path, so it can be tested without an agent.
 */
export async function callTool(name: string, args: Record<string, unknown> = {}, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}.` });
  if (useApp.getState().stage !== 'live') return JSON.stringify({ error: 'The person is still setting up the plot (size, location, calibration). The tools work once that is finished.' });
  const agent = useAgent.getState();
  let id = 0;
  try {
    checkArgs(tool, args);
    await pace();
    id = agent.begin(tool.name, tool.say(args));
    const result = (await tool.run(args, { signal: opts.signal })) as Record<string, unknown> | null;

    let undo: ViewSnapshot | undefined, status: 'done' | 'offered' | 'declined' = 'done', detail: string | undefined, say: string | undefined;
    if (result && typeof result === 'object') {
      if ('__undo' in result) { undo = result.__undo as ViewSnapshot; delete result.__undo; }
      if (result.offered_to_person) { status = 'offered'; detail = 'offered to you instead'; }
      if (result.result === 'not_confirmed') { status = 'declined'; detail = 'not confirmed'; }
      if (result.poured === false && result.result !== 'not_confirmed') detail = String(result.in_plain_words ?? result.reason ?? '');
      if (result.poured === true) say = 'Pouring water into zone A';
      if (result.confirmed_by_person_on_page) detail = 'you confirmed';
    }
    // The screen should agree with what the agent is about to say, unless the person is mid-action.
    const want = tool.show?.(args, result);
    if (want && agent.follow && !personBusy()) { undo ??= snapshotView(); applyUiCommand(want); }
    useAgent.getState().end(id, status, detail, { ...(undo ? { undo } : {}), ...(say ? { say } : {}) });
    return JSON.stringify(result, null, 2);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (id) useAgent.getState().end(id, 'failed', message);
    return JSON.stringify({ error: message });
  }
}

// ------------------------------------------------------------------ registration
type ModelContext = {
  registerTool?: (tool: unknown, options?: { signal?: AbortSignal }) => unknown;
  provideContext?: (ctx: { tools: unknown[] }) => unknown;
  addEventListener?: (type: string, fn: () => void) => void;
};
const live = new Map<string, AbortController>();
let mc: ModelContext | null = null;
// `?webmcp=object` returns objects instead of JSON text, in case a browser prefers them. The spec allows either.
const asObject = new URLSearchParams(location.search).get('webmcp') === 'object';

function definition(t: AgentTool) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, ...(t.consequential ? { consequentialHint: true } : {}) },
    execute: async (input: Record<string, unknown> | null, options?: { signal?: AbortSignal }) => {
      const text = await callTool(t.name, input ?? {}, { signal: options?.signal });
      return asObject ? JSON.parse(text) : text;
    },
  };
}

/** Offer the tools only while they can work: not during onboarding, where there are no zones to read yet. */
async function syncTools(): Promise<void> {
  if (!mc?.registerTool) return;
  const st = useApp.getState();
  const offer = st.ready && st.stage === 'live';
  for (const t of TOOLS) {
    const has = live.has(t.name);
    if (offer && !has) {
      const ctl = new AbortController();
      live.set(t.name, ctl);                                        // before the await: a second sync must not register it twice
      try { await mc.registerTool(definition(t), { signal: ctl.signal }); } catch (e) { live.delete(t.name); console.warn('[webmcp] registerTool failed', t.name, e); }
    } else if (!offer && has) {
      live.get(t.name)!.abort();                                    // aborting unregisters; a call already running is not broken
      live.delete(t.name);
    }
  }
  webmcpStatus = {
    ...webmcpStatus, registered: live.size, available: true,
    reason: live.size ? `${live.size} tools offered to the browser's agent.` : 'Tools are offered once the plot is set up.',
  };
}

export async function registerWebMcp(): Promise<WebMcpStatus> {
  watchPerson();
  watchBackendCalls();
  // Handy for testing without an agent: window.soil.call('read_zone', { zone: 'A' })
  (window as any).soil = { tools: TOOLS.map((t) => t.name), call: callTool, registered: () => [...live.keys()] };

  const doc = (document as any).modelContext as ModelContext | undefined, nav = (navigator as any).modelContext as ModelContext | undefined;
  mc = doc ?? nav ?? null;
  if (!mc) {
    webmcpStatus = {
      available: false, registered: 0, api: null,
      reason: window.isSecureContext
        ? "This browser has no built-in agent API (WebMCP). Open this page in the ChatGPT desktop app's browser, or in Chrome with chrome://flags/#enable-webmcp-testing."
        : 'Not a secure context: WebMCP needs https:// or http://localhost.',
    };
    return webmcpStatus;
  }
  webmcpStatus = { available: true, registered: 0, api: doc ? 'document.modelContext' : 'navigator.modelContext', reason: 'Tools are offered once the plot is set up.' };

  if (typeof mc.registerTool === 'function') {
    await syncTools();
    let lastKey = '';
    useApp.subscribe((s) => { const key = `${s.ready}|${s.stage}`; if (key !== lastKey) { lastKey = key; void syncTools(); } });
  } else if (typeof mc.provideContext === 'function') {
    // the oldest preview: one static list, no way to withdraw a tool
    try { await mc.provideContext({ tools: TOOLS.map(definition) }); webmcpStatus = { ...webmcpStatus, registered: TOOLS.length, reason: `${TOOLS.length} tools offered to the browser's agent.` }; }
    catch (e) { console.warn('[webmcp] provideContext failed', e); webmcpStatus = { ...webmcpStatus, available: false, reason: 'WebMCP is present but registration failed (see console).' }; }
  }
  return webmcpStatus;
}
