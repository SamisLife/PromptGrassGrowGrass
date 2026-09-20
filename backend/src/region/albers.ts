/**
 * EPSG:5070, "CONUS Albers": the projection the USDA Cropland Data Layer is published in.
 * The CropScape API takes its bounding boxes in these metres, not in longitude/latitude.
 *
 * Albers equal-area conic on the GRS80 ellipsoid (Snyder, "Map Projections: A Working Manual",
 * 1987, eq. 14-1 to 14-21). Checked against Snyder's worked example in test/region.test.ts.
 */
const A = 6378137, F = 1 / 298.257222101;
const E2 = 2 * F - F * F, E = Math.sqrt(E2), RAD = Math.PI / 180;
const LAT0 = 23 * RAD, LON0 = -96 * RAD, P1 = 29.5 * RAD, P2 = 45.5 * RAD;

const q = (phi: number): number => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};
const m = (phi: number): number => Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
const N = (m(P1) ** 2 - m(P2) ** 2) / (q(P2) - q(P1));
const C = m(P1) ** 2 + N * q(P1);
const RHO0 = (A * Math.sqrt(C - N * q(LAT0))) / N;

/** longitude, latitude (degrees) -> x, y (metres, EPSG:5070) */
export function toAlbers(lon: number, lat: number): [number, number] {
  const rho = (A * Math.sqrt(C - N * q(lat * RAD))) / N, th = N * (lon * RAD - LON0);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}

/** x, y (metres, EPSG:5070) -> longitude, latitude (degrees) */
export function fromAlbers(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, RHO0 - y), th = Math.atan2(x, RHO0 - y);
  const qq = (C - (rho * rho * N * N) / (A * A)) / N;
  let phi = Math.asin(qq / 2);
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(phi), k = 1 - E2 * s * s;
    phi += ((k * k) / (2 * Math.cos(phi))) * (qq / (1 - E2) - s / k + (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
  }
  return [(LON0 + th / N) / RAD, phi / RAD];
}

/** The Cropland Data Layer covers the contiguous United States only. */
export function inConus(lat: number, lon: number): boolean {
  return lat >= 24.4 && lat <= 49.5 && lon >= -125 && lon <= -66.9;
}
