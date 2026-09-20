import { randomBytes } from 'node:crypto';
import type { McpBackend } from '../proxy.js';
import { persist } from '../persist.js';
import { runPlotTool, type VoiceToolHooks } from '../tools.js';
import type { SoftGuardKind, UiCommand, ZoneId, ZoneLive } from '../types.js';
import { CONFIRM_TTL_MS, ConfirmStore } from './confirm.js';
import type { VoiceClientEvent } from './events.js';
import { VOICE_SYSTEM_PROMPT } from './prompt.js';
import { sessionUpdateMessage, VOICE_AUDIO, XAI_VOICE_MODEL } from './xai.js';

export class VoiceRuntime {
  readonly sessionId: string;
  readonly confirm: ConfirmStore;
  private speaking = false;
  private toolLock = Promise.resolve();
  // One model response can ask for SEVERAL tools at once (e.g. readings + forecast). The
  // model must be told to continue only when the response has finished AND every tool it
  // asked for has answered; continuing after the first result makes it speak half-informed.
  private pendingToolCalls = 0;
  private toolOutputsSent = 0;
  private responseFinished = true;
  private continueTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFinalTranscriptKey = '';
  private closed = false;

  constructor(private opts: {
    app: McpBackend;
    sendClient: (ev: VoiceClientEvent) => void;
    sendProvider: (ev: unknown) => void;
    emitUiCommand: (cmd: UiCommand) => void;
    confirm?: ConfirmStore;
    sessionId?: string;
    now?: () => number;
  }) {
    this.sessionId = opts.sessionId ?? randomBytes(8).toString('hex');
    this.confirm = opts.confirm ?? new ConfirmStore({ now: opts.now });
  }

  start(): void {
    this.emit({ type: 'session_started', session_id: this.sessionId, model: XAI_VOICE_MODEL, audio: { ...VOICE_AUDIO } });
    this.opts.sendProvider(sessionUpdateMessage(VOICE_SYSTEM_PROMPT));
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.confirm.dropSession(this.sessionId);
    this.emit({ type: 'session_ended', reason });
  }

  emit(ev: VoiceClientEvent): void {
    if (this.closed && ev.type !== 'session_ended') return;
    this.opts.sendClient(ev);
  }

