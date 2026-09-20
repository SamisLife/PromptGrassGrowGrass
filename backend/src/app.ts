import { randomBytes } from 'node:crypto';
import { diagnose, moistureWord, waterAdvice } from './advice.js';
import { cropById, scoreCrops } from './crops.js';
import { defaultCal, defaultConfig } from './defaults.js';
import { env, type Env } from './env.js';
import { EventBus } from './events.js';
import { HardwareManager, type SensorPush } from './hardware.js';
import { HistoryStore } from './history.js';
import { isImplausibleRaw } from './parse.js';
import { isCalibrated, mapRaw, swingOk } from './percent.js';
import { ensureDataDir, persist } from './persist.js';
import { judgePour, type PourOutcome } from './plain.js';
import { PourDetector } from './pourDetector.js';
import { defaultGuardConfig, PourGuards, type PourRequestLog } from './pourGuards.js';
import { plantingWindow } from './season.js';
import type {
  AgentCall, BoardConfig, Connectivity, CropScore, DetectedBoard, Diagnosis, Forecast, FrostDates, HistorySeries,
  Mode, Note, Overrides, Place, PlantingWindow, Plot, PourActuatorStatus, PourCaller, PourGuardKind, PourResult, ProbeId,
  SoftGuardKind, SoilProfile, Zone, ZoneId, ZoneLive, ZoneReading, HistoryPoint } from './types.js';
import { cannedDays, fetchForecast, fetchFrostDates, searchPlaces, summarizeForecast } from './weather.js';

const emptyLive = (t = Date.now()): ZoneLive => ({
  t, moistureRaw: null, moisturePct: null, tempC: null, moistureOnline: false, tempOnline: false,
});

export class SoilApp {
  readonly bus = new EventBus();
  config: BoardConfig;
  profile: SoilProfile | null;
  notes: Note[];
  overrides: Overrides = { forecast: null, zoneMoisture: {} };
  live: Record<ZoneId, ZoneLive> = {};
  /** Always real hardware. Kept in every payload so clients can assert it. */
  readonly mode: Mode = 'board';
  missing: string[] = [];
  boardsList: DetectedBoard[] = [];
  internetReachable: boolean | null = null;
  private detector: PourDetector;
  private history: HistoryStore;
  private guards: PourGuards;
  private hardware: HardwareManager | null = null;
  private actuator: PourActuatorStatus = { connected: false };
  private quietUntil = 0;
  private callSeq = 0;
  private cfg: Env;
  private implausible = new Map<ZoneId, boolean>();
  private startedAt = Date.now();

  constructor(cfg?: Env) {
    this.cfg = cfg ?? env();
    this.config = persist.config.load() ?? defaultConfig();
    this.profile = persist.profile.load();
    this.notes = persist.notes.load();
    this.detector = new PourDetector((a, b) => this.distance(a, b));
    this.history = new HistoryStore();
    this.guards = new PourGuards(defaultGuardConfig({
      maxPerWindow: this.cfg.pourMaxPerWindow,
      windowMs: this.cfg.pourWindowMs,
      wetPct: this.cfg.pourWetPct,
    }));
  }

  async start(): Promise<void> {
    ensureDataDir();
    if (this.cfg.hardwareOff) {
      this.missing = ['pour board (servo / water bottle)', 'sensor board A', 'sensor board B'];
      console.log(new Date().toLocaleTimeString(), 'HARDWARE=off: not opening consoles. Every probe stays offline; nothing is simulated.');
      this.tickOffline();
      return;
    }
    this.hardware = new HardwareManager({
      onSensor: (s) => this.onHardwareSensor(s),
      onActuator: (st) => { this.actuator = st; },
      onActuatorPhase: () => { /* detector watches moisture */ },
      onBoards: (boards, missing) => this.onBoards(boards, missing),
      onLog: (msg) => console.log(new Date().toLocaleTimeString(), msg),
    });
    await this.hardware.start();
    this.tickOffline();
  }

  async stop(): Promise<void> {
    await this.hardware?.stop();
  }

