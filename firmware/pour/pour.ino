// pour: tip a water bottle with a servo, pour, and come back to rest. On command only.
//
// Board    Arduino UNO Q (MCU side, arduino:zephyr core)
// Servo    MG996R (or any standard hobby servo), signal on D9
// Callers  - the board's Linux side, through the Bridge call "pour" (a web app, an AI
//            agent's tool call, anything else that runs there)
//          - a person at the console: type  p  and press Enter
//
// WIRING
//   servo signal (yellow/orange) -> D9
//   servo red   -> its OWN 5-6 V supply, 2 A or more (a USB-A wall adapter works well).
//                  Never the board's 3V3 pin (too low) or 5V pin (the board browns out).
//   servo brown -> that supply's minus AND a GND pin on the board (common ground).
//
// SAFETY, enforced here for every caller:
//   one pour at a time - hold time and angles clamped -
//   the bottle always returns to rest.
//
// A hobby servo has NO position feedback. "Current angle" always means "the last angle
// we commanded". If the servo loses power, the firmware cannot know.
//
// MIT License. See ../../LICENSE.

#include "Arduino_RouterBridge.h"
#include "PulseServo.h"

#define BUILD_ID __DATE__ " " __TIME__

// ---------------------------------------------------------------- configuration
const int PIN_SERVO = 9;

// Adjustable at runtime (console or Bridge). Runtime changes live in RAM: after a reset
// these defaults apply again, so put your final numbers here.
int restDeg = 180;            // bottle level and stable
int pourDeg = 75;             // bottle tipped (here: a 105 degree tilt)
int holdMs  = 1500;           // time held at the pour angle

// Self-test: pour repeatedly for this many seconds at every power-on, BEFORE waiting for
// the Linux side. Shows at a glance that the firmware runs and the servo has power.
// 0 = off (pour on command only). It pours real water, so leave it off in normal use.
#define SELFTEST_AT_BOOT_S 0

// ------------------------------------------------------------------ hard limits
const int  DEG_MIN = 5, DEG_MAX = 180;
const int  HOLD_MS_MIN = 200, HOLD_MS_MAX = 5000;
const long COOLDOWN_MS = 0;                  // no pause between pours (it was 4000). One pour at a time still holds: BUSY while moving.
const int  TIP_MS_PER_DEG    = 22;           // tipping: slow enough not to slosh
const int  RETURN_MS_PER_DEG = 16;           // returning: lifting a full bottle fast is the biggest current peak
const int  REPEAT_MAX_S = 60;
const int  US_MIN = 500, US_MAX = 2500;      // pulse width at 0 and 180 degrees

enum PourResult { POUR_STARTED = 1, POUR_BUSY = -1, POUR_COOLDOWN = -2 };

// ------------------------------------------------------------------------ state
PulseServo servo;

enum Phase { IDLE, TIPPING, HOLDING, RETURNING };
const char *const PHASE_NAME[] = { "idle", "tipping", "holding", "returning" };
Phase phase = IDLE;

int currentDeg = -1;                         // last commanded angle; -1 = none since boot
int moveFromUs, moveToUs, moveToDeg;
unsigned long moveStartMs, moveDurationMs;

bool pouring = false;                        // true from "tipping" until back at rest
int activeHoldMs = 0;
unsigned long holdUntilMs = 0, lastPourEndMs = 0, pourCount = 0, repeatUntilMs = 0;

// Requests arrive on the Bridge's thread; loop() acts on them.
volatile bool requestPourFlag = false, requestSaveRest = false;
volatile int  requestHoldMs = 0;

String inputLine;

// ----------------------------------------------------------------------- motion
int degToUs(int deg) { return US_MIN + (long)deg * (US_MAX - US_MIN) / 180; }

// Moves are eased and generated in microseconds, not whole degrees, so they look smooth.
void beginMove(int deg, int msPerDeg) {
  deg = constrain(deg, DEG_MIN, DEG_MAX);
  const int from = currentDeg < 0 ? deg : currentDeg;   // unknown position: cannot ramp
  moveFromUs = degToUs(from);
  moveToUs = degToUs(deg);
  moveToDeg = deg;
  moveDurationMs = max(250, abs(deg - from) * msPerDeg);
  moveStartMs = millis();
}

