import { ConsoleSession } from './console.js';
import { detectBoards, serialsConfigured, type BoardRole } from './discover.js';
import { env } from './env.js';
import { identifyPort } from './identify.js';
import { OnlineTracker } from './online.js';
import {
  isImplausibleRaw, isPourBanner, isSensorBanner, parsePourEvent, parsePourReply, parsePourStatus, parseSensorLine,
} from './parse.js';
import { StaleFilter } from './stale.js';
import type { ActuatorPhase, DetectedBoard, PourActuatorStatus, ProbeId } from './types.js';

export interface SensorPush {
  zone: ProbeId;
  t: number;
  moistureRaw: number;
  volts: number | null;
  tempC: number | null;
  tempErr: boolean;
  implausible: boolean;
  uptimeSec: number;
}

export interface HardwareEvents {
  onSensor: (s: SensorPush) => void;
  onActuator: (st: PourActuatorStatus) => void;
  onActuatorPhase: (phase: ActuatorPhase | 'done') => void;
  onBoards: (boards: DetectedBoard[], missing: string[]) => void;
  onLog: (msg: string) => void;
}

interface Slot {
  role: 'pour' | 'sensors';
  zone: ProbeId | null;
  serial: string | null;
  port: string | null;
  session: ConsoleSession;
  stale: StaleFilter;
  tracker: OnlineTracker;
  wanted: boolean;
}

export class HardwareManager {
  private discovered = new Map<string, BoardRole>();
  private pour = this.slot('pour', null);
  private sensorA = this.slot('sensors', 'A');
  private sensorB = this.slot('sensors', 'B');
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStatus: PourActuatorStatus = { connected: false };
  private identifying = false;
  private noted = new Set<string>();
  running = false;

  constructor(private ev: HardwareEvents) {}

  private slot(role: 'pour' | 'sensors', zone: ProbeId | null): Slot {
    return {
      role, zone, serial: null, port: null,
      session: new ConsoleSession(),
      stale: new StaleFilter(),
      tracker: new OnlineTracker(),
      wanted: true,
    };
  }

  actuator(): PourActuatorStatus {
    return { ...this.lastStatus, connected: this.pour.session.connected };
  }

  boards(): DetectedBoard[] {
    const open = new Set<string>();
    for (const s of [this.pour, this.sensorA, this.sensorB]) if (s.session.connected && s.port) open.add(s.port);
    return detectBoards(this.discovered, open);
  }

  missing(): string[] {
    const out: string[] = [];
    if (!this.pour.session.connected) out.push('pour board (servo / water bottle)');
    if (!this.sensorA.session.connected) out.push('sensor board A');
    if (!this.sensorB.session.connected) out.push('sensor board B');
    return out;
  }

  tracker(zone: ProbeId): OnlineTracker {
    return zone === 'A' ? this.sensorA.tracker : this.sensorB.tracker;
  }

  async start(): Promise<void> {
    this.running = true;
    this.wire(this.sensorA);
    this.wire(this.sensorB);
    this.wire(this.pour);
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 4000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([this.pour.session.close(), this.sensorA.session.close(), this.sensorB.session.close()]);
  }

  private wire(slot: Slot): void {
    slot.session.onLine((line) => this.onLine(slot, line));
  }