  private lastMissingNote = '';
  /** zone A just before the most recent accepted pour */
  private lastPour: { t: number; rawBefore: number | null; pctBefore: number | null } | null = null;
  private onBoards(boards: DetectedBoard[], missing: string[]): void {
    this.boardsList = boards;
    this.missing = missing;
    // No board, no data: probes read offline. Nothing is ever simulated.
    const note = missing.join(', ');
    if (note !== this.lastMissingNote) {
      this.lastMissingNote = note;
      console.log(new Date().toLocaleTimeString(), note ? `not connected: ${note}` : 'all three boards connected');
    }
  }

  private tickOffline(): void {
    setInterval(() => {
      if (this.mode !== 'board' || !this.hardware) return;
      const now = Date.now();
      let changed = false;
      for (const z of this.config.zones) {
        const tr = this.hardware.tracker(z.probe);
        const live = this.live[z.id] ?? emptyLive(now);
        const mOn = tr.moistureOnline(now);
        const tOn = tr.tempOnline(now);
        if (live.moistureOnline !== mOn || live.tempOnline !== tOn) {
          this.live[z.id] = {
            t: now,
            moistureRaw: mOn ? live.moistureRaw : null,
            moisturePct: mOn ? live.moisturePct : null,
            tempC: tOn ? live.tempC : null,
            moistureOnline: mOn,
            tempOnline: tOn,
          };
          changed = true;
        }
      }
      if (changed) this.emitSample(now);
    }, 1000);
  }

  private onHardwareSensor(s: SensorPush): void {
    const zone = this.config.zones.find((z) => z.probe === s.zone) ?? this.config.zones.find((z) => z.id === s.zone);
    if (!zone) return;
    const cal = this.config.calibration[s.zone];
    let pct = mapRaw(s.moistureRaw, cal);
    const forced = this.overrides.zoneMoisture[zone.id];
    if (forced != null && pct != null) pct = forced;
    this.implausible.set(zone.id, s.implausible);
    this.live[zone.id] = {
      t: s.t,
      moistureRaw: s.moistureRaw,
      moisturePct: pct,
      tempC: s.tempC,
      moistureOnline: true,
      tempOnline: s.tempC != null && !s.tempErr,
    };
    this.emitSample(s.t);
    this.recordHistory(s.t);
    this.updateDetector(s.t);
  }

  private emitSample(t: number): void {
    const zones: Record<ZoneId, ZoneLive> = {};
    for (const z of this.config.zones) zones[z.id] = this.live[z.id] ?? emptyLive(t);
    this.bus.emitEvent({ type: 'sample', t, zones, mode: this.mode });
  }

  private emitConfig(): void {
    persist.config.save(this.config);
    this.bus.emitEvent({ type: 'config', config: this.config, mode: this.mode });
  }

  private recordHistory(t: number): void {
    const full = this.detector.state.phase === 'running' || this.detector.state.phase === 'armed'
      || (this.actuator.phase != null && this.actuator.phase !== 'idle');
    for (const z of this.config.zones) {
      const live = this.live[z.id];
      if (!live) continue;
      this.history.push(z.id, { t, moisturePct: live.moisturePct, tempC: live.tempC, moistureRaw: live.moistureRaw }, full);
    }
  }

  private updateDetector(t: number): void {
    if (t < this.quietUntil) {
      if (this.detector.state.phase === 'idle') this.detector = new PourDetector((a, b) => this.distance(a, b));
      return;
    }
    const values: Record<ZoneId, number | null> = {};
    for (const z of this.config.zones) {
      const live = this.live[z.id];
      values[z.id] = live?.moistureOnline ? live.moisturePct : null;
    }
    if (this.detector.update(t, values)) this.onPourChanged();
  }

  private onPourChanged(): void {
    const s = this.detector.state;
    if (s.phase === 'done' && s.rateCmMin != null && s.source && s.target) {
      const label = s.label ?? '';
      this.profile = {
        drainageClass: s.drainageClass!, label,
        texture: label.replace(/^.*behaves like /, '').replace(/ soil$/, ''),
        rateCmMin: s.rateCmMin, distanceCm: s.distanceCm!,
        seconds: ((s.t1 as number) - (s.t0 as number)) / 1000,
        between: [s.source, s.target], measuredAt: Date.now(), estimate: true,
      };
      persist.profile.save(this.profile);                       // survives restarts; used by crop scores until replaced
      persist.appendJsonl('soil-profiles.jsonl', this.profile);   // every measurement is kept, never overwritten
      this.bus.emitEvent({ type: 'profile', profile: this.profile, mode: this.mode });
    }
    this.bus.emitEvent({ type: 'pour', pour: s, mode: this.mode });
  }

