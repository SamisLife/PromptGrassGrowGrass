import test from 'node:test';
import assert from 'node:assert/strict';
import { explainProviderRefusal } from '../src/voice/index.js';

test('no credits is explained as a billing problem, not a key problem', () => {
  const msg = explainProviderRefusal(403, JSON.stringify({ code: 'The caller does not have permission', error: 'Your team abc has either used all available credits or reached its monthly spending limit.' }));
  assert.match(msg, /no available credit/i);
  assert.match(msg, /console\.x\.ai/);
  assert.doesNotMatch(msg, /Check XAI_API_KEY/);
});
test('401 points at the key', () => { assert.match(explainProviderRefusal(401, '{"error":"Invalid API key"}'), /XAI_API_KEY/); });
test('the key is never echoed back, even if the provider includes it', () => {
  const msg = explainProviderRefusal(400, JSON.stringify({ error: 'bad token xai-SECRET123 supplied' }), 'xai-SECRET123');
  assert.doesNotMatch(msg, /SECRET123/);
});
test('non-JSON bodies do not throw', () => { assert.match(explainProviderRefusal(502, '<html>Bad gateway</html>'), /HTTP 502/); });
