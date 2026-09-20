/**
 * The two USDA services, and nothing else. Everything here touches the network, so tests
 * replace this module's functions through RegionService's `io` option.
 */
import { execFile } from 'node:child_process';
import { fromArrayBuffer } from 'geotiff';
import type { DrainageClass } from '../types.js';
import { toAlbers } from './albers.js';
import type { Raster } from './build.js';
import type { RegionSoil } from './types.js';

export const CDL_SERVICE = 'https://nassgeodata.gmu.edu/axis2/services/CDLService';
export const SDA_SERVICE = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';
/** Newest CDL year first; the service answers with an error for a year it does not have yet. */
export const CDL_YEARS = [2024, 2023, 2022];

/**
 * QUIRK: nassgeodata.gmu.edu serves an incomplete TLS chain (no intermediate certificate).
 * Browsers and curl fetch the missing certificate themselves; Node does not, and fails with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE. We never switch verification off. We fall back to curl,
 * which verifies the chain properly.
 */
async function get(url: string, timeoutMs = 120_000): Promise<Buffer> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const code = String((e as { cause?: { code?: string } }).cause?.code ?? '');
    if (!/UNABLE_TO_VERIFY|CERT|SELF_SIGNED/.test(code)) throw e;
    return new Promise<Buffer>((resolve, reject) => {
      execFile('curl', ['-sS', '--fail', '-m', String(Math.round(timeoutMs / 1000)), url], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
        (err, out) => (err ? reject(new Error(`curl: ${err.message}`)) : resolve(out)));
    });
  }
}

/** The CDL clipped to a square around a point. Two calls: ask for the clip, then download the GeoTIFF it names. */
export async function fetchCdlRaster(lat: number, lon: number, halfKm: number): Promise<{ raster: Raster; year: number }> {
  const [x, y] = toAlbers(lon, lat), h = halfKm * 1000;
  let last = 'no year answered';
  for (const year of CDL_YEARS) {
    const xml = (await get(`${CDL_SERVICE}/GetCDLFile?year=${year}&bbox=${x - h},${y - h},${x + h},${y + h}`)).toString();
    const link = xml.match(/<returnURL>(.*?)<\/returnURL>/)?.[1];
    if (!link) { last = xml.replace(/<[^>]+>/g, ' ').trim().slice(0, 160); continue; }
    const buf = await get(link);
    const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const img = await tiff.getImage();
    const [data] = await img.readRasters();
    return { year, raster: { width: img.getWidth(), height: img.getHeight(), data: data as ArrayLike<number>, bbox: img.getBoundingBox() as [number, number, number, number] } };
  }
  throw new Error(`CropScape returned no raster (${last})`);
}

/**
 * SSURGO's natural drainage class, mapped onto the four classes our crop table uses.
 * This is a mapping between two different measurements (theirs: how long the soil stays wet
 * through the year; ours: how fast a poured cup moves), so the result is labelled an estimate.
 */
export function drainageFromSsurgo(drainagecl: string | null): DrainageClass | null {
  const d = (drainagecl ?? '').toLowerCase();
  if (!d) return null;
  if (d.includes('excessively')) return 'fast';              // "Excessively", "Somewhat excessively"
  if (d === 'well drained') return 'moderate';
  if (d.includes('moderately well') || d.includes('somewhat poorly')) return 'slow';
  if (d.includes('poorly')) return 'very_slow';              // "Poorly", "Very poorly"
  return null;
}

async function sda(query: string): Promise<string[][]> {
  const res = await fetch(SDA_SERVICE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, format: 'JSON+COLUMNNAME' }), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Soil Data Access HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return [];                                // QUIRK: an empty result is an empty BODY, not {"Table":[]}
  return ((JSON.parse(text) as { Table?: string[][] }).Table ?? []).slice(1);
}

const num = (s: string | null | undefined): number | null => (s == null || s === '' || Number.isNaN(Number(s)) ? null : Number(s));

/** Dominant soil component and its surface horizon at each point. Points with no survey come back null. */
export async function fetchSoils(points: { lat: number; lon: number }[]): Promise<(RegionSoil | null)[]> {
  const mukeys: (string | null)[] = new Array(points.length).fill(null);
  // One statement can carry many points (UNION ALL of the table function): ~25 per request keeps it under a second.
  for (let i = 0; i < points.length; i += 25) {
    const chunk = points.slice(i, i + 25);
    const sql = chunk.map((p, k) => `SELECT ${i + k} AS i, mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${p.lon} ${p.lat})')`).join(' UNION ALL ');
    for (const [idx, mukey] of await sda(sql)) mukeys[Number(idx)] ??= mukey;
  }
  const wanted = [...new Set(mukeys.filter((m): m is string => !!m))].filter((m) => /^\d+$/.test(m));
  const byKey = new Map<string, RegionSoil>();
  for (let i = 0; i < wanted.length; i += 200) {
    const rows = await sda(`SELECT mu.mukey, mu.muname, c.compname, c.drainagecl, h.ph1to1h2o_r, h.ksat_r,
      (SELECT TOP 1 tg.texdesc FROM chtexturegrp tg WHERE tg.chkey = h.chkey AND tg.rvindicator = 'Yes') AS texture
      FROM mapunit mu
      JOIN component c ON c.mukey = mu.mukey AND c.cokey = (SELECT TOP 1 c2.cokey FROM component c2 WHERE c2.mukey = mu.mukey ORDER BY c2.comppct_r DESC)
      LEFT JOIN chorizon h ON h.cokey = c.cokey AND h.hzdept_r = (SELECT MIN(h2.hzdept_r) FROM chorizon h2 WHERE h2.cokey = c.cokey)
      WHERE mu.mukey IN (${wanted.slice(i, i + 200).join(',')})`);
    for (const [mukey, muname, compname, drainagecl, ph, ksat, texture] of rows) {
      byKey.set(mukey, { mukey, mapUnit: muname, series: compname, texture: texture || null, drainagecl: drainagecl || null, drainageClass: drainageFromSsurgo(drainagecl), ph: num(ph), ksatUmS: num(ksat) });
    }
  }
  return mukeys.map((m) => (m ? byKey.get(m) ?? null : null));
}
