// WebMCP checks: every page tool, the errors an agent can recover from, the "never take the wheel"
// rule, and the pour confirmation. Drives headless Chrome in real time with the WebMCP flag on.
//   node tools/webmcp-check.mjs <outDir> [baseUrl]
// Needs a backend started with HARDWARE=off on a spare port and the dev server pointed at it (see
// tools/shots.mjs). It can never pour: with no board the real route refuses, and the soft-guard path
// is exercised against a stubbed answer inside the page.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const out = process.argv[2] ?? "./webmcp-check", base = process.argv[3] ?? "http://localhost:5199/";
mkdirSync(out, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', PORT = 9335, profile = `${out}/.chrome`;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
  '--enable-features=WebMCPTesting,WebMCP', '--enable-blink-features=WebMCP,WebMCPTesting', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map(); const logs = []; const results = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, { res }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const call = async (name, args = {}) => JSON.parse(await ev(`soil.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`));
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, 'base64')); };
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : info); };
const click = async (sel) => { const p = JSON.parse(await ev(`(() => { const r = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(sel)}).getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 }); };
const st = (expr) => ev(`JSON.stringify((() => { const s = soil.app.getState(); return ${expr}; })())`).then(JSON.parse);
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id).res(msg.result ?? {}); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 300)); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '?quick&debug' }); await sleep(7000);

  const api = await ev(`JSON.stringify({ doc: typeof document.modelContext, nav: typeof navigator.modelContext, registered: soil.registered(), tools: soil.tools })`).then(JSON.parse);
  console.log('WebMCP API in this Chrome:', api.doc, api.nav, '| registered with the browser:', api.registered.length);
  check('12 tools defined', api.tools.length === 12, api.tools.join(','));

  // every read tool answers without an error
  for (const [n, a] of [['list_zones', {}], ['read_zone', { zone: 'B' }], ['get_soil_profile', {}], ['score_crops', { zone: 'A', limit: 3 }], ['get_planting_window', { crop: 'carrot' }], ['get_forecast', {}], ['get_history', { zone: 'A', hours: 6 }], ['get_pour_status', {}], ['find_complementary_farms', { limit: 2 }]]) {
    const r = await call(n, a); check(`${n} answers`, !r.error, JSON.stringify(r).slice(0, 200)); await sleep(300);
  }
  await sleep(3000); await ev(`soil.app.getState().goRegion(false)`); await sleep(2500);
  const rz = await call('read_zone', { zone: 'A' });
  check('offline probe is reported offline with null, not a number', rz.moisture.probe_online === false && rz.moisture.relative_pct === null, JSON.stringify(rz.moisture));

  // errors an agent can recover from
  check('unknown zone names the valid ones', /Valid zones: A, B/.test((await call('read_zone', { zone: 'C' })).error));
  check('unknown argument is rejected with the accepted list', /Unknown argument "force".*hold_ms/.test((await call('pour_water', { force: true })).error));
  check('missing required argument', /needs "zone"/.test((await call('score_crops', {})).error));
  check('unknown tool lists the tools', /Available: list_zones/.test((await call('nope')).error));
  check('navigate rejects junk', /Allowed: field, pour/.test((await call('navigate', { view: 'settings' })).error));

  // follow: the screen agrees with the answer
  await sleep(1500);
  await call('score_crops', { zone: 'B' }); await sleep(600);
  check('score_crops opens the plant list on that zone', JSON.stringify(await st('[s.drawer, s.selectedZone]')) === '["plant","B"]');
  await shot('w1-follow-plant');
  await ev(`soil.agent.getState().setFollow(false)`);
  await ev(`soil.app.setState({ drawer: null })`); await call('get_forecast'); await sleep(400);
  check('with follow off nothing moves', (await st('s.drawer')) === null);
  await ev(`soil.agent.getState().setFollow(true)`);

  // navigate, then undo
  const nav = await call('navigate', { view: 'history' }); await sleep(800);
  check('navigate applies when the person is idle', nav.applied === true && (await st('s.view')) === 'history', JSON.stringify(nav));
  check('internal undo data never reaches the agent', !('__undo' in nav));
  await shot('w2-navigate-undo'); await click('Undo'); await sleep(800);
  check('Undo puts the view back', (await st('s.view')) === 'field');

  // never take the wheel: the person is dragging
  await sleep(1500);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 420, button: 'left', clickCount: 1 });
  const busyNav = await call('navigate', { view: 'history' }); await sleep(400);
  check('navigate is offered, not applied, while the person is dragging', busyNav.applied === false && busyNav.offered_to_person === true && (await st('s.view')) === 'field', JSON.stringify(busyNav));
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 420, button: 'left', clickCount: 1 });
  await shot('w3-offer'); await click('Show'); await sleep(700);
  check('the person accepting the offer moves the view', (await st('s.view')) === 'history');
  await ev(`soil.app.getState().setView('field')`); await sleep(1500);

  // pour: hardware is off, so the real route refuses as offline (hard limit, no question asked)
  const off = await call('pour_water'); 
  check('pour with no board: nothing moves, plain reason, no question', off.poured === false && off.result === 'offline' && off.can_be_overridden === false && !(await ev(`!!document.querySelector('.agent-ask')`)), JSON.stringify(off));

  // soft guard: stub ONLY the pour route in the page; record what would have been sent
  await ev(`(() => { window.__pours = []; const real = window.fetch; window.fetch = (u, init) => { if (String(u).endsWith('/api/pour')) { const body = JSON.parse(init.body || '{}'); window.__pours.push(body); const out = body.force ? { ok: true, result: 'started', holdMsUsed: 2500 } : { ok: false, result: 'refused', guard: 'soft', softKind: 'wet', reason: 'Zone A already reads 82 % relative moisture, which is wet.' }; return Promise.resolve(new Response(JSON.stringify(out), { status: 200 })); } return real(u, init); }; })()`);
  // (a) a script pressing the button is not the person
  let p = ev(`soil.call('pour_water')`); await sleep(1200);
  check('soft guard shows the question on the page', await ev(`document.querySelector('.agent-ask')?.textContent.includes('82 %')`));
  await shot('w4-pour-question');
  await ev(`[...document.querySelectorAll('.agent-ask button')].find((b) => b.textContent === 'Pour anyway').click()`);
  let r = JSON.parse(await p);
  check('a scripted click cannot confirm: nothing forced', r.result === 'not_confirmed' && (await ev(`window.__pours.some((b) => b.force)`)) === false, JSON.stringify(r));
  // (b) the person says no
  p = ev(`soil.call('pour_water')`); await sleep(1200); await click('No, leave it'); r = JSON.parse(await p);
  check('person declines: nothing forced', r.result === 'not_confirmed' && (await ev(`window.__pours.some((b) => b.force)`)) === false);
  // (c) the person says yes
  p = ev(`soil.call('pour_water')`); await sleep(1200); await click('Pour anyway'); r = JSON.parse(await p);
  check('a real click confirms: forced once, result says who confirmed', r.poured === true && r.confirmed_by_person_on_page === true && (await ev(`window.__pours.filter((b) => b.force).length`)) === 1, JSON.stringify(r));
  check('the agent cannot pass a confirmation claim', /Unknown argument/.test((await call('pour_water', { confirmed: true })).error));
  await ev(`document.querySelector('.agent-head').click()`); await sleep(500); await shot('w5-trail');

  // onboarding: tools withdraw
  await ev(`soil.app.getState().setStage('build')`); await sleep(800);
  check('during setup the tools say so', /still setting up/.test((await call('list_zones')).error));
  if (api.doc !== 'undefined' || api.nav !== 'undefined') check('and are withdrawn from the browser', (await ev(`soil.registered().length`)) === 0);
  await ev(`soil.app.getState().setStage('live')`); await sleep(800);
  if (api.doc !== 'undefined' || api.nav !== 'undefined') {
    check('and come back afterwards', (await ev(`soil.registered().length`)) === 12);
    const viaBrowser = await ev(`(async () => { const mc = document.modelContext ?? navigator.modelContext; if (!mc.getTools) return 'no getTools'; const tools = await mc.getTools(); const t = tools.find((x) => x.name === 'read_zone'); return JSON.stringify({ n: tools.length, keys: Object.keys(t.__proto__ ?? {}).concat(Object.keys(t)), out: mc.executeTool ? String(await mc.executeTool(t, JSON.stringify({ zone: 'A' })).catch(async (e1) => 'string input failed: ' + e1.message)).slice(0, 160) : 'no executeTool' }); })()`);
    console.log('through the browser API itself:', viaBrowser);
  }
} catch (e) { console.error('FAILED', e); results.push({ name: 'script ran to the end', ok: false }); }
finally {
  console.log(logs.length ? 'CONSOLE ISSUES:\n' + [...new Set(logs)].join('\n') : 'no console errors or warnings');
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  writeFileSync(`${out}/checks.json`, JSON.stringify(results, null, 2));
  chrome.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); process.exit(0);
}
