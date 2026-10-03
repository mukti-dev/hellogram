import {
  attachmentLabel,
  hasContent,
  isInDnd,
  RING_SECONDS,
  type Clock,
  type ConversationRepository,
  type Message,
  type Persona,
  type PersonaRepository,
  type PushPayload,
} from '@hellogram/domain';

export interface PushIntent {
  accountId: string;
  payload: PushPayload;
  /** Skip when the account already has the app open (a live socket). */
  onlyIfOffline: boolean;
}

const preview = (body: string | null) => (body && body.length > 100 ? `${body.slice(0, 97)}…` : (body ?? ''));

/**
 * Decides whether a domain event becomes a push notification, and what it may say.
 * Locked numbers never reveal a name or preview (rule 27); muted chats and DND stay quiet.
 */
export class PushTriggers {
  constructor(private readonly deps: { personas: PersonaRepository; conversations: ConversationRepository; clock: Clock }) {}

  async forMessage(p: { message: Message; conversationId: string; senderPersonaId: string; recipientPersonaId: string }): Promise<PushIntent | null> {
    if (p.message.suppressed || p.message.type !== 'text') return null;
    const view = await this.deps.conversations.findView(p.conversationId, p.recipientPersonaId);
    if (!view || view.me.hiddenAt) return null;
    const now = this.deps.clock.now();
    if (view.me.mutedUntil && view.me.mutedUntil > now) return null;
    if (isInDnd(view.myPersona, now)) return null;
    const url = `/inbox/${p.conversationId}`;
    if (view.myPersona.hasPin) {
      return { accountId: view.myPersona.accountId, onlyIfOffline: true, payload: { title: 'Hellogram', body: 'New message', url, tag: 'locked' } };
    }
    return {
      accountId: view.myPersona.accountId,
      onlyIfOffline: true,
      payload: {
        title: view.me.nickname ?? (view.me.counterpartMasked ? 'Unknown' : view.otherPersona.displayName),
        body: preview(p.message.body) || (p.message.attachment && hasContent(p.message) ? attachmentLabel(p.message.attachment) : ''),
        url,
        tag: p.conversationId,
      },
    };
  }

  async forRequest(p: { personaId: string }): Promise<PushIntent | null> {
    const persona = await this.deps.personas.findById(p.personaId);
    if (!persona || isInDnd(persona, this.deps.clock.now())) return null;
    return {
      accountId: persona.accountId,
      onlyIfOffline: true,
      payload: {
        title: 'Hellogram',
        body: persona.hasPin ? 'New request' : `New contact request for ${persona.displayName}`,
        url: '/inbox/requests',
        tag: 'requests',
      },
    };
  }

  /**
   * Sent even while the app is open: in a background tab or behind other apps the in-app call
   * screen can't be seen, and the notification is what shows on top. The device's service worker
   * skips it when Hellogram is already on screen.
   */
  forCall(p: { callId: string; callee: Persona; caller: Persona; calleeLocked: boolean; declineToken?: string }): PushIntent {
    return {
      accountId: p.callee.accountId,
      onlyIfOffline: false,
      payload: {
        kind: 'call',
        callId: p.callId,
        ...(p.declineToken ? { declineToken: p.declineToken } : {}),
        title: p.calleeLocked ? 'Incoming call' : `Incoming call from ${p.caller.displayName}`,
        body: p.calleeLocked ? 'Tap to answer in Hellogram' : `to ${p.callee.code}`,
        url: `/inbox?call=${p.callId}`,
        tag: `call-${p.callId}`,
        ttlSeconds: RING_SECONDS,
      },
    };
  }

  /** Replaces the ringing notification: "Missed call…" if they never picked up, otherwise it just goes away. */
  async forCallEnded(p: { callId: string; callerPersonaId: string; calleePersonaId: string; suppressed: boolean; missed?: boolean; answered?: boolean }): Promise<PushIntent | null> {
    if (p.suppressed) return null;
    const [callee, caller] = await Promise.all([this.deps.personas.findById(p.calleePersonaId), this.deps.personas.findById(p.callerPersonaId)]);
    if (!callee) return null;
    const missed = Boolean(p.missed);
    return {
      accountId: callee.accountId,
      onlyIfOffline: false,
      payload: {
        kind: p.answered ? 'call_answered' : 'call_ended',
        callId: p.callId,
        missed,
        title: missed ? (callee.hasPin || !caller ? 'Missed call' : `Missed call from ${caller.displayName}`) : 'Call ended',
        body: missed && !callee.hasPin ? `to ${callee.code}` : '',
        url: '/calls',
        tag: `call-${p.callId}`,
        ttlSeconds: missed ? 60 * 60 : 60,
      },
    };
  }

  forBillingReminder(p: { accountId: string; day: number; graceUntil: Date }): PushIntent {
    const days = Math.max(1, Math.ceil((p.graceUntil.getTime() - this.deps.clock.now().getTime()) / 86_400_000));
    return {
      accountId: p.accountId,
      onlyIfOffline: false,
      payload: {
        title: 'Payment failed',
        body:
          p.day === 0
            ? 'Your extra numbers are paused. Renew to keep them.'
            : `Renew within ${days} day${days === 1 ? '' : 's'} or your extra numbers will be deleted.`,
        url: '/settings/billing',
        tag: 'billing',
      },
    };
  }
}
