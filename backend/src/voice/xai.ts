export const XAI_VOICE_MODEL = 'grok-voice-think-fast-2.0';
export const XAI_REALTIME_URL = `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(XAI_VOICE_MODEL)}`;

export const VOICE_AUDIO = {
  codec: 'audio/pcm',
  rate: 24000,
  channels: 1,
  encoding: 'pcm_s16le',
  transport: 'json-base64',
} as const;

const emptyObject = { type: 'object', properties: {}, additionalProperties: false } as const;

const zoneParam = { type: 'string', description: 'Zone id: "A" or "B".' };

/** Custom function tools sent in session.update. Executed on this laptop, never by xAI. */
export const VOICE_FUNCTION_TOOLS = [
  { type: 'function', name: 'list_zones', description: 'List zones with one-line live status. Start here.', parameters: emptyObject },
  {
    type: 'function', name: 'read_zone',
    description: 'Live probe readings for one zone. Relative moisture, soil temperature, watering advice. null means unknown.',
    parameters: { type: 'object', properties: { zone: zoneParam }, required: ['zone'], additionalProperties: false },
  },
  { type: 'function', name: 'get_soil_profile', description: 'Measured drainage from the pour test. Texture is an estimate. Null if no pour test yet.', parameters: emptyObject },
  {
    type: 'function', name: 'score_crops',
    description: "Score crops 0-100 for a zone using the app's rules. Report these scores; do not invent your own.",
    parameters: { type: 'object', properties: { zone: zoneParam, limit: { type: 'number' } }, required: ['zone'], additionalProperties: false },
  },
  {
    type: 'function', name: 'get_planting_window',
    description: 'When to plant a crop here from local frost dates and whether the soil is warm enough today.',
    parameters: { type: 'object', properties: { crop: { type: 'string' }, zone: zoneParam }, required: ['crop'], additionalProperties: false },
  },
  { type: 'function', name: 'get_forecast', description: '7-day forecast. Check before recommending water. rain_expected_next_48h already applies the 5 mm / 60 % rule.', parameters: emptyObject },
  {
    type: 'function', name: 'get_history',
    description: 'Recorded moisture and temperature for a zone over past hours.',
    parameters: { type: 'object', properties: { zone: zoneParam, hours: { type: 'number' } }, required: ['zone'], additionalProperties: false },
  },
  {
    type: 'function', name: 'add_note',
    description: "Save a short note to the plot's logbook.",
    parameters: { type: 'object', properties: { text: { type: 'string' }, zone: zoneParam }, required: ['text'], additionalProperties: false },
  },
  { type: 'function', name: 'get_readings', description: 'Zone A and B together: raw moisture, relative %, trend, temperature, online flags, pour status.', parameters: emptyObject },
  {
    type: 'function', name: 'pour_water',
    description: 'Tip the real water bottle into zone A. If the result is overridable with a confirm_token, ask the user, wait for them to speak yes, then call again with that exact confirm_token. Never invent a token. Never pass force. Hard limits (busy, cooldown, offline) cannot be overridden — explain and wait. After started, re-read zone A in 10–20 s.',
    parameters: {
      type: 'object',
      properties: {
        hold_ms: { type: 'number', description: 'Hold time in ms. Firmware clamps 200–5000. Omit for default.' },
        confirm_token: { type: 'string', description: 'Single-use token from a previous soft-guard refusal in this session.' },
      },
      additionalProperties: false,
    },
  },
  { type: 'function', name: 'get_pour_status', description: 'Whether the pour board is connected and what it is doing.', parameters: emptyObject },
  {
    type: 'function', name: 'navigate',
    description: 'Move the web app. All fields optional; send only what should change. view: field|pour|history|network. drawer: soil|plant|when|water|diagnose|none. zone: A|B. lens: natural|moisture|temperature. crop: id from score_crops.',
    parameters: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['field', 'pour', 'history', 'network'] },
        drawer: { type: 'string', enum: ['soil', 'plant', 'when', 'water', 'diagnose', 'none'] },
        zone: { type: 'string', enum: ['A', 'B'] },
        lens: { type: 'string', enum: ['natural', 'moisture', 'temperature'] },
        crop: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
] as const;

export function sessionUpdateMessage(instructions: string) {
  return {
    type: 'session.update',
    session: {
      instructions,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'grok-transcribe' },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
      turn_detection: { type: 'server_vad' },
      tools: VOICE_FUNCTION_TOOLS,
    },
  };
}
