import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerWebMcp } from './agent/webmcp';
import { App } from './App';
import { applyBrand } from './brand';
import { startBoard, useApp } from './data/store';
import { voiceMute, voiceStats } from './voice/voiceStore';
import './styles.css';

applyBrand();
startBoard();
void registerWebMcp().then(() => {
  // ?debug exposes the store and the simulator for scripted testing (tools/shots.mjs)
  if (new URLSearchParams(location.search).has('debug')) Object.assign((window as any).soil, { app: useApp, voiceStats, voiceMute });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
