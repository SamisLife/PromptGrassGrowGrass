import type { SoftGuardKind, ZoneId } from '../types.js';
import { VOICE_AUDIO } from './xai.js';

export type VoiceClientEvent =
  | { type: 'session_started'; session_id: string; model: string; audio: typeof VOICE_AUDIO }
  | { type: 'session_ended'; reason: string }
  | { type: 'listening' }
  /** `item_id` identifies the utterance: xAI sends its final text in growing pieces, so REPLACE by id */
  | { type: 'user_transcript'; text: string; final: boolean; item_id?: string }
  | { type: 'thinking' }
  | { type: 'tool_call_started'; tool: string; zones: ZoneId[]; call_id?: string }
  | { type: 'tool_call_finished'; tool: string; zones: ZoneId[]; ok: boolean; summary?: string }
  | { type: 'assistant_transcript'; text: string; final: boolean }
  | { type: 'speaking_started' }
  | { type: 'speaking_ended' }
  | { type: 'awaiting_confirmation'; what: 'pour_water'; reason: string; expires_in_s: number; kind: SoftGuardKind }
  | { type: 'error'; message: string; code?: string }
  | { type: 'output_audio'; audio: string };
