import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../data/store';
import type { Plot, Zone } from '../data/types';
import { fmtLen } from '../ui/format';
import { IconDish, IconDrop, IconThermo } from '../ui/icons';
import { FieldScene } from './FieldScene';

type Edge = 'E' | 'W' | 'N' | 'S';
const EDGES: Edge[] = ['E', 'W', 'N', 'S'];
const MIN_CM = 10, MAX_CM = 10000;

const snap = (cm: number) => { const step = cm < 100 ? 1 : cm < 500 ? 5 : 10; return Math.round(cm / step) * step; };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function FieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FieldScene | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => { if (el) els.current.set(key, el); else els.current.delete(key); };

  const stage = useApp((s) => s.stage);
  const view = useApp((s) => s.view);
  const config = useApp((s) => s.config);
  const draft = useApp((s) => s.draft);
  const live = useApp((s) => s.live);
  const selected = useApp((s) => s.selectedZone);
  const replay = useApp((s) => s.replay);
  const pour = useApp((s) => s.pour);
  const agentCalls = useApp((s) => s.agentCalls);
  const glow = useApp((s) => s.glow);
  const regionOn = useApp((s) => s.regionOn);
  const regionData = useApp((s) => s.regionData);
  const selectedFarm = useApp((s) => s.selectedFarm);
  const hoverFarm = useApp((s) => s.hoverFarm);

  useEffect(() => {
    if (!canvasRef.current) return;
    let scene: FieldScene;
    try { scene = new FieldScene(canvasRef.current); } catch (e) { console.error('WebGL unavailable', e); return; }
    sceneRef.current = scene;
    const v = new THREE.Vector3();
    scene.onFrame = () => {
      const st = useApp.getState();
      if (!st.config) return;
      const plot = st.draft?.plot ?? st.config.plot, zones = st.draft?.zones ?? st.config.zones;
      const place = (key: string, x: number, y: number, lift: number) => {
        const el = els.current.get(key);
        if (!el) return;
        const p = scene.project(scene.toWorld(x, y, plot, v).setY(lift));
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        el.style.visibility = p.visible ? 'visible' : 'hidden';
      };
      for (const z of zones) { place('tag:' + z.id, z.x, z.y, 1.0); place('grip:' + z.id, z.x, z.y, 0.35); }
      place('edge:E', plot.width, plot.length / 2, 0); place('edge:W', 0, plot.length / 2, 0);
      place('edge:N', plot.width / 2, 0, 0); place('edge:S', plot.width / 2, plot.length, 0);
      place('dim:w', plot.width / 2, plot.length, -0.55); place('dim:l', plot.width, plot.length / 2, -0.55);
      if (zones.length >= 2) place('dist', (zones[0].x + zones[1].x) / 2, (zones[0].y + zones[1].y) / 2, 0.12);
      // zoomed out: name tags ride on the complementary fields, and the plot keeps a marker of its own
      const shown = scene.region.amount > 0.75;
      for (const [key, el] of els.current) {
        if (!key.startsWith('farm:')) continue;
        const w = shown ? scene.region.fieldPos(key.slice(5), v) : null;
        if (!w) { el.style.visibility = 'hidden'; continue; }
        const p = scene.project(w);
        el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        el.style.visibility = p.visible ? 'visible' : 'hidden';
      }
      const home = els.current.get('home');
      if (home) {
        const p = scene.project(v.set(0, 1.5, 0));
        home.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        home.style.visibility = shown && p.visible ? 'visible' : 'hidden';
      }
    };
    return () => { scene.dispose(); sceneRef.current = null; };
  }, []);

  // ---- build-mode dragging
  const drag = (kind: { edge: Edge } | { zone: string }) => (e: React.PointerEvent) => {
    const scene = sceneRef.current;
    if (!scene) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scene.setDragging(true);
    scene.freezeScale = true;
    const move = (ev: PointerEvent) => {
      const d = useApp.getState().draft;
      if (!d) return;
      const hit = scene.pick(ev.clientX, ev.clientY, d.plot);
      if (!hit) return;
      if ('edge' in kind) {
        const horizontal = kind.edge === 'E' || kind.edge === 'W';
        const half = horizontal ? Math.abs(hit.x - d.plot.width / 2) : Math.abs(hit.y - d.plot.length / 2);
        const size = clamp(snap(half * 2), MIN_CM, MAX_CM);
        const plot: Plot = horizontal ? { ...d.plot, width: size } : { ...d.plot, length: size };
        // probes keep their relative place as the plot stretches
        const zones = d.zones.map((z) => ({ ...z, x: (z.x / d.plot.width) * plot.width, y: (z.y / d.plot.length) * plot.length }));
        useApp.getState().setDraft({ plot, zones });
      } else {
        const m = Math.min(d.plot.width, d.plot.length) * 0.06;
        const zones = d.zones.map((z) => (z.id === kind.zone ? { ...z, x: clamp(hit.x, m, d.plot.width - m), y: clamp(hit.y, m, d.plot.length - m) } : z));
        useApp.getState().setDraft({ plot: d.plot, zones });
      }
    };
    const up = () => {
      scene.setDragging(false);
      scene.freezeScale = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- zoomed out: touch a field
  const down = useRef<{ x: number; y: number } | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const st = useApp.getState();
    if (!st.regionOn || !sceneRef.current || e.buttons) return;
    const id = sceneRef.current.pickFarm(e.clientX, e.clientY);
    if (id !== st.hoverFarm) useApp.setState({ hoverFarm: id });
  };
  const onUp = (e: React.PointerEvent) => {
    const st = useApp.getState(), d = down.current;
    down.current = null;
    if (!st.regionOn || !sceneRef.current || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;   // a drag orbits; only a tap selects
    st.selectFarm(sceneRef.current.pickFarm(e.clientX, e.clientY));
  };

  const plot = draft?.plot ?? config?.plot;
  const zones: Zone[] = draft?.zones ?? config?.zones ?? [];
  const building = stage === 'build';
  const showTags = stage === 'live' || stage === 'calibrate';
  const dist = zones.length >= 2 ? Math.hypot(zones[0].x - zones[1].x, zones[0].y - zones[1].y) : 0;
  const now = performance.now();

  return (
    <div className="field">
      <canvas ref={canvasRef} className={`field-canvas ${regionOn && hoverFarm ? 'is-pointing' : ''}`} onPointerMove={onMove} onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={onUp} />
      {/* tags sit above the canvas; a scroll that lands on one must still zoom the scene */}
      <div className="field-overlay" onWheel={(e) => canvasRef.current?.dispatchEvent(new WheelEvent('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, bubbles: false, cancelable: true }))}>
        {showTags && !regionOn && zones.map((z) => {
          const l = live[z.id];
          const hist = replay.active ? replay.series[z.id] : null;
          const glowing = glow[z.id] != null && now - glow[z.id] < 2600;
          const lastCall = glowing ? agentCalls.find((c) => c.zones.includes(z.id)) : null;
          const waiting = pour.phase === 'armed';
          return (
            <div key={z.id} ref={reg('tag:' + z.id)} className="anchor">
              <button
                className={`zone-tag ${selected === z.id && stage === 'live' ? 'is-selected' : ''} ${glowing ? 'is-agent' : ''} ${!l?.moistureOnline || !l?.tempOnline ? 'is-offline' : ''} ${waiting ? 'is-waiting' : ''}`}
                onClick={() => useApp.getState().selectZone(z.id)}
              >
                <span className="zone-tag-id">{z.id}</span>
                {hist ? (
                  <span className="zone-tag-vals"><ReplayVals zoneId={z.id} /></span>
                ) : (
                  <span className="zone-tag-vals">
                    <span title="Relative moisture · percent of the air-to-water range"><IconDrop /><b>{l?.moistureOnline ? l.moisturePct != null ? `${Math.round(l.moisturePct)}%` : 'uncalibrated' : 'offline'}</b></span>
                    <span title="Soil temperature"><IconThermo /><i>{l?.tempOnline && l.tempC != null ? `${l.tempC.toFixed(1)}°C` : 'offline'}</i></span>
                  </span>
                )}
                {lastCall && <span className="zone-tag-agent">{lastCall.tool}</span>}
              </button>
            </div>
          );
        })}

        {stage === 'live' && regionOn && (
          <>
            {(regionData?.matches ?? []).map((m) => (
              <div key={m.fieldId} ref={reg('farm:' + m.fieldId)} className="anchor">
                <button className={`farm-tag ${selectedFarm === m.fieldId ? 'is-selected' : ''} ${hoverFarm === m.fieldId ? 'is-hover' : ''}`} onClick={() => useApp.getState().selectFarm(m.fieldId)}>
                  <i>{m.rank}</i><span>{m.identity.farm}<small>Illustrative farm</small></span>
                </button>
              </div>
            ))}
            {hoverFarm && !regionData?.matches.some((m) => m.fieldId === hoverFarm) && (() => {
              const f = regionData?.region?.fields.find((x) => x.id === hoverFarm);
              return f ? <div key={'h' + f.id} ref={reg('farm:' + f.id)} className="anchor"><div className="farm-tag is-plain"><span>{f.grows.map((g) => g.name).join(' · ')}</span></div></div> : null;
            })()}
            <div ref={reg('home')} className="anchor">
              <div className="home-tag">
                <span>{config?.plot.name ?? 'Your plot'}</span>
                <button title="How data leaves this field" onClick={() => useApp.setState({ view: 'network', drawer: null, selectedFarm: null })}><IconDish /></button>
              </div>
            </div>
          </>
        )}

        {building && plot && (
          <>
            {EDGES.map((e) => (
              <div key={e} ref={reg('edge:' + e)} className="anchor">
                <div className={`edge-grip edge-${e}`} onPointerDown={drag({ edge: e })} title="Drag to resize" />
              </div>
            ))}
            {zones.map((z) => (
              <div key={z.id} ref={reg('grip:' + z.id)} className="anchor">
                <div className="probe-grip" onPointerDown={drag({ zone: z.id })}><span>{z.id}</span></div>
              </div>
            ))}
            <div ref={reg('dim:w')} className="anchor"><div className="dim-label">{fmtLen(plot.width)}</div></div>
            <div ref={reg('dim:l')} className="anchor"><div className="dim-label">{fmtLen(plot.length)}</div></div>
          </>
        )}
        {(building || (stage === 'live' && view === 'pour')) && zones.length >= 2 && (
          <div ref={reg('dist')} className="anchor"><div className="dist-label">{fmtLen(dist, 1)} apart</div></div>
        )}
      </div>
    </div>
  );
}

function ReplayVals({ zoneId }: { zoneId: string }) {
  const replay = useApp((s) => s.replay);
  const pts = replay.series[zoneId]?.points ?? [];
  let best = pts[0];
  for (const p of pts) if (Math.abs(p.t - replay.t) < Math.abs((best?.t ?? 0) - replay.t)) best = p;
  if (!best) return <>no data</>;
  return (
    <>
      <b>{best.moisturePct != null ? `${Math.round(best.moisturePct)}%` : '–'}</b>
      <i>{best.tempC != null ? `${best.tempC.toFixed(1)}°` : '–'}</i>
    </>
  );
}
