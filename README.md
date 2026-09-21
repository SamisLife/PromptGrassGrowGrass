# PromptGrass

**Push two probes into the soil. Minutes later the plot is alive on screen, and an AI can read it, explain it, and water it.**

PromptGrass is an open hardware-and-software stack for small plots: capacitive moisture sensors and temperature probes on Arduino UNO Q boards, a servo that tips a water bottle, a local backend that owns the hardware, a 3D web app, and three ways for an AI agent to work with all of it. It was built at HackMIT 2026.

Everything it shows answers one of four questions:

1. **What is my soil like?** Measured by pouring water at one probe and timing it to the other.
2. **What can I plant here?** Twenty-six crops scored 0 to 100 by a transparent rules engine, each score with its reasons.
3. **When should I plant it?** From ten years of local frost history and today's soil temperature.
4. **Does it need water?** From live moisture, the soil's drainage, and the real rain forecast.

A fifth view puts the plot in its world: zoom out and the farmland around it appears, from public USDA data, with the farms whose soil *complements* this one lit up.

## Principles

These are design constraints, not slogans. Code that breaks them is a bug.

- **Every number traces to a reading, a calculation or a lookup.** Nothing is invented, and no language model is in the data path. Agents read the numbers; they do not produce them.
- **Estimates are labelled as estimates.** Soil texture inferred from drainage speed, frost dates, a neighbour's drainage class: each says what it is.
- **Offline is shown as offline.** A disconnected probe reads `null`, never a stale or default value. There is no simulator: with no hardware attached, the app says so.
- **Relative moisture is never called volumetric.** A capacitive probe reports a position between its own air and water readings. That is what the app calls it.
- **Physical actions are guarded where the actuator is.** The firmware enforces its own limits no matter who calls. Software above it adds checks; it never replaces them.
- **The person stays in charge.** An agent's actions are visible, reversible where possible, and never take the view away from someone using it.

## How it fits together

```
 soil ── probes ──▶ UNO Q ×2 (sensor_test)  ─┐
                                              ├─ USB ─▶  backend  ──REST + SSE──▶  web app (3D field)
 bottle ◀─ servo ◀─ UNO Q    (pour)         ─┘   │  ▲                                │
                                                  │  └── Open-Meteo, USDA CDL, USDA SSURGO
                                                  │
                          AI agents ──────────────┼── MCP server (any MCP client, stdio or HTTP)
                                                  ├── Grok voice assistant (speech in, speech out)
                                                  └── WebMCP tools in the page (an agent built into the browser)
```

| Part | What it does | Read more |
| --- | --- | --- |
| [`firmware/`](firmware) | Two sketches for the UNO Q: one reads the sensors, one tips the bottle. Both include drivers written for this board because the stock libraries do not work on it. | [firmware/README.md](firmware/README.md) |
| [`backend/`](backend) | A local Node process that is the single owner of the boards. Turns console lines into readings, runs the rules, fetches weather and land data, and exposes REST, a live event stream, an MCP server and a voice relay. | [backend/README.md](backend/README.md) |
| [`web/`](web) | The interface: a living 3D model of the plot, the four answers, the pour test, history, the region zoom, a voice orb, and the page's own agent tools. | [web/README.md](web/README.md) |
| [`docs/`](docs) | How the system works and why it is built this way; wiring and power. | [architecture](docs/architecture.md), [hardware](docs/hardware.md) |

## Quick start

### Without hardware

The backend and the web app run with nothing plugged in. Every probe reads *offline*, which is a state the interface is designed to show, and the region view works in full.

```sh
# terminal 1
cd backend
npm install
HARDWARE=off npm start            # http://127.0.0.1:8787

# terminal 2
cd web
npm install
npm run dev                       # http://localhost:5173
```

Open `http://localhost:5173`. Add `?quick` to skip onboarding. To see the region view with its best data, open the location step and choose the demo coordinate (lower Yakima Valley, Washington), whose data ships with the repository.

### With hardware

