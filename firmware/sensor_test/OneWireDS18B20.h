// OneWireDS18B20: a minimal bit-banged 1-Wire master with DS18B20 support for the
// Arduino UNO Q (arduino:zephyr core).
//
// Why not the OneWire / DallasTemperature libraries? They are reported not to detect a
// DS18B20 on this board. Two things matter here:
//   - pinMode() on this core is a full GPIO reconfigure and there is no open-drain mode.
//     So "drive low" is pinMode(OUTPUT) (the core configures the pin as OUTPUT_LOW in
//     that one call) and "release" is pinMode(INPUT). Measured cost: about 2 us per
//     call, which leaves a read slot sampling ~4 us after the falling edge (spec: <= 15).
//   - other threads and interrupts must not stretch a bit slot, so every slot runs with
//     interrupts locked (roughly 70 us at a time).
//
// A TRAP THIS DRIVER GUARDS AGAINST: a 1-Wire bus idles HIGH through its pull-up. If it
// is stuck LOW (missing 4.7k pull-up, or the probe has no power), every bit reads 0.
// That looks like "presence: yes, ROM 00..00, 0.00 C", and all-zero data even PASSES the
// CRC. So this driver checks the idle level, requires the line to recover after the
// presence pulse, requires the DS18B20 family code (0x28), and rejects all-zero data.
//
// Wiring: probe red -> 3V3, black -> GND, yellow (data) -> the chosen pin, and a 4.7k
// resistor between the data pin and 3V3. MIT License.
#pragma once
#include <Arduino.h>
#if defined(__ZEPHYR__)
#include <zephyr/kernel.h>
#define OW_LOCK()   unsigned int ow_key_ = irq_lock()
#define OW_UNLOCK() irq_unlock(ow_key_)
#else
#define OW_LOCK()   noInterrupts()
#define OW_UNLOCK() interrupts()
#endif

class OneWireDS18B20 {
 public:
  static const int MAX_PROBES = 4;
  uint8_t roms[MAX_PROBES][8];
  int count = 0;

  explicit OneWireDS18B20(int pin) : pin_(pin) {}

  // ---- bus health ---------------------------------------------------------------
  struct Timing { unsigned pinModeUs, readUs, sampleAtUs; };
  Timing measureTiming() {
    release(); delay(2);
    unsigned long t0 = micros();
    for (int i = 0; i < 50; i++) { driveLow(); release(); }
    cfgUs_ = (micros() - t0) / 100;
    t0 = micros();
    for (int i = 0; i < 100; i++) (void)digitalRead(pin_);
    const unsigned rd = (micros() - t0) / 100;
    return { cfgUs_, rd, 2 * cfgUs_ + rd };
  }

  enum Line { LINE_OK, LINE_NO_EXTERNAL_PULLUP, LINE_STUCK_LOW };
  // With no external pull-up the driver falls back to the MCU's weak internal one. That is
  // fine for a short bench test and unreliable for real use: fit the 4.7k resistor.
  Line checkLine() {
    pinMode(pin_, INPUT); delay(5);
    const bool idleHigh = digitalRead(pin_) == HIGH;
    pinMode(pin_, INPUT_PULLUP); delay(5);
    const bool highWithPullup = digitalRead(pin_) == HIGH;
    pinMode(pin_, INPUT);
    useInternalPullup_ = !idleHigh && highWithPullup;
    return idleHigh ? LINE_OK : highWithPullup ? LINE_NO_EXTERNAL_PULLUP : LINE_STUCK_LOW;
  }

  // ---- 1-Wire primitives --------------------------------------------------------
  // Presence = the line goes LOW ~70 us after release AND is HIGH again by the end of the
  // slot. A line that is simply stuck low fails the second half.
  bool reset() {
    driveLow(); delayMicroseconds(480);
    OW_LOCK(); release(); waitUs(70 - (int)cfgUs_); const bool low = digitalRead(pin_) == LOW; OW_UNLOCK();
    delayMicroseconds(410);
    return low && digitalRead(pin_) == HIGH;
  }
  void writeBit(bool b) {
    OW_LOCK(); driveLow(); waitUs((b ? 6 : 60) - (int)cfgUs_); release(); OW_UNLOCK();
    waitUs(b ? 58 : 6);
  }
  bool readBit() {
    OW_LOCK();
    driveLow(); release();                    // the low pulse is one reconfigure: as short as this core allows
    waitUs(9 - 2 * (int)cfgUs_);
    const bool b = digitalRead(pin_) == HIGH;
    OW_UNLOCK();
    delayMicroseconds(55);
    return b;
  }
  void writeByte(uint8_t v) { for (int i = 0; i < 8; i++) { writeBit(v & 1); v >>= 1; } }
  uint8_t readByte() { uint8_t v = 0; for (int i = 0; i < 8; i++) if (readBit()) v |= 1 << i; return v; }

