/**
 * Open-Meteo lookups (no API key, CORS-enabled).
 *
 * For the frontend-only phase the browser calls these directly so the numbers
 * are real. In the final architecture the board makes the same calls and the
 * page asks the board. Every function degrades to clearly-labeled sample or
 * estimate data when the network is unreachable: never to silent fakes.
 */
import type { Forecast, ForecastDay, FrostDates, Place } from '../data/types';
import { fallbackFrostDates, frostDatesFromDaily } from '../data/sim/season';

async function getJson(url: string, timeoutMs = 9000): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchPlaces(q: string): Promise<Place[]> {
  if (q.trim().length < 2) return [];
  try {
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
    return (j.results ?? []).map((r: any) => ({ name: r.name, region: r.admin1, country: r.country, lat: r.latitude, lon: r.longitude }));
  } catch {
    const needle = q.toLowerCase();
    return OFFLINE_PLACES.filter((p) => p.name.toLowerCase().includes(needle));
  }
}

/** Tiny built-in list so location still works with no internet. */
export const OFFLINE_PLACES: Place[] = [
  { name: 'Cambridge', region: 'Massachusetts', country: 'United States', lat: 42.3736, lon: -71.1097 },
  { name: 'Des Moines', region: 'Iowa', country: 'United States', lat: 41.5868, lon: -93.625 },
  { name: 'Fresno', region: 'California', country: 'United States', lat: 36.7378, lon: -119.7871 },
  { name: 'Nairobi', country: 'Kenya', lat: -1.2921, lon: 36.8219 },
  { name: 'Marrakesh', country: 'Morocco', lat: 31.6295, lon: -7.9811 },
  { name: 'Christchurch', country: 'New Zealand', lat: -43.5321, lon: 172.6362 },
];

const frostCache = new Map<string, FrostDates>();

export async function fetchFrostDates(place: Place): Promise<FrostDates> {
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  const cached = frostCache.get(key) ?? readLocal<FrostDates>('frost:' + key);
  if (cached) return cached;
  const endYear = new Date().getFullYear() - 1;
  try {
    const j = await getJson(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${place.lat}&longitude=${place.lon}&start_date=${endYear - 9}-01-01&end_date=${endYear}-12-31&daily=temperature_2m_min&timezone=auto`,
      15000,
    );
    const out = frostDatesFromDaily(j.daily.time, j.daily.temperature_2m_min, place.lat);
    frostCache.set(key, out);
    writeLocal('frost:' + key, out);
    return out;
  } catch {
    return fallbackFrostDates(place.lat);
  }
}

export function summarizeForecast(days: ForecastDay[], source: Forecast['source'], sample: boolean): Forecast {
  const d48 = days.slice(0, 2);
  const rain48 = d48.reduce((s, d) => s + d.precipMm, 0);
  const probs = d48.map((d) => d.precipProb).filter((p): p is number => p != null);
  const maxProb = probs.length ? Math.max(...probs) : null;
  const rainExpected = rain48 >= 5 && (maxProb == null || maxProb >= 60);
  let dry = 0;
  for (const d of days) { if (d.precipMm < 1) dry++; else break; }
  const firstWet = days.findIndex((d) => d.precipMm >= 1);
  const when = ['today', 'tomorrow'][firstWet] ?? (firstWet > 0 ? new Date(days[firstWet].date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' }) : '');
  const text = rainExpected
    ? `Rain likely ${when}: about ${Math.round(rain48)} mm in the next 48 hours${maxProb != null ? ` (${maxProb}% chance)` : ''}.`
    : dry >= days.length
      ? `No rain in the ${days.length}-day forecast.`
      : dry === 0
        ? rain48 >= 5
          // plenty of water forecast, but the odds are below the 60 % bar: say that, not "light rain"
          ? `Rain possible ${when}: about ${Math.round(rain48)} mm in the next 48 hours, but only a ${maxProb ?? '?'}% chance. Not certain enough to skip watering.`
          : `Light rain possible ${when}, under ${Math.max(1, Math.ceil(rain48))} mm: not enough to count on.`
        : `No rain expected for ${dry} day${dry === 1 ? '' : 's'}.`;
  return { source, sample, fetchedAt: Date.now(), days, rainNext48hMm: Math.round(rain48 * 10) / 10, maxPrecipProb48h: maxProb, rainExpected, dryDaysAhead: dry, text };
}

export async function fetchForecast(place: Place | null): Promise<Forecast> {
  if (place) {
    try {
      const j = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min&forecast_days=7&timezone=auto`,
      );
      const d = j.daily;
      const days: ForecastDay[] = d.time.map((date: string, i: number) => ({
        date, precipMm: d.precipitation_sum?.[i] ?? 0, precipProb: d.precipitation_probability_max?.[i] ?? null,
        tmaxC: d.temperature_2m_max?.[i] ?? null, tminC: d.temperature_2m_min?.[i] ?? null,
      }));
      return summarizeForecast(days, 'open-meteo', false);
    } catch { /* fall through to sample */ }
  }
  return summarizeForecast(cannedDays('dry'), 'sample', true);
}

/** Canned 7-day outlooks: used for the offline sample and for demo overrides. */
export function cannedDays(kind: 'rain' | 'dry'): ForecastDay[] {
  const mm = kind === 'rain' ? [2.5, 14, 6, 0, 0, 1, 0] : [0, 0, 0, 0.4, 3, 0, 0];
  const pr = kind === 'rain' ? [55, 85, 70, 20, 10, 30, 10] : [5, 5, 10, 25, 45, 15, 10];
  return mm.map((precipMm, i) => {
    const d = new Date(Date.now() + i * 86400000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date, precipMm, precipProb: pr[i], tmaxC: 22 - i * 0.5, tminC: 12 - i * 0.3 };
  });
}

function readLocal<T>(k: string): T | null {
  try { const s = localStorage.getItem('soil:' + k); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
function writeLocal(k: string, v: unknown): void {
  try { localStorage.setItem('soil:' + k, JSON.stringify(v)); } catch { /* private mode */ }
}
