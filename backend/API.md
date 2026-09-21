# Backend API reference

Base URL `http://127.0.0.1:8787`. JSON everywhere. Every `/api` body also carries `mode: "board"`: the data always comes from real hardware, never a simulator. Domain objects (`ZoneLive`, `ZoneReading`, `SoilProfile`, `CropScore`, `PlantingWindow`, `Forecast`, `FrostDates`, `Region`, ...) are defined in [`src/types.ts`](src/types.ts) and [`src/region/types.ts`](src/region/types.ts); the web app mirrors them in `web/src/data/types.ts`.

**Conventions.** `null` means *unknown*, never zero. Moisture percentages are *relative* to a probe's own air and water readings. Anything estimated says so in a `label`, `note` or `estimate: true` field. CORS admits pages served from the same machine on any port.

## REST

### Readings and answers

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `{ ok, uptime_s, missing }` (`missing` lists boards that are not connected) |
| GET | `/api/readings` | The self-describing snapshot (below) |
| GET | `/api/zones` | every zone's `ZoneReading` |
| GET | `/api/zones/:id` | `{ reading }`: live values, calibration state, watering advice |
| PATCH | `/api/zones/:id` | body `{ sun?, ph?, name? }` |
| GET | `/api/zones/:id/crops` | `{ crops }`: `CropScore[]`, best first, each with factors and reasons |
| GET | `/api/zones/:id/planting-window/:cropId` | `{ window }` or `null` when no location is set |
| GET | `/api/zones/:id/history?hours=24` | `{ history }` |
| GET | `/api/zones/:id/findings` | `{ diagnosis }`: deterministic findings, not a model |
| GET | `/api/soil-profile` | `{ profile }` or `null` until a pour test has completed |
| DELETE | `/api/soil-profile` (or POST `/api/soil-profile/clear`) | forget the measured profile on purpose |
| GET | `/api/forecast` | `{ forecast }`; `source` is `open-meteo`, `sample` (no network, labelled) or `override` |
| GET | `/api/frost-dates` | `{ frost }`; always an estimate |
| GET, POST | `/api/notes` | `{ notes }`; POST body `{ text, zoneId?, author? }` |
| GET | `/api/connectivity` | how data leaves the field, and what is actually connected |
| GET | `/api/boards` | connected boards with role, zone, and whether their console is open |

`GET /api/readings`, abridged:

```json
{
  "mode": "board",
  "generated_at": "2026-09-20T06:00:00.000Z",
  "zones": {
    "A": {
      "moisture": {
        "raw_adc_counts": 3488,
        "raw_unit": "12-bit ADC counts, 16-sample average. Higher means drier soil.",
        "relative_moisture_pct": 1.8,
        "relative_moisture_note": "Percent of this probe's air-to-water range. Not volumetric water content.",
        "state": "dry", "online": true, "age_ms": 180, "implausible": false,
        "trend": { "unit": "raw ADC counts; negative means getting wetter", "delta_1min": 0, "delta_5min": -2, "delta_15min": null }
      },
      "temperature": { "celsius": 21.6, "unit": "°C, DS18B20 at about 5 cm depth", "online": true, "age_ms": 180 }
    }
  },
  "pour": { "detector": { "phase": "idle" }, "actuator": { "connected": true, "phase": "idle" } },
  "boards": { "present": [], "missing": [] },
  "soil_profile": null
}
```

A trend is `null` when no stored sample lies close enough to the start of its window.

### Configuration

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/config` | |
| PUT | `/api/config/plot` | `{ plot, zones }` |
| PUT | `/api/config/place` | a `Place` (`{ name, lat, lon, region?, country? }`) or `{ place }`. Also starts loading the region for that place. |
| POST | `/api/config/onboarded` | `{ done }` |
| POST | `/api/calibrate/:probe` | `{ step: "air" \| "water" }`; waits about a second while a median is captured; refuses a pair with too little swing |
| POST | `/api/calibrate/:probe/reset` | back to the shipped defaults |
| GET | `/api/places?q=` | geocoding (Open-Meteo) |
| GET, PUT | `/api/overrides` | demonstration overrides for forecast and moisture; always visible in the interface when active |

### Pour

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/pour` | body `{ holdMs?, force? }` → `{ ok, result, reason?, guard?, softKind?, reading?, holdMsUsed? }` |
| GET | `/api/pour/status` | `{ actuator, detector }` |
| POST | `/api/pour/arm` | arm the pour *test* (the detector) |
| POST | `/api/pour/reset` | cancel or re-arm the test. Never touches the saved soil profile. |
| POST | `/api/pump` | always refuses: no pump is fitted |

`result` is one of `started`, `busy`, `cooldown` (only if the firmware is built with one), `offline`, `no_reply`, `refused`, `unauthorized`. A refusal carries `guard`: `hard` can never be overridden; `soft` (`softKind`: `wet` or `window`) can be, with `force: true`, which a well-behaved client sends only after a person has confirmed. Pour routes reject a request whose `Origin` is not a page on this machine, and require `Authorization: Bearer <AUTH_TOKEN>` when one is configured.

