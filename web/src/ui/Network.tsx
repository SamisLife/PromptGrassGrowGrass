import { useEffect, useState } from 'react';
import { webmcpStatus } from '../agent/webmcp';
import { useApp } from '../data/store';
import type { ConnLink, Connectivity } from '../data/types';
import { IconClose, IconSpark } from './icons';

const STATE_WORD: Record<ConnLink['state'], string> = { connected: 'Connected', wired: 'Wired', simulated: 'Simulated', down: 'Down', not_fitted: 'Not fitted' };

/**
 * The real-world architecture, shown honestly: a link is only drawn as live
 * (solid, flowing) when it actually is. Everything else is a dashed outline
 * labeled "not fitted".
 */
export function NetworkPanel() {
  const board = useApp((s) => s.board);
  const zones = useApp((s) => s.config?.zones ?? []);
  const live = useApp((s) => s.live);
  const [conn, setConn] = useState<Connectivity | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => board.connectivity().then((c) => { if (alive) setConn(c); });
    void load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [board]);

  const hop1 = conn?.links.filter((l) => l.layer === 'probe_gateway') ?? [];
  const hop2 = conn?.links.filter((l) => l.layer === 'gateway_internet') ?? [];

  return (
    <div className="network panel">
      <header className="drawer-head">
        <div><div className="eyebrow">Connectivity</div><h2>From the soil to the sky</h2></div>
        <button className="btn btn-icon" onClick={() => useApp.getState().setView('field')} aria-label="Close"><IconClose /></button>
      </header>
      <p className="muted">A real field has no WiFi. Probes reach a gateway over long-range radio; the gateway reaches the internet by whatever exists. This is the path in use right now, and the paths it could take.</p>

      <div className="net">
        <div className="net-col">
          <div className="net-title">Probes</div>
          {zones.map((z) => (
            <div key={z.id} className={`net-node ${live[z.id]?.moistureOnline ? 'is-on' : ''}`}>
              <b>Probe set {z.probe}</b><span>{live[z.id]?.moistureOnline ? 'moisture' : 'moisture offline'} · {live[z.id]?.tempOnline ? 'temperature' : 'temperature offline'}</span>
            </div>
          ))}
        </div>
        <Links links={hop1} />
        <div className="net-col">
          <div className="net-title">Gateway</div>
          <div className={`net-node net-gateway ${board.mode === 'board' ? 'is-on' : ''}`}>
            <b>Local backend</b>
            <span>{board.mode === 'board' ? 'USB-connected UNO Q boards · readings and soil calculations' : 'not attached: this page is running on simulated probes'}</span>
          </div>
        </div>
        <Links links={hop2} />
        <div className="net-col">
          <div className="net-title">Internet</div>
          <div className={`net-node ${conn?.internetReachable ? 'is-on' : ''}`}><b>Forecast & climate</b><span>{conn?.internetReachable ? 'Open-Meteo reachable' : 'unreachable: using labeled estimates'}</span></div>
          <div className={`net-node net-agent ${webmcpStatus.available ? 'is-on' : ''}`}><b><IconSpark /> AI agent</b><span>{webmcpStatus.available ? `${webmcpStatus.registered} page tools registered (WebMCP)` : webmcpStatus.reason}</span></div>
        </div>
      </div>
    </div>
  );
}

function Links({ links }: { links: ConnLink[] }) {
  return (
    <div className="net-links">
      {links.map((l) => (
        <div key={l.id} className={`net-link state-${l.state} ${l.active ? 'is-active' : ''}`} title={l.note}>
          <div className="net-line"><i /></div>
          <div className="net-link-label"><b>{l.label}</b><span>{STATE_WORD[l.state]}</span></div>
          <p>{l.active ? l.detail : l.note}</p>
        </div>
      ))}
    </div>
  );
}