// Call every ~20 ms. Returns true once the move has finished.
bool stepMove() {
  const unsigned long elapsed = millis() - moveStartMs;
  const float t = elapsed >= moveDurationMs ? 1.0f : (float)elapsed / moveDurationMs;
  const float eased = t * t * (3 - 2 * t);
  servo.writeMicroseconds(moveFromUs + (int)((moveToUs - moveFromUs) * eased));
  if (t < 1.0f) return false;
  currentDeg = moveToDeg;
  return true;
}

void moveBlocking(int deg, int msPerDeg) {
  beginMove(deg, msPerDeg);
  while (!stepMove()) delay(20);
}

// ------------------------------------------------------------------ pour logic
// Safe to call from any thread: it only records the request.
int requestPour(int holdMsArg) {
  if (phase != IDLE || requestPourFlag) return POUR_BUSY;
  if (lastPourEndMs && millis() - lastPourEndMs < (unsigned long)COOLDOWN_MS) return POUR_COOLDOWN;
  requestHoldMs = holdMsArg;
  requestPourFlag = true;
  return POUR_STARTED;
}

// Console line for people, Bridge notification for the Linux side.
void report(const char *event, int value, const char *note = "") {
  Monitor.print("["); Monitor.print(millis() / 1000.0f, 1); Monitor.print("s] pour: "); Monitor.print(event); Monitor.println(note);
  Bridge.notify("pour_event", event, value);
}

void runPourStateMachine() {
  switch (phase) {
    case IDLE:
      if (repeatUntilMs) {                                        // console-only repeat mode
        if ((long)(millis() - repeatUntilMs) >= 0) { repeatUntilMs = 0; Monitor.println("repeat: finished"); }
        else if (!requestPourFlag && (!lastPourEndMs || millis() - lastPourEndMs >= 1000)) { requestHoldMs = 0; requestPourFlag = true; }
      }
      if (requestPourFlag) {
        requestPourFlag = false;
        activeHoldMs = constrain(requestHoldMs > 0 ? requestHoldMs : holdMs, HOLD_MS_MIN, HOLD_MS_MAX);
        pouring = true;
        beginMove(pourDeg, TIP_MS_PER_DEG);
        phase = TIPPING;
        report("tipping", pourDeg);
      }
      break;

    case TIPPING:
      if (stepMove()) { holdUntilMs = millis() + activeHoldMs; phase = HOLDING; report("holding", activeHoldMs); }
      break;

    case HOLDING:
      if ((long)(millis() - holdUntilMs) >= 0) { beginMove(restDeg, RETURN_MS_PER_DEG); phase = RETURNING; report("returning", restDeg); }
      break;

    case RETURNING:
      if (stepMove()) {
        phase = IDLE;
        if (pouring) { pouring = false; lastPourEndMs = millis(); pourCount++; report("done", (int)pourCount, ", back at rest"); }
      }
      break;
  }
}

// ------------------------------------------------------------------- Bridge API
// pour(hold_ms): hold_ms <= 0 uses the default. Returns 1 started, -1 busy, -2 cooling down.
// Returns immediately; progress arrives as "pour_event" notifications.
int rpcPour(int holdMsArg) { return requestPour(holdMsArg); }

// "phase,current_deg,rest_deg,pour_deg,hold_ms,pours,cooldown_ms_left"
String rpcStatus() {
  long cooldown = lastPourEndMs ? COOLDOWN_MS - (long)(millis() - lastPourEndMs) : 0;
  return String(PHASE_NAME[phase]) + "," + currentDeg + "," + restDeg + "," + pourDeg + "," + holdMs + "," + pourCount + "," + (cooldown > 0 ? cooldown : 0);
}

// Setters return the new value, or -1 when a pour is in progress.
int rpcSaveRestHere()      { if (phase != IDLE || currentDeg < 0) return -1; requestSaveRest = true; return currentDeg; }
int rpcSetPourDeg(int deg) { if (phase != IDLE) return -1; pourDeg = constrain(deg, DEG_MIN, DEG_MAX); return pourDeg; }
int rpcSetRestDeg(int deg) {
  if (phase != IDLE) return -1;
  restDeg = constrain(deg, DEG_MIN, DEG_MAX);
  beginMove(restDeg, TIP_MS_PER_DEG); phase = RETURNING;
  return restDeg;
}

