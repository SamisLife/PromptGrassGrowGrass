/**
 * Is the PERSON using the app right now?
 *
 * An agent in the browser calls the page's tools through WebMCP, not through the mouse, so
 * real (trusted) pointer, wheel and key events are the person. When they are in the middle of
 * something, the agent does not get to move the view: its request is offered as a button
 * instead. The person's own click always wins.
 */
import { useApp } from '../data/store';

let pointerDown = false, lastInput = 0, lastKey = 0, started = false;

export function watchPerson(): void {
  if (started) return;
  started = true;
  const on = (type: string, fn: (e: Event) => void) => window.addEventListener(type, (e) => { if (e.isTrusted) fn(e); }, { capture: true, passive: true });
  on('pointerdown', () => { pointerDown = true; lastInput = performance.now(); });
  on('pointerup', () => { pointerDown = false; lastInput = performance.now(); });
  on('pointercancel', () => { pointerDown = false; });
  on('wheel', () => { lastInput = performance.now(); });
  on('keydown', () => { lastKey = lastInput = performance.now(); });
}

/** A short reason in plain words while the person is busy, or null when the agent may move the view. */
export function personBusy(): string | null {
  const st = useApp.getState(), now = performance.now();
  if (st.stage !== 'live') return 'setting up the plot';
  if (st.pour.phase === 'armed' || st.pour.phase === 'running') return 'in the middle of a pour test';
  if (st.contactFarm) return 'writing a message';
  if (pointerDown) return 'moving the view';
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && now - lastKey < 6000) return 'typing';
  if (lastInput && now - lastInput < 1200) return 'using the app';
  return null;
}