  private distance(a: ZoneId, b: ZoneId): number {
    const za = this.config.zones.find((z) => z.id === a), zb = this.config.zones.find((z) => z.id === b);
    return za && zb ? Math.hypot(za.x - zb.x, za.y - zb.y) : 0;
  }

  zone(id: ZoneId): Zone {
    const z = this.config.zones.find((x) => x.id.toLowerCase() === String(id).toLowerCase().replace(/^zone\s+/, '')
      || x.name.toLowerCase() === String(id).toLowerCase()
      || x.name.toLowerCase() === 'zone ' + String(id).toLowerCase());
    if (!z) throw new Error(`No zone "${id}". Zones: ${this.config.zones.map((x) => x.id).join(', ')}`);
    return z;
  }

  liveOf(id: ZoneId): ZoneLive {
    return this.live[id] ?? emptyLive();
  }

  async readZone(id: ZoneId): Promise<ZoneReading> {
    const zone = this.zone(id), live = this.liveOf(zone.id), calibrated = isCalibrated(this.config.calibration[zone.probe]);
    const fc = await this.forecast();
    return { zone, live, calibrated, water: waterAdvice(live, calibrated, this.profile, fc), soil: this.profile };
  }

  async soilProfile(): Promise<SoilProfile | null> { return this.profile; }

  async scoreCrops(id: ZoneId): Promise<CropScore[]> {
    const zone = this.zone(id), live = this.liveOf(zone.id);
    return scoreCrops({
      drainageClass: this.profile?.drainageClass ?? null,
      soilTempC: live.tempOnline ? live.tempC : null,
      sun: zone.sun, ph: zone.ph, frost: await this.frostDates(),
    });
  }

  async plantingWindow(cropId: string, zoneId: ZoneId): Promise<PlantingWindow | null> {
    const crop = cropById(cropId);
    if (!crop) throw new Error(`Unknown crop "${cropId}".`);
    const frost = await this.frostDates();
    if (!frost) return null;
    const live = this.liveOf(this.zone(zoneId).id);
    return plantingWindow(crop, frost, new Date(), live.tempOnline ? live.tempC : null);
  }

  async frostDates(): Promise<FrostDates | null> {
    return this.config.place ? fetchFrostDates(this.config.place) : null;
  }

  async forecast(): Promise<Forecast> {
    if (this.overrides.forecast) return summarizeForecast(cannedDays(this.overrides.forecast), 'override', false);
    try {
      const value = await fetchForecast(this.config.place);
      this.internetReachable = !value.sample;
      return value;
    } catch {
      this.internetReachable = false;
      return summarizeForecast(cannedDays('dry'), 'sample', true);
    }
  }

  async diagnose(id: ZoneId): Promise<Diagnosis> {
    const zone = this.zone(id);
    return diagnose(zone.id, this.liveOf(zone.id), isCalibrated(this.config.calibration[zone.probe]), this.profile, await this.forecast());
  }

  async historyFor(id: ZoneId, hours: number): Promise<HistorySeries> {
    const zone = this.zone(id);
    return this.history.series(zone.id, hours);
  }

  async addNote(text: string, zoneId: ZoneId | null, author: 'user' | 'agent'): Promise<Note> {
    const note: Note = {
      id: randomBytes(4).toString('hex'),
      t: Date.now(),
      zoneId: zoneId ? this.zone(zoneId).id : null,
      text: text.slice(0, 500),
      author,
    };
    this.notes = [note, ...this.notes].slice(0, 100);
    persist.notes.save(this.notes);
    this.bus.emitEvent({ type: 'notes', notes: this.notes, mode: this.mode });
    return note;
  }

