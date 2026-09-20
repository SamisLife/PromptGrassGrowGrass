# PromptGrass backend

Laptop-side owner of the three Arduino UNO Q consoles. It replaces `web/tools/pour-bridge.mjs`, serves live soil data to the Vite app, and exposes the same data plus `pour_water` to AI agents over MCP.

The backend **never calls an LLM** for readings, rules, weather, crop scores, Diagnose, or MCP. The optional Grok voice assistant in `src/voice/` is the one exception; with no `XAI_API_KEY` it is inert.

## Run

Node 20+ (26 is fine). From this folder:

```sh
npm install
cp .env.example .env   # optional; serials can also live in ../web/.env
```

**There is no simulator.** Every number this backend serves comes from a real probe. With no boards plugged in it still starts and answers, and every probe reads offline (`null`), never a made-up value.

In another terminal, `cd ../web && npm run dev`. The existing “Pour water” button talks to `127.0.0.1:8787`.

**Real boards:** plug the three UNO Qs in over USB-C, put serials in `.env`, `npm start`. The process is the **single owner** of all three consoles. Stop `npm run bridge` in `web/` first or you will get `Serial port busy`.

```sh
npm run scan          # identify every connected board, then exit (sends `s`, never `p`)
npm test              # unit tests; never talks to hardware
npm run typecheck
npm run mcp           # MCP over stdio (see below)
npm run hardware-smoke  # opt-in; announces, waits for YES; add --pour to actually tip
npm run voice-smoke     # opt-in; talks to a running backend + xAI; never pours unless --pour and YES
```

Bind is `127.0.0.1:8787` by default. CORS allows any page served from this machine (`localhost`, `127.0.0.1`, `[::1]`) on any port.

**No hardware, or a backend already owns the boards:** `HARDWARE=off npm start` starts HTTP/MCP/voice without opening a console. Every probe stays `offline` / `null`. Nothing is simulated. Do not start a second copy on the same port — the process checks `/api/health` first and exits in plain words.

## How stdio and HTTP share one hardware owner

A serial console can have only one reader.

- `npm start` starts the owner: it opens the consoles, serves REST + SSE, and mounts MCP Streamable HTTP at `/mcp`.
- `npm run mcp` is the stdio entry. It **never opens a serial port**. If `http://127.0.0.1:8787/api/health` answers, every tool is proxied to that API. If nothing is listening, the stdio process starts the owner itself (HTTP + hardware) and speaks MCP on stdin/stdout.

So: start `npm start` for the web app, then point Claude Desktop at `npm run mcp`. Or launch only `npm run mcp` and the web app can still use `:8787`.

## `.env`

See `.env.example`. Serials are also read from `web/.env` if `backend/.env` does not set them (backend wins on conflict).

| Variable | Default | Meaning |
| --- | --- | --- |
| `POUR_BOARD_SERIAL` | (empty) | USB serial of the pour board |
| `SENSOR_A_BOARD_SERIAL` | | Zone A sensor board |
| `SENSOR_B_BOARD_SERIAL` | | Zone B sensor board |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | HTTP bind |
| `AUTH_TOKEN` | unset | Required for pour if `HOST` is not loopback; also enforced on loopback if set |
| `POUR_MAX_PER_WINDOW` | `8` | Server-side cap |
| `POUR_WINDOW_MS` | `600000` | 10 minute rolling window |
| `POUR_WET_PCT` | `78` | Refuse pour if zone A relative moisture ≥ this, unless `force` |
| `BOARD_PORT` | unset | One-off pour-board port override |
| `HARDWARE` | unset | `off` = do not open consoles; probes stay offline |
| `XAI_API_KEY` | unset | Enables the Grok voice relay. Never sent to the browser. |

