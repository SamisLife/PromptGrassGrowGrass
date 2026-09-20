/**
 * The region: the same field view with the camera pulled up, NOT a page of its own.
 * These are the few pieces of UI that sit over the land while it is zoomed out.
 *
 * Everything shown is a lookup (USDA cropland map, USDA soil survey), a measurement (this
 * plot's pour test) or a calculation (the crop rules run on both soils). The farm names and
 * people are illustrative and say so: the cropland map knows crops, not owners.
 */
import { useEffect, useState } from 'react';
import { useExitValue } from './useExitValue';
import { useApp } from '../data/store';
import type { FarmMatch, RegionField } from '../data/types';
import { IconArrow, IconClose, IconHome, IconMail, IconPin, IconRegion, IconSpark } from './icons';

const names = (xs: { name: string }[], n = 3) => xs.slice(0, n).map((x) => x.name.toLowerCase().replace(' (cover crop)', '')).join(', ');

/** The zoom control. It lives with the navigation but it is a camera move, not a tab. */
export function RegionControl() {
  const on = useApp((s) => s.regionOn);
  const has = useApp((s) => !!s.regionData);
  return (
    <div className="rail-group rail-zoom" role="group" aria-label="Camera zoom" title="Scroll out from the plot to get here, scroll in to come home">
      <button aria-pressed={on} className={`rail-btn rail-btn-sm ${on ? 'is-on' : ''}`} disabled={!has} onClick={() => useApp.getState().goRegion(true)}><IconRegion /><span>Region</span></button>
      <button aria-pressed={!on} className={`rail-btn rail-btn-sm ${!on ? 'is-on' : ''}`} onClick={() => useApp.getState().goRegion(false)}><IconHome /><span>Plot</span></button>
    </div>
  );
}

export function RegionOverlay() {
  const on = useApp((s) => s.regionOn);
  const view = useApp((s) => s.view);
  const { shown, exiting } = useExitValue(on && view === 'field' ? true : null);
  if (!shown) return null;
  return (<div className={`region-overlay ${exiting ? 'is-exiting' : ''}`} inert={exiting}><MatchRail /><FarmCard /><Legend /><ContactDraft /></div>);
}