Legacy aliases kept for the web app's Pour button: `POST /pour`, `GET /status`, `GET /events` (actuator phases as SSE: `tipping`, `holding`, `returning`, `done`), `GET /boards`. They run the same guards.

### Region

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/region` | `{ status, reason, region, matches, unserved, you, method }` |
| GET | `/api/region/matches` | the same without the grid |
| POST | `/api/region/show` | body `{ farm? }`; emits `ui_command { view: "region", farm? }` |
| GET | `/api/region/demo-place` | the coordinate whose region ships precomputed |

`status` is `no_place`, `loading`, `ready` or `unavailable` (with a `reason`, for example outside the contiguous United States). `region` holds the grid (`n`, `cellM`, `cells`, `fieldOf`), `fields` (crop, area, distance, bearing, soil), `legend`, `sources`, `year` and `precomputed`. `matches` is empty until this plot's drainage has been measured; `you.measured` says which. `method` states the thresholds and what is measured, looked up and estimated.

### Agents

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/agent/connect-info` | MCP URL, stdio command, tool list, a starter prompt |
| POST | `/api/agent/calls` | body `{ tool, zones, summary }`; used by the stdio proxy so its calls glow in the interface too |
| ALL | `/mcp` | MCP Streamable HTTP. `Host` is validated to block DNS rebinding. |

## Live stream

`GET /api/events` is Server-Sent Events with **named** events; subscribe with one `addEventListener` per name. Each payload repeats its `type` and carries `mode`.

| Event | Payload |
| --- | --- |
| `config` | `{ config }` on connect and on every change |
| `sample` | `{ t, zones: { [id]: ZoneLive } }` about once a second |
| `pour` | `{ pour: PourState }`: the pour *test* (`idle`, `armed`, `running`, `done`, `timeout`) |
| `profile` | `{ profile }` when a test completes or the profile is cleared |
| `notes`, `overrides` | the new value |
| `agent_call` | `{ tool, zones, summary, t, id }` for every tool run through MCP or voice, so touched zones can glow |
| `ui_command` | `{ view?, drawer?, zone?, lens?, crop?, farm? }`: an agent asked the interface to move |
| `region` | `{ status }`: fetch `/api/region` again |

`ui_command` vocabulary: `view` = `field`, `pour`, `history`, `network`, `region`; `drawer` = `soil`, `plant`, `when`, `water`, `diagnose`, `none`; `zone` = a zone id; `lens` = `natural`, `moisture`, `temperature`; `crop` = an id from the crop scores; `farm` = a field id from the region. `region` is a zoom level of the field view, not a page.

## Voice

### `GET /api/voice/status`

Always available. Reports `enabled`, a human-readable `reason` when disabled, the model, the audio format, the WebSocket URL and what a browser client must do. The API key never appears.

### `WS /api/voice/session`

Accepted from pages on this machine only. `503` when voice is disabled.

Client to server:

```json
{ "type": "input_audio", "audio": "<base64 pcm_s16le, 24 kHz, mono>" }
{ "type": "text", "text": "How is zone B?" }
{ "type": "end" }
```

Server to client:

```json
{ "type": "session_started", "session_id": "a1b2c3d4", "model": "...", "audio": { "rate": 24000, "channels": 1, "encoding": "pcm_s16le" } }
{ "type": "listening" }
{ "type": "user_transcript", "text": "Pour water.", "final": true, "item_id": "item_abc" }
{ "type": "thinking" }
{ "type": "tool_call_started", "tool": "pour_water", "zones": ["A"], "call_id": "..." }
{ "type": "awaiting_confirmation", "what": "pour_water", "kind": "wet", "reason": "...", "expires_in_s": 60 }
{ "type": "tool_call_finished", "tool": "pour_water", "zones": ["A"], "ok": false, "summary": "Pour refused" }
{ "type": "assistant_transcript", "text": "...", "final": false }
{ "type": "speaking_started" }
{ "type": "output_audio", "audio": "<base64 pcm_s16le>" }
{ "type": "speaking_ended" }
{ "type": "error", "message": "a sentence a person can act on", "code": "provider" }
{ "type": "session_ended", "reason": "client_end" }
```

Notes for a client:

- Capture and play **PCM 16-bit little-endian, 24 000 Hz, mono**, in chunks of 100 to 200 ms. Do not resample to 48 kHz.
- The final transcript of one utterance can arrive in growing pieces that share an `item_id`. Replace the line for that id; do not append.
- `awaiting_confirmation` means the model will ask the person out loud. Show a confirming state. Do not build a button that forces the pour: the confirmation token lives in the tool result the model sees and becomes usable only after the person's next utterance.
- The microphone needs a secure context: `http://localhost` or `http://127.0.0.1`.
