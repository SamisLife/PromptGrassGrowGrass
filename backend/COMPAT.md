# Frontend compatibility

The backend JSON is meant to match `web/src/data/types.ts` field for field on the domain objects (`ZoneLive`, `SoilProfile`, `CropScore`, `Forecast`, …). This file is what a frontend client will need to do, and where we had to wrap or extend.

## Wrappers (not type changes)

Every REST body except the four legacy pour-bridge aliases includes a sibling `mode: "board"` (always real hardware: the backend simulator was removed on 2026-09-20; `HistorySeries.simulated` is always `false`). Domain objects themselves are not given a `mode` field, so they stay assignable to `types.ts`. The page’s “Simulated probes” badge should read `mode` from the envelope (or from each SSE event, which also carries `mode`).

SSE events are the `BoardEvent` shapes from `web/src/data/source.ts`, plus `mode`, plus one extra event:

```ts
{ type: 'agent_call'; tool: string; zones: ZoneId[]; summary: string; t: number; id: number; mode }
```

`BoardEvent` today has no `agent_call`. The store records those only from in-browser WebMCP. When you switch the client to this backend, subscribe to `agent_call` on `/api/events` and call `recordAgentCall` (or write the glow state directly). This is demo-critical: MCP tool calls must light up the 3D field.

## Legacy pour button

`POST /pour`, `GET /status`, `GET /events`, `GET /boards` keep the pour-bridge shapes (`{ ok, result }`, `{ connected, phase, ... }`, SSE `{ phase, t }`). `web/src/services/pourBridge.ts` should keep working against this process on `:8787`. Stop `node tools/pour-bridge.mjs` first.

`GET /events` (legacy) streams **actuator** phases (`tipping` | `holding` | `returning` | `idle`), not the pour-detector `PourState`. `GET /api/events` event `pour` is the detector `PourState` the 3D field uses.

## `BoardSource` methods vs HTTP

| BoardSource | HTTP |
| --- | --- |
| `connect(listener)` | `GET /api/events` (SSE) |
| `setPlot` / `updateZone` / `setPlace` / `setOnboarded` | `PUT /api/config/plot`, `PATCH /api/zones/:id`, `PUT /api/config/place`, `POST /api/config/onboarded` |
| `calibrate` / `clearCalibration` | `POST /api/calibrate/:probe`, `.../reset` |
| `armPour` / `resetPour` | `POST /api/pour/arm`, `/api/pour/reset` |
| `readZone` | `GET /api/zones/:id` → `{ reading }` |
| `soilProfile` | `GET /api/soil-profile` → `{ profile }` |
| `scoreCrops` | `GET /api/zones/:id/crops` → `{ crops }` |
| `plantingWindow` | `GET /api/zones/:id/planting-window/:cropId` → `{ window }` |
| `forecast` / `frostDates` | `/api/forecast`, `/api/frost-dates` |
| `history` | `GET /api/zones/:id/history?hours=` |
| `addNote` | `POST /api/notes` |
| `connectivity` | `GET /api/connectivity` |
| `setOverrides` | `PUT /api/overrides` |
| `runPump` | `POST /api/pump` still refuses |
| `diagnose` | **not an LLM.** `GET /api/zones/:id/findings` returns the deterministic `Diagnosis` from `advice.ts`. The Diagnose button should show `GET /api/agent/connect-info` and tell the user to connect their assistant. |

A real `BoardSource` client will need to implement `calibrate()` as HTTP, including the 1–2 s wait while the backend captures a median (the server already waits).

## Types the backend added (AI-facing only)

`GET /api/readings` and `get_readings` are new. They are not in `types.ts`. They carry raw ADC, relative %, trend deltas, ages, implausible flags, pour status, boards, `mode`. Keep them self-describing; do not flatten them into `ZoneLive`.

`HistoryPoint` on the backend may include `moistureRaw` in addition to `moisturePct` and `tempC`. Extra field; old clients can ignore it.

`PourResult` adds `refused` and `unauthorized` next to the bridge’s `started` | `busy` | `cooldown` | `offline` | `no_reply`. `POUR_RESULT_TEXT` in `pourBridge.ts` should map those (or treat unknown as a generic refusal).

## Assumptions we could not satisfy from HTTP alone

- `BoardSource.mode` is a readonly field on the in-browser object. Over the wire it is on every payload and every SSE event.
- In-browser `SimBoard` ticks at 200 ms. Real hardware is 1 Hz, and that is what the backend streams: the 3D field must interpolate between samples itself.
- `navigator.onLine` is a browser concept. `connectivity().internetReachable` is inferred from whether Open-Meteo succeeded.
- Config/notes/profile persist in `backend/data/`, not `localStorage`. Switching the client off SimBoard means onboarding state lives on the laptop process; a browser refresh will re-fetch `/api/config`.
- Geocoding: `GET /api/places?q=` exists so the client can stop calling Open-Meteo from the browser. Until then the existing `openMeteo.ts` still works.

## Voice assistant (additive)

New named SSE event on `GET /api/events` — existing listeners that subscribe by name can ignore it:

```ts
{ type: 'ui_command'; view?: 'field'|'pour'|'history'|'network'; drawer?: 'soil'|'plant'|'when'|'water'|'diagnose'|'none'; zone?: 'A'|'B'; lens?: 'natural'|'moisture'|'temperature'; crop?: string; t: number; mode: 'board' }
```

`agent_call` is unchanged and is now also emitted for voice tools (including `navigate` and `pour_water`).

New REST / WS (not used by `backendBoard.ts` today):

| Route | Shape |
| --- | --- |
| `GET /api/voice/status` | `{ enabled, reason, provider, path, model, audio, browser, mode }` — see README examples |
| `GET /api/voice/session` | WebSocket upgrade. Client: `{type:'input_audio', audio}`, `{type:'text', text}`, `{type:'end'}`. Server events: `session_started`, `listening`, `user_transcript`, `thinking`, `tool_call_started`, `tool_call_finished`, `assistant_transcript`, `speaking_started`, `speaking_ended`, `output_audio`, `awaiting_confirmation`, `error`, `session_ended`. Audio is pcm_s16le 24000 Hz mono, JSON base64. |

Voice UI animation events travel on that WebSocket, not on SSE. `ui_command` travels on SSE so the page can move even if it only listens to `/api/events`.

Do not rename existing events or REST keys. The floating Grok mark should read `/api/voice/status` and, if `enabled`, open the session socket from `browser.websocket`.

## Diagnose

We kept the deterministic `diagnose()` findings as `GET /api/zones/:id/findings`. We did not build an AI version (per the brief). The MCP prompt `diagnose_field` is what ChatGPT / Muse should run.

## Pour detector, 1 Hz

Ported from `web/src/data/sim/pour.ts` with:

- `HOLD` 3 → 2 (3 samples at 1 Hz was 3 s of onset latency)
- EMA alpha 0.4 → 0.55
- baseline fallback at 3 samples instead of 5

Thresholds `RISE_PCT`, `EARLY_PCT`, `MIN_TRAVEL_S`, and the drainage bands are unchanged. Texture remains `estimate: true`.