// ------------------------------------------------------------ best matches nearby
function MatchRail() {
  const data = useApp((s) => s.regionData);
  const place = useApp((s) => s.config?.place ?? null);
  const selected = useApp((s) => s.selectedFarm);
  const drawer = useApp((s) => s.drawer);
  const { selectFarm, setView, setStage, goRegion } = useApp.getState();
  const region = data?.region ?? null;

  return (
    <aside className={`panel region-rail ${drawer ? 'is-covered' : ''}`} inert={!!drawer}>
      <header className="drawer-head">
        <div>
          <div className="eyebrow">Around this plot</div>
          <h2>Best matches nearby</h2>
        </div>
        <button className="btn btn-icon" onClick={() => goRegion(false)} aria-label="Back to the plot"><IconClose /></button>
      </header>
      <div className="drawer-body">
        {place && <p className="muted small region-where"><IconPin /> {place.name}{region ? ` · ${region.halfKm * 2} km across · cropland map ${region.year}` : ''}</p>}

        {(!data || data.status === 'loading') && <div className="card"><div className="shimmer-line" /><p className="muted small">Fetching the USDA cropland map and soil survey for this place. It is stored after the first time.</p></div>}
        {data?.status === 'no_place' && (
          <div className="card"><p className="muted">The land around a plot comes from its location. Set one and the region loads by itself.</p>
            <button className="btn btn-primary" onClick={() => setStage('location')}>Set location <IconArrow /></button></div>
        )}
        {data?.status === 'unavailable' && <div className="card"><p className="muted">{data.reason}</p><button className="btn btn-ghost" onClick={() => setStage('location')}>Change location</button></div>}
        {data?.status === 'ready' && !data.you.measured && (
          <div className="card"><p className="muted">The land you see is real. Finding who complements you needs one thing from this plot: how its soil drains.</p>
            <button className="btn btn-primary" onClick={() => setView('pour')}>Run the pour test <IconArrow /></button></div>
        )}

        {data?.status === 'ready' && data.you.measured && data.matches.length === 0 && <p className="muted">No nearby field has soil different enough from yours to complement it.</p>}
        {data?.matches.map((m) => (
          <button key={m.fieldId} className={`match ${selected === m.fieldId ? 'is-on' : ''}`} onClick={() => selectFarm(m.fieldId)}
            onMouseEnter={() => useApp.setState({ hoverFarm: m.fieldId })} onMouseLeave={() => useApp.setState({ hoverFarm: null })}>
            <i className="match-rank">{m.rank}</i>
            <span className="match-main">
              <b>{m.identity.farm}</b><small className="illustrative">Illustrative farm</small>
              <span>{m.theyGrow.join(', ')}</span>
            </span>
            <span className="match-side">
              <b>{m.distanceKm} km {m.bearing}</b>
              <span className="match-bar" title={`Complement score ${m.score} of 100`}><i style={{ width: `${m.score}%` }} /></span>
            </span>
          </button>
        ))}

        {!!data?.unserved.length && data.matches.length > 0 && (
          <p className="estimate">Your soil also suits {names(data.unserved, 4)}, and the cropland map shows nobody growing them within {region?.halfKm} km.</p>
        )}
        {data?.status === 'ready' && data.matches.length > 0 && (
          <p className="muted small">Ranked by how much each soil adds to the other, nearer first. Farm names and people are illustrative: the cropland map knows crops, not owners.</p>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------ the card: three lines, no more
function FarmCard() {
  const data = useApp((s) => s.regionData);
  const requested = useApp((s) => s.selectedFarm);
  const drawer = useApp((s) => s.drawer);
  const { shown: id, exiting } = useExitValue(drawer ? null : requested);
  if (!id || !data?.region) return null;
  const match = data.matches.find((m) => m.fieldId === id);
  const field = data.region.fields.find((f) => f.id === id);
  if (!field) return null;
  return <div className={`farm-presence ${exiting ? 'is-exiting' : ''}`} inert={exiting}>{match ? <MatchCard m={match} year={data.region.year} /> : <PlainCard f={field} year={data.region.year} measured={data.you.measured} />}</div>;
}

function Sources({ year, soil }: { year: number; soil: boolean }) {
  return <footer className="farm-sources">Crops: USDA Cropland Data Layer {year}{soil ? ' · Their soil: USDA SSURGO survey (drainage class is an estimate) · Your soil: measured by the pour test · Scores: this app\'s crop rules' : ''}</footer>;
}

function MatchCard({ m, year }: { m: FarmMatch; year: number }) {
  return (
    <section className="panel farm-card" key={m.fieldId}>
      <header>
        <div>
          <div className="eyebrow">{m.distanceKm} km {m.bearing} · {m.soil.series}{m.soil.texture ? ` ${m.soil.texture.toLowerCase()}` : ''}</div>
          <h3>{m.identity.farm}</h3><span className="illustrative">Illustrative farm and contact</span>
        </div>
        <button className="btn btn-icon" onClick={() => useApp.getState().selectFarm(null)} aria-label="Close"><IconClose /></button>
      </header>
      <dl className="farm-lines">
        <div><dt>They grow</dt><dd>{m.theyGrow.join(', ')}</dd></div>
        <div><dt>You could grow, they can't</dt><dd>{m.youNotThey.length ? <>{names(m.youNotThey)} <em>({m.youWhy})</em></> : <em>nothing their soil cannot also grow</em>}</dd></div>
        <div><dt>They could grow, you can't</dt><dd>{m.theyNotYou.length ? <>{names(m.theyNotYou)} <em>({m.theyWhy})</em></> : <em>nothing your soil cannot also grow</em>}</dd></div>
      </dl>
      <p className="farm-say">{m.sentence}</p>
      <div className="farm-actions">
        <button className="btn btn-primary" onClick={() => useApp.setState({ contactFarm: m.fieldId })}><IconMail /> Contact {m.identity.person}</button>
        <span className="muted small">Illustrative person. Nothing is sent.</span>
      </div>
      <Sources year={year} soil />
    </section>
  );
}

function PlainCard({ f, year, measured }: { f: RegionField; year: number; measured: boolean }) {
  return (
    <section className="panel farm-card" key={f.id}>
      <header>
        <div><div className="eyebrow">{f.distanceKm} km {f.bearing} · about {f.areaHa} ha</div><h3>{f.crop}</h3></div>
        <button className="btn btn-icon" onClick={() => useApp.getState().selectFarm(null)} aria-label="Close"><IconClose /></button>
      </header>
      <dl className="farm-lines">
        <div><dt>They grow</dt><dd>{f.grows.map((g) => g.name.toLowerCase()).join(', ')}</dd></div>
        <div><dt>Their soil</dt><dd>{f.soil ? <>{f.soil.mapUnit}{f.soil.drainagecl ? <em> ({f.soil.drainagecl.toLowerCase()})</em> : null}</> : <em>no soil survey at this point</em>}</dd></div>
        <div><dt>Pairing</dt><dd><em>{!measured ? 'unknown until this plot\'s drainage is measured' : 'not a strong complement: the two soils suit and fail much the same crops'}</em></dd></div>
      </dl>
      <Sources year={year} soil={!!f.soil} />
    </section>
  );
}

// ------------------------------------------------------------ legend, sitting in a corner of the land
function Legend() {
  const region = useApp((s) => s.regionData?.region ?? null);
  if (!region) return null;
  const crops = region.legend.filter((l) => l.farmed).slice(0, 9);
  const land = new Map<string, string>();
  for (const l of region.legend) if (!l.farmed && l.sharePct >= 2 && !land.has(l.familyLabel)) land.set(l.familyLabel, l.color);
  return (
    <div className="region-legend">
      <ul>
        {crops.map((l) => <li key={l.code}><i style={{ background: l.color }} />{l.name}</li>)}
        {[...land].slice(0, 4).map(([label, color]) => <li key={label} className="is-land"><i style={{ background: color }} />{label}</li>)}
      </ul>
      <p>Each tile is about {Math.round(region.cellM / 50) * 50} m of real land, tinted by its main crop; not property boundaries. Not to scale: your plot is drawn far larger than life.</p>
    </div>
  );
}

// ------------------------------------------------------------ contact: a draft, clearly illustrative
function ContactDraft() {
  const id = useApp((s) => s.contactFarm);
  const m = useApp((s) => s.regionData?.matches.find((x) => x.fieldId === id) ?? null);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { setText(m?.draft ?? ''); setCopied(false); }, [m?.fieldId, m?.draft]);
  if (!m) return null;
  const close = () => useApp.setState({ contactFarm: null });
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } };
  return (
    <div className="modal-scrim" onClick={close}>
      <section className="panel contact" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div><div className="eyebrow">First message · draft</div><h2>To {m.identity.person} at {m.identity.farm}</h2></div>
          <button className="btn btn-icon" onClick={close} aria-label="Close"><IconClose /></button>
        </header>
        <div className="drawer-body">
          <p className="contact-note"><b>Illustrative contact.</b> {m.identity.person} and {m.identity.farm} are made up for this demo: the public cropland map says what grows on that land, not who farms it. Nothing is sent. The crops, soils and pairing in the message are real lookups.</p>
          <p className="muted small">{m.identity.note}</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} spellCheck />
          <div className="row-end">
            <span className="muted small"><IconSpark /> Ask the assistant to rewrite it: "draft a friendlier message to {m.identity.farm}".</span>
            <button className="btn btn-primary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy message'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
