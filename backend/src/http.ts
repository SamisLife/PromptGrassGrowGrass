import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DEMO_PLACE } from './region/demo.js';
import { localhostHostValidation, toNodeHandler } from '@modelcontextprotocol/node';
import type { SoilApp } from './app.js';
import { env } from './env.js';
import { mcpHttpHandler } from './mcp.js';
import type { PourCaller, ProbeId, Zone, ZoneId } from './types.js';
import { attachVoice, voiceStatus } from './voice/index.js';

/**
 * A page served from THIS machine, on any port. Dev servers hop ports (5173, 5174, ...),
 * and an allow-list of exact ports silently breaks the app when that happens. Pages from
 * anywhere else on the web get no CORS grant, so a browser will not let them read data.
 */
function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = String(req.headers.origin ?? '');
  return {
    ...(isLocalOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS,DELETE',
    'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  };
}

function json(res: ServerResponse, code: number, body: unknown, req?: IncomingMessage): void {
  res.writeHead(code, { 'Content-Type': 'application/json', ...(req ? corsHeaders(req) : {}) });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req: IncomingMessage): Promise<any> {
  const s = await readBody(req);
  if (!s.trim()) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function wrap(app: SoilApp, extra: Record<string, unknown> = {}) {
  return { mode: app.mode, ...extra };
}

/**
 * Browsers attach an Origin header to cross-site requests. A page on some other site could
 * otherwise POST to http://127.0.0.1:8787/pour and tip a real bottle (no preflight is
 * needed for a body-less POST). Requests with no Origin (curl, MCP clients, server code)
 * are unaffected.
 */
function pourOriginOk(req: IncomingMessage): boolean {
  const origin = String(req.headers.origin ?? '');
  return !origin || isLocalOrigin(origin);
}

function pourAuth(req: IncomingMessage, cfg: ReturnType<typeof env>): boolean {
  if (cfg.loopback && !cfg.authToken) return true;
  const token = cfg.authToken;
  if (!token) return false;
  const h = req.headers.authorization ?? '';
  return h === `Bearer ${token}` || h === token;
}

function callerOf(req: IncomingMessage, fallback: PourCaller): PourCaller {
  const v = String(req.headers['x-pour-caller'] ?? '');
  if (v === 'mcp-stdio' || v === 'mcp-http' || v === 'legacy' || v === 'http') return v;
  return fallback;
}

export function listenHttp(app: SoilApp): Promise<import('node:http').Server> {
  const cfg = env();
  const mcp = toNodeHandler(mcpHttpHandler(app), { onerror: (e) => console.error('mcp', e) });
  const validateHost = cfg.loopback ? localhostHostValidation() : () => true;

  const server = createServer(async (req, res) => {
    try {
      // Set once, for every reply on this request (many handlers call json() without `req`).
      for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        return res.end();
      }
      const host = req.headers.host ?? `${cfg.host}:${cfg.port}`;
      const url = new URL(req.url ?? '/', `http://${host}`);
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (path === '/mcp' || path.startsWith('/mcp/')) {
        // Host check blocks DNS rebinding. Origin is not checked: MCP clients
        // (ChatGPT, Inspector, Claude) often send a non-localhost Origin or none.
        if (cfg.loopback && !validateHost(req, res)) return;
        { const o = corsHeaders(req)['Access-Control-Allow-Origin']; if (o) res.setHeader('Access-Control-Allow-Origin', o); }
        res.setHeader('Access-Control-Allow-Headers', corsHeaders(req)['Access-Control-Allow-Headers']);
        await mcp(req, res);
        return;
      }

      // ---- legacy pour-bridge aliases (existing frontend button) ----
      if (path === '/events' && method === 'GET') return sseLegacy(app, req, res);
      if (path === '/boards' && method === 'GET') return json(res, 200, { boards: app.boardsList.length ? app.boardsList : app.snapshotReadings().boards.present });
      if (path === '/status' && method === 'GET') {
        const st = await app.pourStatus();
        return json(res, 200, st);
      }
      if (path === '/pour' && method === 'POST') {
        if (!pourOriginOk(req)) return json(res, 403, { ok: false, result: 'refused', reason: 'This web origin may not trigger a pour.' });
        if (!pourAuth(req, cfg)) return json(res, 401, { ok: false, result: 'unauthorized', reason: 'Bearer token required for pour when not on localhost.' });
        const body = await readJson(req);
        const out = await app.pourWater({ holdMs: body.holdMs ?? body.hold_ms, force: body.force, caller: callerOf(req, 'legacy') });
        const code = out.result === 'offline' ? 503 : 200;
        return json(res, code, { ok: out.ok, result: out.result, reason: out.reason });
      }

      // ---- live stream ----
      if (path === '/api/events' && method === 'GET') return sseApi(app, req, res);

      if (path === '/api/health') return json(res, 200, wrap(app, { ok: true, uptime_s: Math.round(process.uptime()), missing: app.missing }));
      if (path === '/api/voice/status' && method === 'GET') {
        return json(res, 200, wrap(app, { ...voiceStatus({ publicBase: cfg.publicBase }) }));
      }
      if (path === '/api/readings') return json(res, 200, app.snapshotReadings());
      if (path === '/api/boards') return json(res, 200, wrap(app, { boards: app.snapshotReadings().boards.present, missing: app.missing }));
      if (path === '/api/agent/connect-info') return json(res, 200, wrap(app, app.connectInfo()));
      if (path === '/api/connectivity') return json(res, 200, wrap(app, { connectivity: await app.connectivity() }));
      if (path === '/api/config' && method === 'GET') return json(res, 200, wrap(app, { config: app.config }));
      if (path === '/api/soil-profile' && method === 'GET') return json(res, 200, wrap(app, { profile: await app.soilProfile() }));
      // Deliberately forget the measurement (new soil). Resetting the pour test does NOT do this.
      if ((path === '/api/soil-profile' && method === 'DELETE') || (path === '/api/soil-profile/clear' && method === 'POST')) {
        app.clearSoilProfile();
        return json(res, 200, wrap(app, { profile: null }));
      }
      // The land around the plot (USDA cropland map + soil survey) and who in it complements this plot.
      if (path === '/api/region' && method === 'GET') return json(res, 200, wrap(app, app.regionView()));
      if (path === '/api/region/matches' && method === 'GET') { return json(res, 200, wrap(app, { ...(await app.regionMatches()) })); }
      if (path === '/api/region/show' && method === 'POST') { const body = await readJson(req); app.showRegion(typeof body.farm === 'string' ? body.farm : undefined); return json(res, 200, wrap(app, { ok: true })); }
      if (path === '/api/region/demo-place' && method === 'GET') return json(res, 200, wrap(app, { place: DEMO_PLACE }));
      if (path === '/api/forecast') return json(res, 200, wrap(app, { forecast: await app.forecast() }));
      if (path === '/api/frost-dates') return json(res, 200, wrap(app, { frost: await app.frostDates() }));
      if (path === '/api/notes' && method === 'GET') return json(res, 200, wrap(app, { notes: app.notes }));
      if (path === '/api/notes' && method === 'POST') {
        const body = await readJson(req);
        const n = await app.addNote(String(body.text ?? ''), body.zoneId ?? body.zone ?? null, body.author === 'agent' ? 'agent' : 'user');
        return json(res, 200, wrap(app, { note: n }));
      }
      if (path === '/api/overrides' && method === 'GET') return json(res, 200, wrap(app, { overrides: app.overrides }));
      if (path === '/api/overrides' && (method === 'PUT' || method === 'POST')) {
        const body = await readJson(req);
        app.setOverrides({ forecast: body.forecast ?? null, zoneMoisture: body.zoneMoisture ?? {} });
        return json(res, 200, wrap(app, { overrides: app.overrides }));
      }
      if (path === '/api/places' && method === 'GET') {
        const q = url.searchParams.get('q') ?? '';
        return json(res, 200, wrap(app, { places: await app.searchPlaces(q) }));
      }
      if (path === '/api/zones' && method === 'GET') {
        const zones = await Promise.all(app.config.zones.map((z) => app.readZone(z.id)));
        return json(res, 200, wrap(app, { zones }));
      }

      const zoneM = path.match(/^\/api\/zones\/([^/]+)(?:\/(.*))?$/);
      if (zoneM) {
        const id = decodeURIComponent(zoneM[1]);
        const rest = zoneM[2] ?? '';
        if (!rest && method === 'GET') return json(res, 200, wrap(app, { reading: await app.readZone(id) }));
        if (!rest && method === 'PATCH') {
          const body = await readJson(req);
          app.updateZone(id, body);
          return json(res, 200, wrap(app, { config: app.config }));
        }
        if (rest === 'crops') return json(res, 200, wrap(app, { crops: await app.scoreCrops(id) }));
        if (rest === 'history') {
          const hours = Math.max(1, Math.min(72, Number(url.searchParams.get('hours') ?? 24)));
          return json(res, 200, wrap(app, { history: await app.historyFor(id, hours) }));
        }
        if (rest === 'findings' || rest === 'diagnose') return json(res, 200, wrap(app, { diagnosis: await app.diagnose(id) }));
        const win = rest.match(/^planting-window\/(.+)$/);
        if (win) return json(res, 200, wrap(app, { window: await app.plantingWindow(decodeURIComponent(win[1]), id) }));
      }

      if (path === '/api/config/plot' && (method === 'PUT' || method === 'POST')) {
        const body = await readJson(req);
        app.setPlot(body.plot, body.zones as Zone[]);
        return json(res, 200, wrap(app, { config: app.config }));
      }
      if (path === '/api/config/place' && (method === 'PUT' || method === 'POST')) {
        const body = await readJson(req);
        app.setPlace(body.place === undefined ? body : body.place);
        return json(res, 200, wrap(app, { config: app.config }));
      }
      if (path === '/api/config/onboarded' && method === 'POST') {
        const body = await readJson(req);
        app.setOnboarded(!!(body.done ?? body.onboarded));
        return json(res, 200, wrap(app, { config: app.config }));
      }
      const cal = path.match(/^\/api\/calibrate\/([AB])(?:\/(reset))?$/);
      if (cal && method === 'POST') {
        const probe = cal[1] as ProbeId;
        if (cal[2] === 'reset') { app.clearCalibration(probe); return json(res, 200, wrap(app, { config: app.config })); }
        const body = await readJson(req);
        const step = body.step === 'water' ? 'water' : 'air';
        const result = await app.calibrate(probe, step);
        return json(res, result.ok ? 200 : 400, wrap(app, result));
      }

      if (path === '/api/pour/arm' && method === 'POST') { app.armPour(); return json(res, 200, wrap(app, { pour: app.snapshotReadings().pour })); }
      if (path === '/api/pour/reset' && method === 'POST') { app.resetPour(); return json(res, 200, wrap(app, { pour: app.snapshotReadings().pour })); }
      if (path === '/api/pour/status' && method === 'GET') {
        return json(res, 200, wrap(app, { actuator: await app.pourStatus(), detector: app.snapshotReadings().pour.detector }));
      }
      if (path === '/api/pour' && method === 'POST') {
        if (!pourOriginOk(req)) return json(res, 403, wrap(app, { ok: false, result: 'refused', reason: 'This web origin may not trigger a pour.' }));
        if (!pourAuth(req, cfg)) return json(res, 401, wrap(app, { ok: false, result: 'unauthorized', reason: 'Bearer token required for pour when not on localhost.' }));
        const body = await readJson(req);
        const out = await app.pourWater({ holdMs: body.holdMs ?? body.hold_ms, force: body.force, caller: callerOf(req, 'http') });
        const code = out.result === 'offline' ? 503 : out.result === 'unauthorized' ? 401 : 200;
        return json(res, code, wrap(app, out));
      }
      if (path === '/api/agent/calls' && method === 'POST') {
        const body = await readJson(req);
        const call = app.recordAgentCall(String(body.tool ?? 'unknown'), (body.zones ?? []) as ZoneId[], String(body.summary ?? ''));
        return json(res, 200, wrap(app, { call }));
      }
      if (path === '/api/pump' && method === 'POST') {
        return json(res, 200, wrap(app, { ok: false, reason: 'Pump hardware is not fitted. Use POST /api/pour.' }));
      }

      json(res, 404, wrap(app, { error: 'not found', path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) json(res, 400, { error: msg });
      else res.end();
    }
  });

  attachVoice(server, app);

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      const vs = voiceStatus({ publicBase: cfg.publicBase });
      console.log(new Date().toLocaleTimeString(), `backend on http://${cfg.host}:${cfg.port}  (MCP streamable HTTP at /mcp)`);
      console.log(new Date().toLocaleTimeString(), vs.enabled ? 'voice: enabled (Grok realtime relay)' : `voice: disabled (${vs.reason})`);
      resolve(server);
    });
  });
}

