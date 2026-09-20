import { useEffect, useState } from 'react';
import { CROPS } from '../data/sim/crops';
import { seasonText } from '../data/sim/season';
import { useApp } from '../data/store';
import type { CropScore, Sun } from '../data/types';
import { fmtDate, fmtDoy, fmtLen, fmtWhen } from './format';
import { IconCheck, IconClose } from './icons';
import { useExitValue } from './useExitValue';
import { ScoreRing } from './Live';

const TITLES = { soil: 'What is my soil like?', plant: 'What can I plant here?', when: 'When should I plant it?', water: 'Does it need water?', diagnose: 'Diagnosis' } as const;

export function Drawer() {
  const requested = useApp((s) => s.drawer);
  const { shown: drawer, exiting } = useExitValue(requested);
  const zone = useApp((s) => s.config?.zones.find((z) => z.id === s.selectedZone));
  if (!drawer || !zone) return null;
  return (
    <aside className={`panel drawer ${exiting ? 'is-exiting' : ''}`} inert={exiting}>
      <header className="drawer-head">
        <div><div className="eyebrow">{zone.name}</div><h2>{TITLES[drawer]}</h2></div>
        <button className="btn btn-icon" onClick={() => useApp.getState().openDrawer(null)} aria-label="Close"><IconClose /></button>
      </header>
      <div className="drawer-body" key={drawer}>
        {drawer === 'soil' && <SoilDrawer />}
        {drawer === 'plant' && <PlantDrawer />}
        {drawer === 'when' && <WhenDrawer />}
        {drawer === 'water' && <WaterDrawer />}
        {drawer === 'diagnose' && <DiagnoseDrawer />}
      </div>
    </aside>
  );
}

function SoilDrawer() {
  const profile = useApp((s) => s.profile);
  const zone = useApp((s) => s.config!.zones.find((z) => z.id === s.selectedZone)!);
  const live = useApp((s) => s.live[s.selectedZone]);
  const board = useApp((s) => s.board);
  const notes = useApp((s) => s.notes);
  const [note, setNote] = useState('');
  return (
    <>
      {profile ? (
        <div className="card hero-card">
          <h3>{profile.label}</h3>
          <div className="stat-row">
            <div><span>Speed</span><b>{profile.rateCmMin.toFixed(1)}<small> cm/min</small></b></div>
            <div><span>Distance</span><b>{fmtLen(profile.distanceCm, 1)}</b></div>
            <div><span>Time</span><b>{profile.seconds.toFixed(1)}<small> s</small></b></div>
          </div>
          <p className="muted small">Measured between probes {profile.between[0]} and {profile.between[1]}, {fmtWhen(profile.measuredAt)}.</p>
          <p className="estimate">Drainage is measured. "{profile.texture}" is inferred from the speed: an estimate, not a lab texture test.</p>
        </div>
      ) : (
        <div className="card"><h3>Drainage not measured yet</h3><p className="muted">One cup of water and about a minute.</p>
          <button className="btn btn-primary" onClick={() => useApp.getState().setView('pour')}>Run the pour test</button></div>
      )}
      <div className="card">
        <div className="kv"><span>Soil temperature</span><b>{live?.tempOnline && live.tempC != null ? `${live.tempC.toFixed(1)} °C` : 'probe offline'}</b></div>
        <div className="kv"><span>Relative moisture</span><b>{live?.moistureOnline && live.moisturePct != null ? `${Math.round(live.moisturePct)}%` : live?.moistureOnline ? 'not calibrated' : 'probe offline'}</b></div>
      </div>
      <div className="card">
        <div className="card-title">What the probes cannot see</div>
        <label>Sun on this zone
          <div className="segmented">
            {(['full', 'partial', 'shade'] as Sun[]).map((s) => <button key={s} className={zone.sun === s ? 'is-on' : ''} onClick={() => board.updateZone(zone.id, { sun: s })}>{s === 'full' ? 'Full sun' : s === 'partial' ? 'Partial' : 'Shade'}</button>)}
          </div>
        </label>
        <label>Soil pH, if you know it
          <input type="number" step="0.1" min={3} max={10} placeholder="Not measured" value={zone.ph ?? ''} onChange={(e) => board.updateZone(zone.id, { ph: e.target.value === '' ? null : Math.max(3, Math.min(10, +e.target.value)) })} />
        </label>
        <p className="muted small">pH, salinity and nutrients change over months and need a lab-style test, so the probes do not measure them.</p>
      </div>
      <div className="card">
        <div className="card-title">Logbook</div>
        <form className="note-form" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { void board.addNote(note.trim(), zone.id, 'user'); setNote(''); } }}>
          <input type="text" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-ghost" type="submit">Add</button>
        </form>
        <ul className="notes">
          {notes.slice(0, 6).map((n) => <li key={n.id} className={n.author === 'agent' ? 'by-agent' : ''}><span>{n.author === 'agent' ? 'Agent' : 'You'}{n.zoneId ? ` · ${n.zoneId}` : ''} · {fmtWhen(n.t)}</span>{n.text}</li>)}
          {!notes.length && <li className="muted small">Nothing yet. The agent can write here too.</li>}
        </ul>
      </div>
    </>
  );
}

