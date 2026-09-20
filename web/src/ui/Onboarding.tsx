import { useEffect, useRef, useState } from 'react';
import { brand } from '../brand';
import { CALIBRATION_DEFAULTS } from '../data/calibrationDefaults';
import { useApp } from '../data/store';
import type { FrostDates, Place, ProbeId } from '../data/types';
import { seasonText } from '../data/sim/season';
import { searchPlaces } from '../services/openMeteo';
import { fmtArea, fmtDoy, fmtLen } from './format';
import { IconArrow, IconCheck, IconPin, Logo } from './icons';

const STEPS = [
  { id: 'build', label: 'Plot' },
  { id: 'location', label: 'Location' },
  { id: 'calibrate', label: 'Probes' },
] as const;

export function Stepper() {
  const stage = useApp((s) => s.stage);
  const idx = STEPS.findIndex((s) => s.id === stage);
  if (idx < 0) return null;
  return (
    <div className="stepper">
      {STEPS.map((s, i) => (
        <button key={s.id} className={`step ${i === idx ? 'is-current' : ''} ${i < idx ? 'is-done' : ''}`} disabled={i > idx} onClick={() => useApp.getState().setStage(s.id)}>
          <span className="step-dot">{i < idx ? <IconCheck /> : i + 1}</span>
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function Welcome() {
  const setStage = useApp((s) => s.setStage);
  return (
    <div className="welcome">
      <div className="welcome-mark"><Logo size={30} /> <span>{brand.name}</span></div>
      <h1>{brand.tagline}</h1>
      <p>{brand.pitch}</p>
      <div className="welcome-actions">
        <button className="btn btn-primary btn-lg" onClick={() => setStage('build')}>Build your plot <IconArrow /></button>
      </div>
      <ul className="welcome-answers">
        <li><b>1</b> What is my soil like?</li>
        <li><b>2</b> What can I plant here?</li>
        <li><b>3</b> When should I plant it?</li>
        <li><b>4</b> Does it need water right now?</li>
      </ul>
    </div>
  );
}

const PRESETS = [
  { name: 'Demo container', width: 30, length: 15 },
  { name: 'Raised bed', width: 240, length: 120 },
  { name: 'Garden plot', width: 800, length: 500 },
];

export function BuildPanel() {
  const draft = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);
  if (!draft) return null;
  const { plot, zones } = draft;
  const dist = zones.length >= 2 ? Math.hypot(zones[0].x - zones[1].x, zones[0].y - zones[1].y) : 0;

  const resize = (width: number, length: number, name = plot.name) => {
    const w = Math.max(10, Math.min(10000, width || 10)), l = Math.max(10, Math.min(10000, length || 10));
    setDraft({ plot: { name, width: w, length: l }, zones: zones.map((z) => ({ ...z, x: (z.x / plot.width) * w, y: (z.y / plot.length) * l })) });
  };
  const next = () => { useApp.getState().commitDraft(); useApp.getState().setStage('location'); };

  return (
    <aside className="panel side-panel">
      <div className="eyebrow">Step 1</div>
      <h2>Shape your plot</h2>
      <p className="muted">Drag the glowing edges to resize. Drag probes <b>A</b> and <b>B</b> to where they sit in the soil: the distance between them is what turns a pour into a drainage rate.</p>

      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.name} className={`chip ${plot.width === p.width && plot.length === p.length ? 'is-on' : ''}`} onClick={() => resize(p.width, p.length, p.name)}>
            {p.name}<small>{fmtLen(p.width)} × {fmtLen(p.length)}</small>
          </button>
        ))}
      </div>

      <div className="field-row">
        <label>Width<div className="input-unit"><input type="number" min={10} value={Math.round(plot.width)} onChange={(e) => resize(+e.target.value, plot.length)} /><span>cm</span></div></label>
        <label>Length<div className="input-unit"><input type="number" min={10} value={Math.round(plot.length)} onChange={(e) => resize(plot.width, +e.target.value)} /><span>cm</span></div></label>
      </div>
      <label>Name<input type="text" value={plot.name} maxLength={40} onChange={(e) => setDraft({ plot: { ...plot, name: e.target.value }, zones })} /></label>

      <div className="readouts">
        <div><span>Area</span><b>{fmtArea(plot.width, plot.length)}</b></div>
        <div><span>Probes apart</span><b>{fmtLen(dist, 1)}</b></div>
        <div><span>Zones</span><b>{zones.length}</b></div>
      </div>

      <button className="btn btn-primary btn-block" onClick={next}>Looks right <IconArrow /></button>
    </aside>
  );
}

