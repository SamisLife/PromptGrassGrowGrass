import { useEffect, useRef, useState } from 'react';
import { useExitValue } from './useExitValue';
import { IconClose } from './icons';
import { useVoice, voiceLevels } from '../voice/voiceStore';

const LABEL = { idle: 'Ask Grok', connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', confirming: 'Confirm pour', error: 'Tap to retry' } as const;

/**
 * The floating voice assistant. Tap to talk, tap again to stop.
 *   green  = it is listening to you (the ring follows your voice)
 *   violet = Grok is working: thinking, calling tools, speaking (the bars follow its voice)
 *   amber  = Grok asked you to confirm something
 * Audio levels are read in an animation loop and written to CSS variables, so the orb moves
 * at 60 fps without re-rendering React.
 */
export function VoiceOrb() {
  const { phase, open, userText, assistantText, tools, confirm, error, toggle, stop, sendText } = useVoice();
  const orb = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState('');
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    if (!open) { orb.current?.style.setProperty('--mic', '0'); orb.current?.style.setProperty('--out', '0'); return; }
    let raf = 0;
    const loop = () => {
      const { mic, out } = voiceLevels();
      orb.current?.style.setProperty('--mic', mic.toFixed(3));
      orb.current?.style.setProperty('--out', out.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // let the bubble rest once the conversation has gone quiet
  useEffect(() => {
    setQuiet(false);
    if (!open || phase !== 'listening') return;
    const id = setTimeout(() => setQuiet(true), 9000);
    return () => clearTimeout(id);
  }, [open, phase, userText, assistantText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && useVoice.getState().open) stop(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  const showBubble = !!error || (open && !quiet) || !!confirm;
  const bubble = useExitValue(showBubble ? true : null);
  const liveTools = tools.slice(-3);

  return (
    <div className={`voice voice-${phase} ${open ? 'is-open' : ''}`}>
      {bubble.shown && (
        <div className={`voice-bubble panel ${bubble.exiting ? 'is-exiting' : ''}`} inert={bubble.exiting} role="region" aria-label="Grok conversation">
          <header className="voice-bubble-head"><span>Grok <i>· {LABEL[phase]}</i></span><button className="btn btn-icon" aria-label="Close voice conversation" onClick={stop}><IconClose /></button></header>
          <div className="voice-transcript" role="status" aria-live="polite">
          {error ? (
            <p className="voice-error">{error}</p>
          ) : (
            <>
              {confirm && (
                <div className="voice-confirm">
                  <b>Grok is asking before it pours</b>
                  <span>{confirm.reason}</span>
                  <em>Say “yes” to pour anyway, or “no” to cancel.</em>
                </div>
              )}
              {userText && <p className="voice-user">{userText}</p>}
              {liveTools.length > 0 && (
                <div className="voice-tools">
                  {liveTools.map((t) => (
                    <span key={t.id} className={`voice-tool ${t.done ? (t.ok ? 'is-done' : 'is-refused') : 'is-running'}`}>
                      <code>{t.tool}</code>{t.zones.length > 0 && <i>{t.zones.join(' ')}</i>}
                    </span>
                  ))}
                </div>
              )}
              {assistantText ? <p className="voice-grok">{assistantText}</p>
                : !userText && !confirm && <p className="voice-hint">Try “How is zone A?”, “Show me the history”, or “Pour water”.</p>}
            </>
          )}
          </div>
          {!error && <form className="voice-type" onSubmit={(e) => { e.preventDefault(); sendText(draft); setDraft(''); }}>
                <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="…or type it" aria-label="Type a message to Grok" />
              </form>}
        </div>
      )}
      <button ref={orb} className="voice-orb" onClick={() => void toggle()} aria-pressed={open} aria-label={open ? 'Stop the voice assistant' : 'Talk to Grok'} title={open ? 'Tap to stop (Esc)' : 'Talk to Grok'}>
        <span className="voice-ring" />
        <span className="voice-core">
          <span className="voice-bars"><i /><i /><i /><i /><i /></span>
        </span>
      </button>
      <span className="voice-label">{LABEL[phase]}</span>
    </div>
  );
}
