import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = join(here, '..');
export const DATA_DIR = join(BACKEND_ROOT, 'data');

/** Parse one env file. Missing file or bad syntax is not fatal. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  try {
    return parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;
  } catch (e) {
    console.error(`could not read ${path}:`, (e as Error).message);
    return {};
  }
}

/**
 * Load backend/.env, then web/.env (where the team first put the board serials).
 *
 * An EMPTY value means "not set". This matters: `cp .env.example .env` leaves lines like
 * `POUR_BOARD_SERIAL=` behind. If those counted as set they would mask the real serials
 * in web/.env, the backend would fall back to guessing which sensor board is which, and
 * zone A and zone B could be swapped without anyone noticing.
 * Precedence: real environment > backend/.env > web/.env, first NON-EMPTY value wins.
 */
export function loadEnv(): void {
  const files = [join(BACKEND_ROOT, '.env'), join(BACKEND_ROOT, '..', 'web', '.env')];
  for (const file of files) {
    for (const [k, v] of Object.entries(readEnvFile(file))) {
      const value = (v ?? '').trim();
      if (!value) continue;
      if ((process.env[k] ?? '').trim()) continue;
      process.env[k] = value;
    }
  }
}

const num = (k: string, fallback: number) => {
  const v = process.env[k];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (k: string) => (process.env[k] ?? '').trim();

export function env() {
  const host = str('HOST') || '127.0.0.1';
  const port = num('PORT', 8787);
  const authToken = str('AUTH_TOKEN');
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  return {
    host,
    port,
    authToken,
    loopback,
    pourBoardSerial: str('POUR_BOARD_SERIAL'),
    sensorASerial: str('SENSOR_A_BOARD_SERIAL'),
    sensorBSerial: str('SENSOR_B_BOARD_SERIAL'),
    boardPort: str('BOARD_PORT'),
    pourMaxPerWindow: num('POUR_MAX_PER_WINDOW', 8),
    pourWindowMs: num('POUR_WINDOW_MS', 10 * 60 * 1000),
    pourWetPct: num('POUR_WET_PCT', 78),
    publicBase: `http://${host === '::1' ? '[::1]' : host}:${port}`,
    /** When true, no serial console is opened. Every probe stays offline. Never invents readings. */
    hardwareOff: str('HARDWARE').toLowerCase() === 'off',
  };
}

export type Env = ReturnType<typeof env>;
