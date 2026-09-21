# Contributing

Thank you for looking. Bug reports, ideas, documentation fixes and code are all welcome. A board is **not** required for most work: the backend and the web app run with `HARDWARE=off`, and none of the automated checks touch hardware.

## Ground rules

These are what make the project trustworthy. A change that breaks one will be asked to change, however good it is otherwise.

1. **Every number has a provenance.** A value shown to a person or returned to an agent is measured, calculated, looked up or estimated, and an estimate says that it is one. If a value cannot be computed honestly, return `null` and let the caller say "unknown". Never substitute a nearby quantity under the same label.
2. **No simulated data.** There is no simulator and no generated history. Offline hardware is shown as offline. Data of different provenance never shares a store.
3. **No language model in the data path.** Readings, scores, advice and matching are deterministic code. Models are clients of the tool layer.
4. **Tests never move hardware, never call a paid API, never touch real data.** Mock the provider, replay recorded console lines, use a temporary data folder. Anything that needs a real board or a real account is a separate, opt-in script that announces itself and waits.
5. **Physical safety lives closest to the actuator.** Firmware limits are not relaxed because a layer above also checks. Before a command with a physical effect, prove the device is live and listening.
6. **The person stays in charge.** Agent actions are visible and, where meaningful, reversible. An agent never moves the view away from someone who is using it, and never confirms on a person's behalf.
7. **Secrets and serial numbers stay out of the repository.** They belong in gitignored `.env` files. Never log a key.

## Setup

```sh
git clone https://github.com/SamisLife/PromptGrassGrowGrass.git
cd PromptGrassGrowGrass

cd backend && npm install && HARDWARE=off npm start     # terminal 1
cd web && npm install && npm run dev                    # terminal 2
```

Node 20 or newer. For firmware work, `arduino-cli` with the `arduino:zephyr` core (see [firmware/README.md](firmware/README.md)).

## Before opening a pull request

| Area | Run |
| --- | --- |
| `backend/` | `npm run typecheck && npm test` |
| `web/` | `npm run build`, and for anything visual the browser checks in [web/README.md](web/README.md#checks) (`shots`, `layout-check`, `webmcp-check`). Include a before and after screenshot. |
| `firmware/` | `arduino-cli compile --fqbn arduino:zephyr:unoq <sketch>`. Say in the pull request what was verified on a real board and what was not. |

New behaviour comes with a test where a test is possible. A bug fix comes with the test that would have caught it.

## Style

- TypeScript, strict. Match the code around you: its naming, its comment density, its idiom.
- **Comments explain why.** The code already says what. The most useful comments in this repository record a constraint that is not visible in the code: a hardware quirk, an API's odd behaviour, a bug that a line exists to prevent.
- Words on screen are written for a gardener, not an engineer. Tool descriptions are written for a model that has no other documentation. Error messages are sentences someone can act on.
- The web app's name and colours come from `web/src/brand.ts`. Violet means the AI and nothing else.
- Keep dependencies few. A small, well-chosen library is welcome; a framework is a discussion first.

## Commits and pull requests

[Conventional Commits](https://www.conventionalcommits.org/) with the area as scope: `feat(web): ...`, `fix(backend): ...`, `docs: ...`. The body says **why**, and what was and was not verified. Keep a pull request to one concern; separate a refactor from a behaviour change.

## Reporting a problem

Useful reports include: what was expected and what happened; the backend's console output around the time; for hardware, the wiring and the power supply (most servo problems are power problems; see [docs/hardware.md](docs/hardware.md)); for the agent tools, the contents of the status panel behind the AI pill in the top bar.

**Security.** If a finding could let a web page, a network peer or an agent move the servo or read data it should not, please report it privately to the maintainers through GitHub's security advisory form rather than in a public issue.

## Good places to start

- The firmware wish list in [backend/FIRMWARE_REQUESTS.md](backend/FIRMWARE_REQUESTS.md): a faster sample rate during a pour, a self-identification command, machine-friendly sample lines.
- Calibrating the drainage bands and the crop table against soils and sources of known quality.
- Land data outside the contiguous United States (the EU crop maps, Canada's Annual Crop Inventory, SoilGrids).
- Extending the crop table beyond garden crops so the region view can speak about orchards and field crops.
- A real, opt-in farmer directory behind the region view's contact action.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