function PlantDrawer() {
  const crops = useApp((s) => s.answers.crops);
  const selectedCrop = useApp((s) => s.selectedCrop);
  const win = useApp((s) => s.answers.window);
  const [showAll, setShowAll] = useState(false);
  const unknowns = crops[0]?.unknowns ?? [];
  const list = showAll ? crops : crops.slice(0, 8);
  return (
    <>
      {unknowns.length > 0 && (
        <p className="notice">Scored without: {unknowns.map((u) => ({ drainage: 'drainage (run a pour test)', soil_temp: 'soil temperature', season: 'season (set a location)', sun: 'sun', ph: 'pH (optional)' }[u] ?? u)).join(', ')}.</p>
      )}
      {!crops.length && <div className="card"><h3>Waiting for crop scores</h3><p className="muted">Recommendations appear when the backend has assessed this zone.</p></div>}
      <ul className="crops">
        {list.map((c, i) => <CropRow key={c.id} crop={c} open={selectedCrop === c.id} rank={i} windowText={selectedCrop === c.id ? win?.text ?? null : null} />)}
      </ul>
      {!showAll && crops.length > 8 && <button className="btn btn-ghost btn-block" onClick={() => setShowAll(true)}>Show all {crops.length} crops</button>}
      <p className="muted small">Scores come from a fixed rules table checked against your readings. Same readings, same scores, every time.</p>
    </>
  );
}

function CropRow({ crop, open, rank, windowText }: { crop: CropScore; open: boolean; rank: number; windowText: string | null }) {
  return (
    <li className={`crop verdict-${crop.verdict} ${open ? 'is-open' : ''}`} style={{ animationDelay: `${rank * 40}ms` }}>
      <button className="crop-head" aria-expanded={open} onClick={() => useApp.getState().selectCrop(open ? null : crop.id)}>
        <ScoreRing score={crop.score} size={40} />
        <div className="crop-main">
          <b>{crop.name}{crop.plantableNow && <em className="ready"><IconCheck /> ready to plant</em>}</b>
          <span>{crop.summary}</span>
        </div>
        <span className="crop-expand" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="crop-detail">
          {crop.factors.map((f) => (
            <div key={f.key} className={`factor ${f.known ? '' : 'is-unknown'}`}>
              <div className="factor-top"><span>{f.label}</span><b>{f.score ?? '–'}</b></div>
              <div className="bar"><i style={{ width: `${f.score ?? 0}%` }} /></div>
              <p>{f.reason}</p>
            </div>
          ))}
          {windowText && <p className="window-text">{windowText}</p>}
          <button className="btn btn-ghost btn-block" onClick={() => useApp.getState().openDrawer('when')}>See the planting calendar</button>
        </div>
      )}
    </li>
  );
}