function sseApi(app: SoilApp, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...corsHeaders(req),
  });
  res.write('retry: 2000\n\n');
  const send = (e: { type: string }) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  send({ type: 'config', config: app.config, mode: app.mode } as { type: string });
  send({ type: 'profile', profile: app.profile, mode: app.mode } as { type: string });
  send({ type: 'notes', notes: app.notes, mode: app.mode } as { type: string });
  send({ type: 'pour', pour: app.snapshotReadings().pour.detector, mode: app.mode } as { type: string });
  const zones: Record<string, unknown> = {};
  for (const z of app.config.zones) zones[z.id] = app.liveOf(z.id);
  send({ type: 'sample', ...( { t: Date.now(), zones, mode: app.mode } as object ) } as { type: string });
  const off = app.bus.onEvent((e) => send(e));
  req.on('close', off);
}

function sseLegacy(app: SoilApp, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  const st = app.snapshotReadings().pour.actuator as { connected?: boolean; phase?: string };
  res.write(`data: ${JSON.stringify({ hello: true, connected: !!st.connected })}\n\n`);
  const off = app.bus.onEvent((e) => {
    if (e.type !== 'pour') return;
  });
  let lastPhase = '';
  const off2 = setInterval(async () => {
    const a = await app.pourStatus();
    if (a.phase && a.phase !== lastPhase) {
      lastPhase = a.phase;
      res.write(`data: ${JSON.stringify({ phase: a.phase, t: Date.now() })}\n\n`);
    }
  }, 250);
  req.on('close', () => { off(); clearInterval(off2); });
}
