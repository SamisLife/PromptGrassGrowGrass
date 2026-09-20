import { XAI_VOICE_MODEL, VOICE_AUDIO } from './xai.js';

export interface VoiceAudioSpec {
  codec: string;
  rate: number;
  channels: number;
  encoding: string;
  transport: string;
}

export interface VoiceStatus {
  enabled: boolean;
  reason: string | null;
  provider: 'xai-realtime';
  path: 'server-relay';
  model: string;
  audio: VoiceAudioSpec;
  browser: {
    websocket: string;
    connect: string;
    secure_context: string;
    capture: string;
    playback: string;
  };
}

export function voiceStatus(opts?: { publicBase?: string; key?: string | null }): VoiceStatus {
  const key = opts?.key !== undefined ? opts.key : (process.env.XAI_API_KEY ?? '').trim();
  const base = opts?.publicBase ?? 'http://127.0.0.1:8787';
  const ws = base.replace(/^http/, 'ws') + '/api/voice/session';
  const common = {
    provider: 'xai-realtime' as const,
    path: 'server-relay' as const,
    model: XAI_VOICE_MODEL,
    audio: { ...VOICE_AUDIO },
    browser: {
      websocket: ws,
      connect: `Open a WebSocket to ${ws}. Send JSON {type:"input_audio", audio:"<base64 pcm_s16le>"}. Receive JSON events listed in README (session_started, listening, user_transcript, thinking, tool_call_*, assistant_transcript, speaking_*, output_audio, awaiting_confirmation, error, session_ended).`,
      secure_context: 'Microphone access needs a secure context. http://localhost and http://127.0.0.1 qualify. A LAN address over plain http does not. The Vite origin port may change; the backend accepts any local origin.',
      capture: 'AudioContext at 24000 Hz, mono, Int16 PCM little-endian. Chunk ~100–200 ms. Send {type:"input_audio", audio: base64}. Do not resample to 48 kHz. Optional {type:"text", text} for typed turns (tests / smoke). {type:"end"} closes the session.',
      playback: 'Play output_audio payloads as pcm_s16le 24000 Hz mono. speaking_started / speaking_ended bound a reply.',
    },
  };
  if (!key) {
    return {
      enabled: false,
      reason: 'XAI_API_KEY is not set. Add it to backend/.env (never the browser). Create a key at https://console.x.ai/',
      ...common,
    };
  }
  return { enabled: true, reason: null, ...common };
}
