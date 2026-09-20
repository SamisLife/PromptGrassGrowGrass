/**
 * The AI, as the person sees it: that it is acting, what it just did in plain words, what it
 * would like to show them, and the one question only they can answer (pour anyway?).
 * Violet is the AI's colour everywhere in the app; nothing else uses it.
 */
import { useEffect, useState } from 'react';
import { useAgent, type TrailItem } from '../agent/agentStore';
import { webmcpStatus } from '../agent/webmcp';
import { IconClose, IconSpark } from './icons';

const FRESH_MS = 9000;
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 5 ? 'now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
const mark = (x: TrailItem) => (x.status === 'running' ? '' : x.status === 'failed' ? 'could not' : x.status === 'offered' ? 'offered' : x.status === 'declined' ? 'declined' : '');

export function AgentPresence() {
  const trail = useAgent((s) => s.trail);
  const follow = useAgent((s) => s.follow);
  const suggestion = useAgent((s) => s.suggestion);
  const pourAsk = useAgent((s) => s.pourAsk);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(id); }, []);

  const now = Date.now();
  const head = trail.find((x) => x.status === 'running') ?? trail[0];
  const fresh = !!head && (head.status === 'running' || now - head.t < FRESH_MS);
  const acting = trail.some((x) => x.status === 'running') || (!!trail[0] && now - trail[0].t < 2500);
  useEffect(() => { document.querySelector('.app')?.classList.toggle('is-agent', acting); }, [acting]);

  if (!fresh && !open && !suggestion && !pourAsk) return null;
  // Undo sits in the pill only for the action it names; older ones are in the trail
  const undoable = head?.undo && now - head.t < 30000 ? head : undefined;

  return (
    <div className="agent-presence" aria-live="polite">
      {(fresh || open) && head && (
        <div className={`agent-feed ${head.status === 'running' ? 'is-running' : ''} ${head.status === 'failed' ? 'is-failed' : ''}`}>
          <button className="agent-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="What the AI has done">
            <IconSpark /><span className="agent-say">{head.say}</span>
            {head.status === 'running' ? <i className="agent-dots"><b /><b /><b /></i> : mark(head) && <em>{mark(head)}</em>}
            {trail.length > 1 && <small>{trail.length}</small>}
          </button>
          {undoable && !open && <button className="agent-undo" onClick={() => useAgent.getState().undo(undoable.id)}>Undo</button>}
        </div>
      )}

      {open && (
        <div className="panel agent-trail">
          <header><div className="eyebrow">What the AI has done</div><button className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Close"><IconClose /></button></header>
          <ol>
            {trail.slice(0, 10).map((x) => (
              <li key={x.id} className={`is-${x.status}`}>
                <span><b>{x.say}</b>{x.detail && <em>{x.detail}</em>}</span>
                <small>{x.source === 'backend' ? 'voice / MCP · ' : ''}{ago(x.t)}</small>
                {x.undo && <button className="agent-undo" onClick={() => useAgent.getState().undo(x.id)}>Undo</button>}
              </li>
            ))}
          </ol>
          <label className="agent-follow"><input type="checkbox" checked={follow} onChange={(e) => useAgent.getState().setFollow(e.target.checked)} /> Show me what the AI is reading</label>
          <p className="muted small">{webmcpStatus.reason} It never moves the view while you are using it; your click always wins.</p>
        </div>
      )}

      {suggestion && (
        <div className="agent-offer">
          <span><IconSpark /> The AI would like to: <b>{suggestion.say.replace(/^Show /, 'show ').replace(/^Select /, 'select ').replace(/^Colour /, 'colour ')}</b></span>
          <button className="btn btn-agent-solid" onClick={() => useAgent.getState().acceptSuggestion()}>Show</button>
          <button className="btn btn-ghost" onClick={() => useAgent.getState().dismissSuggestion()}>Not now</button>
        </div>
      )}

      {pourAsk && (
        <div className="panel agent-ask" role="alertdialog" aria-label="Confirm pour">
          <div className="eyebrow">The AI asked to pour water</div>
          <h3>Pour anyway?</h3>
          <p>{pourAsk.reason}</p>
          <div className="row">
            <button className="btn btn-warn" onClick={(e) => useAgent.getState().answerPour(true, e.nativeEvent.isTrusted)}>Pour anyway</button>
            <button className="btn btn-ghost" onClick={(e) => useAgent.getState().answerPour(false, e.nativeEvent.isTrusted)}>No, leave it</button>
            <span className="muted small">{Math.max(0, Math.ceil((pourAsk.expiresAt - now) / 1000))} s · only you can answer this</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Top-bar pill: off, offered, or an agent actually at work. */
export function AgentBadge() {
  const lastAt = useAgent((s) => s.lastAt);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1500); return () => clearInterval(id); }, []);
  const active = Date.now() - lastAt < 60000;
  const st = webmcpStatus;
  return (
    <span className={`pill ${st.available || active ? 'pill-agent' : ''} ${active ? 'is-active' : ''}`} title={st.reason}>
      <IconSpark />{active ? 'AI is working with you' : st.available ? (st.registered ? `AI tools ready · ${st.registered}` : 'AI tools after setup') : 'AI tools off'}
    </span>
  );
}
