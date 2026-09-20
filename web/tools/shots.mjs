// Scripted visual check: drives headless Chrome in REAL time over the DevTools
// protocol (requestAnimationFrame does not run under --virtual-time-budget).
//   node tools/shots.mjs <outDir> [baseUrl]
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';

const out = process.argv[2] ?? './shots';
const base = process.argv[3] ?? 'http://localhost:5199/';
if (new URL(base).port !== '5199') throw new Error('Design captures must use spare port 5199');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'pg-design-chrome-'));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
process.on('SIGTERM', () => { chrome.kill(); rmSync(profile, { recursive: true, force: true }); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); rej(new Error(method + ' timed out')); }, 30000); pending.set(id, { res: value => { clearTimeout(timer); res(value); }, rej: error => { clearTimeout(timer); rej(error); } }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + r.exceptionDetails.exception?.description); return r.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, 'base64')); console.log('shot', name); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { msg.error ? pending.get(msg.id).rej(new Error(JSON.stringify(msg.error))) : pending.get(msg.id).res(msg.result ?? {}); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 400));
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  if (process.argv[4] === 'supplement') {
    await send('Page.navigate', { url: base + '?quick&debug' }); await sleep(4500);
    await evaluate(`window.voice=(await import('/src/voice/voiceStore.ts')).useVoice`);
    await evaluate(`soil.app.setState({live:{A:{t:Date.now(),moistureRaw:2600,moisturePct:58,tempC:21.4,moistureOnline:true,tempOnline:true},B:{t:Date.now(),moistureRaw:3500,moisturePct:18,tempC:20.1,moistureOnline:true,tempOnline:true}}})`); await sleep(2500); await shot('probes-live');
    await evaluate(`soil.app.setState({live:{A:{t:Date.now(),moistureRaw:2600,moisturePct:58,tempC:21.4,moistureOnline:false,tempOnline:true},B:{t:Date.now(),moistureRaw:3500,moisturePct:18,tempC:20.1,moistureOnline:true,tempOnline:false}}})`); await sleep(1000); await shot('probes-partial');
    await evaluate(`soil.app.setState({live:{}}); await soil.app.getState().runDiagnose()`); await sleep(500); await shot('diagnose-result');
    await evaluate(`soil.app.getState().toggleDemo(true)`); await sleep(500); await shot('demo-panel');
    await evaluate(`soil.app.getState().toggleDemo(false);soil.app.setState({drawer:null});soil.app.getState().recordAgentCall('read_zone',['A'],'Reading zone A')`); await sleep(500); await shot('agent-activity');
    await evaluate(`soil.app.getState().goRegion(true)`); await sleep(3500);
    await evaluate(`window.savedRegion=soil.app.getState().regionData`);
    for(const status of ['loading','no_place','unavailable']) {
      await evaluate(`soil.app.setState({regionData:{...savedRegion,status:'${status}',region:null,matches:[],reason:'USDA coverage is unavailable for this location.'}})`); await sleep(500); await shot('region-' + status);
    }
    await evaluate(`soil.app.setState({regionData:{...savedRegion,matches:[],you:{...savedRegion.you,measured:false}}})`); await sleep(500); await shot('region-unmeasured');
    await evaluate(`soil.app.setState({regionData:{...savedRegion,matches:[]}})`); await sleep(500); await shot('region-no-matches');
    await evaluate(`soil.app.setState({regionData:savedRegion});soil.app.getState().goRegion(false);soil.app.getState().setView('history')`); await sleep(800);
    await evaluate(`const now=Date.now(); soil.app.getState().setReplay({series:{A:{zone:'A',points:[{t:now-60000,moisturePct:35,tempC:20},{t:now,moisturePct:40,tempC:21}]},B:{zone:'B',points:[{t:now-60000,moisturePct:25,tempC:19},{t:now,moisturePct:28,tempC:20}]}},active:true,t:now-30000})`); await sleep(500); await shot('history-replay');
    await evaluate(`const now=Date.now();soil.app.getState().setReplay({series:{A:{zone:'A',points:[{t:now,moisturePct:35,tempC:20}]}},active:true,t:now})`); await sleep(500); await shot('history-single-point');
    const badPath = await evaluate(`return [...document.querySelectorAll('.history-chart path')].some(p=>/NaN|Infinity/.test(p.getAttribute('d')))`);
    if(badPath) throw new Error('Non-finite single-point chart path');
    writeFileSync(`${out}/supplement-console.json`,JSON.stringify(logs,null,2));
  } else {
  await send('Page.navigate', { url: base + '?quick&debug' });
  await sleep(5000);
  await evaluate(`window.voice = (await import('/src/voice/voiceStore.ts')).useVoice`);
  const state = async (expr, name, ms = 1700) => { await evaluate(expr); await sleep(ms); await shot(name); };
  for (const stage of ['welcome', 'build', 'location', 'calibrate']) {
    await state(`soil.app.getState().setStage('${stage}')`, 'onboarding-' + stage);
  }
  await state(`soil.app.getState().setStage('live')`, 'field-offline');
  for (const drawer of ['soil', 'plant', 'when', 'water', 'diagnose']) {
    await state(`soil.app.getState().openDrawer('${drawer}')`, 'drawer-' + drawer);
  }
  await evaluate(`soil.app.getState().openDrawer('plant')`);
  for (const phase of ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'confirming', 'error']) {
    await state(`voice.setState({phase:'${phase}', open:${phase !== 'idle' && phase !== 'error'}, userText:'What can I plant here?', assistantText:'The crop list uses your measured drainage. Connect the probes to check today’s soil temperature and relative moisture.', error:${phase === 'error' ? "'Unable to connect. Tap the orb to try again.'" : 'null'}, confirm:${phase === 'confirming' ? "{reason:'Zone A is already wet.', kind:'wet', until:Date.now()+60000}" : 'null'}})`, 'voice-' + phase, 700);
  }
  await evaluate(`voice.setState({phase:'idle',open:false,error:null,confirm:null}); soil.app.getState().openDrawer(null)`);
  for (const view of ['pour', 'history', 'network']) await state(`soil.app.getState().setView('${view}')`, 'view-' + view);
  await evaluate(`soil.app.getState().setView('field'); soil.app.getState().board.setPlace(await soil.app.getState().board.demoPlace())`);
  await sleep(4000);
  await state(`soil.app.getState().goRegion(true)`, 'region', 5000);
  await state(`soil.app.getState().selectFarm(soil.app.getState().regionData?.matches[0]?.fieldId ?? soil.app.getState().regionData?.region?.fields[0]?.id)`, 'region-card', 3000);
  await state(`soil.app.setState({contactFarm:soil.app.getState().selectedFarm})`, 'region-contact');
  await evaluate(`soil.app.setState({contactFarm:null}); soil.app.getState().goRegion(false)`);
  // Visual fixtures are memory-only, never persisted or sent to the board.
  await state(`soil.app.setState({ live: {A:{t:Date.now(),moistureRaw:2600,moisturePct:58,tempC:21.4,moistureOnline:true,tempOnline:true},B:{t:Date.now(),moistureRaw:3500,moisturePct:18,tempC:20.1,moistureOnline:true,tempOnline:true}} })`, 'probes-live', 3000);
  await state(`soil.app.setState({ live: {A:{t:Date.now(),moistureRaw:2600,moisturePct:58,tempC:21.4,moistureOnline:false,tempOnline:true},B:{t:Date.now(),moistureRaw:3500,moisturePct:18,tempC:20.1,moistureOnline:true,tempOnline:false}} })`, 'probes-partial');
  for (const lens of ['moisture','temperature']) await state(`soil.app.getState().setLens('${lens}')`, 'lens-' + lens);
  await evaluate(`soil.app.getState().setLens('natural'); soil.app.setState({live:{}})`);
  for (const phase of ['armed','running','done','timeout']) await state(`soil.app.setState({view:'pour',pour:{...soil.app.getState().pour,phase:'${phase}',source:'A',target:'B',t0:Date.now()-14000,t1:${phase === 'done' ? 'Date.now()' : 'null'},rateCmMin:3,seconds:14,distanceCm:20,baseline:{A:20,B:20}}})`, 'pour-' + phase);
  await evaluate(`soil.app.setState({pour:{...soil.app.getState().pour,phase:'idle'}}); soil.app.getState().setView('field')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(2000); await shot('small-field');
  await state(`soil.app.getState().openDrawer('plant'); voice.setState({phase:'speaking',open:true,assistantText:'The crop list uses your measured drainage. Connect the probes to check today’s soil temperature and relative moisture.'})`, 'small-voice-plant');
  await evaluate(`voice.setState({phase:'idle',open:false})`);
  await state(`soil.app.getState().goRegion(true)`, 'small-region', 4000);
  await state(`soil.app.getState().selectFarm(soil.app.getState().regionData?.matches[0]?.fieldId)`, 'small-region-card', 3000);
  await state(`soil.app.getState().goRegion(false);soil.app.getState().setStage('calibrate')`, 'small-calibrate');
  await state(`soil.app.setState({ready:false})`, 'backend-waiting', 2800);
  // Interaction checks run after captures so fixtures cannot affect the screenshots.
  await send('Page.navigate', { url: base + '?quick&debug' }); await sleep(4500);
  const checks = [];
  const check = async (name, expr) => { const ok = await evaluate(`return !!(${expr})`); checks.push({name, ok}); if (!ok) throw new Error('Check failed: ' + name); };
  await check('rail clears voice orb at 1280 × 720', `document.querySelector('.rail').getBoundingClientRect().bottom + 16 < document.querySelector('.voice-orb').getBoundingClientRect().top`);
  const drag = async (selector, dx, dy) => {
    const point = await evaluate(`const r = document.querySelector('${selector}').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`);
    await send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
    for(let i=1;i<=5;i++) { await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:point.x+dx*i/5,y:point.y+dy*i/5,button:'left',buttons:1}); await sleep(60); }
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',x:point.x+dx,y:point.y+dy,button:'left',clickCount:1});
    await sleep(500);
  };
  await evaluate(`soil.app.getState().setStage('build'); window.beforeZone = {...soil.app.getState().draft.zones[0]}; window.beforeWidth=soil.app.getState().draft.plot.width`); await sleep(2500);
  await drag('.probe-grip',40,20);
  await check('zone dragging updates draft coordinates', `Math.abs(soil.app.getState().draft.zones[0].x-beforeZone.x) > .1 || Math.abs(soil.app.getState().draft.zones[0].y-beforeZone.y) > .1`);
  await drag('.edge-E',35,0);
  await check('container edge dragging resizes draft', `soil.app.getState().draft.plot.width !== beforeWidth`);
  await evaluate(`soil.app.getState().setStage('live'); soil.app.getState().setView('field')`); await sleep(3000);
  for(let i=0;i<10;i++) {
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:640,y:270,deltaX:0,deltaY:360}); await sleep(400);
    if(await evaluate(`return soil.app.getState().regionOn`)) break;
  }
  await check('wheel out enters region', `soil.app.getState().regionOn`); await sleep(4000);
  await evaluate(`soil.app.getState().selectFarm(soil.app.getState().regionData.matches[0].fieldId)`); await sleep(2300);
  await check('match card retains exactly three fact rows', `document.querySelectorAll('.farm-card .farm-lines > div').length === 3`);
  await check('farm presence does not intercept the canvas', `getComputedStyle(document.querySelector('.farm-presence')).pointerEvents === 'none'`);
  await evaluate(`soil.app.setState({drawer:'plant'})`); await sleep(500);
  await check('drawer replaces farm card without panel overlap', `!document.querySelector('.farm-card') && getComputedStyle(document.querySelector('.region-rail')).visibility === 'hidden'`);
  await evaluate(`soil.app.setState({drawer:null, selectedFarm:null})`); await sleep(2500);
  for(let i=0;i<12;i++) {
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:640,y:270,deltaX:0,deltaY:-360}); await sleep(400);
    if(!await evaluate(`return soil.app.getState().regionOn`)) break;
  }
  await check('wheel in returns to plot', `!soil.app.getState().regionOn`);
  await evaluate(`soil.app.getState().openDrawer('plant')`); await sleep(700);
  await evaluate(`document.querySelector('.crop-head').click()`); await sleep(500);
  await check('crop row expands by click', `document.querySelector('.crop-head').getAttribute('aria-expanded') === 'true'`);
  await shot('crop-expanded');
  await evaluate(`window.voice=(await import('/src/voice/voiceStore.ts')).useVoice; voice.setState({open:true,phase:'confirming',confirm:{reason:'Visual check only',kind:'wet',until:Date.now()+60000},assistantText:'Long transcript. '.repeat(80)})`); await sleep(500);
  await check('long voice transcript scrolls within viewport', `document.querySelector('.voice-transcript').scrollHeight > document.querySelector('.voice-transcript').clientHeight && document.querySelector('.voice-bubble').getBoundingClientRect().top >= 64`);
  await evaluate(`voice.getState().stop();soil.app.setState({live:{A:{t:Date.now(),moisturePct:58,moistureOnline:false,tempC:21.4,tempOnline:true},B:{t:Date.now(),moisturePct:18,moistureOnline:true,tempC:20,tempOnline:false}}})`); await sleep(600);
  await check('offline moisture never hides working temperature or leaks stale percentage', `document.querySelector('.zone-tag').textContent.includes('21.4') && !document.querySelector('.zone-tag').textContent.includes('58%')`);
  await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate(`soil.app.getState().goRegion(true)`); await sleep(500);
  await check('reduced-motion preference active', `matchMedia('(prefers-reduced-motion: reduce)').matches`);
  writeFileSync(`${out}/checks.json`, JSON.stringify(checks,null,2));
  console.log('interaction checks:', checks.length, 'passed');
  writeFileSync(`${out}/console.json`, JSON.stringify(logs, null, 2));
  }
} catch (e) { console.error('FAILED', e); process.exitCode = 1; }
finally {
  console.log(logs.length ? 'CONSOLE ISSUES:\n' + [...new Set(logs)].join('\n') : 'no console errors or warnings');
  chrome.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); process.exit(process.exitCode ?? (logs.length ? 1 : 0));
}
