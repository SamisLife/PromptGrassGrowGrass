/**
 * WebMCP registration.
 *
 * Current Chrome (149+) exposes `document.modelContext.registerTool(tool,
 * { signal })` and expects `execute` to resolve to a string. Earlier previews
 * used `navigator.modelContext`, some with `provideContext({ tools })`. We
 * feature-detect all three.
 *
 * IMPORTANT: WebMCP only exists in a SECURE CONTEXT. Served from the board it
 * must be https:// (or localhost during development). On plain http:// the
 * API is simply absent and `status.reason` says so.
 */
import { TOOLS } from './tools';

export interface WebMcpStatus {
  available: boolean;
  registered: number;
  api: 'document.modelContext' | 'navigator.modelContext' | null;
  reason: string;
}

export let webmcpStatus: WebMcpStatus = { available: false, registered: 0, api: null, reason: 'not initialised' };

export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool "${name}".` });
  try {
    return JSON.stringify(await tool.run(args), null, 2);
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function registerWebMcp(): Promise<WebMcpStatus> {
  // Handy for testing without an agent: window.soil.call('read_zone', { zone: 'A' })
  (window as any).soil = { tools: TOOLS.map((t) => t.name), call: callTool };

  const doc = (document as any).modelContext, nav = (navigator as any).modelContext;
  const mc = doc ?? nav;
  if (!mc) {
    webmcpStatus = {
      available: false, registered: 0, api: null,
      reason: window.isSecureContext
        ? 'This browser does not expose WebMCP (needs Chrome 149+ with the WebMCP flag, or an agent browser).'
        : 'Not a secure context: WebMCP needs https:// (or localhost).',
    };
    return webmcpStatus;
  }

  const defs = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly },
    execute: (args: Record<string, unknown>) => callTool(t.name, args ?? {}),
  }));

  let registered = 0;
  const controller = new AbortController();
  if (typeof mc.registerTool === 'function') {
    for (const def of defs) {
      try { await mc.registerTool(def, { signal: controller.signal }); registered++; } catch (e) { console.warn('[webmcp] registerTool failed', def.name, e); }
    }
  } else if (typeof mc.provideContext === 'function') {
    try { await mc.provideContext({ tools: defs }); registered = defs.length; } catch (e) { console.warn('[webmcp] provideContext failed', e); }
  }
  webmcpStatus = {
    available: registered > 0, registered, api: doc ? 'document.modelContext' : 'navigator.modelContext',
    reason: registered > 0 ? `${registered} tools registered` : 'WebMCP is present but registration failed (see console).',
  };
  return webmcpStatus;
}
