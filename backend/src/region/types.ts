import type { DrainageClass } from '../types.js';
import type { Family } from './cdl.js';

/** Soil at one point, looked up in USDA SSURGO. `drainageClass` is OUR mapping of their class. */
export interface RegionSoil {
  mukey: string;
  mapUnit: string;                 // "Toppenish silt loam, 0 to 2 percent slopes"
  series: string;                  // "Toppenish"
  texture: string | null;          // surface horizon, "Silt loam"
  drainagecl: string | null;       // SSURGO's own words, "Somewhat poorly drained"
  drainageClass: DrainageClass | null;
  ph: number | null;               // surface horizon, 1:1 water
  ksatUmS: number | null;          // surface horizon, micrometres per second
}

export interface LegendEntry { code: number; name: string; family: Family; familyLabel: string; color: string; farmed: boolean; sharePct: number }

/**
 * A "field" here is a block of neighbouring grid cells where the CDL says the same crop
 * dominates. It is NOT a property boundary: the CDL knows crops, not owners.
 */
export interface RegionField {
  id: string;
  code: number;
  crop: string;
  /** crops inside the block with a real share of its farmed pixels, largest first */
  grows: { code: number; name: string; sharePct: number }[];
  cells: number;
  areaHa: number;
  /** centroid in grid cells, (0,0) = north-west corner */
  cx: number; cy: number;
  lat: number; lon: number;
  distanceKm: number;
  bearing: string;                 // "NE"
  soil: RegionSoil | null;
}

export interface Region {
  version: 1;
  centre: { lat: number; lon: number };
  label: string | null;
  year: number;
  halfKm: number;
  cellM: number;
  n: number;                       // the grid is n x n cells, row-major from the north-west corner
  cells: number[];                 // dominant CDL code per cell
  fieldOf: number[];               // index into `fields`, or -1 for land nobody farms
  fields: RegionField[];
  legend: LegendEntry[];
  sources: { name: string; what: string; url: string }[];
  builtAt: number;
  precomputed: boolean;
}

export type RegionStatus = 'no_place' | 'loading' | 'ready' | 'unavailable';
