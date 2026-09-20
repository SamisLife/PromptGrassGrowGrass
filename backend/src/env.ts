import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = join(here, '..');
export const DATA_DIR = join(BACKEND_ROOT, 'data');

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (e) {
    console.error(`could not read ${path}:`, (e as Error).message);
  }
}

/** Load backend/.env, then web/.env for serials the team already set. Existing keys win. */
export function loadEnv(): void {
  loadEnvFile(join(BACKEND_ROOT, '.env'));
  const webEnv = join(BACKEND_ROOT, '..', 'web', '.env');
  if (existsSync(webEnv)) {
    const had = new Set(Object.keys(process.env));
    const snapshot = { ...process.env };
    loadEnvFile(webEnv);
    for (const [k, v] of Object.entries(process.env)) {
      if (!had.has(k)) continue;
      if (snapshot[k] !== undefined && snapshot[k] !== v) process.env[k] = snapshot[k];
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
  };
}

export type Env = ReturnType<typeof env>;