  static uint8_t crc8(const uint8_t *d, int n) {
    uint8_t c = 0;
    while (n--) { uint8_t b = *d++; for (int i = 0; i < 8; i++) { const uint8_t m = (c ^ b) & 1; c >>= 1; if (m) c ^= 0x8C; b >>= 1; } }
    return c;
  }

  // ---- discovery ----------------------------------------------------------------
  enum SearchError { SEARCH_OK, SEARCH_BAD_FAMILY, SEARCH_BAD_CRC };
  SearchError lastSearchError = SEARCH_OK;
  uint8_t lastBadFamily = 0;

  // Standard 1-Wire ROM search. Fills roms[] / count and returns count.
  int search() {
    count = 0; lastSearchError = SEARCH_OK;
    int lastDiscrepancy = 0; bool done = false; uint8_t rom[8] = {0};
    while (!done && count < MAX_PROBES) {
      if (!reset()) return count;
      writeByte(0xF0);
      int discrepancy = 0;
      for (int bit = 1; bit <= 64; bit++) {
        const bool a = readBit(), b = readBit();
        if (a && b) return count;             // nobody answered
        const int byteIdx = (bit - 1) / 8, mask = 1 << ((bit - 1) % 8);
        bool dir;
        if (a != b) dir = a;
        else { dir = bit < lastDiscrepancy ? (rom[byteIdx] & mask) != 0 : bit == lastDiscrepancy; if (!dir) discrepancy = bit; }
        if (dir) rom[byteIdx] |= mask; else rom[byteIdx] &= ~mask;
        writeBit(dir);
      }
      lastDiscrepancy = discrepancy; done = lastDiscrepancy == 0;
      if (rom[0] != 0x28) { lastSearchError = SEARCH_BAD_FAMILY; lastBadFamily = rom[0]; return count; }
      if (crc8(rom, 7) != rom[7]) { lastSearchError = SEARCH_BAD_CRC; return count; }
      memcpy(roms[count++], rom, 8);
    }
    return count;
  }

  // ---- DS18B20 ------------------------------------------------------------------
  // Start a conversion on every probe at once. At 12 bits it takes up to 750 ms: come
  // back later with readCelsius(). Nothing here blocks.
  void startConversion() { if (reset()) { writeByte(0xCC); writeByte(0x44); } }

  bool readScratchpad(int index, uint8_t sp[9]) {
    if (index >= count || !reset()) return false;
    writeByte(0x55); for (int j = 0; j < 8; j++) writeByte(roms[index][j]);
    writeByte(0xBE);
    for (int j = 0; j < 9; j++) sp[j] = readByte();
    return true;
  }

  // Returns false for anything that is not a real reading: CRC error, stuck-low bus
  // (all zeros), or 85.0 C, which is the chip's power-on value, not a measurement.
  bool readCelsius(int index, float &celsius) {
    uint8_t sp[9];
    if (!readScratchpad(index, sp) || crc8(sp, 8) != sp[8]) return false;
    bool allZero = true; for (int j = 0; j < 9; j++) if (sp[j]) allZero = false;
    if (allZero) return false;
    const int16_t raw = (int16_t)((sp[1] << 8) | sp[0]);
    celsius = raw / 16.0f;
    return raw != 0x0550 && celsius > -40 && celsius < 85;
  }

  // true = the probe has power on its VDD wire; false = "parasite" mode, which almost
  // always means the red wire is not reaching 3V3. A probe in that state answers every
  // read with 85.0 C because it can never finish a conversion.
  bool externallyPowered() {
    if (!reset()) return false;
    writeByte(0xCC); writeByte(0xB4);
    return readBit();
  }

 private:
  void driveLow() { pinMode(pin_, OUTPUT); }
  void release()  { pinMode(pin_, useInternalPullup_ ? INPUT_PULLUP : INPUT); }
  static void waitUs(int us) { if (us > 0) delayMicroseconds(us); }

  int pin_;
  unsigned cfgUs_ = 0;
  bool useInternalPullup_ = false;
};
