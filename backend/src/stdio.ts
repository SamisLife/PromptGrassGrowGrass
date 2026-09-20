/**
 * MCP stdio entry.
 *
 * Hardware is owned by one process: the HTTP server on 127.0.0.1:8787.
 * This program never opens a serial console itself.
 *
 * - If that server is already running, every tool is proxied to its REST API.
 * - If it is not, we start SoilApp + HTTP in this process and speak MCP on
 *   stdio as well, so the web app can still use :8787.
 *
 * Log only to stderr: stdout is the JSON-RPC channel.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { SoilApp } from './app.js';
import { env, loadEnv } from './env.js';
import { listenHttp } from './http.js';
import { createSoilMcp } from './mcp.js';
import { HttpBackend, type McpBackend } from './proxy.js';

loadEnv();

const cfg = env();
const base = `http://127.0.0.1:${cfg.port}`;

async function backendUp(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    const res = await fetch(`${base}/api/health`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json() as { ok?: boolean };
    return !!j.ok;
  } catch {
    return false;
  }
}

let backend: McpBackend;
let local: SoilApp | null = null;

if (await backendUp()) {
  console.error(`promptgrass mcp stdio: proxying tools to ${base} (hardware owner already running; this process will not open serial ports)`);
  const proxy = new HttpBackend(base);
  await proxy.refresh();
  backend = proxy;
} else {
  console.error('promptgrass mcp stdio: no HTTP owner on :8787; starting hardware + HTTP in this process');
  local = new SoilApp(cfg);
  await local.start();
  await listenHttp(local);
  backend = local;
}

const handle = serveStdio(() => createSoilMcp(backend, 'mcp-stdio'));

const shutdown = async () => {
  await handle.close();
  await local?.stop();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
