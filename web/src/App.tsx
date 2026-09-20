import { useEffect, useState } from 'react';
import { BACKEND_URL } from './data/backendBoard';
import { useApp } from './data/store';
import { FieldCanvas } from './scene/FieldCanvas';
import { DemoPanel } from './ui/DemoPanel';
import { Drawer } from './ui/Drawers';
import { AgentPresence } from './ui/AgentPresence';
import { AnswersBar, HistoryBar, PourPanel, Rail, TopBar } from './ui/Live';
import { NetworkPanel } from './ui/Network';
import { RegionOverlay } from './ui/Region';
import { BuildPanel, CalibratePanel, LocationPanel, Stepper, Welcome } from './ui/Onboarding';
import { VoiceOrb } from './ui/VoiceOrb';

/** Shown until the backend's first message arrives. No backend, no data: nothing is simulated. */
function BackendWaiting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSlow(true), 2500); return () => clearTimeout(id); }, []);
  if (!slow) return null;
  return (
    <div className="panel backend-waiting">
      <div className="eyebrow">Waiting for the backend</div>
      <h2>No data source yet</h2>
      <p className="muted">This app shows real probe readings only. Start the backend, with the boards plugged in, and this page connects by itself:</p>
      <pre>cd backend{'\n'}npm start</pre>
      <p className="muted small">Looking for it at {BACKEND_URL}</p>
    </div>
  );
}

export function App() {
  const ready = useApp((s) => s.ready);
  const stage = useApp((s) => s.stage);
  const view = useApp((s) => s.view);
  const replayActive = useApp((s) => s.replay.active);
  const aliveAt = useApp((s) => s.aliveAt);
  const regionOn = useApp((s) => s.regionOn);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); useApp.getState().toggleDemo(); }
      if (e.key === 'Escape') {
        const st = useApp.getState();
        if (st.contactFarm) useApp.setState({ contactFarm: null }); else if (st.selectedFarm) st.selectFarm(null);
        st.openDrawer(null); st.toggleDemo(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app stage-${stage} view-${view} ${replayActive ? 'is-replay' : ''} ${regionOn ? 'is-region' : ''}`}>
      <div className="backdrop" />
      <FieldCanvas />
      {!ready && <BackendWaiting />}
      {ready && (
        <>
          <TopBar />
          <Stepper />
          {stage === 'welcome' && <Welcome />}
          {stage === 'build' && <BuildPanel />}
          {stage === 'location' && <LocationPanel />}
          {stage === 'calibrate' && <CalibratePanel />}
          {stage === 'live' && (
            <>
              <AgentPresence />
              <Rail />
              {view === 'field' && !regionOn && <AnswersBar />}
              <RegionOverlay />
              {view === 'pour' && <PourPanel />}
              {view === 'history' && <HistoryBar />}
              {view === 'network' && <NetworkPanel />}
              <Drawer />
              <VoiceOrb />
              {aliveAt != null && <div className="alive-flash" key={aliveAt} />}
            </>
          )}
          <DemoPanel />
        </>
      )}
    </div>
  );
}
