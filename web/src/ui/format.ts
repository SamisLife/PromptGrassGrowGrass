export function fmtLen(cm: number, digits = 0): string {
  if (cm >= 200) return `${(cm / 100).toFixed(cm % 100 === 0 ? 0 : 1)} m`;
  return `${cm.toFixed(digits).replace(/\.0$/, '')} cm`;
}

export function fmtArea(wCm: number, lCm: number): string {
  const m2 = (wCm * lCm) / 10000;
  return m2 >= 1 ? `${m2.toFixed(m2 >= 10 ? 0 : 1)} m²` : `${Math.round(wCm * lCm)} cm²`;
}

export function fmtDoy(doy: number | null): string {
  if (doy == null) return '–';
  return new Date(2025, 0, doy).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function fmtWhen(t: number): string {
  return new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
