/**
 * VoiceClient: the browser half of the Grok voice assistant.
 *
 *   microphone ─▶ 24 kHz mono PCM16 ─▶ WebSocket ─▶ backend relay ─▶ xAI
 *   speaker    ◀─ 24 kHz mono PCM16 ◀─ WebSocket ◀─ backend relay ◀─ xAI
 *
 * The xAI key never reaches the browser: the backend holds it and runs every tool. This
 * file only moves audio and turns the backend's events into state for the orb.
 *
 * Details that make it feel smooth:
 *  - One AudioContext at 24 kHz for both directions, so nothing is resampled in JS.
 *  - Capture runs in an AudioWorklet (off the main thread) and is sent in 100 ms chunks.
 *  - Playback is scheduled back to back on the audio clock, so chunks join without clicks.
 *  - Barge-in: if you start talking while Grok is speaking, its audio stops at once.
 *  - Echo cancellation is on, so Grok does not hear itself through the speakers.
 *  - An OPTIONAL noise gate (?voicegate): xAI decides by itself when "the user started speaking", and that CANCELS
 *    whatever Grok is saying. In a noisy room, chatter would keep cutting Grok off. So quiet
 *    frames are sent as silence; real audio goes out only while you speak, plus a short tail.
 */
import { BACKEND_URL } from '../data/backendBoard';

export type VoiceEvent =
  | { type: 'session_started'; session_id: string }
  | { type: 'listening' }
  | { type: 'user_transcript'; text: string; final: boolean; item_id?: string }
  | { type: 'thinking' }
  | { type: 'tool_call_started'; tool: string; zones: string[]; call_id?: string }
  | { type: 'tool_call_finished'; tool: string; zones: string[]; ok: boolean; summary: string }
  | { type: 'assistant_transcript'; text: string; final: boolean }
  | { type: 'speaking_started' }
  | { type: 'speaking_ended' }
  | { type: 'output_audio'; audio: string }
  | { type: 'awaiting_confirmation'; what: string; kind: string; reason: string; expires_in_s: number }
  | { type: 'error'; message: string; code?: string }
  | { type: 'session_ended'; reason: string };

export interface VoiceStatus { enabled: boolean; reason: string | null; model?: string; browser?: { websocket?: string } }

const RATE = 24000;
const CHUNK = 2400;                       // 100 ms
// The gate is OFF unless the page URL contains ?voicegate. It is untested with a real voice,
// and a gate that is too eager would clip a quiet speaker.
const NOISE_GATE = new URLSearchParams(location.search).has('voicegate');
const GATE_OPEN = 0.022;                  // RMS above this opens the gate (speech close to the mic)
const GATE_HOLD_MS = 700;                 // keep sending after the last loud frame, so word endings survive
const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('pcm-tap', PcmTap);`;

export async function fetchVoiceStatus(): Promise<VoiceStatus> {
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${BACKEND_URL}/api/voice/status`, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.status === 404) return { enabled: false, reason: 'This backend build has no voice assistant. Restart the backend to load it.' };
    return (await res.json()) as VoiceStatus;
  } catch {
    return { enabled: false, reason: 'The backend is not reachable. Start it with: cd backend && npm start' };
  }
}

export class VoiceClient {
  /** 0..1, smoothed. Read these from requestAnimationFrame; they are not React state. */
  micLevel = 0;
  outLevel = 0;

  private ctx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private mic: MediaStream | null = null;
  private tap: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuf: Uint8Array<ArrayBuffer> | null = null;
  private playing = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private pending = new Int16Array(CHUNK);
  private filled = 0;
  private lastLoudAt = 0;
  private closed = false;
  /** counters for debugging a silent microphone (window.soil.voiceStats() with ?debug) */
  stats = { framesIn: 0, chunksSent: 0, chunksPlayed: 0, gatedFrames: 0, contextState: '' };
  /** true = send silence instead of the microphone (the session stays open) */
  muted = false;
  private gateOpenUntil = 0;

  constructor(private onEvent: (e: VoiceEvent) => void, private onPlayback: (active: boolean) => void) {}

