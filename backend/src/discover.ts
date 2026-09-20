import { execFileSync } from 'node:child_process';
import { env } from './env.js';
import type { DetectedBoard, ProbeId } from './types.js';

export type BoardRole = 'pour' | 'sensors' | 'other' | 'unknown';

export interface RawPort {
  serial: string | null;
  port: string;
  fqbn: string;
}

export function listUnoQPorts(): RawPort[] {
  let ports: any[] = [];
  try {
    const j = JSON.parse(execFileSync('arduino-cli', ['board', 'list', '--format', 'json'], { encoding: 'utf8' }));
    ports = j.detected_ports ?? (Array.isArray(j) ? j : []);
  } catch (e) {
    console.error('arduino-cli board list failed:', (e as Error).message);
    return [];
  }
  return ports
    .filter((d) => (d.matching_boards ?? []).some((b: any) => (b.fqbn ?? '').includes('unoq')))
    .map((d) => ({
      serial: d.port?.properties?.serialNumber ?? null,
      port: d.port?.address as string,
      fqbn: (d.matching_boards ?? []).map((b: any) => b.fqbn).join(','),
    }))
    .filter((p: RawPort) => !!p.port);
}

export function roleRegistry(discovered: Map<string, BoardRole>): Record<string, { role: BoardRole; label: string; zone: ProbeId | null; from: '.env' | 'auto' }> {
  const e = env();
  const reg: Record<string, { role: BoardRole; label: string; zone: ProbeId | null; from: '.env' | 'auto' }> = {};
  if (e.pourBoardSerial) reg[e.pourBoardSerial] = { role: 'pour', label: 'Water bottle servo', zone: null, from: '.env' };
  if (e.sensorASerial) reg[e.sensorASerial] = { role: 'sensors', label: 'Probe set A', zone: 'A', from: '.env' };
  if (e.sensorBSerial) reg[e.sensorBSerial] = { role: 'sensors', label: 'Probe set B', zone: 'B', from: '.env' };
  for (const [serial, role] of discovered) {
    if (reg[serial]) continue;
    const zone: ProbeId | null = null;
    const label = role === 'pour' ? 'Water bottle servo (auto-detected)' : role === 'sensors' ? 'Sensor board (auto-detected)' : 'Unrecognised firmware';
    reg[serial] = { role, label, zone, from: 'auto' };
  }
  return reg;
}

export function detectBoards(discovered: Map<string, BoardRole>, openPorts: Set<string> = new Set()): DetectedBoard[] {
  const reg = roleRegistry(discovered);
  return listUnoQPorts().map((p) => {
    const info = p.serial ? reg[p.serial] : undefined;
    return {
      serial: p.serial,
      port: p.port,
      role: info?.role ?? 'unknown',
      label: info?.label ?? null,
      zone: info?.zone ?? null,
      from: info?.from ?? null,
      open: openPorts.has(p.port),
    };
  });
}

export function serialsConfigured(): boolean {
  const e = env();
  return !!(e.pourBoardSerial || e.sensorASerial || e.sensorBSerial);
}
