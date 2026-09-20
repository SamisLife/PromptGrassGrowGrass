import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePour, moistureInWords, scrub, trendInWords } from '../src/plain.js';
import { VOICE_SYSTEM_PROMPT } from '../src/voice/prompt.js';

const live = (raw: number | null, pct: number | null, online = true) => ({ t: 0, moistureRaw: raw, moisturePct: pct, tempC: 25, moistureOnline: online, tempOnline: true });

test('no raw sensor number survives the voice view', () => {
  const out = JSON.stringify(scrub({ zone: 'A', moisture: { raw_adc_counts: 3512, relative_pct: 0, note: 'Raw rises as the soil dries', calibrated: true }, age_ms: 12, trend: { unit: 'raw ADC counts', delta_1min: -4 }, mode: 'board' }));
  assert.doesNotMatch(out, /3512|adc|counts|Raw rises/i);
  assert.match(out, /relative_pct/);
});

test('water that reached the sensor is reported as arrived, in percent', () => {
  const o = judgePour({ pouredAt: 0, now: 20_000, rawBefore: 3510, pctBefore: 0.3, live: live(2900, 40.5) });
  assert.equal(o.status, 'arrived');
  assert.match(o.plain, /from 0 percent to 41 percent/);
  assert.doesNotMatch(o.plain, /\d{4}/);
});

test('an unchanged reading after enough time is "not detected", with likely causes, and no counts', () => {
  const o = judgePour({ pouredAt: 0, now: 20_000, rawBefore: 3512, pctBefore: 0, live: live(3512, 0) });
  assert.equal(o.status, 'not_detected');
  assert.match(o.plain, /hasn't picked up any water/);
  assert.doesNotMatch(o.plain, /3512|ADC|counts/i);
});

test('checking too soon says so instead of calling it a failure', () => {
  assert.equal(judgePour({ pouredAt: 0, now: 5_000, rawBefore: 3512, pctBefore: 0, live: live(3510, 0) }).status, 'too_early');
});

test('an offline sensor is "unknown", never a guess', () => {
  assert.equal(judgePour({ pouredAt: 0, now: 30_000, rawBefore: 3512, pctBefore: 0, live: live(null, null, false) }).status, 'unknown');
  assert.match(moistureInWords(null, false), /isn't reporting/);
});

test('words for moisture and trend', () => {
  assert.equal(moistureInWords(5, true), 'dry');
  assert.equal(moistureInWords(60, true), 'nicely moist');
  assert.equal(moistureInWords(90, true), 'very wet');
  assert.equal(trendInWords(8), 'getting wetter');
  assert.equal(trendInWords(-0.5), 'steady');
  assert.equal(trendInWords(null), null);
});

test('the prompt does not teach the model engineering words to say out loud', () => {
  assert.doesNotMatch(VOICE_SYSTEM_PROMPT, /Quote numbers with units.*ADC|Report whether raw/i);
  assert.match(VOICE_SYSTEM_PROMPT, /Never say sensor counts/);
});