1. Build the circuit in [docs/hardware.md](docs/hardware.md): three UNO Q boards on USB, two with a moisture sensor and a DS18B20 each, one with the servo. **The servo needs its own 5 V supply.**
2. Flash the sketches with `arduino-cli` ([firmware/README.md](firmware/README.md)).
3. `cd backend && npm run scan` prints each board's USB serial number and what it is running. Put the three serials in `backend/.env` (copy `.env.example`).
4. `npm start`, then `npm run dev` in `web/`, and walk through onboarding: draw the plot, place the probes, set the location, calibrate in air and water.
5. Run the pour test. It measures how fast water travels between the probes, and from then on the crop scores know the soil.

### Requirements

Node 20 or newer, a current Chromium-based browser (WebGL 2), and for hardware work [`arduino-cli`](https://arduino.github.io/arduino-cli) with the `arduino:zephyr` core. macOS is what the project was developed on; nothing in it is macOS-specific except serial port names.

## Working with AI agents

The same deterministic tool layer is offered three ways. Tool names and results are shared, so an agent behaves the same whichever door it uses.

| Surface | For | How |
| --- | --- | --- |
| **MCP server** | Any MCP client: Claude Desktop, ChatGPT connectors, the MCP Inspector, custom agents | `npm run mcp` (stdio) or `http://127.0.0.1:8787/mcp` (Streamable HTTP). [Details](backend/README.md#mcp) |
| **Voice** | Talking to the plot hands-free | An optional relay to xAI's realtime speech API; tools run locally. Needs an `XAI_API_KEY`. [Details](backend/README.md#voice-assistant) |
| **WebMCP** | An agent built into the browser, working in the same tab as the person | The page registers twelve tools through `document.modelContext`. [Details](web/README.md#webmcp-an-agent-in-the-same-tab) |

Agents can read zones, soil, crop scores, planting windows, forecast and history, find complementary farms, write notes, move the interface, and pour water. Pouring is the only action with a physical effect, and it is protected in layers: firmware limits that cannot be bypassed, a backend check that the board is alive before any command is sent, a guard against pouring onto wet soil, and a confirmation that only the person can give. See [docs/architecture.md](docs/architecture.md#pouring-water-safely).

## Status and limits

Working end to end on real hardware: sensing, the pour test, crop scoring, planting windows, watering advice, history, the region view, the MCP server, the voice assistant and the WebMCP tools.

Known limits, stated plainly:

- The drainage bands and the crop table are reasonable reference values. They have **not** been validated agronomically. Treat the scores as informed suggestions.
- Probe B borrows probe A's calibration until it is calibrated itself; the interface marks this.
- The pour test measures lateral wetting-front speed in a container. It correlates with texture; it is not a lab infiltration test.
- The region view covers the contiguous United States only (that is what the USDA Cropland Data Layer covers). Elsewhere it says it has no data.
- Farm names and people in the region view are illustrative and labelled so. Public land data knows crops, not owners.
- The servo has no position feedback. The only evidence that water arrived is the moisture reading afterwards, and the software says so.
- There is no authentication story for multi-user or internet-facing deployment. The backend binds to `127.0.0.1` and is meant to stay there.

## Repository layout

```
firmware/
  pour/            servo pour, with PulseServo.h (a jitter-free servo signal for the UNO Q)
  sensor_test/     moisture + DS18B20, with OneWireDS18B20.h (a 1-Wire driver that works on the UNO Q)
backend/
  src/             hardware owner, rules, weather, region, MCP, voice relay, HTTP
  region-data/     precomputed land data for the demo coordinate
  test/            unit and integration tests (never touch hardware or paid APIs)
web/
  src/scene/       the 3D field, probes and region, in three.js with custom shaders
  src/ui/          panels, drawers, onboarding, voice orb, agent presence
  src/agent/       WebMCP tools and the rules for sharing the screen with an agent
  tools/           real-time headless-browser checks (layout, interactions, WebMCP)
docs/              architecture and hardware notes
```

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the checks to run, and the rules that keep the project honest: no simulated data, no test that moves hardware or calls a paid API, and provenance for every number.

## Acknowledgements

Weather and geocoding by [Open-Meteo](https://open-meteo.com). Cropland data from the [USDA NASS Cropland Data Layer](https://nassgeodata.gmu.edu/CropScape/). Soil survey data from [USDA NRCS Soil Data Access](https://sdmdataaccess.sc.egov.usda.gov/). Built with [three.js](https://threejs.org), React, zustand, the [Model Context Protocol](https://modelcontextprotocol.io) SDK and `arduino-cli`.

## License

[MIT](LICENSE)
