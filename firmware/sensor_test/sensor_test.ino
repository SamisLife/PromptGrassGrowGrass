// sensor_test: bring-up test for the two soil sensors on an Arduino UNO Q.
//
//   Capacitive soil moisture sensor v1.2   AOUT -> A0   (VCC -> 3V3, GND -> GND)
//   DS18B20 waterproof temperature probe   data -> D2   (red -> 3V3, black -> GND,
//                                                         4.7k between D2 and 3V3)
//
// Prints one line per second to the console (`Monitor`; on the UNO Q, `Serial` is the
// UART header pins, not USB). Commands, followed by Enter:
//   r   rescan the 1-Wire bus and print the bus health report
//   t   temperature diagnostics: power mode, conversion time, raw scratchpad
//   ?   help
//
// MOISTURE: the output voltage RISES as the soil gets DRIER (air reads high, water reads
// low). Every probe has its own range, so calibrate each one: note the raw value in air
// and in a glass of water (only up to the line printed on the probe; the electronics at
// the top must stay dry). A healthy probe swings by more than 1000 counts at 12 bits.
// If the value never changes, that probe may only work at 5 V: power it from 5 V and put
// a two-resistor divider on AOUT so the ADC never sees more than 3.3 V.
//
// MIT License. See ../../LICENSE.

#include "Arduino_RouterBridge.h"
#include "OneWireDS18B20.h"

#define BUILD_ID __DATE__ " " __TIME__

const int PIN_MOISTURE = A0;
const int PIN_ONEWIRE  = 2;
const int ADC_BITS = 12;

OneWireDS18B20 probes(PIN_ONEWIRE);
String inputLine;

// 16 quick reads averaged: the ADC is fast and the averaging removes most of the noise.
int readMoistureRaw() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(PIN_MOISTURE);
  return (int)(sum / 16);
}

void printRom(const uint8_t *rom) {
  for (int j = 0; j < 8; j++) { if (rom[j] < 16) Monitor.print('0'); Monitor.print(rom[j], HEX); }
}

void scanBus() {
  const OneWireDS18B20::Timing t = probes.measureTiming();
  Monitor.print("1-Wire timing: pinMode="); Monitor.print(t.pinModeUs); Monitor.print(" us, digitalRead="); Monitor.print(t.readUs);
  Monitor.print(" us -> read slot samples ~"); Monitor.print(t.sampleAtUs); Monitor.print(" us after the edge: ");
  Monitor.println(t.sampleAtUs <= 15 ? "OK (spec: <=15)" : t.sampleAtUs <= 28 ? "MARGINAL" : "TOO SLOW");

  switch (probes.checkLine()) {
    case OneWireDS18B20::LINE_OK:
      Monitor.println("1-Wire idle level: HIGH -> external pull-up present: good"); break;
    case OneWireDS18B20::LINE_NO_EXTERNAL_PULLUP:
      Monitor.println("1-Wire idle level: LOW -> NO EXTERNAL PULL-UP (4.7k from the data pin to 3V3 is missing or not making contact).");
      Monitor.println("  Continuing on the weak internal pull-up: fine for a bench test, unreliable otherwise."); break;
    case OneWireDS18B20::LINE_STUCK_LOW:
      Monitor.println("1-Wire line is held LOW even with a pull-up: data shorted to GND, probe wired backwards, or data wire on the wrong pin.");
      Monitor.println("DS18B20 found: 0"); return;
  }

  Monitor.print("1-Wire presence pulse: "); Monitor.println(probes.reset() ? "YES" : "NO (check wiring and the 4.7k pull-up)");
  probes.search();
  if (probes.lastSearchError == OneWireDS18B20::SEARCH_BAD_FAMILY) { Monitor.print("  rejected a ROM with family code 0x"); Monitor.print(probes.lastBadFamily, HEX); Monitor.println(" (not a DS18B20, or bits are being misread)"); }
  if (probes.lastSearchError == OneWireDS18B20::SEARCH_BAD_CRC) Monitor.println("  ROM CRC error (bits are being misread)");
  Monitor.print("DS18B20 found: "); Monitor.println(probes.count);
  for (int i = 0; i < probes.count; i++) { Monitor.print("  ROM "); printRom(probes.roms[i]); Monitor.println(); }
}

