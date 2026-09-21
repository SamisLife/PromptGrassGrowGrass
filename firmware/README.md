# Firmware

Two sketches for the **Arduino UNO Q** (MCU side, `arduino:zephyr` core). Each does one job, prints a human-readable console, and enforces its own limits. Interpretation happens in the [backend](../backend).

| Sketch | Job | Reusable part |
| --- | --- | --- |
| [`sensor_test/`](sensor_test) | Reads a capacitive soil moisture sensor and a DS18B20 temperature probe once a second, with built-in diagnostics. Flash it on one board per zone. | [`OneWireDS18B20.h`](sensor_test/OneWireDS18B20.h): a 1-Wire / DS18B20 driver that works on this board and refuses to be fooled by a dead bus. |
| [`pour/`](pour) | Tips a water bottle with a servo, holds, and returns to rest, on command only. | [`PulseServo.h`](pour/PulseServo.h): a servo signal held to within 3 µs, where the stock `Servo` library wanders by about 200 µs. |

Both headers are self-contained. Drop either into any UNO Q sketch.

## Why there are custom drivers

- **The Arduino `Servo` library does not produce a steady signal on the UNO Q** (core 1.0.0). Its pulse width was measured wandering by about 200 µs, which a servo reads as its target jumping ±10° fifty times a second: under load it twitches and draws near-stall current. Hardware PWM is not an option on D9, whose timer cannot reach a 20 ms period. `PulseServo.h` times each pulse from a high-priority thread and locks interrupts only for the last 60 µs.
- **The stock OneWire and DallasTemperature libraries are reported not to find a DS18B20 on this board.** `OneWireDS18B20.h` bit-bangs the bus with per-slot interrupt locking. It also checks the idle level, requires the DS18B20 family code and rejects all-zero data, because a data line stuck low otherwise reads as a valid-looking 0.00 °C with a passing CRC.

## Build and flash

```sh
# once
brew install arduino-cli                  # or https://arduino.github.io/arduino-cli
arduino-cli core update-index
arduino-cli core install arduino:zephyr
arduino-cli lib install Arduino_RouterBridge

# per board
arduino-cli board list                                             # find the port
arduino-cli compile --fqbn arduino:zephyr:unoq firmware/pour
arduino-cli upload  --fqbn arduino:zephyr:unoq -p <port> firmware/pour
arduino-cli monitor -p <port> --config baudrate=115200             # the console, both directions
```

No IDE is needed. A console accepts one reader at a time: close the monitor before starting the backend, which needs the console for itself.

## Things to know about the board

- The sketch starts at power-on, but `Bridge.begin()` waits, with no timeout, until the board's Linux side is up, which takes 30 to 60 seconds after a cold start.
- `Serial` is the UART header pins. The USB console is `Monitor`.
- The console replays old output on connect and queues input for a sketch that is not listening. Expect stale commands after a crash.
- Only two dynamically allocated thread stacks exist and the Bridge library uses them. Give your own threads a static stack or the sketch dies silently inside `Bridge.begin()`.

Wiring, servo power and the supplies that do not work: [docs/hardware.md](../docs/hardware.md). Improvements the backend would benefit from: [backend/FIRMWARE_REQUESTS.md](../backend/FIRMWARE_REQUESTS.md).