  async connectivity(): Promise<Connectivity> {
    const online = this.internetReachable;
    const wiredState = this.missing.length === 3 ? 'down' : 'wired';
    return {
      internetReachable: online,
      links: [
        {
          id: 'wired', layer: 'probe_gateway', label: 'Wired',
          state: wiredState, active: wiredState !== 'down',
          detail: this.missing.length ? `Missing: ${this.missing.join(', ')}` : 'USB consoles open',
          note: 'On the demo table the probes plug straight into the gateway boards.',
        },
        { id: 'lora', layer: 'probe_gateway', label: 'LoRa radio', state: 'not_fitted', active: false, detail: 'Not fitted', note: 'In a real field: battery probes, kilometres of range, years on a cell.' },
        {
          id: 'wifi', layer: 'gateway_internet', label: 'WiFi',
          state: online ? 'connected' : online === false ? 'down' : 'connected',
          active: online !== false,
          detail: online === false ? 'No connection' : 'This laptop\'s network',
          note: 'Hotspot or farmhouse WiFi, when it exists.',
        },
        { id: 'cellular', layer: 'gateway_internet', label: 'Cellular', state: 'not_fitted', active: false, detail: 'Not fitted', note: 'An LTE-M modem (e.g. Notecard) for fields with coverage but no WiFi.' },
        { id: 'satellite', layer: 'gateway_internet', label: 'Satellite', state: 'not_fitted', active: false, detail: 'Not fitted', note: 'A short-burst modem (e.g. Iridium) for fields with nothing else. A few bytes a day is enough.' },
      ],
    };
  }

  setPlot(plot: Plot, zones: Zone[]): void { this.config = { ...this.config, plot, zones }; this.emitConfig(); }
  updateZone(id: ZoneId, patch: Partial<Pick<Zone, 'sun' | 'ph' | 'name'>>): void {
    this.config = { ...this.config, zones: this.config.zones.map((z) => (z.id === this.zone(id).id ? { ...z, ...patch } : z)) };
    this.emitConfig();
  }
  setPlace(place: Place | null): void { this.config = { ...this.config, place }; this.emitConfig(); }
  setOnboarded(done: boolean): void { this.config = { ...this.config, onboarded: done }; this.emitConfig(); }
  setOverrides(o: Overrides): void { this.overrides = o; this.bus.emitEvent({ type: 'overrides', overrides: o, mode: this.mode }); }

  async calibrate(probe: ProbeId, step: 'air' | 'water'): Promise<{ ok: true; raw: number } | { ok: false; error: string }> {
    this.quietUntil = Date.now() + 6000;
    await new Promise((r) => setTimeout(r, 1200));
    const zone = this.config.zones.find((z) => z.probe === probe);
    const live = zone ? this.liveOf(zone.id) : emptyLive();
    const raw = live.moistureRaw;
    if (raw == null || (zone && !live.moistureOnline)) return { ok: false, error: 'Probe is offline. Check its three wires.' };
    const cal = { ...this.config.calibration[probe], source: 'user' as const };
    if (step === 'air') { cal.airRaw = raw; cal.waterRaw = null; cal.calibratedAt = null; }
    else cal.waterRaw = raw;
    if (cal.airRaw != null && cal.waterRaw != null) {
      if (!swingOk(cal.airRaw, cal.waterRaw)) {
        return { ok: false, error: 'Air and water read almost the same: the probe is not responding. Some batches only work at 5 V.' };
      }
      cal.calibratedAt = Date.now();
    }
    this.quietUntil = Date.now() + 4000;
    this.config = { ...this.config, calibration: { ...this.config.calibration, [probe]: cal } };
    this.emitConfig();
    return { ok: true, raw };
  }

  clearCalibration(probe: ProbeId): void {
    this.config = { ...this.config, calibration: { ...this.config.calibration, [probe]: defaultCal(probe) } };
    this.emitConfig();
  }

  armPour(): void {
    this.detector.arm();
    this.bus.emitEvent({ type: 'pour', pour: this.detector.state, mode: this.mode });
  }

  /**
   * Cancel / re-arm the pour TEST. This never touches the saved soil profile: cancelling a new
   * attempt must not destroy the last good measurement. The profile is replaced only when a new
   * test completes (onPourChanged), or removed on purpose with clearSoilProfile().
   */
  resetPour(): void {
    this.detector.reset();
    this.bus.emitEvent({ type: 'pour', pour: this.detector.state, mode: this.mode });
  }

