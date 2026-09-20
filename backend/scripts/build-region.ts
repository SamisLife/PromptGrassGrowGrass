/**
 * Precompute the land around a coordinate and store it in region-data/, so a demo never
 * depends on a live USDA query.
 *
 *   npm run build-region                      the demo coordinate
 *   npm run build-region -- 40.05 -76.20 lancaster "Lancaster County"
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_ROOT } from '../src/env.js';
import { DEMO_PLACE } from '../src/region/demo.js';
import { buildRegion } from '../src/region/index.js';

const [lat, lon, slug, name] = process.argv.slice(2);
const place = lat && lon ? { lat: Number(lat), lon: Number(lon), name: name ?? `${lat}, ${lon}` } : DEMO_PLACE;
const file = join(BACKEND_ROOT, 'region-data', `${slug ?? 'demo-yakima'}.json`);

console.log(`Fetching the Cropland Data Layer and SSURGO soils around ${place.lat}, ${place.lon} ...`);
const t0 = Date.now();
const region = await buildRegion(place);
mkdirSync(join(BACKEND_ROOT, 'region-data'), { recursive: true });
writeFileSync(file, JSON.stringify({ ...region, precomputed: true }));
const soils = region.fields.filter((f) => f.soil).length;
console.log(`${region.fields.length} fields (${soils} with soil data), CDL ${region.year}, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${file}`);
console.log(region.legend.filter((l) => l.farmed).slice(0, 12).map((l) => `${l.name} ${l.sharePct}%`).join(' | '));
const dr = new Map<string, number>();
for (const f of region.fields) dr.set(f.soil?.drainagecl ?? 'unknown', (dr.get(f.soil?.drainagecl ?? 'unknown') ?? 0) + 1);
console.log([...dr].map(([k, v]) => `${k}: ${v}`).join(' | '));
