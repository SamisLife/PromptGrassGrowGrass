/**
 * Raster -> grid -> fields. Pure: no network, no clock, so it is fully testable.
 */
import { fromAlbers } from './albers.js';
import { FAMILY_LABEL, cdlClass, isFarmed } from './cdl.js';
import type { LegendEntry, RegionField } from './types.js';

export interface Raster { width: number; height: number; data: ArrayLike<number>; /** EPSG:5070 metres: west, south, east, north */ bbox: [number, number, number, number] }

/** A cell is "farmed" when at least this share of its pixels is a crop. */
export const FARMED_SHARE = 0.4;
/** Blocks larger than this are split: a 40-cell sea of corn is not one farm. */
export const MAX_FIELD_CELLS = 8;
const BEARINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export interface Grid { n: number; cellM: number; cells: number[]; fieldOf: number[]; fields: Omit<RegionField, 'soil'>[]; legend: LegendEntry[] }

export function buildGrid(r: Raster, n: number): Grid {
  const pxW = r.width / n, pxH = r.height / n;
  const cellM = ((r.bbox[2] - r.bbox[0]) / r.width) * pxW;
  const cells: number[] = new Array(n * n).fill(0);
  const cellHist: Map<number, number>[] = [];
  const total = new Map<number, number>();

  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const hist = new Map<number, number>();
    const x0 = Math.floor(gx * pxW), x1 = Math.floor((gx + 1) * pxW), y0 = Math.floor(gy * pxH), y1 = Math.floor((gy + 1) * pxH);
    let count = 0, farmed = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = r.data[y * r.width + x];
      hist.set(v, (hist.get(v) ?? 0) + 1); total.set(v, (total.get(v) ?? 0) + 1);
      count++; if (isFarmed(v)) farmed++;
    }
    const wantFarmed = count > 0 && farmed / count >= FARMED_SHARE;
    let best = 0, bestN = -1;
    for (const [v, c] of hist) if (isFarmed(v) === wantFarmed && c > bestN) { best = v; bestN = c; }
    cells[gy * n + gx] = best;
    cellHist.push(hist);
  }

  // fields: neighbouring farmed cells with the same dominant crop, capped in size
  const fieldOf: number[] = new Array(n * n).fill(-1);
  const fields: Omit<RegionField, 'soil'>[] = [];
  const mid = (n - 1) / 2;
  for (let start = 0; start < n * n; start++) {
    if (fieldOf[start] !== -1 || !isFarmed(cells[start])) continue;
    const code = cells[start], idx = fields.length, members: number[] = [];
    const queue = [start];
    fieldOf[start] = idx;
    while (queue.length && members.length < MAX_FIELD_CELLS) {
      const c = queue.shift()!;
      members.push(c);
      const x = c % n, y = (c / n) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * n + nx;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || fieldOf[k] !== -1 || cells[k] !== code) continue;
        if (members.length + queue.length >= MAX_FIELD_CELLS) continue;
        fieldOf[k] = idx; queue.push(k);
      }
    }
    const cx = members.reduce((s, c) => s + (c % n), 0) / members.length, cy = members.reduce((s, c) => s + ((c / n) | 0), 0) / members.length;
    // the soil lookup must land INSIDE the block, so use the member cell nearest the centroid
    const near = members.reduce((a, b) => (Math.hypot((a % n) - cx, ((a / n) | 0) - cy) <= Math.hypot((b % n) - cx, ((b / n) | 0) - cy) ? a : b));
    const px = r.bbox[0] + ((near % n) + 0.5) * cellM, py = r.bbox[3] - (((near / n) | 0) + 0.5) * cellM;
    const [lon, lat] = fromAlbers(px, py);
    const dxKm = ((cx - mid) * cellM) / 1000, dyKm = ((mid - cy) * cellM) / 1000;
    const hist = new Map<number, number>();
    for (const c of members) for (const [v, k] of cellHist[c]) if (isFarmed(v)) hist.set(v, (hist.get(v) ?? 0) + k);
    const farmedPx = [...hist.values()].reduce((s, k) => s + k, 0) || 1;
    const grows = [...hist].sort((a, b) => b[1] - a[1]).map(([v, k]) => ({ code: v, name: cdlClass(v).name, sharePct: Math.round((100 * k) / farmedPx) })).filter((g, i) => i === 0 || g.sharePct >= 12).slice(0, 3);
    fields.push({
      id: `f${idx}`, code, crop: cdlClass(code).name, grows, cells: members.length, areaHa: Math.round((members.length * cellM * cellM) / 10000),
      cx, cy, lat: +lat.toFixed(5), lon: +lon.toFixed(5), distanceKm: +Math.hypot(dxKm, dyKm).toFixed(1),
      bearing: BEARINGS[Math.round(((Math.atan2(dxKm, dyKm) * 180) / Math.PI + 360) / 45) % 8],
    });
  }

  const px = r.width * r.height || 1;
  const legend: LegendEntry[] = [...total].filter(([v]) => cells.includes(v)).map(([v, c]) => {
    const k = cdlClass(v);
    return { code: v, name: k.name, family: k.family, familyLabel: FAMILY_LABEL[k.family], color: k.color, farmed: isFarmed(v), sharePct: +((100 * c) / px).toFixed(1) };
  }).sort((a, b) => Number(b.farmed) - Number(a.farmed) || b.sharePct - a.sharePct);

  return { n, cellM, cells, fieldOf, fields, legend };
}