  /** Forget the measured soil profile, e.g. the probes moved to a different container of soil. */
  clearSoilProfile(): void {
    this.profile = null;
    persist.profile.save(null);
    this.bus.emitEvent({ type: 'profile', profile: null, mode: this.mode });
  }

  async pourWater(opts: { holdMs?: number; force?: boolean; caller: PourCaller }): Promise<{
    result: PourResult; ok: boolean; reason?: string; reading?: ZoneLive; next?: string;
    guard?: PourGuardKind; softKind?: SoftGuardKind; holdMsUsed?: number; holdMsClamped?: boolean;
  }> {
    const rawHold = opts.holdMs && opts.holdMs > 0 ? Math.round(opts.holdMs) : undefined;
    const holdMs = rawHold != null ? Math.max(200, Math.min(5000, rawHold)) : undefined;
    const holdMsClamped = rawHold != null && holdMs !== rawHold;
    const zoneA = this.config.zones.find((z) => z.probe === 'A' || z.id === 'A');
    const liveA = zoneA ? this.liveOf(zoneA.id) : null;
    const boardOnline = this.actuator.connected;
    const gate = this.guards.check({ zoneA: liveA, force: !!opts.force, boardOnline });
    const log = (result: PourResult, reason?: string) => {
      const row: PourRequestLog = { t: Date.now(), caller: opts.caller, result, holdMs: holdMs ?? null, force: !!opts.force, reason };
      persist.appendJsonl('pour-log.jsonl', row);
      console.log(new Date().toLocaleTimeString(), 'pour', opts.caller, result, reason ?? '');
    };
    if (!gate.ok) {
      log(gate.result, gate.reason);
      return { result: gate.result, ok: false, reason: gate.reason, reading: gate.reading, guard: gate.guard, softKind: gate.softKind };
    }
    if (!this.hardware) {
      const reason = this.cfg.hardwareOff
        ? 'HARDWARE=off: no pour board is open. Nothing was sent.'
        : 'No pour board is connected.';
      log('offline', reason);
      return { result: 'offline', ok: false, reason, guard: 'hard' };
    }
    if (this.detector.state.phase === 'idle') this.armPour();
    const r = await this.hardware.requestPour(holdMs);
    if (r === 'started') {
      this.guards.recordAccepted();
      this.lastPour = { t: Date.now(), rawBefore: liveA?.moistureOnline ? liveA.moistureRaw : null, pctBefore: liveA?.moistureOnline ? liveA.moisturePct : null };
    }
    log(r);
    const next = r === 'started' ? 'Read zone A again in 10 to 20 seconds to confirm the water arrived. The servo has no position feedback — falling moisture at A is the only evidence.' : undefined;
    const hardReason =
      r === 'busy' ? 'The pour board is still returning from the last pour. Wait a few seconds and try again. This cannot be overridden.'
      : r === 'cooldown' ? `The pour board is in cooldown (${this.actuator.cooldownMsLeft ?? 4000} ms left). Wait, then try again. This cannot be overridden.`
      : r === 'offline' ? 'The pour board is not connected or did not answer a status ping. This cannot be overridden.'
      : r === 'no_reply' ? 'The pour board did not acknowledge the command. It may still be booting. This cannot be overridden.'
      : undefined;
    return {
      result: r,
      ok: r === 'started',
      next,
      reason: hardReason,
      guard: r === 'started' ? undefined : 'hard',
      holdMsUsed: holdMs,
      holdMsClamped,
    };
  }

  /** Did the last pour reach the zone A sensor? null when there was no pour in the last 5 minutes. */
  pourOutcome(now = Date.now()): PourOutcome | null {
    if (!this.lastPour || now - this.lastPour.t > 5 * 60_000) return null;
    const zoneA = this.config.zones.find((z) => z.probe === 'A' || z.id === 'A');
    return judgePour({ pouredAt: this.lastPour.t, now, rawBefore: this.lastPour.rawBefore, pctBefore: this.lastPour.pctBefore, live: zoneA ? this.liveOf(zoneA.id) : null });
  }

  async pourStatus(): Promise<PourActuatorStatus> {
    return this.hardware ? this.hardware.refreshStatus() : { connected: false };
  }

