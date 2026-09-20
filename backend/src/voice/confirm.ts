import { randomBytes } from 'node:crypto';
import type { SoftGuardKind, ZoneLive } from '../types.js';

export const CONFIRM_TTL_MS = 60_000;

const CONFIRM_RE = /\b(yes|yeah|yep|yup|sure|ok|okay|do it|pour(?:\s+it)?|go ahead|go for it|confirm|please|proceed|do that|tip it)\b/i;
const DENY_RE = /\b(no|nope|don't|dont|stop|cancel|never\s?mind|not now|wait)\b/i;

export interface ConfirmRecord {
  id: string;
  sessionId: string;
  kind: SoftGuardKind;
  reason: string;
  reading?: ZoneLive;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
  /** True only after a confirmatory user utterance in this session. */
  armed: boolean;
  /** A user turn happened after issue (VAD or transcript). Needed even without keywords. */
  userTurnAfterIssue: boolean;
}

export class ConfirmStore {
  private tokens = new Map<string, ConfirmRecord>();

  constructor(private opts: { ttlMs?: number; now?: () => number } = {}) {}

  now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  issue(sessionId: string, input: { kind: SoftGuardKind; reason: string; reading?: ZoneLive }): ConfirmRecord {
    const t = this.now();
    const rec: ConfirmRecord = {
      id: `pgc_${randomBytes(18).toString('base64url')}`,
      sessionId,
      kind: input.kind,
      reason: input.reason,
      reading: input.reading,
      issuedAt: t,
      expiresAt: t + (this.opts.ttlMs ?? CONFIRM_TTL_MS),
      used: false,
      armed: false,
      userTurnAfterIssue: false,
    };
    this.tokens.set(rec.id, rec);
    return rec;
  }

  /**
   * Record that the user spoke. Deny phrases revoke pending tokens.
   * Confirm phrases arm a token that already has a user turn (this utterance counts).
   * A user turn with no usable transcript (ASR missing) also arms: speech itself is the evidence.
   */
  noteUserUtterance(sessionId: string, text: string | null, source: 'transcript' | 'vad'): { armed: string[]; revoked: string[] } {
    const armed: string[] = [];
    const revoked: string[] = [];
    const t = this.now();
    const deny = text != null && DENY_RE.test(text);
    const confirm = text != null && CONFIRM_RE.test(text) && !deny;
    for (const rec of this.tokens.values()) {
      if (rec.sessionId !== sessionId || rec.used || t >= rec.expiresAt) continue;
      rec.userTurnAfterIssue = true;
      if (deny) {
        rec.used = true;
        revoked.push(rec.id);
        continue;
      }
      if (confirm || (source === 'vad' && text == null)) {
        rec.armed = true;
        armed.push(rec.id);
      }
    }
    return { armed, revoked };
  }

  peek(id: string): ConfirmRecord | undefined {
    return this.tokens.get(id);
  }

  /** Validate without consuming. */
  assertUsable(sessionId: string, id: string): { ok: true; record: ConfirmRecord } | { ok: false; reason: string; code: string } {
    const rec = this.tokens.get(id);
    if (!rec) return { ok: false, reason: 'That confirm token is not recognised. Call pour_water without a token to get a new one if a soft guard still applies.', code: 'unknown_token' };
    if (rec.sessionId !== sessionId) return { ok: false, reason: 'That confirm token belongs to a different voice session.', code: 'wrong_session' };
    if (rec.used) return { ok: false, reason: 'That confirm token was already used or revoked. Call pour_water without a token if you still need to pour.', code: 'used' };
    if (this.now() >= rec.expiresAt) return { ok: false, reason: 'That confirm token expired. Ask the user again, then call pour_water without a token to get a fresh one.', code: 'expired' };
    if (!rec.armed || !rec.userTurnAfterIssue) {
      return { ok: false, reason: 'The user has not confirmed yet. Tell them why the pour was refused and wait for them to speak.', code: 'not_armed' };
    }
    return { ok: true, record: rec };
  }

  consume(id: string): void {
    const rec = this.tokens.get(id);
    if (rec) rec.used = true;
  }

  dropSession(sessionId: string): void {
    for (const [id, rec] of this.tokens) {
      if (rec.sessionId === sessionId) this.tokens.delete(id);
    }
  }
}