**Pour-guard defaults.** Firmware already enforces one pour at a time, a 4 s cooldown, and a 200–5000 ms hold. The server adds: at most 8 accepted pours per 10 minutes (a demo is 2–4; a half bottle should not be emptied into the container) and a refusal when zone A is already in the app’s “wet” band (78 %), so an agent cannot flood saturated soil without passing `force: true`.

With no serials, each unknown board is asked once (`s` only), classified, and released. Two unidentified sensor boards are assigned A then B by sorted serial; set the env vars to pin them.

## Live stream

`GET /api/events` is **Server-Sent Events**, not a WebSocket. The sample stream is one-way (board → page), the existing pour-bridge already used SSE, and `EventSource` is what the frontend pour button speaks. Events: `config`, `sample`, `pour`, `profile`, `notes`, `overrides`, `agent_call`, `ui_command`.

`agent_call` (`{ type, tool, zones, summary, t, id, mode }`) is emitted whenever an MCP or voice tool runs, so the page can glow the touched zones.

`ui_command` is new (voice `navigate` tool). Existing listeners that subscribe by event name can ignore it. See COMPAT.md.

## Endpoints

Every JSON body includes `mode: "board"` (real hardware; the simulator was removed) except the four legacy aliases, which keep the pour-bridge shapes so the current button keeps working.

### `GET /api/readings`

The “any AI” snapshot. Example (truncated):

```json
{
  "mode": "board",
  "generated_at": "2026-09-20T06:00:00.000Z",
  "generated_at_unix_ms": 1758348000000,
  "zones": {
    "A": {
      "name": "Zone A",
      "probe": "A",
      "moisture": {
        "raw_adc_counts": 3488,
        "raw_unit": "12-bit ADC counts, 16-sample average. Higher means drier soil.",
        "relative_moisture_pct": 1.8,
        "relative_moisture_note": "Percent of this probe's air-to-water range. Not volumetric water content.",
        "state": "dry",
        "online": true,
        "age_ms": 180,
        "implausible": false,
        "trend": { "unit": "raw ADC counts; negative means getting wetter", "delta_1min": 0, "delta_5min": -2, "delta_15min": -5 }
      },
      "temperature": { "celsius": 21.6, "unit": "°C, DS18B20 at about 5 cm depth", "online": true, "age_ms": 180 },
      "sampled_at": "2026-09-20T06:00:00.000Z",
      "sampled_at_unix_ms": 1758348000000
    }
  },
  "pour": { "detector": { "phase": "idle" }, "actuator": { "connected": true, "phase": "idle" } },
  "boards": { "present": [], "missing": ["pour board (servo / water bottle)", "sensor board A", "sensor board B"] },
  "soil_profile": null
}
```

### Other REST

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, mode, uptime_s, missing }` |
| GET | `/api/zones` | all `ZoneReading` |
| GET | `/api/zones/:id` | `{ reading }` matching `types.ts` |
| PATCH | `/api/zones/:id` | `{ sun, ph, name }` |
| GET | `/api/zones/:id/crops` | `CropScore[]` |
| GET | `/api/zones/:id/planting-window/:cropId` | `PlantingWindow \| null` |
| GET | `/api/zones/:id/history?hours=24` | `HistorySeries` |
| GET | `/api/zones/:id/findings` | deterministic `Diagnosis` (not an LLM) |
| GET | `/api/soil-profile` | `{ profile }` |
| GET | `/api/forecast` | `{ forecast }` |
| GET | `/api/frost-dates` | `{ frost }` |
| GET | `/api/notes` | `{ notes }` |
| POST | `/api/notes` | `{ text, zoneId?, author? }` |
| GET | `/api/connectivity` | `{ connectivity }` |
| GET | `/api/config` | plot, zones, place, calibration |
| PUT | `/api/config/plot` | `{ plot, zones }` |
| PUT | `/api/config/place` | a `Place` or `{ place }` |
| POST | `/api/config/onboarded` | `{ done }` |
| POST | `/api/calibrate/:A|B` | `{ step: "air" \| "water" }` |
| POST | `/api/calibrate/:A|B/reset` | restore bench defaults |
| GET/PUT | `/api/overrides` | demo overrides |
| GET | `/api/places?q=` | Open-Meteo geocoding |
| POST | `/api/pour` | `{ holdMs?, force? }` → `{ result, ok, reason, next }` |
| GET | `/api/pour/status` | actuator + detector |
| POST | `/api/pour/arm` | arm the pour detector |
| POST | `/api/pour/reset` | clear detector + saved profile |
| GET | `/api/boards` | connected UNO Qs |
| GET | `/api/agent/connect-info` | MCP URL, stdio command, starter prompt |
| GET | `/api/events` | SSE |
| POST | `/api/pump` | always refuses (not fitted) |

Legacy (same port, same shapes as `pour-bridge.mjs`):

| Method | Path |
| --- | --- |
| POST | `/pour` |
| GET | `/status` |
| GET | `/events` |
| GET | `/boards` |

`POST /api/pour` and `POST /pour` results: `started` | `busy` | `cooldown` | `offline` | `no_reply` | `refused` | `unauthorized`.

## MCP

Streamable HTTP: `http://127.0.0.1:8787/mcp`  
stdio: `npm run mcp` from `backend/`