  recordAgentCall(tool: string, zones: ZoneId[], summary: string): AgentCall {
    const call: AgentCall = { id: ++this.callSeq, t: Date.now(), tool, zones, summary };
    this.bus.emitEvent({ type: 'agent_call', ...call, mode: this.mode });
    return call;
  }

  snapshotReadings() {
    const now = Date.now();
    const zonePayload: Record<string, unknown> = {};
    for (const z of this.config.zones) {
      const live = this.liveOf(z.id);
      const ageMs = now - live.t;
      const hist = this.history.rawWindow(z.id, 15 * 60000, now);
      // Change versus the sample closest to `ms` ago. If nothing was recorded near that
      // moment (just started, or the probe was offline) there is no trend: say null.
      const delta = (ms: number) => {
        if (live.moistureRaw == null || !live.moistureOnline) return null;
        const tolerance = Math.max(20_000, ms * 0.25);
        let best: HistoryPoint | null = null;
        for (const p of hist) {
          if (p.moistureRaw == null) continue;
          const off = Math.abs((now - p.t) - ms);
          if (off <= tolerance && (!best || off < Math.abs((now - best.t) - ms))) best = p;
        }
        return best?.moistureRaw == null ? null : live.moistureRaw - best.moistureRaw;
      };
      zonePayload[z.id] = {
        name: z.name,
        probe: z.probe,
        moisture: {
          raw_adc_counts: live.moistureOnline ? live.moistureRaw : null,
          raw_unit: '12-bit ADC counts, 16-sample average. Higher means drier soil.',
          relative_moisture_pct: live.moistureOnline && live.moisturePct != null ? Math.round(live.moisturePct * 10) / 10 : null,
          relative_moisture_note: "Percent of this probe's air-to-water range. Not volumetric water content.",
          state: moistureWord(live.moisturePct),
          online: live.moistureOnline,
          age_ms: live.moistureOnline ? ageMs : live.moistureRaw == null ? null : ageMs,
          implausible: this.implausible.get(z.id) ?? false,
          implausible_note: 'A floating unconnected analog pin reads ≈ 1100. Values outside 1500–3700 are flagged.',
          trend: {
            unit: 'raw ADC counts; negative means getting wetter',
            delta_1min: delta(60_000),
            delta_5min: delta(5 * 60_000),
            delta_15min: delta(15 * 60_000),
          },
        },
        temperature: {
          celsius: live.tempOnline ? live.tempC : null,
          unit: '°C, DS18B20 at about 5 cm depth',
          online: live.tempOnline,
          age_ms: live.tempOnline ? ageMs : null,
        },
        sampled_at: new Date(live.t).toISOString(),
        sampled_at_unix_ms: live.t,
      };
    }
    return {
      mode: this.mode,
      generated_at: new Date(now).toISOString(),
      generated_at_unix_ms: now,
      zones: zonePayload,
      pour: {
        detector: this.detector.state,
        actuator: this.hardware?.actuator() ?? { connected: false },
      },
      boards: {
        present: this.boardsList,
        missing: this.missing,
      },
      soil_profile: this.profile,
      note: 'Raw moisture is first-class. Percent is a convenience. Offline probes return null, not a held last value.',
    };
  }

  async readings() {
    return this.snapshotReadings();
  }

  connectInfo() {
    const base = this.cfg.publicBase;
    return {
      mode: this.mode,
      mcp_url: `${base}/mcp`,
      stdio_command: 'npm run mcp',
      stdio_cwd: 'backend/',
      starter_prompt: 'Diagnose this garden plot. Use the PromptGrass MCP tools: start with get_readings, then get_forecast, get_soil_profile, and score_crops. Quote the real numbers. Separate measured values from estimates. Check the rain forecast before recommending water. If you pour, re-read zone A after 10–20 seconds to confirm the water arrived.',
      tools: ['list_zones', 'read_zone', 'get_soil_profile', 'score_crops', 'get_planting_window', 'get_forecast', 'get_history', 'add_note', 'get_readings', 'pour_water', 'get_pour_status'],
      prompt: 'diagnose_field',
    };
  }

  searchPlaces = searchPlaces;
}

export { persist } from './persist.js';
