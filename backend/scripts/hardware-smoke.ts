/**
 * Manual, opt-in hardware smoke test. NEVER run from `npm test`.
 *
 *   npm run hardware-smoke
 *
 * Prints what it will do, then waits for you to type YES. Only then may it
 * send `p` to a real pour board. Identification uses `s` only.
 */
import { createInterface } from 'node:readline';
import { loadEnv } from '../src/env.js';
import { detectBoards } from '../src/discover.js';
import { identifyPort } from '../src/identify.js';
import { ConsoleSession } from '../src/console.js';
import { parsePourReply, parsePourStatus } from '../src/parse.js';

loadEnv();

const boards = detectBoards(new Map());
console.log('This script talks to REAL Arduino UNO Q boards on USB.');
console.log('Connected UNO Qs:');
if (!boards.length) console.log('  (none)');
for (const b of boards) console.log(`  ${b.serial}  ${b.port}  role=${b.role}  ${b.label ?? ''}`);

console.log(`
Plan:
  1. Ask each unknown board what it is (open console, send "s", release). Never "p".
  2. Open the pour board only.
  3. Send "s" and print status.
  4. IF you type YES: send "p" once, print the reply, wait for pour: done.
  5. Close the console.

Tests (npm test) never reach this file and never send p.
`);

if (!process.argv.includes('--i-mean-it') && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question('Type YES to continue (anything else aborts): ', resolve));
  rl.close();
  if (answer.trim() !== 'YES') {
    console.log('Aborted. No command was sent.');
    process.exit(0);
  }
} else if (!process.argv.includes('--i-mean-it')) {
  console.log('Refusing to run without a TTY unless you pass --i-mean-it (still will not pour unless you also pass --pour).');
  process.exit(1);
}

for (const b of boards.filter((x) => x.role === 'unknown')) {
  console.log(`identifying ${b.serial} on ${b.port}…`);
  const role = await identifyPort(b.port);
  console.log(`  → ${role}`);
}

const pour = boards.find((b) => b.role === 'pour');
if (!pour) {
  console.log('No pour-role board. Nothing more to do.');
  process.exit(0);
}

const session = new ConsoleSession();
session.onLine((l) => console.log('  board:', l));
console.log(`opening pour board ${pour.serial} on ${pour.port}`);
const ok = await session.open(pour.port);
if (!ok) {
  console.log('failed to open');
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 2500));
session.send('s');
const st = await session.waitFor((l) => parsePourStatus(l) ?? undefined, 4000);
console.log('status:', st);

if (process.argv.includes('--pour')) {
  console.log('sending p (real pour)…');
  session.send('p');
  const r = await session.waitFor((l) => parsePourReply(l) ?? undefined, 3000);
  console.log('reply:', r);
  const done = await session.waitFor((l) => (/pour: done/.test(l) ? true : undefined), 20000);
  console.log('done event:', done ? 'yes' : 'timeout');
} else {
  console.log('Not pouring (pass --pour after YES to actually tip the bottle).');
}

await session.close();
console.log('console released.');
