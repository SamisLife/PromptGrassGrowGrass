import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './env.js';
import type { BoardConfig, Note, SoilProfile } from './types.js';

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(name: string, fallback: T): T {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(name: string, value: unknown): void {
  ensureDataDir();
  writeFileSync(join(DATA_DIR, name), JSON.stringify(value, null, 2));
}

export const persist = {
  config: {
    load: (): BoardConfig | null => readJson('config.json', null),
    save: (c: BoardConfig) => writeJson('config.json', c),
  },
  notes: {
    load: (): Note[] => readJson('notes.json', []),
    save: (n: Note[]) => writeJson('notes.json', n),
  },
  profile: {
    load: (): SoilProfile | null => readJson('profile.json', null),
    save: (p: SoilProfile | null) => writeJson('profile.json', p),
  },
  readNamed<T>(name: string, fallback: T): T {
    return readJson(name, fallback);
  },
  writeNamed(name: string, value: unknown): void {
    writeJson(name, value);
  },
  appendJsonl(name: string, row: unknown): void {
    ensureDataDir();
    appendFileSync(join(DATA_DIR, name), JSON.stringify(row) + '\n');
  },
  dataPath: (name: string) => join(DATA_DIR, name),
};