  private onLine(slot: Slot, line: string): void {
    if (isSensorBanner(line) || isPourBanner(line)) {
      slot.stale.onBanner();
      return;
    }
    if (slot.role === 'sensors') {
      const s = parseSensorLine(line);
      if (!s) return;
      if (!slot.stale.accept(s.uptimeSec)) return;
      const zone = slot.zone;
      if (!zone) return;
      const now = Date.now();
      slot.tracker.onMoisture(s.moistureRaw, now);
      if (s.tempC != null && !s.tempErr) slot.tracker.onValidTemp(s.tempC, now);
      this.ev.onSensor({
        zone, t: now, moistureRaw: s.moistureRaw, volts: s.volts, tempC: s.tempC, tempErr: s.tempErr,
        implausible: isImplausibleRaw(s.moistureRaw), uptimeSec: s.uptimeSec,
      });
      return;
    }
    const status = parsePourStatus(line);
    if (status) {
      if (!slot.stale.accept(null)) return;
      this.lastStatus = {
        connected: true, phase: status.phase, currentDeg: status.currentDeg, restDeg: status.restDeg,
        pourDeg: status.pourDeg, holdMs: status.holdMs, pours: status.pours, cooldownMsLeft: status.cooldownMsLeft,
        port: slot.port, serial: slot.serial,
      };
      this.ev.onActuator(this.lastStatus);
      return;
    }
    const event = parsePourEvent(line);
    if (event) {
      if (!slot.stale.accept(event.uptimeSec)) return;
      if (event.phase !== 'done') this.lastStatus = { ...this.lastStatus, connected: true, phase: event.phase };
      else this.lastStatus = { ...this.lastStatus, connected: true, phase: 'idle' };
      this.ev.onActuator(this.lastStatus);
      this.ev.onActuatorPhase(event.phase);
    }
  }

  /**
   * Ask the firmware to pour. Two protections before `p` is ever written:
   *  - the console must be past its stale-replay window, or an OLD "pour: accepted" line
   *    from a previous session could be mistaken for the answer;
   *  - the sketch must answer a status ping right now. The router QUEUES input for a sketch
   *    that is not listening, so a `p` sent to a booting board would fire later, unasked.
   */
  async requestPour(holdMs?: number): Promise<'started' | 'busy' | 'cooldown' | 'offline' | 'no_reply'> {
    if (!this.pour.session.connected || !this.pour.stale.isLive) return 'offline';
    this.pour.session.send('s');
    const alive = await this.pour.session.waitFor((l) => (parsePourStatus(l) ? true : undefined), 2000);
    if (!alive) return 'offline';
    const cmd = holdMs && holdMs > 0 ? `p${Math.round(holdMs)}` : 'p';
    this.pour.session.send(cmd);
    const r = await this.pour.session.waitFor((l) => parsePourReply(l) ?? undefined, 3000);
    if (r === 'accepted') return 'started';
    if (r === 'BUSY') return 'busy';
    if (r === 'COOLDOWN') return 'cooldown';
    return 'no_reply';
  }

  async refreshStatus(): Promise<PourActuatorStatus> {
    if (!this.pour.session.connected) {
      this.lastStatus = { connected: false };
      return this.lastStatus;
    }
    this.pour.session.send('s');
    await this.pour.session.waitFor((l) => (parsePourStatus(l) ? true : undefined), 2500);
    return this.actuator();
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    let boards = detectBoards(this.discovered);
    if (!this.identifying) {
      const unknown = boards.filter((b) => b.role === 'unknown' && b.serial && b.port);
      if (unknown.length) {
        this.identifying = true;
        try {
          for (const b of unknown) {
            this.ev.onLog(`board ${b.serial} is not in .env: asking it what it is (port released right after)`);
            const role = await identifyPort(b.port);
            if (b.serial) this.discovered.set(b.serial, role);
            const envName = role === 'pour' ? 'POUR_BOARD_SERIAL' : role === 'sensors' ? 'SENSOR_A_BOARD_SERIAL or SENSOR_B_BOARD_SERIAL' : null;
            this.ev.onLog(`  -> ${role === 'other' ? 'no recognisable firmware; leaving it alone' : `it is a ${role} board`}${envName ? `. Add to .env: ${envName}=${b.serial}` : ''}`);
          }
        } finally {
          this.identifying = false;
        }
        boards = detectBoards(this.discovered);
      }
    }

    this.assignAutoZones(boards);

    const e = env();
    const pourTarget = e.boardPort
      ? boards.find((b) => b.port === e.boardPort) ?? { port: e.boardPort, serial: 'BOARD_PORT', role: 'pour' as const, label: 'override', zone: null, from: null, open: false }
      : boards.find((b) => b.role === 'pour');
    const sensors = boards.filter((b) => b.role === 'sensors');
    const aTarget = sensors.find((b) => b.zone === 'A') ?? sensors.filter((b) => !b.zone).sort((a, b) => (a.serial ?? '').localeCompare(b.serial ?? ''))[0];
    const bTarget = sensors.find((b) => b.zone === 'B' && b.port !== aTarget?.port)
      ?? sensors.filter((b) => !b.zone && b.port !== aTarget?.port).sort((a, c) => (a.serial ?? '').localeCompare(c.serial ?? ''))[0];

    await this.ensure(this.pour, pourTarget?.port ?? null, pourTarget?.serial ?? null);
    await this.ensure(this.sensorA, aTarget?.port ?? null, aTarget?.serial ?? null);
    await this.ensure(this.sensorB, bTarget?.port ?? null, bTarget?.serial ?? null);

    this.ev.onBoards(this.boards(), this.missing());
  }

