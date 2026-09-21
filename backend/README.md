# PromptGrass backend

A local Node process that owns the boards and turns their console output into something software can use: readings, soil analysis, crop scores, weather-aware advice, a map of the surrounding farmland, and a guarded way to pour water. It serves a REST API and a live event stream to the [web app](../web), an [MCP](https://modelcontextprotocol.io) server to AI agents, and an optional voice relay.

**It never calls a language model to produce data.** Readings, rules, scores and advice are deterministic code. The optional voice assistant is the one place a model is involved, and there it is a *client* of the same tools: it can ask and act, it cannot compute or invent a value.

**It has no simulator.** With nothing plugged in it still starts and answers, and every probe reads offline (`null`).

For the concepts behind it (provenance, the pour test, the rules engine, the region pipeline, pour safety) see [docs/architecture.md](../docs/architecture.md). For every route, event and message shape see [API.md](API.md).

## Requirements

- Node 20 or newer
- For hardware: [`arduino-cli`](https://arduino.github.io/arduino-cli) on the `PATH` (the backend uses it to list boards and to open their consoles), and the boards flashed with the sketches in [`firmware/`](../firmware)
- Optional: an [xAI API key](https://console.x.ai/) for the voice assistant

## Run

```sh
npm install
cp .env.example .env        # optional; see Configuration

npm start                   # REST + SSE + MCP on http://127.0.0.1:8787
```

| Command | What it does |
| --- | --- |
| `npm start` | Start the backend: open the boards, serve everything. |
| `HARDWARE=off npm start` | Start without opening any board. Every probe stays offline. Use it with no hardware, or while another backend owns the boards (on another `PORT`). |
| `npm run dev` | The same, restarting on file changes. |
| `npm run scan` | List connected boards, identify each (a status request only, never a pour), print the lines to paste into `.env`, and exit. |
| `npm run mcp` | MCP over stdio. See [MCP](#mcp). |
| `npm test` | Unit and integration tests. Never touch hardware, the network, or a paid API. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build-region [-- lat lon slug name]` | Precompute the land around a coordinate into `region-data/`. |
| `npm run hardware-smoke` | Opt-in check against real boards. Announces, waits for `YES`; add `--pour` to tip the bottle. |
| `npm run voice-smoke` | Opt-in text conversation with the real voice provider against a running backend. |

**One owner.** A board's console accepts one reader, so only one backend may own the boards. A second copy checks the port first, recognises the running one through `/api/health`, says so, and exits without touching a console.

## Configuration

Settings come from the environment, then `backend/.env`, then `web/.env` (so the board serials can live in either place). An empty value counts as unset. `.env` files are gitignored.

| Variable | Default | Meaning |
| --- | --- | --- |
| `POUR_BOARD_SERIAL` | | USB serial number of the board running `firmware/pour` |
| `SENSOR_A_BOARD_SERIAL`, `SENSOR_B_BOARD_SERIAL` | | The boards running `firmware/sensor_test`, one per zone |
| `HOST`, `PORT` | `127.0.0.1`, `8787` | Where to listen. Keep it on loopback. |
| `AUTH_TOKEN` | | Bearer token required by the pour routes. Mandatory if `HOST` is not loopback. |
| `POUR_WET_PCT` | `78` | Refuse a pour when zone A's relative moisture is at or above this, unless confirmed. |
| `POUR_MAX_PER_WINDOW`, `POUR_WINDOW_MS` | `0` (off), `600000` | Optional cap on accepted pours per rolling window, for unattended setups. |
| `HARDWARE` | | `off` = never open a console. |
| `BOARD_PORT` | | One-off override of the pour board's port. |
| `XAI_API_KEY` | | Enables the voice assistant. Never sent to the browser, never logged. |
| `PROMPTGRASS_DATA_DIR` | `backend/data` | Where state is kept. Tests point it at a temporary folder. |

**Identifying boards.** USB serial numbers never change; port names do. With serials set, each role opens the right console. Without them, the backend asks each connected board once what it is, and two unidentified sensor boards become zones A and B in serial order, which can swap after a replug. Set the serials.

## What it serves

| Surface | Address | For |
| --- | --- | --- |
| REST | `/api/...` | configuration, readings, answers, region, pour |
| Live stream | `GET /api/events` | Server-Sent Events with **named** events: `config`, `sample`, `pour`, `profile`, `notes`, `overrides`, `agent_call`, `ui_command`, `region` |
| MCP | `/mcp` (Streamable HTTP), `npm run mcp` (stdio) | AI agents |
| Voice | `GET /api/voice/status`, `WS /api/voice/session` | the web app's voice orb |

The stream is Server-Sent Events rather than a WebSocket because it is one-way (boards to page) and reconnects by itself. Samples arrive at the boards' own rate, one per second. The full reference is in [API.md](API.md).

`GET /api/readings` is the self-describing snapshot meant for any client, human or model: raw counts with their unit, relative moisture with its caveat, per-sensor online flags and ages, trends (or `null`), pour status, connected boards and the soil profile.

## MCP

Tools, shared with the voice assistant and mirrored by the page's WebMCP tools:

| Tool | Effect | Notes |
| --- | --- | --- |
| `list_zones` | read | Start here. |
| `read_zone` | read | Moisture, temperature and watering advice with reasons. |
| `get_readings` | read | The full snapshot, same as `GET /api/readings`. |
| `get_soil_profile` | read | Measured drainage; texture is an estimate. `null` until a pour test has run. |
| `score_crops` | read | The rules engine's scores with reasons. Report them; do not invent others. |
| `get_planting_window` | read | From local frost history and today's soil temperature. |
| `get_forecast` | read | Check before recommending water. |
| `get_history` | read | Summarised past hours for a zone. |
| `find_complementary_farms` | read | Neighbouring farms whose soil complements this plot; also zooms the web app out. Names are illustrative. |
| `add_note` | write | A note in the plot's logbook. |
| `get_pour_status` | read | Whether the pour board is connected and what it is doing. |
| `pour_water` | **physical** | Tips the real bottle. Returns at once: `started`, `busy`, `offline`, `no_reply` or `refused`. |

A prompt, `diagnose_field`, walks a model through the four questions with the live tools.

`pour_water` does not wait for the pour to finish, and asking the human "are you sure?" is the client's job. After `started`, read zone A again in 10 to 20 seconds: the servo has no position feedback, so a moisture change is the only evidence that water arrived. The layers that protect a pour are described in [docs/architecture.md](../docs/architecture.md#pouring-water-safely).

**Sharing one hardware owner between stdio and HTTP.** `npm run mcp` never opens a serial port. If a backend is already running it proxies every tool to it; if nothing is listening it becomes the owner itself and also serves HTTP. So the web app and a desktop MCP client can use the same boards at the same time.

### Connecting a client

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "promptgrass": { "command": "npm", "args": ["run", "mcp"], "cwd": "/absolute/path/to/backend" }
  }
}
```

Any client that takes a URL: `http://127.0.0.1:8787/mcp`.

The MCP Inspector: `npx @modelcontextprotocol/inspector npm run mcp`.

`GET /api/agent/connect-info` returns these details and a starter prompt.

## Voice assistant

Optional, in `src/voice/`. Nothing in the data path imports it, and with no `XAI_API_KEY` every other route behaves exactly the same while `GET /api/voice/status` reports why voice is off.

The backend **relays** between the browser and xAI's realtime speech-to-speech API (`grok-voice-think-fast-2.0`; PCM 16-bit, 24 kHz, mono). It could hand the browser a short-lived key and step aside, but then tool calls would run in the page or not at all. Tools with a physical effect have to run here, so that the guards, the pour log, the liveness check and the origin rules all apply. The cost is one extra hop on loopback.

Three things make it safe and pleasant to use:

- **Plain language first.** Tool results for voice pass through `src/plain.ts`: no ADC counts, no tool names, judgements already made ("the soil is moist", "it rose clearly after the pour"). The model is told to answer in a sentence or two. This keeps answers friendly and keeps token use low.
- **One continuation.** A single model turn may call several tools. The relay asks the model to continue only after the turn has ended *and* every tool has answered, so it never speaks half-informed.
- **Confirmation the model cannot fake.** When a pour is refused by a soft guard, the result carries a single-use token, bound to the session, valid for 60 seconds, that becomes usable only after a further user utterance has reached the backend. Hard limits (busy, offline) are explained, never offered for override.

Browsers give a page the microphone only in a secure context: `http://localhost` and `http://127.0.0.1` qualify, a LAN address over plain http does not.

## Data on disk

JSON and JSONL under `data/` (gitignored):

| File | Contents |
| --- | --- |
| `config.json` | plot, zones, place, calibration, onboarding state |
| `profile.json`, `soil-profiles.jsonl` | the current soil profile, and every completed measurement |
| `history.board.jsonl` | readings: full rate during a pour, every 15 s otherwise |
| `pour-log.jsonl` | every pour request with its caller (`http`, `legacy`, `mcp-http`, `mcp-stdio`, `voice`) and outcome |
| `notes.json` | the logbook |
| `frost-<lat>,<lon>.json`, `region-<lat>,<lon>.json` | cached lookups |

`region-data/` (committed) holds precomputed regions; `demo-yakima.json` backs the demo coordinate so the region view never depends on a live USDA query.

## Layout

```
src/
  index.ts, http.ts         entry point; routes, CORS, origin checks, SSE
  app.ts                    application state and the methods every surface calls
  hardware.ts, console.ts   board ownership, console sessions, liveness before a pour
  discover.ts, parse.ts     board identification; console line parsing
  stale.ts, online.ts       replayed-output filter; per-sensor online tracking
  percent.ts                raw counts -> relative moisture; calibration checks
  pourDetector.ts           the pour test: onset detection, wetting-front speed, drainage bands
  pourGuards.ts             soft guards for a pour
  crops.ts, season.ts       the crop rules engine; frost dates and planting windows
  advice.ts, weather.ts     watering advice and findings; Open-Meteo client
  history.ts, persist.ts    storage
  region/                   projection, CDL classes, USDA clients, grid and fields, matching
  tools.ts, plain.ts        the shared tool layer; plain-language results for voice
  mcp.ts, stdio.ts, proxy.ts  MCP server, stdio entry, HTTP proxy for the stdio entry
  voice/                    relay, session logic, confirmation tokens, prompt
test/                       see Testing
scripts/                    opt-in hardware and voice checks; region precompute
```

## Testing

```sh
npm test
```

The suite uses recorded console lines, a mocked voice provider and a synthetic land raster. It never opens a serial port, never sends a pour, never reaches the network, and writes only to a temporary data folder. It covers parsing, staleness, percent mapping, the detector, guards, crop scoring, the region pipeline (projection against a hand-checked point, grid and fields, the drainage mapping, the set difference, disk cache, the shipped demo file), the tool layer, the confirmation-token lifecycle and a full refuse-confirm-pour conversation.

Real hardware and a real conversation are covered by the two opt-in scripts, which announce what they are about to do and wait.

## Notes for anyone wiring the USDA services

- **CropScape** takes coordinates in EPSG:5070 metres, answers every request with a URL to a file that expires, serves an incomplete TLS chain that Node rejects (the client falls back to `curl`, which completes the chain; verification is never disabled), and takes 6 to 15 seconds. Its statistics endpoint returns JavaScript-like text, not JSON.
- **Soil Data Access** takes T-SQL over POST, returns every value as a string, answers an empty result with an empty body, wants WKT points as *longitude latitude*, and accepts many points in one statement through `UNION ALL`.

## Firmware wishes

Changes to the sketches that would make this side more reliable, none of them required: [FIRMWARE_REQUESTS.md](FIRMWARE_REQUESTS.md).
