import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentBadge } from './AgentPresence';
import { brand } from '../brand';
import { useApp } from '../data/store';
import type { Lens, View } from '../data/store';
import { onPourPhase, pourActuatorStatus, pourWater, POUR_RESULT_TEXT } from '../services/pourBridge';
import type { PourPhase } from '../services/pourBridge';
import { fmtClock, fmtDate, fmtLen, fmtWhen } from './format';
import { RegionControl } from './Region';
import {
  IconCalendar, IconDrop, IconEdit, IconEye, IconField, IconHistory, IconNetwork, IconPause, IconPin, IconPlay, IconPour,
  IconScan, IconSoil, IconSpark, IconSprout, IconThermo, Logo,
} from './icons';

// ------------------------------------------------------------------ top bar
export function TopBar() {
  const config = useApp((s) => s.config);
  const live = useApp((s) => s.live);
  const backendOnline = useApp((s) => s.backendOnline);
  const stage = useApp((s) => s.stage);
  const overrides = useApp((s) => s.overrides);
  const zones = config?.zones ?? [];
  const online = zones.reduce((n, z) => n + Number(!!live[z.id]?.moistureOnline) + Number(!!live[z.id]?.tempOnline), 0);
  const overriding = overrides.forecast != null || Object.values(overrides.zoneMoisture).some((v) => v != null);
  return (
    <header className="topbar">
      <div className="brandmark" onDoubleClick={() => useApp.getState().toggleDemo()}>
        <Logo /> <span>{brand.name}</span>
        {stage === 'live' && config && <em>{config.plot.name}</em>}
        {overriding && <i className="override-dot" title="Demo override active" />}
      </div>
      <div className="pills">
        {!backendOnline && <span className="pill pill-warn" title="Start it with: cd backend && npm start"><i className="dot" />Backend offline</span>}
        {stage !== 'welcome' && <span className={`pill ${online === zones.length * 2 && online > 0 ? 'pill-ok' : 'pill-warn'}`}><i className="dot" />{online}/{zones.length * 2} sensors online</span>}
        {stage === 'live' && config?.place && <button className="pill pill-btn" title="Change location" onClick={() => useApp.getState().setStage('location')}><IconPin />{config.place.name}</button>}
        {stage === 'live' && <AgentBadge />}
      </div>
    </header>
  );
}

// --------------------------------------------------------------------- rail
const VIEWS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'field', label: 'Field', icon: <IconField /> },
  { id: 'pour', label: 'Pour test', icon: <IconPour /> },
  { id: 'history', label: 'History', icon: <IconHistory /> },
  { id: 'network', label: 'Network', icon: <IconNetwork /> },
];
const LENSES: { id: Lens; label: string; icon: React.ReactNode }[] = [
  { id: 'natural', label: 'Natural', icon: <IconEye /> },
  { id: 'moisture', label: 'Moisture', icon: <IconDrop /> },
  { id: 'temperature', label: 'Temperature', icon: <IconThermo /> },
];