Tools (names are what the model reads):

| Tool | Side effects | Notes |
| --- | --- | --- |
| `list_zones` | read | start here |
| `read_zone` | read | includes raw ADC |
| `get_soil_profile` | read | texture is an estimate |
| `score_crops` | read | report these scores; do not invent |
| `get_planting_window` | read | |
| `get_forecast` | read | check before watering |
| `get_history` | read | raw + percent |
| `add_note` | write | |
| `get_readings` | read | same payload as `GET /api/readings` |
| `pour_water` | **physical** | annotated `destructiveHint` + `openWorldHint`; optional `hold_ms`, `force` |
| `get_pour_status` | read | |

Prompt: `diagnose_field` — which tools to call, quote real numbers, separate measured from estimated, check forecast before water, verify a pour by re-reading zone A.

`pour_water` returns immediately (`started` / `busy` / `cooldown` / `refused` / `offline`). The human “are you sure?” belongs to the MCP client. After `started`, read zone A in 10–20 s; falling raw counts are the only evidence water arrived.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "promptgrass": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/HackMIT/backend"
    }
  }
}
```

Start `npm start` first if you also want the web app on the same hardware.

### ChatGPT (or any client that takes a URL)

Connect to `http://127.0.0.1:8787/mcp`. Keep the backend on loopback. If you tunnel it, set `HOST` to the bind address **and** `AUTH_TOKEN`, and send `Authorization: Bearer …` on `pour_water` / `POST /api/pour`.

### Generic MCP client / Inspector

```sh
npx @modelcontextprotocol/inspector npm run mcp
```

Or point a Streamable HTTP client at `/mcp`. `GET /api/agent/connect-info` is the copy-paste card for the Diagnose button.

## Persistence

JSON / JSONL under `backend/data/` (gitignored): config, notes, soil profile, frost cache, `history.board.jsonl`, `pour-log.jsonl`. History is stored at full 1 Hz during a pour and every 15 s otherwise. Simulated data is never written here.

## Grok voice assistant

Optional module in `src/voice/`. Nothing in the data path imports it. With no `XAI_API_KEY`, every existing route behaves as today.

### What we found in xAI's docs (2026-09-20)

xAI ships a **Speech-to-Speech / Voice Agent realtime API** on a normal API key (WebSocket, not a separate product we could not reach):

