/** Parse Arduino console lines. Pure functions — no I/O. */

export interface SensorSample {
  uptimeSec: number;
  moistureRaw: number;
  volts: number | null;
  tempC: number | null;
  tempErr: boolean;
  temps: Record<string, number | 'ERR'>;
  extra: boolean;
}

export interface PourStatusLine {
  phase: 'idle' | 'tipping' | 'holding' | 'returning';
  currentDeg: number;
  restDeg: number;
  pourDeg: number;
  holdMs: number;
  pours: number;
  cooldownMsLeft: number;
}

export type PourReply = 'accepted' | 'BUSY' | 'COOLDOWN';
export type PourEventPhase = 'tipping' | 'holding' | 'returning' | 'done';

export interface PourEventLine {
  uptimeSec: number | null;
  phase: PourEventPhase;
}

const SENSOR_RE =
  /^\[(\d+)s\]\s+moisture raw=(-?\d+)(?:\s+\(([\d.]+)\s*V\))?(?:\s+(.+))?$/i;
const TEMP_RE = /\bT(\d+)=(ERR|-?[\d.]+)/gi;
const STATUS_RE = /^status:\s*(\w+),(-?\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\s*$/;
const POUR_REPLY_RE = /^pour:\s*(accepted|BUSY|COOLDOWN)\b/;
const POUR_EVENT_RE = /^(?:\[([\d.]+)s\]\s+)?pour:\s*(tipping|holding|returning|done)\b/;
const SENSOR_BANNER_RE = /===\s*sensor_test\s*===/i;
const POUR_BANNER_RE = /===\s*pour firmware\s*===/i;

export function isSensorBanner(line: string): boolean {
  return SENSOR_BANNER_RE.test(line);
}

export function isPourBanner(line: string): boolean {
  return POUR_BANNER_RE.test(line);
}

export function parseSensorLine(line: string): SensorSample | null {
  const m = line.trim().match(SENSOR_RE);
  if (!m) return null;
  const rest = m[4] ?? '';
  const temps: Record<string, number | 'ERR'> = {};
  let tempC: number | null = null;
  let tempErr = false;
  TEMP_RE.lastIndex = 0;
  let tm: RegExpExecArray | null;
  while ((tm = TEMP_RE.exec(rest))) {
    const key = `T${tm[1]}`;
    if (tm[2] === 'ERR') {
      temps[key] = 'ERR';
      if (tm[1] === '0') tempErr = true;
    } else {
      const v = Number(tm[2]);
      temps[key] = v;
      if (tm[1] === '0') tempC = v;
    }
  }
  return {
    uptimeSec: Number(m[1]),
    moistureRaw: Number(m[2]),
    volts: m[3] != null ? Number(m[3]) : null,
    tempC,
    tempErr,
    temps,
    extra: rest.length > 0,
  };
}

export function parsePourStatus(line: string): PourStatusLine | null {
  const m = line.trim().match(STATUS_RE);
  if (!m) return null;
  const phase = m[1];
  if (phase !== 'idle' && phase !== 'tipping' && phase !== 'holding' && phase !== 'returning') return null;
  return {
    phase,
    currentDeg: Number(m[2]),
    restDeg: Number(m[3]),
    pourDeg: Number(m[4]),
    holdMs: Number(m[5]),
    pours: Number(m[6]),
    cooldownMsLeft: Number(m[7]),
  };
}

export function parsePourReply(line: string): PourReply | null {
  const m = line.trim().match(POUR_REPLY_RE);
  return m ? (m[1] as PourReply) : null;
}

export function parsePourEvent(line: string): PourEventLine | null {
  const m = line.trim().match(POUR_EVENT_RE);
  if (!m) return null;
  if (parsePourReply(line)) return null;
  return {
    uptimeSec: m[1] != null ? Number(m[1]) : null,
    phase: m[2] as PourEventPhase,
  };
}

export function classifyIdentifyText(text: string): 'pour' | 'sensors' | 'other' {
  if (/status:\s*\w+,-?\d+,\d+/.test(text) || POUR_BANNER_RE.test(text) || /pour:\s*(accepted|BUSY|COOLDOWN|tipping)/.test(text)) {
    return 'pour';
  }
  if (/moisture raw=/.test(text) || SENSOR_BANNER_RE.test(text)) return 'sensors';
  return 'other';
}

/** Raw ADC outside the measured healthy range of these probes. Floating pin ≈ 1100. */
export function isImplausibleRaw(raw: number): boolean {
  return raw < 1500 || raw > 3700;
}
