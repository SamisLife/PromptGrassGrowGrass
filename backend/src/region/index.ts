/**
 * RegionService: the land around the plot. Real public data, fetched once and kept.
 *
 *   precomputed (backend/region-data/*.json, shipped)  -> the demo never needs the network
 *   cached      (data/region-<lat>,<lon>.json)         -> any other place, after its first fetch
 *   live        (USDA CropScape + Soil Data Access)     -> first time a place is set
 *
 * Outside the contiguous US there is no Cropland Data Layer, so the service says so. It never
 * substitutes anything.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_ROOT } from '../env.js';
import { persist } from '../persist.js';
import type { Place } from '../types.js';
import { inConus } from './albers.js';
import { buildGrid, type Raster } from './build.js';
import { CDL_SERVICE, SDA_SERVICE, fetchCdlRaster, fetchSoils } from './fetch.js';
import type { Region, RegionSoil, RegionStatus } from './types.js';

export const HALF_KM = 12;
export const GRID_N = 32;
const PRECOMPUTED_DIR = join(BACKEND_ROOT, 'region-data');

export interface RegionIo {
  raster(lat: number, lon: number, halfKm: number): Promise<{ raster: Raster; year: number }>;
  soils(points: { lat: number; lon: number }[]): Promise<(RegionSoil | null)[]>;
}
const liveIo: RegionIo = { raster: fetchCdlRaster, soils: fetchSoils };

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180));

export async function buildRegion(place: { lat: number; lon: number; name?: string }, io: RegionIo = liveIo): Promise<Region> {
  const { raster, year } = await io.raster(place.lat, place.lon, HALF_KM);
  const grid = buildGrid(raster, GRID_N);
  if (!grid.cells.some((c) => c !== 0)) throw new Error('The Cropland Data Layer has no data at this location.');
  let soils: (RegionSoil | null)[] = [];
  try { soils = await io.soils(grid.fields.map((f) => ({ lat: f.lat, lon: f.lon }))); } catch { soils = []; }   // crops without soils still draws the land
  return {
    version: 1, centre: { lat: place.lat, lon: place.lon }, label: place.name ?? null, year, halfKm: HALF_KM, cellM: Math.round(grid.cellM), n: grid.n,
    cells: grid.cells, fieldOf: grid.fieldOf, fields: grid.fields.map((f, i) => ({ ...f, soil: soils[i] ?? null })), legend: grid.legend,
    sources: [
      { name: `USDA NASS Cropland Data Layer ${year}`, what: 'which crop grew on each 30 m pixel', url: CDL_SERVICE },
      { name: 'USDA NRCS Soil Data Access (SSURGO)', what: 'soil series, texture, drainage class and pH at each field', url: SDA_SERVICE },
    ],
    builtAt: Date.now(), precomputed: false,
  };
}

export class RegionService {
  private current: Region | null = null;
  private state: RegionStatus = 'no_place';
  private why: string | null = null;
  private key = '';
  onChange: (() => void) | null = null;

  constructor(private io: RegionIo = liveIo, private precomputedDir = PRECOMPUTED_DIR) {}

  get status(): RegionStatus { return this.state; }
  get reason(): string | null { return this.why; }
  get region(): Region | null { return this.state === 'ready' ? this.current : null; }

  /** Call whenever the place changes. Returns at once; `onChange` fires when the data is in. */
  ensure(place: Place | null): void {
    const key = place ? `${place.lat.toFixed(2)},${place.lon.toFixed(2)}` : '';
    if (key === this.key && this.state !== 'unavailable') return;
    this.key = key; this.current = null; this.why = null;
    if (!place) return this.set('no_place');
    if (!inConus(place.lat, place.lon)) return this.set('unavailable', "Neighbouring farms come from the USDA Cropland Data Layer, which covers the contiguous United States only. Nothing is shown here rather than guessed.");

    const ready = this.precomputed(place) ?? persist.readNamed<Region | null>(`region-${key}.json`, null);
    if (ready?.version === 1) { this.current = ready; return this.set('ready'); }

    this.set('loading');
    buildRegion(place, this.io).then((r) => {
      if (this.key !== key) return;
      persist.writeNamed(`region-${key}.json`, r);
      this.current = r; this.set('ready');
    }).catch((e: Error) => {
      if (this.key !== key) return;
      this.set('unavailable', `Could not load the land around this place: ${e.message}. It will be tried again when the location is set.`);
    });
  }

  private precomputed(place: Place): Region | null {
    if (!existsSync(this.precomputedDir)) return null;
    for (const f of readdirSync(this.precomputedDir).filter((x) => x.endsWith('.json'))) {
      try {
        const r = JSON.parse(readFileSync(join(this.precomputedDir, f), 'utf8')) as Region;
        if (r.version === 1 && km(r.centre, place) < 1.5) return { ...r, precomputed: true };
      } catch { /* a broken file is skipped, never fatal */ }
    }
    return null;
  }

  private set(state: RegionStatus, why: string | null = null): void { this.state = state; this.why = why; this.onChange?.(); }
}

export type { Region, RegionField, RegionSoil, RegionStatus } from './types.js';
export { findMatches, unservedCrops, type Match, type YourSoil } from './match.js';