  private note(msg: string): void {
    if (this.noted.has(msg)) return;
    this.noted.add(msg);
    this.ev.onLog(msg);
  }

  private assignAutoZones(boards: DetectedBoard[]): void {
    const e = env();
    if (e.sensorASerial && e.sensorBSerial) return;
    const unzoned = boards.filter((b) => b.role === 'sensors' && !b.zone && b.serial).sort((a, b) => (a.serial ?? '').localeCompare(b.serial ?? ''));
    if (unzoned[0] && !e.sensorASerial) this.note(`auto-assigned sensor ${unzoned[0].serial} to zone A (set SENSOR_A_BOARD_SERIAL to pin this)`);
    if (unzoned[e.sensorASerial ? 0 : 1] && !e.sensorBSerial) {
      const b = unzoned[e.sensorASerial ? 0 : 1];
      this.note(`auto-assigned sensor ${b.serial} to zone B (set SENSOR_B_BOARD_SERIAL to pin this)`);
    }
  }

  private async ensure(slot: Slot, port: string | null, serial: string | null): Promise<void> {
    if (!port) {
      if (slot.session.connected) {
        this.note(`${slot.role}${slot.zone ? ` ${slot.zone}` : ''} disconnected`);
        slot.tracker.markGone();
        await slot.session.close();
      }
      slot.port = null;
      slot.serial = serial;
      return;
    }
    if (slot.session.connected && slot.port === port) return;
    if (slot.session.connected) await slot.session.close();
    slot.stale.reset();
    slot.port = port;
    slot.serial = serial;
    this.ev.onLog(`opening ${slot.role}${slot.zone ? ` ${slot.zone}` : ''} on ${port} (${serial ?? 'no serial'})`);
    const ok = await slot.session.open(port);
    if (!ok) {
      this.note(`failed to open ${port}; will retry`);
      slot.port = null;
      return;
    }
    if (slot.role === 'pour') {
      await new Promise((r) => setTimeout(r, 2500));
      slot.session.send('s');
    }
  }
}

export async function scanBoards(): Promise<void> {
  const discovered = new Map<string, BoardRole>();
  const boards = detectBoards(discovered);
  if (!boards.length) {
    console.log('No UNO Q connected.');
    return;
  }
  const suggestions: string[] = [];
  for (const b of boards) {
    const answers = await identifyPort(b.port);
    if (b.serial) discovered.set(b.serial, answers);
    const mismatch = b.role !== 'unknown' && answers !== 'other' && answers !== b.role;
    console.log(`${b.serial}  ${b.port}\n    in .env as:    ${b.role === 'unknown' ? '(not listed)' : `${b.role} (${b.label})`}\n    answers like:  ${answers === 'other' ? 'no recognisable firmware (or its console is in use)' : answers}${mismatch ? '   <-- MISMATCH with .env' : ''}`);
    if (b.role === 'unknown' && answers !== 'other') {
      suggestions.push(`${answers === 'pour' ? 'POUR_BOARD_SERIAL' : 'SENSOR_?_BOARD_SERIAL'}=${b.serial}`);
    }
  }
  if (suggestions.length) console.log(`\nTo register them, add to backend/.env (or web/.env):\n  ${suggestions.join('\n  ')}`);
  if (!serialsConfigured()) console.log('\nNo serials in .env; identification is the zero-config fallback.');
}
