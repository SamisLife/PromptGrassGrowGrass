import { existsSync, readFileSync } from 'node:fs';
import { persist } from './persist.js';
import type { HistoryPoint, HistorySeries, ZoneId } from './types.js';

// Real readings only. (An earlier build also wrote simulated rows to history.jsonl;
// that file is ignored now so they can never leak into a trend.)
const FILE = 'history.board.jsonl';
const THIN_MS = 15_000;
const KEEP_MS = 72 * 3600_000;

export class HistoryStore {
  private points = new Map<ZoneId, HistoryPoint[]>();
  private lastStored = new Map<ZoneId, number>();
  constructor() {
    this.load();
  }

  private load(): void {
    const path = persist.dataPath(FILE);
    if (!existsSync(path)) return;
    const now = Date.now();
    try {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const row = JSON.parse(line) as HistoryPoint & { zoneId: ZoneId };
        if (now - row.t > KEEP_MS) continue;
        (this.points.get(row.zoneId) ?? this.points.set(row.zoneId, []).get(row.zoneId)!).push(row);
      }
    } catch { /* truncated jsonl */ }
  }

  push(zoneId: ZoneId, point: HistoryPoint, fullRate: boolean): void {
    const last = this.lastStored.get(zoneId) ?? 0;
    if (!fullRate && point.t - last < THIN_MS) return;
    this.lastStored.set(zoneId, point.t);
    const arr = this.points.get(zoneId) ?? [];
    arr.push(point);
    const cutoff = point.t - KEEP_MS;
    while (arr.length && arr[0].t < cutoff) arr.shift();
    this.points.set(zoneId, arr);
    persist.appendJsonl(FILE, { zoneId, ...point });
  }

  series(zoneId: ZoneId, hours: number, now = Date.now()): HistorySeries {
    const since = now - hours * 3600000;
    const points = (this.points.get(zoneId) ?? []).filter((p) => p.t >= since);
    return { zoneId, points, simulated: false };
  }

  rawWindow(zoneId: ZoneId, ms: number, now = Date.now()): HistoryPoint[] {
    const since = now - ms;
    return (this.points.get(zoneId) ?? []).filter((p) => p.t >= since);
  }
}
