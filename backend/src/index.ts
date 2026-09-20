import { SoilApp } from './app.js';
import { env, loadEnv } from './env.js';
import { scanBoards } from './hardware.js';
import { listenHttp } from './http.js';
import { connect } from 'node:net';

/** 'free', 'backend' (another copy of this program answers /api/health), or 'other'. */
async function whoHoldsPort(host: string, port: number): Promise<'free' | 'backend' | 'other'> {
  const open = await new Promise<boolean>((resolve) => {
    const sock = connect({ host, port });
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(1000, () => done(false));
  });
  if (!open) return 'free';
  try {
    const res = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json() as { ok?: boolean; mode?: string };
    return body?.ok && body.mode ? 'backend' : 'other';
  } catch {
    return 'other';
  }
}

loadEnv();

if (process.argv.includes('--scan')) {
  await scanBoards();
  process.exit(0);
}

// Check the port BEFORE touching any hardware. A second copy would otherwise grab at
// consoles that the first copy owns ("Serial port busy") and then crash on listen().
const cfg = env();
const holder = await whoHoldsPort(cfg.host, cfg.port);
if (holder !== 'free') {
  console.error(
    holder === 'backend'
      ? `\nThe backend is already running on http://${cfg.host}:${cfg.port} (it owns the boards).\n`
        + `Nothing to do: use that one. To restart it, stop it first:\n`
        + `    lsof -ti tcp:${cfg.port} | xargs kill\n`
      : `\nPort ${cfg.port} is in use by another program, so the backend cannot start.\n`
        + `See what it is:   lsof -nP -i tcp:${cfg.port}\n`
        + `Or pick another port:   PORT=8790 npm start\n`,
  );
  process.exit(1);
}

const app = new SoilApp(cfg);
await app.start();
const server = await listenHttp(app);

const shutdown = async () => {
  server.close();
  await app.stop();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