export function LocationPanel() {
  const place = useApp((s) => s.config?.place ?? null);
  const board = useApp((s) => s.board);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [frost, setFrost] = useState<FrostDates | null>(null);
  const [geoErr, setGeoErr] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => { const r = await searchPlaces(q); if (id === seq.current) setResults(r); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setFrost(null);
    if (!place) return;
    setBusy(true);
    board.frostDates().then((f) => { if (alive) { setFrost(f); setBusy(false); } });
    return () => { alive = false; };
  }, [place, board]);

  const choose = (p: Place) => { board.setPlace(p); setQ(''); setResults([]); };
  // Pasted coordinates skip the town search: "46.42, -120.33", "46.42 N 120.33 W", "46.42 -120.33"
  const coords = parseCoords(q);
  const useDemo = async () => { try { choose(await board.demoPlace()); } catch { setGeoErr('The backend did not answer. Is it running?'); } };
  const locate = () => {
    setGeoErr('');
    if (!navigator.geolocation) { setGeoErr('This browser cannot share a location.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: 'My location', lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) }),
      () => setGeoErr('Location was not shared. Search for your town instead.'),
      { timeout: 8000 },
    );
  };

  return (
    <aside className="panel side-panel">
      <div className="eyebrow">Step 2</div>
      <h2>Where is this plot?</h2>
      <p className="muted">Location gives frost dates, the growing season and the rain forecast. It is the one thing the probes cannot measure.</p>

      <div className="search">
        <IconPin />
        <input autoFocus type="text" placeholder="Search a town, or paste coordinates" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {coords && (
        <ul className="results">
          <li><button onClick={() => choose({ name: `${Math.abs(coords.lat).toFixed(3)}° ${coords.lat >= 0 ? 'N' : 'S'}, ${Math.abs(coords.lon).toFixed(3)}° ${coords.lon >= 0 ? 'E' : 'W'}`, lat: coords.lat, lon: coords.lon })}>
            <b>Use these coordinates</b><span>{coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}</span></button></li>
        </ul>
      )}
      {!coords && results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}><button onClick={() => choose(r)}><b>{r.name}</b><span>{[r.region, r.country].filter(Boolean).join(', ')}</span></button></li>
          ))}
        </ul>
      )}
      <button className="btn btn-ghost btn-block" onClick={locate}>Use my current location</button>
      <button className="btn btn-ghost btn-block" onClick={() => void useDemo()} title="A fixed point in the lower Yakima Valley, Washington. Not a real plot: its surroundings ship with the app, so the region view never waits on the network.">Use the demo coordinate (Yakima Valley)</button>
      {geoErr && <p className="error">{geoErr}</p>}

      {place && (
        <div className="card season-card">
          <div className="card-title"><IconPin /> {place.name}{place.region ? `, ${place.region}` : ''}</div>
          {busy && <div className="shimmer-line" />}
          {frost && (
            <>
              {frost.frostFree ? (
                <div className="season-big">Frost-free</div>
              ) : (
                <div className="season-grid">
                  <div><span>Last spring frost</span><b>{fmtDoy(frost.lastSpringFrostDoy)}</b></div>
                  <div><span>First fall frost</span><b>{fmtDoy(frost.firstFallFrostDoy)}</b></div>
                  <div><span>Growing season</span><b>{frost.growingSeasonDays} days</b></div>
                </div>
              )}
              <p className="muted small">{seasonText(frost)}</p>
              <p className="estimate">Estimate · {frost.label}</p>
            </>
          )}
        </div>
      )}

      <div className="row-end">
        {!place && <button className="btn btn-ghost" onClick={() => useApp.getState().setStage('calibrate')}>Skip for now</button>}
        <button className="btn btn-primary" disabled={!place} onClick={() => useApp.getState().setStage('calibrate')}>Continue <IconArrow /></button>
      </div>
    </aside>
  );
}

/** Decimal degrees, with or without hemisphere letters. Returns null for anything that is not clearly a coordinate pair. */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
}