export function Rail() {
  const view = useApp((s) => s.view);
  const lens = useApp((s) => s.lens);
  const regionOn = useApp((s) => s.regionOn);
  return (
    <nav className="rail" aria-label="Plot controls">
      <div className="rail-group" role="group" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v.id} aria-pressed={view === v.id && !(regionOn && v.id === 'field')} className={`rail-btn ${view === v.id && !(regionOn && v.id === 'field') ? 'is-on' : ''}`} onClick={() => useApp.getState().setView(v.id)}>
            {v.icon}<span>{v.label}</span>
          </button>
        ))}
        <button className="rail-btn" onClick={() => useApp.getState().setStage('build')}><IconEdit /><span>Edit plot</span></button>
      </div>
      <RegionControl />
      <div className="rail-group rail-lens" role="group" aria-label="Soil lenses">
        {LENSES.map((l) => (
          <button key={l.id} aria-pressed={lens === l.id} className={`rail-btn rail-btn-sm ${lens === l.id ? 'is-on' : ''}`} onClick={() => useApp.getState().setLens(l.id)} title={`${l.label} view`}>
            {l.icon}<span>{l.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ------------------------------------------------------------- four answers
function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  const tone = score >= 80 ? 'var(--accent)' : score >= 60 ? '#d9e86a' : score >= 40 ? 'var(--warm)' : 'var(--danger)';
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.1)" strokeWidth="3.500" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth="3.500" fill="none" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle">{score}</text>
    </svg>
  );
}
export { ScoreRing };

export function AnswersBar() {
  const config = useApp((s) => s.config);
  const selected = useApp((s) => s.selectedZone);
  const drawer = useApp((s) => s.drawer);
  const a = useApp((s) => s.answers);
  const profile = useApp((s) => s.profile);
  const selectedCrop = useApp((s) => s.selectedCrop);
  const { openDrawer, selectZone, setView, runDiagnose } = useApp.getState();
  if (!config) return null;

  const top = a.crops[0];
  const crop = a.crops.find((c) => c.id === selectedCrop) ?? top;
  const w = a.window;
  const water = a.reading?.water;
  const pct = a.reading?.live.moistureOnline ? a.reading.live.moisturePct : null;
  const whenHead = !config.place ? 'Set location' : !w ? '…' : w.status === 'open' ? 'Plant now' : w.status === 'year_round' ? 'Any time' : w.nextOpen ? `From ${fmtDate(w.nextOpen)}` : 'Closed';
  const waterTone = water?.action === 'water' ? 'bad' : water?.action === 'wait_for_rain' ? 'warn' : water?.action === 'none' ? 'good' : '';

  return (
    <div className="answers-wrap">
      <div className="zone-switch">
        {config.zones.map((z) => (
          <button key={z.id} className={selected === z.id ? 'is-on' : ''} onClick={() => selectZone(z.id)}>{z.name}</button>
        ))}
      </div>
      <div className="answers">
        <button className={`answer ${drawer === 'soil' ? 'is-on' : ''}`} onClick={() => (profile ? openDrawer('soil') : setView('pour'))}>
          <span className="answer-q"><IconSoil /> What is my soil like?</span>
          <b className="answer-a">{profile ? profile.label.split(',')[0] : 'Not measured yet'}</b>
          <span className="answer-sub">{profile ? `Est. ${profile.texture} · ${profile.rateCmMin.toFixed(1)} cm/min` : 'Run the pour test →'}</span>
        </button>
        <button className={`answer ${drawer === 'plant' ? 'is-on' : ''}`} onClick={() => openDrawer('plant')}>
          <span className="answer-q"><IconSprout /> What can I plant?</span>
          <div className="answer-row">
            {top && <ScoreRing score={top.score} />}
            <div>
              <b className="answer-a">{top ? top.name : '…'}</b>
              <span className="answer-sub">{top?.unknowns.includes('drainage') ? 'Provisional · drainage not measured' : a.crops.slice(1, 3).map((c) => `${c.name} ${c.score}`).join(' · ')}</span>
            </div>
          </div>
        </button>
        <button className={`answer ${drawer === 'when' ? 'is-on' : ''}`} onClick={() => openDrawer('when')}>
          <span className="answer-q"><IconCalendar /> When should I plant?</span>
          <b className={`answer-a ${w?.status === 'open' || w?.status === 'year_round' ? 'tone-good' : ''}`}>{whenHead}</b>
          <span className="answer-sub">{crop ? crop.name : ''}{w && w.soilWarmEnough != null ? (w.soilWarmEnough ? ' · soil warm enough' : ' · soil too cold') : ''}</span>
        </button>
        <button className={`answer ${drawer === 'water' ? 'is-on' : ''}`} onClick={() => openDrawer('water')}>
          <span className="answer-q"><IconDrop /> Does it need water?</span>
          <b className={`answer-a tone-${waterTone}`}>{water?.headline ?? '…'}</b>
          <span className="answer-sub">
            <span className="meter"><i style={{ width: `${pct ?? 0}%` }} /></span>
            {pct != null ? `${Math.round(pct)}% relative` : 'no reading'}
          </span>
        </button>
        <button className={`diagnose ${drawer === 'diagnose' ? 'is-on' : ''}`} onClick={() => void runDiagnose()}>
          <IconScan /><span>Diagnose</span>
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------- servo pour
/**
 * One click: the real bottle tips, pours and returns, through the backend's pour routes
 * (services/pourBridge.ts). Agents pour through the backend's guarded `pour_water` tool instead.
 *
 * The click also arms the pour test, so the backend times the real water from zone A to
 * zone B off the real probes.
 */
function ServoPour() {
  const board = useApp((s) => s.board);
  const pourState = useApp((s) => s.pour.phase);
  const [online, setOnline] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<PourPhase | 'idle'>('idle');
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    const check = () => pourActuatorStatus().then((st) => { if (alive) setOnline(st.connected); });
    void check();
    const id = setInterval(check, 5000);
    const off = onPourPhase((p) => {
      setPhase(p === 'done' ? 'idle' : p);
      if (p === 'done') setNote('');
    });
    return () => { alive = false; clearInterval(id); off(); };
  }, []);

  const click = async () => {
    setNote('');
    if (pourState === 'idle') board.armPour();
    const r = await pourWater();
    if (r !== 'started') setNote(POUR_RESULT_TEXT[r]);
    if (r === 'offline') setOnline(false);
  };
  const busy = phase !== 'idle';
  return (
    <div className="servo-pour">
      <span className={`servo-dot ${online ? 'is-on' : ''}`} title={online ? 'Servo bridge connected' : 'Servo bridge offline'} />
      <button className="btn btn-water" disabled={busy || online === false} onClick={() => void click()}>
        <IconDrop /> {busy ? (phase === 'tipping' ? 'Tipping…' : phase === 'holding' ? 'Pouring…' : 'Returning…') : 'Pour water'}
      </button>
      <span className="servo-note">{note || (online === false ? 'pour board offline' : online ? 'servo ready' : '')}</span>
    </div>
  );
}

// --------------------------------------------------------------- pour panel
export function PourPanel() {
  const pour = useApp((s) => s.pour);
  const config = useApp((s) => s.config);
  const profile = useApp((s) => s.profile);
  const board = useApp((s) => s.board);
  const live = useApp((s) => s.live);
  const [, force] = useState(0);

  useEffect(() => {
    if (pour.phase !== 'running') return;
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [pour.phase]);

  if (!config) return null;
  const zones = config.zones;
  const dist = zones.length >= 2 ? Math.hypot(zones[0].x - zones[1].x, zones[0].y - zones[1].y) : 0;
  const calibrated = zones.every((z) => config.calibration[z.probe].airRaw != null && config.calibration[z.probe].waterRaw != null);
  const elapsed = pour.t0 ? (pour.t1 ?? Date.now()) - pour.t0 : 0;
  const other = zones.find((z) => z.id !== pour.source);

  return (
    <div className="pour panel">
      {(pour.phase === 'idle' || pour.phase === 'armed') && (
        <div className="pour-idle">
          <div>
            <div className="eyebrow">Pour test</div>
            <h3>{pour.phase === 'armed' ? 'Ready. Pour one cup, slowly, at a probe.' : 'Measure how this soil drains'}</h3>
            <p className="muted">
              {pour.phase === 'armed'
                ? 'Watching both probes. The clock starts the moment water reaches the first one.'
                : `Pour a cup of water at one probe. The app times the water to the other, ${fmtLen(dist, 1)} away, and turns that into a drainage rate.`}
            </p>
            {!calibrated && <p className="error">Calibrate both probes first: the pour is detected from calibrated moisture.</p>}
          </div>
          <div className="pour-actions">
            {pour.phase === 'idle'
              ? <button className="btn btn-primary btn-lg" disabled={!calibrated} onClick={() => board.armPour()}>Start pour test</button>
              : <><span className="listening"><i /><i /><i /> Listening</span><button className="btn btn-ghost" onClick={() => board.resetPour()}>Cancel</button></>}
            <ServoPour />
          </div>
        </div>
      )}

      {pour.phase === 'running' && (
        <div className="pour-run">
          <div className="pour-clock">
            <span className="eyebrow">Water reached {pour.source} · travelling to {other?.id}</span>
            <div className="clock">{fmtClock(elapsed)}</div>
          </div>
          <div className="pour-track">
            <div className="pour-track-ends"><b>{pour.source}</b><span>{fmtLen(dist, 1)}</span><b>{other?.id}</b></div>
            <div className="pour-track-bar"><i /></div>
            <p className="estimate">Front position between the probes is an estimate. The result is set only when probe {other?.id} responds
              {other && live[other.id]?.moisturePct != null ? ` (now ${Math.round(live[other.id].moisturePct!)}%)` : ''}.</p>
          </div>
          <button className="btn btn-ghost" onClick={() => board.resetPour()}>Cancel</button>
        </div>
      )}

      {pour.phase === 'done' && pour.rateCmMin != null && (
        <div className="pour-done">
          <div className="pour-result">
            <span className="eyebrow">Water reached {pour.target} in {(elapsed / 1000).toFixed(1)} s</span>
            <div className="rate"><b>{pour.rateCmMin.toFixed(1)}</b><span>cm / min</span></div>
            <span className="muted small">{fmtLen(pour.distanceCm ?? 0, 1)} ÷ {(elapsed / 1000).toFixed(1)} s</span>
          </div>
          <div className="pour-label">
            <h3>{pour.label}</h3>
            <p className="estimate">Drainage is measured. Texture is inferred from it: an estimate.</p>
            <div className="row">
              <button className="btn btn-primary" onClick={() => { useApp.getState().setView('field'); useApp.getState().openDrawer('plant'); }}>See what grows here</button>
              <button className="btn btn-ghost" onClick={() => board.resetPour()}>Measure again</button>
            </div>
          </div>
        </div>
      )}

      {pour.phase === 'timeout' && (
        <div className="pour-idle">
          <div><h3>No arrival after 30 minutes</h3><p className="muted">Water has not reached probe {other?.id}. That itself says very slow drainage, below {(dist / 30).toFixed(2)} cm/min, but no rate was measured.</p></div>
          <button className="btn btn-ghost" onClick={() => board.resetPour()}>Reset</button>
        </div>
      )}
      {profile && pour.phase !== 'done' && (
        <p className="pour-prev">
          Saved result: {profile.label} ({profile.rateCmMin.toFixed(1)} cm/min, measured {new Date(profile.measuredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}).
          {' '}It stays in use for planting advice until a new test finishes.
          {pour.phase === 'idle' && <button className="link-btn" onClick={() => { if (window.confirm('Forget the saved drainage result? Planting advice will go back to "drainage not measured" until you run a new pour test.')) board.clearSoilProfile(); }}>Forget it (new soil)</button>}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ history scrub
export function HistoryBar() {
  const replay = useApp((s) => s.replay);
  const config = useApp((s) => s.config);
  const setReplay = useApp((s) => s.setReplay);
  const raf = useRef(0);

  const ids = config?.zones.map((z) => z.id) ?? [];
  const range = useMemo(() => {
    const all = ids.flatMap((id) => replay.series[id]?.points ?? []);
    if (!all.length) return null;
    return { t0: Math.min(...all.map((p) => p.t)), t1: Math.max(...all.map((p) => p.t)) };
  }, [replay.series]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!replay.playing || !range) return;
    let last = performance.now();
    const step = (now: number) => {
      const s = useApp.getState().replay;
      const t = s.t + ((now - last) / 1000) * ((range.t1 - range.t0) / 45); // whole span in ~45 s
      last = now;
      if (t >= range.t1) { setReplay({ t: range.t1, playing: false }); return; }
      setReplay({ t });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [replay.playing, range, setReplay]);

  if (!range) return <div className="history panel history-empty"><div><div className="eyebrow">Reading history</div><h3>No readings to replay yet</h3></div><p className="muted">Readings appear here as connected probes report. Choose Field to return to the plot.</p><button className="btn btn-ghost" onClick={() => useApp.getState().setView('field')}>Back to field</button></div>;
  const W = 1000, H = 84;
  const x = (t: number) => ((t - range.t0) / Math.max(1, range.t1 - range.t0)) * W;
  const path = (id: string, key: 'moisturePct' | 'tempC', lo: number, hi: number) =>
    (replay.series[id]?.points ?? []).filter((p) => p[key] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${(H - ((p[key]! - lo) / (hi - lo)) * H).toFixed(1)}`).join('');
  const simulated = ids.some((id) => replay.series[id]?.simulated);
  const nights: { a: number; b: number }[] = [];
  for (let d = new Date(range.t0); d.getTime() < range.t1 + 86400000; d = new Date(d.getTime() + 86400000)) {
    const dusk = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 19).getTime(), dawn = dusk + 11 * 3600000;
    nights.push({ a: Math.max(range.t0, dusk), b: Math.min(range.t1, dawn) });
  }

  return (
    <div className="history panel">
      <div className="history-head">
        <button className="btn btn-icon" onClick={() => setReplay(replay.playing ? { playing: false } : { active: true, playing: true, t: replay.active && replay.t < range.t1 - 1000 ? replay.t : range.t0 })}>
          {replay.playing ? <IconPause /> : <IconPlay />}
        </button>
        <div className="history-time">
          <b>{replay.active ? fmtWhen(replay.t) : 'Live'}</b>
          <span>{replay.active ? 'Replaying recorded readings' : 'Drag to replay what the probes recorded'}</span>
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--water)' }} />Moisture A</span>
          <span><i style={{ background: 'var(--cool)' }} />Moisture B</span>
          <span><i style={{ background: 'var(--warm)' }} />Soil temp</span>
          {simulated && <span className="sim-tag">Simulated history</span>}
        </div>
        <button className={`btn ${replay.active ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setReplay({ active: false, playing: false, t: Date.now() })}><i className="dot live" />Back to live</button>
      </div>
      <div className="history-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {nights.filter((n) => n.b > n.a).map((n, i) => <rect key={i} x={x(n.a)} y={0} width={x(n.b) - x(n.a)} height={H} fill="rgba(120,150,255,.07)" />)}
          <path d={path(ids[0], 'tempC', 5, 30)} stroke="var(--warm)" strokeWidth="1.500" fill="none" opacity=".75" vectorEffect="non-scaling-stroke" />
          {ids[1] && <path d={path(ids[1], 'moisturePct', 0, 100)} stroke="var(--cool)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />}
          <path d={path(ids[0], 'moisturePct', 0, 100)} stroke="var(--water)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        {replay.active && <i className="playhead" style={{ left: `${(x(replay.t) / W) * 100}%` }} />}
        <input type="range" min={range.t0} max={range.t1} step={60000} value={replay.active ? replay.t : range.t1}
          onChange={(e) => setReplay({ active: true, playing: false, t: +e.target.value })} aria-label="Replay time" />
      </div>
    </div>
  );
}