// ---------------------------------------------------------------------- console
void printHelp() {
  Monitor.println("p = pour | p<ms> = pour, holding <ms> | s = status | j = servo signal jitter");
  Monitor.println("n<+/-deg> = nudge (e.g. n-3) | z = save current position as REST | r<deg> = set REST | t<deg> = set POUR angle");
  Monitor.println("d<sec> = repeat pours for <sec> (x = stop) | ? = help");
}

void printStatus() { Monitor.print("status: "); Monitor.println(rpcStatus()); }

void handleCommand(String s) {
  s.trim();
  if (!s.length()) return;
  const char c = s[0];
  const int v = s.substring(1).toInt();

  if (c == 'p') {
    const int r = requestPour(v);
    Monitor.println(r == POUR_STARTED ? "pour: accepted" : r == POUR_BUSY ? "pour: BUSY (already pouring)" : "pour: COOLDOWN (wait a few seconds)");
  } else if (c == 's') {
    printStatus();
  } else if (c == 'j') {
    const PulseServo::Stats st = servo.takeStats();
    if (!st.pulses) { Monitor.println("jitter: no pulses since last check"); return; }
    Monitor.print("jitter: "); Monitor.print(st.pulses); Monitor.print(" pulses, width error min "); Monitor.print(st.minUs);
    Monitor.print(" / mean "); Monitor.print(st.meanUs); Monitor.print(" / max "); Monitor.print(st.maxUs); Monitor.println(" us");
  } else if (c == 'n') {
    if (phase == IDLE && currentDeg >= 0) { beginMove(currentDeg + v, TIP_MS_PER_DEG); phase = RETURNING; Monitor.print("nudge to "); Monitor.println(constrain(currentDeg + v, DEG_MIN, DEG_MAX)); }
  } else if (c == 'z') {
    if (rpcSaveRestHere() < 0) Monitor.println("z: only when idle");
  } else if (c == 'r') {
    if (rpcSetRestDeg(v) >= 0) { Monitor.print("REST set to "); Monitor.println(restDeg); }
  } else if (c == 't') {
    if (rpcSetPourDeg(v) >= 0) { Monitor.print("POUR angle set to "); Monitor.println(pourDeg); }
  } else if (c == 'd') {
    const int sec = constrain(v > 0 ? v : 20, 1, REPEAT_MAX_S);
    repeatUntilMs = millis() + sec * 1000UL;
    Monitor.print("repeat: pouring for "); Monitor.print(sec); Monitor.println(" s");
  } else if (c == 'x') {
    repeatUntilMs = 0; Monitor.println("repeat: will stop after the current pour");
  } else {
    printHelp();
  }
}

// -------------------------------------------------------------------- lifecycle
void setup() {
  // FIRST: hold the bottle. Bridge.begin() waits, with no timeout, for the board's Linux
  // side, which needs 30-60 s after a cold power-on. The servo must not hang limp that long.
  servo.begin(PIN_SERVO, US_MIN, US_MAX);
  servo.writeMicroseconds(degToUs(restDeg));
  currentDeg = restDeg;
  delay(800);

#if SELFTEST_AT_BOOT_S > 0
  for (unsigned long until = millis() + SELFTEST_AT_BOOT_S * 1000UL; (long)(millis() - until) < 0; ) {
    moveBlocking(pourDeg, TIP_MS_PER_DEG);
    delay(holdMs);
    moveBlocking(restDeg, RETURN_MS_PER_DEG);
    delay(1000);
  }
#endif

  Bridge.begin();
  Monitor.begin(115200);
  Bridge.provide("pour", rpcPour);
  Bridge.provide("pour_status", rpcStatus);
  Bridge.provide("pour_set_rest_here", rpcSaveRestHere);
  Bridge.provide("pour_set_rest_deg", rpcSetRestDeg);
  Bridge.provide("pour_set_pour_deg", rpcSetPourDeg);

  delay(1200);
  Monitor.print("\n=== pour firmware === build "); Monitor.println(BUILD_ID);
  printHelp();
  printStatus();
}

void loop() {
  while (Monitor.available()) {
    const char ch = (char)Monitor.read();
    if (ch == '\n' || ch == '\r') { handleCommand(inputLine); inputLine = ""; } else inputLine += ch;
  }

  if (requestSaveRest && phase == IDLE) {
    requestSaveRest = false;
    restDeg = currentDeg;
    Monitor.print("REST saved = "); Monitor.println(restDeg);
    Bridge.notify("pour_event", "rest_saved", restDeg);
  }

  runPourStateMachine();
  delay(20);                                  // one servo frame
}