void temperatureDiagnostics() {
  if (probes.checkLine() == OneWireDS18B20::LINE_STUCK_LOW || !probes.reset()) { Monitor.println("T-DEBUG: no presence pulse"); return; }
  const bool external = probes.externallyPowered();
  Monitor.print("T-DEBUG: power mode = ");
  Monitor.println(external ? "EXTERNAL (VDD wired: good)" : "PARASITE (the probe sees no VDD: is the red wire really at 3V3?)");

  probes.startConversion();
  const unsigned long t0 = millis(); long doneAfter = -1;
  if (external) { while (millis() - t0 < 1200) { if (probes.readBit()) { doneAfter = millis() - t0; break; } delay(10); } }
  else delay(900);
  Monitor.print("T-DEBUG: conversion signalled done after "); Monitor.print(doneAfter); Monitor.println(" ms (-1 = not signalled; up to 750 expected at 12 bits)");

  for (int i = 0; i < probes.count; i++) {
    uint8_t sp[9];
    if (!probes.readScratchpad(i, sp)) { Monitor.println("T-DEBUG: probe did not answer"); continue; }
    Monitor.print("T-DEBUG: scratchpad =");
    for (int j = 0; j < 9; j++) { Monitor.print(' '); if (sp[j] < 16) Monitor.print('0'); Monitor.print(sp[j], HEX); }
    const int16_t raw = (int16_t)((sp[1] << 8) | sp[0]);
    Monitor.print("  crc "); Monitor.print(OneWireDS18B20::crc8(sp, 8) == sp[8] ? "OK" : "BAD");
    Monitor.print("  -> "); Monitor.print(raw / 16.0f, 4); Monitor.print(" C");
    if (raw == 0x0550) Monitor.print("  [85.0 = power-on value: the conversion never ran]");
    Monitor.println();
  }
}

void printHelp() { Monitor.println("commands: r = rescan 1-Wire | t = temperature diagnostics | ? = help"); }

void handleCommand(String s) {
  s.trim();
  if (!s.length()) return;
  if (s[0] == 'r') scanBus();
  else if (s[0] == 't') temperatureDiagnostics();
  else printHelp();
}

void setup() {
  Bridge.begin();
  Monitor.begin(115200);
  delay(1500);
  analogReadResolution(ADC_BITS);
  Monitor.print("\n=== sensor_test === build "); Monitor.println(BUILD_ID);
  scanBus();
  printHelp();
}

void loop() {
  static unsigned long lastPrintMs = 0, conversionStartedMs = 0;

  while (Monitor.available()) {
    const char ch = (char)Monitor.read();
    if (ch == '\n' || ch == '\r') { handleCommand(inputLine); inputLine = ""; } else inputLine += ch;
  }

  const unsigned long now = millis();
  if (now - lastPrintMs < 1000) return;
  lastPrintMs = now;

  const int raw = readMoistureRaw();
  Monitor.print("["); Monitor.print(now / 1000); Monitor.print("s] moisture raw="); Monitor.print(raw);
  Monitor.print(" ("); Monitor.print(raw * 3.3f / ((1 << ADC_BITS) - 1), 2); Monitor.print(" V)");

  // Non-blocking temperature: start a conversion, read it on a later pass (>= 800 ms).
  if (conversionStartedMs && now - conversionStartedMs >= 800) {
    for (int i = 0; i < probes.count; i++) {
      float c;
      Monitor.print("  T"); Monitor.print(i); Monitor.print('=');
      if (probes.readCelsius(i, c)) Monitor.print(c, 2); else Monitor.print("ERR");
    }
    conversionStartedMs = 0;
  }
  if (!conversionStartedMs && probes.count > 0) { probes.startConversion(); conversionStartedMs = now; }
  Monitor.println();
}
