# Firmware requests

Built against `PromptGrassGrowGrass` `sensor_test` and `pour` as they are today. These would make the laptop owner more reliable. None of them are required for the demo to function.

## 1. Sample faster while a pour is running (high value)

Sensor boards print **once per second**. Sand in the demo container can wet through in 20–40 s; onset is backdated, so speed error is about one sample on each end (~5–10 % on a 20 s travel). Gravel is worse. The detector is adapted (`HOLD=2`, EMA 0.55) but it cannot invent information between seconds.

A 5–10 Hz stream **during** a pour (and 1 Hz otherwise) would tighten wetting-front timing without flooding the USB console at rest. A command like `f10` (Hz) / `f1` would be enough; the backend can raise the rate when `p` is accepted and drop it on `pour: done`.

## 2. A board self-identification command that is not `s`

Zero-config identification currently opens the console, sends `s`, and classifies the reply. On pour firmware `s` is status (harmless). On `sensor_test` `s` is ignored (also harmless). A dedicated `i` → `id: pour` / `id: sensor_test` plus serial or role would:

- avoid relying on banner text that only appears at boot (and is easily lost in replay)
- tell zone A from zone B if the sketch knew its role
- mean we never send a pour-shaped command while probing

Today two unidentified sensor boards are assigned A/B by sorted serial, which can swap after a replug.

## 3. Machine-friendly sample lines

Human lines work:

```
[362s] moisture raw=3516 (2.83 V)  T0=26.12
```

A stable, split-safe form would survive firmware copy tweaks:

```
M uptime=362 raw=3516 T0=26.12
```

or JSON. Optional: a monotonic `seq=` so replay vs live does not depend only on uptime (which resets at reboot and collides with the replay burst).

## 4. Uptime on pour *status* (events already have it)

`[21.5s] pour: tipping` is stamped; `status: idle,180,...` is not. After connect we already wait ~2.5 s before trusting pour lines. A leading `[uptime]` on `status:` would let the same stale-filter reject a replayed `status: holding` from a previous pour.

## 5. Do not queue `p`

The router queues console input for a sketch that is not listening yet. A stale `p` from a previous session can pour water after a flash. The backend never sends `p` speculatively; identification uses `s` only. A firmware-side “ignore commands older than N ms” or a drain-on-boot would still be a useful belt.

## 6. Probe-not-wired vs wet

A floating A0 reads a steady ≈ 1100. We flag raw outside 1500–3700 as implausible. A firmware `moisture: OPEN` / `moisture: OK` after a short open-circuit check would be clearer than a magic range.

## Not requested

- Changing pour limits (cooldown, hold clamp, always-return-to-rest): we surface those refusals as-is.
- Temperature on the pour board.
- Combining sensors onto one board (the product is two zones on two boards).