function WhenDrawer() {
  const a = useApp((s) => s.answers);
  const place = useApp((s) => s.config?.place);
  const selectedCrop = useApp((s) => s.selectedCrop);
  const cropId = selectedCrop ?? a.crops[0]?.id ?? '';
  if (!place) {
    return <div className="card"><h3>Location needed</h3><p className="muted">Planting windows come from local frost dates.</p><button className="btn btn-primary" onClick={() => useApp.getState().setStage('location')}>Set location</button></div>;
  }
  const w = a.window, frost = a.frost;
  const year = new Date().getFullYear();
  const pos = (iso: string) => { const d = new Date(iso + 'T12:00'); return ((d.getTime() - new Date(year, 0, 1).getTime()) / (365 * 86400000)) * 100; };
  const today = pos(new Date().toISOString().slice(0, 10));
  return (
    <>
      <label>Crop
        <select value={cropId} onChange={(e) => useApp.getState().selectCrop(e.target.value)}>
          {CROPS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {w && (
        <div className="card hero-card">
          <h3 className={w.status === 'open' || w.status === 'year_round' ? 'tone-good' : ''}>
            {w.status === 'open' ? 'Plant now' : w.status === 'year_round' ? 'Any time of year' : w.status === 'upcoming' && w.nextOpen ? `Opens ${fmtDate(w.nextOpen)}` : 'Closed for this season'}
          </h3>
          <div className="calendar">
            <div className="calendar-track">
              {w.windows.map((x, i) => {
                const l = Math.max(0, pos(x.start)), r = Math.min(100, pos(x.end));
                return r > l ? <i key={i} className={`win win-${x.kind}`} style={{ left: `${l}%`, width: `${r - l}%` }} title={`${fmtDate(x.start)} – ${fmtDate(x.end)}`} /> : null;
              })}
              {frost && !frost.frostFree && <>
                <i className="frost" style={{ left: `${((frost.lastSpringFrostDoy ?? 0) / 365) * 100}%` }} title="Average last spring frost" />
                <i className="frost" style={{ left: `${((frost.firstFallFrostDoy ?? 0) / 365) * 100}%` }} title="Average first fall frost" />
              </>}
              <i className="today" style={{ left: `${today}%` }} />
            </div>
            <div className="calendar-months">{'JFMAMJJASOND'.split('').map((m, i) => <span key={i}>{m}</span>)}</div>
          </div>
          {w.windows.map((x, i) => <div className="kv" key={i}><span>{x.kind === 'spring' ? 'Spring' : 'Fall'} window · {x.method}</span><b>{fmtDate(x.start)} – {fmtDate(x.end)}</b></div>)}
          <div className="kv"><span>Soil today</span>
            <b className={w.soilWarmEnough ? 'tone-good' : w.soilWarmEnough === false ? 'tone-bad' : ''}>
              {w.soilTempC != null ? `${w.soilTempC.toFixed(1)} °C` : 'unknown'} <small>needs {w.soilTempMinC} °C</small>
            </b>
          </div>
        </div>
      )}
      {frost && (
        <div className="card">
          <div className="card-title">{place.name}</div>
          {!frost.frostFree && <div className="season-grid">
            <div><span>Last spring frost</span><b>{fmtDoy(frost.lastSpringFrostDoy)}</b></div>
            <div><span>First fall frost</span><b>{fmtDoy(frost.firstFallFrostDoy)}</b></div>
            <div><span>Season</span><b>{frost.growingSeasonDays} d</b></div>
          </div>}
          <p className="muted small">{seasonText(frost)}</p>
          <p className="estimate">Estimate · {frost.label}</p>
        </div>
      )}
    </>
  );
}

function WaterDrawer() {
  const a = useApp((s) => s.answers);
  const water = a.reading?.water, f = a.forecast, pct = a.reading?.live.moistureOnline ? a.reading.live.moisturePct : null;
  const maxMm = Math.max(10, ...(f?.days.map((d) => d.precipMm) ?? [0]));
  return (
    <>
      {water && (
        <div className={`card hero-card tone-border-${water.action}`}>
          <h3>{water.headline}</h3>
          <div className="gauge"><i style={{ width: `${pct ?? 0}%` }} /><span style={{ left: '30%' }} /><b style={{ left: `${pct ?? 0}%` }}>{pct != null ? `${Math.round(pct)}%` : ''}</b></div>
          <ul className="reasons">{water.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="estimate">Relative moisture: percent of this probe's air-to-water range, not volumetric water content.</p>
        </div>
      )}
      {f && (
        <div className="card">
          <div className="card-title">Next 7 days {f.source === 'override' ? '' : f.sample ? '· sample data (offline)' : '· Open-Meteo'}</div>
          <div className="forecast">
            {f.days.map((d) => (
              <div key={d.date} className="fday">
                <span className="fday-prob">{d.precipProb != null ? `${d.precipProb}%` : ''}</span>
                <div className="fday-bar"><i style={{ height: `${Math.min(100, (d.precipMm / maxMm) * 100)}%` }} /></div>
                <b>{d.precipMm >= 0.1 ? d.precipMm.toFixed(d.precipMm < 10 ? 1 : 0) : '0'}</b>
                <span>{new Date(d.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
          <p className="muted small">{f.text} Rain in mm per day.</p>
        </div>
      )}
    </>
  );
}

function DiagnoseDrawer() {
  const d = useApp((s) => s.diagnosis);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (!d) return;
    const id = setInterval(() => setShown((n) => Math.min(d.findings.length, n + 1)), 420);
    return () => clearInterval(id);
  }, [d]);
  if (!d) return <div className="scanning"><span className="spinner" /> Reading the probes…</div>;
  return (
    <ul className="findings">
      {d.findings.slice(0, shown).map((f) => (
        <li key={f.key} className={`finding status-${f.status}`}>
          <i className="finding-dot" />
          <div><b>{f.headline}</b><p>{f.reason}</p></div>
        </li>
      ))}
    </ul>
  );
}