- URL: `wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-2.0`
- We pin `grok-voice-think-fast-2.0` (not `grok-voice-latest`, which lagged on 1.0 until 2026-08-05).
- Audio: PCM 16-bit little-endian, **24 kHz**, mono (`audio/pcm`). Server VAD is available.
- Function tools: `session.update` with `{ type: "function", name, description, parameters }`. The model emits `response.function_call_arguments.done`; the client must `conversation.item.create` a `function_call_output` and then `response.create`.
- Auth: `Authorization: Bearer $XAI_API_KEY` on the WebSocket (Node can set headers). Browsers cannot; xAI also mints ephemeral client secrets (`POST /v1/realtime/client_secrets`) used as the subprotocol `xai-client-secret.<token>`.
- Pricing published for 2.0: about **$0.08 per minute of audio** plus a small text rate (~$0.004 / text input). Rate limits were not listed on the pages we read.
- Input transcription is optional (`audio.input.transcription.model: grok-transcribe`) so the UI can show a live transcript.

**We relay.** Ephemeral tokens would let the browser talk to xAI directly, but then function tools would run in the page (or xAI would have to call our MCP, which is localhost and unreachable). Tools with a physical effect must run here so pour guards, the pour log (`caller: "voice"`), liveness, and origin checks all apply. Cost of the extra hop: one WebSocket through this process, on the order of tens of milliseconds on loopback, plus the same xAI round-trip you would pay anyway.

**Fallback we did not build:** if an account cannot open the realtime socket, the frontend can still capture with the Web Speech API and play with `speechSynthesis`, posting text turns as `{ type: "text" }` once a chat-completions path exists. That path is not implemented. `{ type: "text" }` already works on the relay for tests and `npm run voice-smoke`.

### `GET /api/voice/status`

Always available. Example when disabled:

```json
{
  "mode": "board",
  "enabled": false,
  "reason": "XAI_API_KEY is not set. Add it to backend/.env (never the browser). Create a key at https://console.x.ai/",
  "provider": "xai-realtime",
  "path": "server-relay",
  "model": "grok-voice-think-fast-2.0",
  "audio": {
    "codec": "audio/pcm",
    "rate": 24000,
    "channels": 1,
    "encoding": "pcm_s16le",
    "transport": "json-base64"
  },
  "browser": {
    "websocket": "ws://127.0.0.1:8787/api/voice/session",
    "connect": "Open a WebSocket to ws://127.0.0.1:8787/api/voice/session. Send JSON {type:\"input_audio\", audio:\"<base64 pcm_s16le>\"}. Receive JSON events listed in README (session_started, listening, user_transcript, thinking, tool_call_*, assistant_transcript, speaking_*, output_audio, awaiting_confirmation, error, session_ended).",
    "secure_context": "Microphone access needs a secure context. http://localhost and http://127.0.0.1 qualify. A LAN address over plain http does not. The Vite origin port may change; the backend accepts any local origin.",
    "capture": "AudioContext at 24000 Hz, mono, Int16 PCM little-endian. Chunk ~100–200 ms. Send {type:\"input_audio\", audio: base64}. Do not resample to 48 kHz. Optional {type:\"text\", text} for typed turns (tests / smoke). {type:\"end\"} closes the session.",
    "playback": "Play output_audio payloads as pcm_s16le 24000 Hz mono. speaking_started / speaking_ended bound a reply."
  }
}
```

When enabled, `enabled` is `true` and `reason` is `null`. The API key is never in this body.

### `GET /api/voice/session` (WebSocket upgrade)

Local `Origin` only (same rule as pour). No `Origin` (scripts) is allowed. If voice is disabled the upgrade is `503`.

**Client → server**

```json
{ "type": "input_audio", "audio": "<base64 pcm_s16le 24 kHz mono>" }
{ "type": "text", "text": "How is zone B?" }
{ "type": "end" }
```

**Server → client** (animate the floating mark from these; do not wait on SSE for them). Verified against xAI on 2026-09-20: the final transcript of ONE utterance arrives in growing pieces ("Is zone", "Is zone A doing", …), each with `final: true` and the same `item_id`. Replace the line for that `item_id`; do not append. One model response may call several tools; the backend tells Grok to continue only after all of them have answered.

