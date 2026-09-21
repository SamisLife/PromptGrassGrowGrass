# PromptGrass web app

The interface: a living 3D model of the plot, four answers along the bottom, a pour test that measures the soil, a history scrubber, a zoom-out over the surrounding farmland, a voice orb, and a set of tools for an AI agent that shares the tab with the person.

Vite, React, TypeScript, raw [three.js](https://threejs.org) with custom GLSL, and [zustand](https://github.com/pmndrs/zustand). No UI framework, no component library, no second rendering engine.

It shows **real data only**. There is no in-browser simulator: without the [backend](../backend) it says it is waiting for one, and with a backend but no hardware every probe reads *offline*.

## Run

```sh
npm install
npm run dev            # http://localhost:5173
```

Start the backend first (`cd ../backend && npm start`, or `HARDWARE=off npm start` with no boards). The page connects by itself and reconnects if the backend restarts.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload. |
| `npm run build` | Typecheck, then a production build into `dist/`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run preview` | Serve the production build. |

| Setting | Default | Meaning |
| --- | --- | --- |
| `VITE_BACKEND` | `http://127.0.0.1:8787` | Where the backend is. |

URL switches: `?quick` skips onboarding; `?debug` exposes the stores as `window.soil.app` and `window.soil.agent`; `?voicegate` turns on a noise gate for a loud room; `?webmcp=text` makes agent tools return JSON text instead of objects.

**Use `localhost`.** The microphone and WebMCP exist only in a secure context. `http://localhost` and `http://127.0.0.1` qualify; a LAN address over plain http does not, and on one the voice orb and the agent tools are simply absent.

## A tour

**Onboarding.** Draw the plot to size, drag the two probe sets to where they are in the soil, set the location (search, geolocation, pasted coordinates, or the demo coordinate), and calibrate each probe in air and in water.

**The field.** A slab of earth, to scale, that reacts to the readings: soil darkens as it wets, sprouts follow moisture, a droplet hovers over a zone that needs water. Each zone is drawn as its two real sensors, a capacitive moisture blade and a steel DS18B20 tube with their cables, each with its own status light, because the two can fail independently. Lenses recolour the soil by moisture or temperature.

**Four answers.** What is my soil like, what can I plant, when should I plant, does it need water. Each opens a drawer with the reasoning, the numbers behind it, and what is unknown.

**The pour test.** Pour a cup at one probe; the app times the water to the other and turns distance over time into a drainage rate. The front drawn between the probes is an estimate and is never shown arriving before the second probe reports it.

**History.** Scrub back through recorded readings; the field replays them.

**The region.** Scroll out from the plot and the camera rises over 24 km of real farmland, tiled by crop. Fields whose soil complements this plot glow and send a thin line home. Touching one opens a card with exactly three lines (they grow; you could grow, they can't; they could grow, you can't), one sentence, and a contact draft. It is a **zoom level of the same scene, not a page**: the plot stays in the centre and scrolling in brings it home. The legend states that tiles are not to scale and are not property boundaries; farm names and people are labelled illustrative.

**Voice.** A floating orb: tap, speak, and the assistant answers aloud, moves the interface and can pour water, asking first when the soil is already wet. Hidden in small windows, where it also closes any open session so a hidden orb never holds a microphone.

**Narrow panes.** Below 900 px the rail becomes a bottom dock, every panel becomes one bottom sheet, and the four answers become a swipeable strip, so the app works inside a split window or an embedded browser.

## How it is built

```
src/
  brand.ts                 name, colours, fonts: the single place for branding
  data/
    source.ts              BoardSource: everything the app needs from "the board", as one interface
    backendBoard.ts        its implementation: named SSE events plus REST
    store.ts               zustand store; applyUiCommand() is the one way the view is moved by anything but the person
    types.ts               the data contract, mirrored from the backend
    sim/                   small pure rule helpers the UI still uses (thresholds, wording). Not a simulator.
  scene/
    FieldScene.ts          the 3D plot, camera modes, picking; reads the store every frame, no React in the hot path
    shaders.ts             soil and sprout GLSL
    Probe.ts               the two sensors per zone, procedural geometry
    RegionLayer.ts         the farmland: one instanced mesh, one shader, arcs to the matches
    FieldCanvas.tsx        the canvas plus HTML tags that ride on 3D points
  ui/                      top bar, rail, answers, drawers, pour panel, history, onboarding, region, voice orb, agent presence
  voice/                   microphone capture (AudioWorklet, 24 kHz PCM), gapless playback, barge-in; session state
  agent/                   WebMCP: tools, registration, what the person sees of the agent, and when the person is busy
  services/                pour button transport; geocoding
tools/                     real-time browser checks (below)
```

**One seam to the hardware.** The interface talks to `BoardSource` and nothing else. Pointing the app at different hardware, or at a recording, means writing one class.

**The scene is not React.** `FieldScene` reads the store inside its own animation loop and drives shader uniforms directly; React renders only the panels and the HTML tags positioned over 3D points. This keeps sixty frames a second independent of interface re-renders.

**Every moving part goes through one function.** The voice assistant's navigation (a backend event), the page's agent tools and the undo of either all call `applyUiCommand()`. There is one vocabulary for moving the app and one implementation of it.

## WebMCP: an agent in the same tab

[WebMCP](https://github.com/webmachinelearning/webmcp) lets a page hand tools to the *browser*, so an agent built into that browser can call them while the person looks at the same tab. It is different from the backend's MCP server, which is reached over the network and whose work nobody sees. A WebMCP tool is a function in this page: it reads the same store the screen is drawn from, and it moves the interface.

The page registers twelve tools through `document.modelContext.registerTool` (falling back to older API names), from a small script that loads before the 3D bundle so an agent that looks for tools at page load finds them: `list_zones`, `read_zone`, `get_soil_profile`, `score_crops`, `get_planting_window`, `get_forecast`, `get_history`, `find_complementary_farms`, `get_pour_status`, `add_note`, `navigate`, `pour_water`.

How the page behaves while an agent uses it:

- **Visible.** A plain-language status in the AI's violet ("Reading zone B"), a violet frame while it acts, the touched zone glows, and a trail of recent actions opens from the status pill. Calls made through the backend (voice, MCP clients) join the same trail.
- **In agreement.** After the agent reads crop scores, the plant list for that zone is open, so what it says and what the screen shows match. This can be switched off.
- **Never taking the wheel.** While the person is dragging, scrolling, typing, running a pour test or writing a message, an agent's navigation is not applied: it is offered as a button that expires, and the tool result tells the agent so. Trusted input events are how the page knows the person from the agent.
- **Reversible.** View changes can be undone from the pill or the trail.
- **Pouring is the person's decision.** `pour_water` goes through the backend's guarded route only. If the soil guard objects, the page asks "Pour anyway?" and the tool call waits; the override is sent only from a trusted click on that button. The tool has no argument that claims confirmation, and unknown arguments are rejected.
- **Recoverable errors.** A tool never throws; every problem comes back as a sentence ("Unknown zone 'C'. Valid zones: A, B.").

The pill in the top bar opens a status panel: whether the browser exposes the API, how many tools registered and how fast, any registration error, and the last calls that arrived from the browser's agent with their outcome. To exercise the tools without any agent: `window.soil.call('read_zone', { zone: 'A' })`.

As of September 2026 the API is available in Chrome behind `chrome://flags/#enable-webmcp-testing` and in the built-in browser of the ChatGPT desktop app (as "site tools").

## Checks

There is no unit-test runner here; the interface is verified in a real browser. The scripts drive headless Chrome over the DevTools protocol **in real time**, because Chrome's virtual-time mode freezes `requestAnimationFrame` after a few frames and a living scene then looks dead.

They expect a hardware-off backend on a spare port and a dev server pointed at it, so they can never touch real boards or real data:

```sh
# terminal 1
cd ../backend && PORT=8799 HARDWARE=off PROMPTGRASS_DATA_DIR=/tmp/pg-check npx tsx src/index.ts
# terminal 2
VITE_BACKEND=http://127.0.0.1:8799 npx vite --port 5199
# terminal 3
node tools/shots.mjs ./shots                 # screenshots of every state + 12 interaction checks
node tools/layout-check.mjs ./layout-check   # 13 screens x 5 window sizes: nothing overflows, nothing overlaps
node tools/webmcp-check.mjs ./webmcp-check   # every tool, errors, the busy rule, the pour question, the browser API itself
```

States that need hardware (live readings, a pour in progress) are reached by setting the store from the script. That is for looking only; nothing fake ships.

## Conventions

- Name and colours come from `src/brand.ts` and CSS custom properties; nothing else hard-codes them. Violet is reserved for the AI.
- Every number on screen is a reading, a calculation or a lookup, and estimates are labelled. A label may be restyled; it may not be removed or made easy to miss.
- Offline is shown as offline. An offline flag wins over an old value.
- `prefers-reduced-motion` stops automatic camera rotation and makes camera moves immediate.