  async start(wsUrl: string): Promise<void> {
    // 1. microphone first: this is the step that needs the user's tap and permission
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyserBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.analyser.connect(this.ctx.destination);

    // 2. the relay
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not open the voice connection to the backend.'));
      ws.onmessage = (m) => { try { this.handle(JSON.parse(String(m.data)) as VoiceEvent); } catch { /* ignore */ } };
      ws.onclose = () => { if (!this.closed) this.onEvent({ type: 'session_ended', reason: 'connection_closed' }); };
    });

    // 3. capture
    const src = this.ctx.createMediaStreamSource(this.mic);
    // The tap needs an output that leads to the destination: a node nobody pulls from is
    // never processed, and the microphone would look silent. A zero-gain node keeps it mute.
    this.tap = new AudioWorkletNode(this.ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.tap.port.onmessage = (m) => this.onFrame(m.data as Float32Array);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.tap);
    this.tap.connect(mute);
    mute.connect(this.ctx.destination);
  }

  sendText(text: string): void { this.send({ type: 'text', text }); }

  stop(): void {
    this.closed = true;
    try { this.send({ type: 'end' }); } catch { /* already gone */ }
    this.flushPlayback();
    this.tap?.port.close(); this.tap?.disconnect(); this.tap = null;
    this.mic?.getTracks().forEach((t) => t.stop()); this.mic = null;
    setTimeout(() => { try { this.ws?.close(); } catch { /* */ } this.ws = null; }, 150);
    void this.ctx?.close(); this.ctx = null;
    this.micLevel = 0; this.outLevel = 0;
  }

  /** Call every animation frame while a session is open. */
  sampleLevels(): void {
    this.stats.contextState = this.ctx?.state ?? 'none';
    this.micLevel *= 0.86;
    if (this.analyser && this.analyserBuf) {
      this.analyser.getByteTimeDomainData(this.analyserBuf);
      let sum = 0; for (const v of this.analyserBuf) { const x = (v - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / this.analyserBuf.length);
      this.outLevel = this.outLevel * 0.7 + Math.min(1, rms * 4.5) * 0.3;
    }
    const active = !!this.ctx && this.nextTime > this.ctx.currentTime + 0.02;
    if (active !== this.wasActive) { this.wasActive = active; this.onPlayback(active); }
  }
  private wasActive = false;

  // ------------------------------------------------------------------ capture
  private onFrame(frame: Float32Array): void {
    this.stats.framesIn++;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const level = Math.sqrt(sum / frame.length);
    const now = performance.now();
    if (level > GATE_OPEN) this.gateOpenUntil = now + GATE_HOLD_MS;
    const pass = !this.muted && (!NOISE_GATE || now < this.gateOpenUntil);
    if (!pass) this.stats.gatedFrames++;
    for (let i = 0; i < frame.length; i++) {
      const s = pass ? Math.max(-1, Math.min(1, frame[i])) : 0;
      this.pending[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === CHUNK) { this.send({ type: 'input_audio', audio: toBase64(this.pending) }); this.filled = 0; this.stats.chunksSent++; }
    }
    this.micLevel = Math.max(this.micLevel, this.muted ? 0 : Math.min(1, level * 6));
    if (level > 0.035 && !this.muted) this.lastLoudAt = now;
  }

  // ----------------------------------------------------------------- playback
  private handle(e: VoiceEvent): void {
    if (e.type === 'output_audio') { this.enqueue(e.audio); return; }
    // Barge-in: the server heard speech while Grok is talking. Only trust it if OUR mic was
    // really loud just now, so an echo of Grok's own voice cannot cut Grok off.
    if (e.type === 'listening' && this.wasActive && performance.now() - this.lastLoudAt < 600) this.flushPlayback();
    if (e.type === 'session_ended') this.closed = true;
    this.onEvent(e);
  }

  private enqueue(b64: string): void {
    const ctx = this.ctx; if (!ctx || !this.analyser) return;
    const pcm = fromBase64(b64);
    if (!pcm.length) return;
    this.stats.chunksPlayed++;
    const buf = ctx.createBuffer(1, pcm.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(this.analyser);
    const at = Math.max(ctx.currentTime + 0.06, this.nextTime);     // back to back on the audio clock
    node.start(at);
    this.nextTime = at + buf.duration;
    this.playing.add(node);
    node.onended = () => this.playing.delete(node);
  }

  private flushPlayback(): void {
    for (const n of this.playing) { try { n.stop(); } catch { /* not started */ } }
    this.playing.clear();
    this.nextTime = 0;
  }

  private send(msg: unknown): void { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
}

function toBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Int16Array {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length - (bin.length % 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
