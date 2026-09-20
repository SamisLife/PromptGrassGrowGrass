// PulseServo: a jitter-free hobby-servo signal for the Arduino UNO Q (arduino:zephyr core).
//
// Why not the Arduino Servo library? On this core it bit-bangs the pin from a timer
// interrupt that fires every 4 microseconds. The chip cannot service that steadily: we
// measured the pulse width wandering by ~200 us, which a servo reads as its target moving
// +/-10 degrees, fifty times a second. A loaded servo twitches and draws near-stall
// current, enough to trip a 3 A USB supply.
//
// Why not hardware PWM? The timer behind the usual PWM pins is 16-bit with a fixed
// prescaler: its longest period is about 2 ms, and a servo needs 20 ms.
//
// What this does instead: a dedicated high-priority thread produces one pulse every
// 20 ms. Interrupts stay ENABLED for most of the pulse and are locked only for the final
// GUARD_US microseconds, which is what pins down the falling edge, i.e. the pulse width.
// GUARD_US is shorter than one byte on the 115200-baud Bridge link (87 us), so the link
// to the board's Linux side never loses data.
//
// Measured on hardware: pulse-width error of +1 to +3 us, idle and while moving a load.
//
// One servo per sketch (the thread and its stack are static). MIT License.
#pragma once
#include <Arduino.h>
#include <zephyr/kernel.h>

// One static stack: include this header from exactly one .ino / .cpp file.
K_THREAD_STACK_DEFINE(pulse_servo_stack, 1024);

class PulseServo {
 public:
  static const uint32_t GUARD_US = 60;
  static const uint32_t FRAME_US = 20000;

  // Starts the pulse thread. No pulses are sent until writeMicroseconds() is called.
  void begin(int pin, int minUs = 500, int maxUs = 2500) {
    if (started_) return;
    pin_ = pin; minUs_ = minUs; maxUs_ = maxUs;
    pinMode(pin_, OUTPUT);
    digitalWrite(pin_, LOW);
    // The stack is STATIC on purpose. This board's firmware has a pool of only two
    // dynamically allocated thread stacks and the Bridge library needs them; taking one
    // before Bridge.begin() makes the sketch die silently inside Bridge.begin().
    k_thread_create(&thread_, pulse_servo_stack, K_THREAD_STACK_SIZEOF(pulse_servo_stack), &PulseServo::threadEntry,
                    this, NULL, NULL, K_PRIO_PREEMPT(0), 0, K_NO_WAIT);
    k_thread_name_set(&thread_, "servo");
    started_ = true;
  }

  void writeMicroseconds(int us) { pulseUs_ = constrain(us, minUs_, maxUs_); }
  void release() { pulseUs_ = 0; }             // stop sending pulses: the servo relaxes
  bool isDriving() const { return pulseUs_ > 0; }

  // Pulse-width error (measured minus commanded) since the last call. For diagnostics.
  struct Stats { uint32_t pulses; int32_t minUs, meanUs, maxUs; };
  Stats takeStats() {
    Stats s = { n_, (int32_t)errMin_ - BIAS, n_ ? (int32_t)(errSum_ / n_) - BIAS : 0, (int32_t)errMax_ - BIAS };
    n_ = 0; errSum_ = 0; errMin_ = 0xFFFFFFFF; errMax_ = 0;
    return s;
  }

 private:
  static const int32_t BIAS = 1000;            // keeps the error statistics unsigned

  static void threadEntry(void *self, void *, void *) { static_cast<PulseServo *>(self)->run(); }

  void run() {
    for (;;) {
      const int us = pulseUs_;
      if (us <= 0) { k_msleep(20); continue; }

      unsigned int key = irq_lock();           // rising edge and its timestamp, atomically
      digitalWrite(pin_, HIGH);
      const uint32_t t0 = micros();
      irq_unlock(key);

      while ((uint32_t)(micros() - t0) < (uint32_t)us - GUARD_US) { }   // interrupts enabled

      key = irq_lock();                        // last stretch: nothing may delay the falling edge
      while ((uint32_t)(micros() - t0) < (uint32_t)us) { }
      digitalWrite(pin_, LOW);
      const uint32_t width = micros() - t0;
      irq_unlock(key);

      const uint32_t e = (uint32_t)((int32_t)width - us + BIAS);
      if (e < errMin_) errMin_ = e;
      if (e > errMax_) errMax_ = e;
      errSum_ += e; n_++;

      k_usleep(FRAME_US - us);
    }
  }

  int pin_ = -1, minUs_ = 500, maxUs_ = 2500;
  bool started_ = false;
  volatile int pulseUs_ = 0;
  volatile uint32_t n_ = 0, errSum_ = 0, errMin_ = 0xFFFFFFFF, errMax_ = 0;
  struct k_thread thread_;
};
