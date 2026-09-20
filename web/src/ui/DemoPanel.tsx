import { useState } from 'react';
import { TOOLS } from '../agent/tools';
import { callTool, webmcpStatus } from '../agent/webmcp';
import { useApp } from '../data/store';
import { IconClose } from './icons';

/**
 * Hidden panel for the team, not for users. Open with Ctrl/Cmd + Shift + D,
 * or double-click the logo. Overrides (applied by the backend) let us trigger any agent answer on cue;
 * a small amber dot next to the logo shows when one is active.
 */
export function DemoPanel() {
  const open = useApp((s) => s.demoOpen);
  const overrides = useApp((s) => s.overrides);
  const zones = useApp((s) => s.config?.zones ?? []);
  const board = useApp((s) => s.board);
  const selected = useApp((s) => s.selectedZone);
  const [out, setOut] = useState('');
  if (!open) return null;

  const run = async (name: string) => {
    const args: Record<string, unknown> = name === 'get_planting_window' ? { crop: 'carrot', zone: selected } : name === 'add_note' ? { text: 'Test note from the demo panel', zone: selected } : { zone: selected };
    setOut(`> ${name}(${JSON.stringify(args)})\n` + (await callTool(name, args)));
  };

  return (
    <aside className="panel demo">
      <header className="drawer-head">
        <div><div className="eyebrow">Team only</div><h2>Demo controls</h2></div>
        <button className="btn btn-icon" onClick={() => useApp.getState().toggleDemo(false)}><IconClose /></button>
      </header>
      <div className="drawer-body">
        <div className="card">
          <div className="card-title">Overrides (affect what the agent hears)</div>
          <label>Forecast
            <div className="segmented">
              {([null, 'rain', 'dry'] as const).map((v) => <button key={String(v)} className={overrides.forecast === v ? 'is-on' : ''} onClick={() => board.setOverrides({ ...overrides, forecast: v })}>{v == null ? 'Real' : v === 'rain' ? 'Rain coming' : 'Dry week'}</button>)}
            </div>
          </label>
          {zones.map((z) => (
            <label key={z.id}>{z.name} moisture
              <div className="segmented">
                {([null, 12, 55] as const).map((v) => <button key={String(v)} className={(overrides.zoneMoisture[z.id] ?? null) === v ? 'is-on' : ''} onClick={() => board.setOverrides({ ...overrides, zoneMoisture: { ...overrides.zoneMoisture, [z.id]: v } })}>{v == null ? 'Real' : v === 12 ? 'Dry (12%)' : 'Fine (55%)'}</button>)}
              </div>
            </label>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Agent console</div>
          <p className="muted small">WebMCP: {webmcpStatus.reason}. These buttons call the same tools the agent does.</p>
          <div className="tool-grid">{TOOLS.map((t) => <button key={t.name} className="btn btn-agent" onClick={() => void run(t.name)}>{t.name}</button>)}</div>
          {out && <pre className="tool-out">{out}</pre>}
        </div>

        <div className="card">
          <div className="card-title">Reset</div>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => { board.setOnboarded(false); useApp.getState().setStage('welcome'); useApp.getState().toggleDemo(false); }}>Replay onboarding</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