```json
{ "type": "session_started", "session_id": "a1b2c3d4", "model": "grok-voice-think-fast-2.0", "audio": { "codec": "audio/pcm", "rate": 24000, "channels": 1, "encoding": "pcm_s16le", "transport": "json-base64" } }
{ "type": "listening" }
{ "type": "user_transcript", "text": "pour water", "final": false }
{ "type": "user_transcript", "text": "Pour water.", "final": true, "item_id": "item_abc" }
{ "type": "thinking" }
{ "type": "tool_call_started", "tool": "pour_water", "zones": ["A"], "call_id": "…" }
{ "type": "awaiting_confirmation", "what": "pour_water", "kind": "wet", "reason": "Zone A already reads 82 percent relative moisture, that's wet. …", "expires_in_s": 60 }
{ "type": "tool_call_finished", "tool": "pour_water", "zones": ["A"], "ok": false, "summary": "Pour refused" }
{ "type": "assistant_transcript", "text": "Zone A already reads 82 percent, that's wet. Are you sure?", "final": false }
{ "type": "speaking_started" }
{ "type": "output_audio", "audio": "<base64 pcm_s16le>" }
{ "type": "speaking_ended" }
{ "type": "error", "message": "Lost the connection to xAI. Check the API key and try again.", "code": "provider" }
{ "type": "session_ended", "reason": "client_end" }
```

Named SSE event `ui_command` (on `GET /api/events`) is how `navigate` moves the page:

```json
{ "type": "ui_command", "view": "history", "drawer": "plant", "zone": "B", "lens": "moisture", "crop": "carrot", "t": 1758348000000, "mode": "board" }
```

All of `view`, `drawer`, `zone`, `lens`, `crop` are optional. Vocabulary: `view` = `field` | `pour` | `history` | `network`; `drawer` = `soil` | `plant` | `when` | `water` | `diagnose` | `none`; `zone` = `A` | `B`; `lens` = `natural` | `moisture` | `temperature`; `crop` = an id from `score_crops`. Unknown values are a tool error the model can recover from. `agent_call` is also emitted for every voice tool, including `navigate`.

### Confirmation UI

1. User says "Pour water."
2. You receive `awaiting_confirmation` (and the model will ask out loud). Show a confirm state on the mark; do not send a pour yourself.
3. User says "Yes, do it."
4. The server arms the `confirm_token` only after that user turn. The model then calls `pour_water` with the token. You will see `tool_call_started` / `tool_call_finished` with `ok: true` if the bottle actually tipped.
5. After a successful pour the model should re-read zone A. There is no servo position feedback; if moisture did not fall it should say so.

Do not implement a "force pour" button that bypasses this. The token never leaves the tool result that xAI sees; the browser does not need it.

### Audio the frontend must capture and play

- Capture and playback: **pcm_s16le, 24000 Hz, mono**.
- Send chunks as JSON `{ type: "input_audio", audio: base64 }`.
- Play `{ type: "output_audio", audio }` the same way.
- Secure context: `http://localhost` and `http://127.0.0.1` (any port). A `http://192.168.*` Vite origin will not get a microphone.

`npm run voice-smoke` is an opt-in text conversation against a running backend. It never pours unless you pass `--pour` and type `YES`.

## Tests vs hardware

`npm test` uses recorded console lines and mocked xAI. It never spawns `arduino-cli monitor`, never writes `p`, and never calls xAI. Manual opt-in: `scripts/hardware-smoke.ts` (real `p` after YES) and `scripts/voice-smoke.ts` (real Grok conversation against a running backend; `--pour` still needs YES, and the server still enforces `confirm_token`).

## Firmware

Do not edit firmware from here. Requests that would make this more reliable: [`FIRMWARE_REQUESTS.md`](FIRMWARE_REQUESTS.md). Frontend contract gaps: [`COMPAT.md`](COMPAT.md).
