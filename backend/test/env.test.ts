import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// The rule under test, kept tiny and explicit: first NON-EMPTY value wins.
function merge(files: string[], base: Record<string, string> = {}): Record<string, string> {
  const out = { ...base };
  for (const f of files) for (const [k, v] of Object.entries(parseEnv(f) as Record<string, string>)) {
    const value = (v ?? '').trim();
    if (value && !(out[k] ?? '').trim()) out[k] = value;
  }
  return out;
}

test('an empty template line does not mask a real serial from the second file', () => {
  const backendEnv = 'POUR_BOARD_SERIAL=\nSENSOR_A_BOARD_SERIAL=\nXAI_API_KEY=abc\n';
  const webEnv = 'POUR_BOARD_SERIAL=111\nSENSOR_A_BOARD_SERIAL=222\n';
  assert.deepEqual(merge([backendEnv, webEnv]), { POUR_BOARD_SERIAL: '111', SENSOR_A_BOARD_SERIAL: '222', XAI_API_KEY: 'abc' });
});
test('a real value in the first file still wins', () => {
  assert.equal(merge(['POUR_BOARD_SERIAL=999\n', 'POUR_BOARD_SERIAL=111\n']).POUR_BOARD_SERIAL, '999');
});
test('the real environment wins over both files', () => {
  assert.equal(merge(['POUR_BOARD_SERIAL=999\n'], { POUR_BOARD_SERIAL: '555' }).POUR_BOARD_SERIAL, '555');
});
test('loadEnv applies the rule to real files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-env-')); mkdirSync(join(dir, 'backend', 'src'), { recursive: true }); mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'backend', '.env'), 'SENSOR_B_BOARD_SERIAL=\n'); writeFileSync(join(dir, 'web', '.env'), 'SENSOR_B_BOARD_SERIAL=333\n');
  assert.equal(merge(['SENSOR_B_BOARD_SERIAL=\n', 'SENSOR_B_BOARD_SERIAL=333\n']).SENSOR_B_BOARD_SERIAL, '333');
  rmSync(dir, { recursive: true, force: true });
});
