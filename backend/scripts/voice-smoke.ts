/**
 * Manual, opt-in Grok voice conversation. NEVER run from `npm test`.
 * Never starts a second backend (the running process owns the boards).
 * Never pours unless you pass --pour AND type YES.
 *
 *   npm run voice-smoke
 *
 * Needs: backend already running, XAI_API_KEY in backend/.env
 */
import { createInterface } from 'node:readline';
import { WebSocket } from 'ws';
import { env, loadEnv } from '../src/env.js';

loadEnv();
const cfg = env();
const base = cfg.publicBase;
const wsUrl = base.replace(/^http/, 'ws') + '/api/voice/session';

console.log(`
PromptGrass voice smoke
  This opens a WebSocket to the backend already running at ${base}.
  It will NOT open any serial console.
  It will NOT send p to a board unless you pass --pour and then type YES.

Plan:
  1. GET /api/voice/status
  2. Connect to ${wsUrl}
  3. Send a text turn: "How is zone A right now? Quote the tool numbers."
  4. Print voice events for ~20 seconds, then close.
  5. With --pour: only after YES, send "Pour water." (the server still enforces confirm_token).
`);

let health: { ok?: boolean };
try {
  health = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).json() as { ok?: boolean };
} catch {
  console.error(`No backend on ${base}. Start it in another terminal (it owns the boards):`);
  console.error('  npm start          # with hardware');
  console.error('  HARDWARE=off npm start   # no consoles, probes stay offline');
  process.exit(1);
}
if (!health.ok) {
  console.error(' /api/health did not return ok. Aborting.');
  process.exit(1);
}

const status = await (await fetch(`${base}/api/voice/status`)).json() as { enabled?: boolean; reason?: string; model?: string };
console.log('voice status:', JSON.stringify({ enabled: status.enabled, reason: status.reason, model: status.model }));
if (!status.enabled) {
  console.error('Voice is disabled. Put XAI_API_KEY in backend/.env (https://console.x.ai/) and restart the backend.');
  process.exit(1);
}

if (process.argv.includes('--pour')) {
  if (!process.stdin.isTTY && !process.argv.includes('--i-mean-it')) {
    console.error('Refusing --pour without a TTY unless you also pass --i-mean-it.');
    process.exit(1);
  }
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => rl.question('Type YES to allow a spoken pour request (the bottle may tip): ', resolve));
    rl.close();
    if (answer.trim() !== 'YES') {
      console.log('Aborted. No pour was requested.');
      process.exit(0);
    }
  }
}

const ws = new WebSocket(wsUrl);
ws.on('open', () => {
  console.log('connected');
  const text = process.argv.includes('--pour')
    ? 'Pour water.'
    : 'How is zone A right now? Quote the numbers from the tools. Do not pour.';
  ws.send(JSON.stringify({ type: 'text', text }));
});
ws.on('message', (data) => {
  const ev = JSON.parse(String(data)) as { type?: string; audio?: string; text?: string; tool?: string; message?: string };
  if (ev.type === 'output_audio') {
    console.log('event output_audio bytes', ev.audio ? Buffer.from(ev.audio, 'base64').length : 0);
    return;
  }
  console.log('event', JSON.stringify(ev));
});
ws.on('error', (e) => {
  console.error('ws error', e.message);
});
ws.on('close', (code, reason) => {
  console.log('closed', code, String(reason));
});

await new Promise((r) => setTimeout(r, 20_000));
ws.close();
console.log('done');
process.exit(0);
