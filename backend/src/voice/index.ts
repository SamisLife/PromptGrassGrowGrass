import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { SoilApp } from '../app.js';
import { env } from '../env.js';
import { persist } from '../persist.js';
import { VoiceRuntime } from './session.js';
import { voiceStatus } from './status.js';
import { XAI_REALTIME_URL, XAI_VOICE_MODEL } from './xai.js';

export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

function voiceOriginOk(req: IncomingMessage): boolean {
  const origin = String(req.headers.origin ?? '');
  return !origin || isLocalOrigin(origin);
}

export function attachVoice(server: HttpServer, app: SoilApp): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = req.headers.host ?? '127.0.0.1';
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname !== '/api/voice/session') {
      socket.destroy();
      return;
    }
    if (!voiceOriginOk(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const st = voiceStatus({ publicBase: env().publicBase });
    if (!st.enabled) {
      const body = JSON.stringify({ enabled: false, reason: st.reason });
      socket.write(`HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void bindSession(ws, app);
    });
  });
}

/** Turn xAI's refusal into one sentence a person can act on. Never echoes the key. */
export function explainProviderRefusal(status: number, body: string, key = ''): string {
  let detail = '';
  try { const j = JSON.parse(body) as { error?: unknown; code?: unknown }; detail = String(j.error ?? j.code ?? ''); } catch { detail = body; }
  if (key) detail = detail.split(key).join('<key>');
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (/credit|spending limit|billing|quota/i.test(detail)) return `Your xAI account has no available credit (or hit its monthly spending limit). Add credits or raise the limit at https://console.x.ai/, then try again. xAI said: ${detail}`;
  if (status === 401) return `xAI rejected the API key. Check XAI_API_KEY in backend/.env. xAI said: ${detail || 'unauthorized'}`;
  if (status === 403) return `This xAI key is not allowed to use the voice API. xAI said: ${detail || 'forbidden'}`;
  if (status === 429) return `xAI is rate limiting this key. Wait a moment and try again. xAI said: ${detail || 'too many requests'}`;
  return `xAI refused the voice connection (HTTP ${status}). ${detail}`.trim();
}

async function bindSession(client: WebSocket, app: SoilApp): Promise<void> {
  const key = (process.env.XAI_API_KEY ?? '').trim();
  if (!key) {
    client.close(1011, 'voice disabled');
    return;
  }
  let provider: WebSocket;
  try {
    provider = new WebSocket(XAI_REALTIME_URL, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    client.send(JSON.stringify({ type: 'error', message: 'Could not open the xAI voice socket.', code: 'provider_connect' }));
    client.close();
    return;
  }

  const runtime = new VoiceRuntime({
    app,
    sendClient: (ev) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(ev));
    },
    sendProvider: (ev) => {
      if (provider.readyState === WebSocket.OPEN) provider.send(JSON.stringify(ev));
    },
    emitUiCommand: (cmd) => {
      app.bus.emitEvent({ type: 'ui_command', ...cmd, t: Date.now(), mode: app.mode });
    },
  });

  const pendingProvider: unknown[] = [];
  let providerOpen = false;

  provider.on('open', () => {
    providerOpen = true;
    runtime.start();
    for (const p of pendingProvider) runtime.handleProviderEvent(p);
    pendingProvider.length = 0;
  });
  provider.on('message', (data) => {
    try {
      const ev = JSON.parse(String(data));
      if (!providerOpen) pendingProvider.push(ev);
      else void runtime.handleProviderEvent(ev);
    } catch {
      /* ignore non-JSON */
    }
  });
  // When xAI refuses the WebSocket upgrade it answers with a normal HTTP status and a JSON
  // body that says exactly why (bad key, no credits, no voice access). Read it and pass the
  // reason on in plain words: "check the API key" sends people looking in the wrong place.
  let refusal: string | null = null;
  provider.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (d: Buffer) => { body += d.toString(); });
    res.on('end', () => {
      refusal = explainProviderRefusal(res.statusCode ?? 0, body, key);
      console.error(new Date().toLocaleTimeString(), `voice: xAI refused the connection (HTTP ${res.statusCode}): ${refusal}`);
      runtime.emit({ type: 'error', message: refusal, code: `provider_http_${res.statusCode}` });
      runtime.close('provider_refused');
      if (client.readyState === WebSocket.OPEN) client.close();
    });
  });
  provider.on('error', (e: Error) => {
    if (refusal) return;                                   // already explained above
    console.error(new Date().toLocaleTimeString(), 'voice: xAI socket error:', String(e.message).split(key).join('<key>'));
    runtime.emit({ type: 'error', message: 'Could not reach xAI. Check the internet connection and try again.', code: 'provider' });
  });
  provider.on('close', () => {
    runtime.close('provider_closed');
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  client.on('message', (data) => {
    try {
      runtime.handleClientMessage(JSON.parse(String(data)));
    } catch {
      runtime.emit({ type: 'error', message: 'Voice client messages must be JSON.', code: 'bad_json' });
    }
  });
  client.on('close', () => {
    runtime.close('client_closed');
    if (provider.readyState === WebSocket.OPEN) provider.close();
  });
  client.on('error', () => {
    runtime.close('client_error');
    if (provider.readyState === WebSocket.OPEN) provider.close();
  });

  persist.appendJsonl('pour-log.jsonl', {
    t: Date.now(), caller: 'voice', result: 'session', event: 'session_started',
    model: XAI_VOICE_MODEL, session: runtime.sessionId,
  });
}

export { voiceStatus } from './status.js';
export { VoiceRuntime } from './session.js';
export { ConfirmStore } from './confirm.js';