export function CalibratePanel() {
  const config = useApp((s) => s.config);
  const live = useApp((s) => s.live);
  const board = useApp((s) => s.board);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!config) return null;

  const capture = async (probe: ProbeId, step: 'air' | 'water') => {
    setBusy(probe + step);
    setErrors((e) => ({ ...e, [probe]: '' }));
    const r = await board.calibrate(probe, step);
    if (!r.ok) setErrors((e) => ({ ...e, [probe]: r.error }));
    setBusy(null);
  };
  const allDone = config.zones.every((z) => config.calibration[z.probe].airRaw != null && config.calibration[z.probe].waterRaw != null);

  return (
    <aside className="panel side-panel">
      <div className="eyebrow">Step 3</div>
      <h2>Connect and calibrate</h2>
      <p className="muted">Your probes arrive pre-calibrated from a bench test, so you can carry straight on. Every probe reads a little differently, though: to tune one to its own scale, show it the two extremes, dry air and a cup of water.</p>

      {config.zones.map((z) => {
        const l = live[z.id], cal = config.calibration[z.probe];
        const online = l?.moistureOnline ?? false;
        const raw = online ? l?.moistureRaw ?? null : null;
        const done = cal.airRaw != null && cal.waterRaw != null;
        return (
          <div key={z.id} className={`card probe-card ${online ? 'is-online' : ''} ${done ? 'is-done' : ''}`}>
            <div className="probe-head">
              <span className="probe-badge">{z.probe}</span>
              <div>
                <b>Probe {z.probe}</b>
                <span className={`status ${online ? 'ok' : ''}`}>{online ? 'Moisture online' : 'Moisture offline'}{l?.tempOnline ? ` · ${l.tempC?.toFixed(1)} °C` : online ? ' · temperature probe offline' : ''}</span>
              </div>
              {done && <span className="probe-pct">{online && l?.moisturePct != null ? `${Math.round(l.moisturePct)}%` : ''}</span>}
            </div>
            <div className="cal-source">
              {cal.source === 'user'
                ? <><span>{done ? 'Your calibration' : 'Calibrating: capture water next'}</span><button className="link" disabled={busy != null} onClick={() => board.clearCalibration(z.probe)}>Reset to default</button></>
                : <span title={CALIBRATION_DEFAULTS[z.probe].note}>{CALIBRATION_DEFAULTS[z.probe].measured ? 'Pre-calibrated · bench default' : "Default borrowed from probe A · not measured on this probe yet"} · air {cal.airRaw} / water {cal.waterRaw}</span>}
            </div>
            <div className="rawbar" title="Raw sensor signal">
              <div className="rawbar-fill" style={{ width: raw != null ? `${Math.min(100, (raw / 4095) * 100)}%` : '0%' }} />
              {cal.airRaw != null && <i className="rawbar-mark air" style={{ left: `${(cal.airRaw / 4095) * 100}%` }} />}
              {cal.waterRaw != null && <i className="rawbar-mark water" style={{ left: `${(cal.waterRaw / 4095) * 100}%` }} />}
              <span>{raw != null ? `raw ${raw}` : '—'}</span>
            </div>
            <div className="cal-steps">
              <button className={`btn btn-step ${cal.source === 'user' && cal.airRaw != null ? 'is-done' : ''}`} disabled={!online || busy != null} onClick={() => capture(z.probe, 'air')}>
                {busy === z.probe + 'air' ? <span className="spinner" /> : cal.source === 'user' && cal.airRaw != null ? <IconCheck /> : <em>1</em>} Hold in air
              </button>
              <button className={`btn btn-step ${cal.source === 'user' && cal.waterRaw != null ? 'is-done' : ''}`} disabled={!online || busy != null || cal.source !== 'user' || cal.airRaw == null} onClick={() => capture(z.probe, 'water')}>
                {busy === z.probe + 'water' ? <span className="spinner" /> : cal.source === 'user' && cal.waterRaw != null ? <IconCheck /> : <em>2</em>} Dip in water
              </button>
            </div>
            {errors[z.probe] && <p className="error">{errors[z.probe]}</p>}
          </div>
        );
      })}
      <p className="muted small">Keep the top edge of the probe, where the electronics are, above the water line.</p>

      <div className="row-end">
        {!allDone && <button className="btn btn-ghost" onClick={() => useApp.getState().finishOnboarding()}>Skip</button>}
        <button className="btn btn-primary" disabled={!allDone} onClick={() => useApp.getState().finishOnboarding()}>Bring the field to life <IconArrow /></button>
      </div>
    </aside>
  );
}
