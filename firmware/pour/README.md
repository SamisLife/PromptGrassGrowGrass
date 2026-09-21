# pour

Tips a water bottle with a servo, holds, and returns to rest. It pours only when told to.

```
idle ──pour──▶ tipping ──▶ holding ──▶ returning ──▶ idle
```

## Wiring

```
5 V supply, USB-A, 2 A+ ── cut USB cable ──┬─ red   → servo red
                                           └─ black → servo brown  AND  a UNO Q GND pin
UNO Q D9 → servo signal (yellow/orange)
```

The servo needs its own supply and a ground shared with the board. Details and the list of supplies that do not work: [`docs/hardware.md`](../../docs/hardware.md).

## Console

| Command | Effect |
| --- | --- |
| `p` / `p2500` | pour (optionally holding for 2500 ms) |
| `s` | status: `phase,current_deg,rest_deg,pour_deg,hold_ms,pours,cooldown_ms_left` |
| `n-3` / `n+5` | nudge the position by degrees |
| `z` | save the current position as REST |
| `r<deg>` / `t<deg>` | set REST and go there / set the POUR angle |
| `d20` / `x` | repeat pours for 20 s (max 60) / stop after the current pour |
| `j` | servo signal jitter since the last check |

Defaults are at the top of [`pour.ino`](pour.ino): REST 180°, POUR 75°, hold 1500 ms. Runtime changes are kept in RAM and revert on reset, so write your final numbers into the sketch.

**Finding your angles:** nudge with `n` until the bottle is level, then `z`. Set the pour angle with `t`, try `p`, adjust.

A hobby servo has no position feedback. "Current angle" means the last commanded angle; if the servo loses power the firmware cannot know.

## Bridge API

For code on the board's Linux side (`Bridge.call("pour", 0)` in Python).

| Call | Returns |
| --- | --- |
| `pour(hold_ms)`, `<= 0` = default | `1` started, `-1` busy, `-2` cooling down (only when `COOLDOWN_MS` is set above 0; the default is 0). Returns at once |
| `pour_status()` | the status string above |
| `pour_set_rest_here()`, `pour_set_rest_deg(d)`, `pour_set_pour_deg(d)` | the new value, or `-1` while pouring |
| notification `pour_event(name, value)` | `tipping`, `holding`, `returning`, `done`, `rest_saved` |

Limits enforced on the board, whoever calls: one pour at a time, hold time clamped to 200-5000 ms, angles clamped, and the bottle always returns to rest. The repeat mode is console-only. Asking a human "are you sure?" is the caller's job.

## Self-test at boot

Set `SELFTEST_AT_BOOT_S` to, say, `20` and the board pours repeatedly for that long at every power-on, before it waits for the Linux side. It is a quick way to see that the firmware runs and the servo has power. It pours real water, so it is off by default.

## Verified

On an UNO Q with an MG996R and a half-full water bottle: repeated pour cycles, refusal while busy, and a signal width error of +1 to +3 µs over thousands of pulses, idle and while moving.
