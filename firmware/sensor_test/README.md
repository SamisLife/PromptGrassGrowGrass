# sensor_test

Bring-up test for the two soil sensors. It prints one line per second and can explain itself when something is wrong.

```
[12s] moisture raw=3465 (2.79 V)  T0=25.81
```

## Wiring

| Part | Connection |
| --- | --- |
| Capacitive soil moisture sensor v1.2 | VCC → 3V3, GND → GND, AOUT → **A0**. No resistor |
| DS18B20 probe | red → 3V3, black → GND, yellow → **D2**, plus **4.7 kΩ between D2 and 3V3** |

Several DS18B20 probes can share D2 and the one resistor.

## Commands

| Command | Effect |
| --- | --- |
| `r` | rescan the bus and print its health: timing, idle level, presence, ROMs found |
| `t` | temperature diagnostics: power mode, conversion time, raw scratchpad |

## Reading the moisture value

The voltage **rises as the soil dries**: air reads high, water reads low. Calibrate each probe by noting both. On our probe at 3.3 V (12-bit ADC): air ≈ 3470, water ≈ 2000, noise ±3 counts. Dip the probe only up to its printed line; the electronics at the top must stay dry. A probe whose value never changes may be from a batch that only works at 5 V: power it from 5 V and add a two-resistor divider on AOUT so the pin never sees more than 3.3 V.

## When the temperature is wrong

| You see | Meaning |
| --- | --- |
| `idle level: LOW -> NO EXTERNAL PULL-UP` | the 4.7 kΩ is missing or not making contact |
| `power mode = PARASITE`, readings `ERR`, scratchpad shows 85.0 | the probe's red wire is not getting 3.3 V. 85.0 °C is the chip's power-on value: it never measured |
| `ROM 0000000000000000`, 0.00 °C (older code) | the data line is stuck low. All-zero data passes the CRC, which is why this driver checks the line first |
| conversion done after ~335 ms | likely a clone chip (genuine parts take longer). Harmless |

## Verified

On an UNO Q: moisture in air / water / air (3487 → 1998 → 3465), and a DS18B20 read 39 times out of 39 with valid CRCs once wired correctly. Read-slot timing measured on the board: sample about 4 µs after the edge (spec: within 15 µs). Absolute temperature accuracy was not checked against a reference; an ice-water bath should read 0 ± 0.5 °C.