  /** Browser → us. */
  handleClientMessage(raw: unknown): void {
    if (this.closed) return;
    const msg = raw as { type?: string; audio?: string; text?: string };
    if (msg?.type === 'input_audio' && typeof msg.audio === 'string') {
      this.opts.sendProvider({ type: 'input_audio_buffer.append', audio: msg.audio });
      return;
    }
    if (msg?.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
      this.noteUserText(msg.text.trim());
      this.opts.sendProvider({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: msg.text.trim() }] },
      });
      this.opts.sendProvider({ type: 'response.create' });
      this.emit({ type: 'thinking' });
      return;
    }
    if (msg?.type === 'end') {
      this.close('client_end');
    }
  }

  /** xAI → us. */
  async handleProviderEvent(raw: unknown): Promise<void> {
    if (this.closed) return;
    const ev = raw as Record<string, unknown>;
    const type = String(ev.type ?? '');
    switch (type) {
      case 'input_audio_buffer.speech_started':
        this.emit({ type: 'listening' });
        return;
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        this.confirm.noteUserUtterance(this.sessionId, null, 'vad');
        return;
      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.updated':
        this.emit({ type: 'user_transcript', text: String(ev.delta ?? ev.transcript ?? ev.text ?? ''), final: false });
        return;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(ev.transcript ?? ev.text ?? '');
        // xAI can repeat the "completed" event for the same utterance. Act on it once:
        // a repeated "yes" must not count as a second confirmation.
        const key = `${String(ev.item_id ?? '')}|${text}`;
        if (key === this.lastFinalTranscriptKey) return;
        this.lastFinalTranscriptKey = key;
        // xAI sends the "completed" transcript of one utterance in growing pieces, each marked
        // complete. `item_id` lets the UI REPLACE the line for that utterance instead of stacking.
        this.emit({ type: 'user_transcript', text, final: true, item_id: String(ev.item_id ?? '') || undefined });
        this.noteUserText(text);
        return;
      }
      case 'response.created':
        this.responseFinished = false;
        this.emit({ type: 'thinking' });
        return;
      case 'response.done':
        this.responseFinished = true;
        this.maybeContinue();
        return;
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const audio = String(ev.delta ?? ev.audio ?? '');
        if (!this.speaking) {
          this.speaking = true;
          this.emit({ type: 'speaking_started' });
        }
        if (audio) this.emit({ type: 'output_audio', audio });
        return;
      }
      case 'response.output_audio.done':
      case 'response.audio.done':
        if (this.speaking) {
          this.speaking = false;
          this.emit({ type: 'speaking_ended' });
        }
        return;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        this.emit({ type: 'assistant_transcript', text: String(ev.delta ?? ''), final: false });
        return;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        this.emit({ type: 'assistant_transcript', text: String(ev.transcript ?? ev.text ?? ''), final: true });
        return;
      case 'response.function_call_arguments.done': {
        const name = String(ev.name ?? '');
        const callId = String(ev.call_id ?? ev.callId ?? '');
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(String(ev.arguments ?? '{}')); } catch { args = {}; }
        this.pendingToolCalls++;
        try { await this.runTool(name, args, callId); }
        finally { this.pendingToolCalls--; this.maybeContinue(); }
        return;
      }
      case 'error': {
        const message = String((ev.error as { message?: string } | undefined)?.message ?? ev.message ?? 'xAI error');
        this.emit({ type: 'error', message, code: String((ev.error as { code?: string } | undefined)?.code ?? 'xai') });
        return;
      }
      default:
        return;
    }
  }

  /** Ask the model to continue, once: after the response ended and all its tools answered. */
  private maybeContinue(): void {
    if (this.pendingToolCalls > 0 || this.toolOutputsSent === 0) return;
    const go = () => {
      if (this.continueTimer) { clearTimeout(this.continueTimer); this.continueTimer = null; }
      if (this.pendingToolCalls > 0 || this.toolOutputsSent === 0) return;
      this.toolOutputsSent = 0;
      this.opts.sendProvider({ type: 'response.create' });
    };
    if (this.responseFinished) return go();
    // Safety net: if the provider never signals the end of the response, do not hang forever.
    if (!this.continueTimer) this.continueTimer = setTimeout(go, 1500);
  }

  noteUserText(text: string): void {
    const { revoked } = this.confirm.noteUserUtterance(this.sessionId, text, 'transcript');
    if (revoked.length) {
      persist.appendJsonl('pour-log.jsonl', { t: Date.now(), caller: 'voice', result: 'refused', event: 'token_revoked', reason: `user said: ${text.slice(0, 80)}`, session: this.sessionId });
    }
  }

  async runTool(name: string, args: Record<string, unknown>, callId: string): Promise<ToolRunView> {
    const run = this.toolLock.then(() => this.runToolLocked(name, args, callId));
    this.toolLock = run.then(() => undefined, () => undefined);
    return run;
  }

  private async runToolLocked(name: string, args: Record<string, unknown>, callId: string): Promise<ToolRunView> {
    // Best guess from the arguments, so the zone can start glowing when the call STARTS.
    const allZones = this.opts.app.config.zones.map((z) => z.id);
    const asked = String(args.zone ?? '').trim().toUpperCase().replace(/^ZONE\s+/, '');
    const zonesGuess: ZoneId[] = name === 'pour_water' ? ['A']
      : asked && allZones.includes(asked) ? [asked]
      : name === 'get_readings' || name === 'list_zones' ? allZones : [];
    this.emit({ type: 'tool_call_started', tool: name, zones: zonesGuess, call_id: callId || undefined });
    const hooks: VoiceToolHooks = {
      sessionId: this.sessionId,
      assertConfirmToken: (token) => {
        const r = this.confirm.assertUsable(this.sessionId, token);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason, code: r.code };
      },
      consumeConfirmToken: (token) => this.confirm.consume(token),
      issueConfirmToken: (input: { kind: SoftGuardKind; reason: string; reading?: ZoneLive }) => {
        const rec = this.confirm.issue(this.sessionId, input);
        return { id: rec.id, expires_in_s: Math.round((rec.expiresAt - this.confirm.now()) / 1000) };
      },
      emitNavigate: (cmd) => this.opts.emitUiCommand(cmd),
      onAwaitingConfirmation: (info) => {
        this.emit({ type: 'awaiting_confirmation', what: 'pour_water', reason: info.reason, expires_in_s: info.expires_in_s, kind: info.kind });
      },
      logPour: (row) => persist.appendJsonl('pour-log.jsonl', { ...row, session: this.sessionId }),
    };
    const result = await runPlotTool(this.opts.app, name, args, { caller: 'voice', voice: hooks });
    this.emit({
      type: 'tool_call_finished',
      tool: name,
      zones: result.zones,
      ok: result.ok && !(isPourPayload(result.payload) && result.payload.ok === false),
      summary: result.summary,
    });
    if (callId) {
      this.opts.sendProvider({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result.payload) },
      });
      this.toolOutputsSent++;
    }
    return { name, zones: result.zones, payload: result.payload, ok: result.ok, summary: result.summary };
  }
}

function isPourPayload(p: unknown): p is { ok?: boolean } {
  return !!p && typeof p === 'object' && 'result' in (p as object);
}

export interface ToolRunView {
  name: string;
  zones: ZoneId[];
  payload: unknown;
  ok: boolean;
  summary: string;
}

export { CONFIRM_TTL_MS };
