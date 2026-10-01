import { z } from 'zod';
import { counterpartSchema, ownPersonaBriefSchema } from './requests.js';

export const iceServerSchema = z.object({
  urls: z.array(z.string()),
  username: z.string(),
  credential: z.string(),
});

export const callStartSchema = z.object({
  callId: z.uuid(),
  iceServers: z.array(iceServerSchema),
  /** Always "relay": peers never learn each other's IP address. */
  iceTransportPolicy: z.literal('relay'),
  ringSeconds: z.number().int(),
});
export type CallStartDto = z.infer<typeof callStartSchema>;

export const callAcceptSchema = z.object({
  iceServers: z.array(iceServerSchema),
  iceTransportPolicy: z.literal('relay'),
});
export type CallAcceptDto = z.infer<typeof callAcceptSchema>;

export const callLogEntrySchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  direction: z.enum(['incoming', 'outgoing']),
  outcome: z.enum(['answered', 'no_answer', 'declined', 'missed', 'cancelled']),
  me: ownPersonaBriefSchema,
  counterpart: counterpartSchema,
  startedAt: z.string(),
  durationSeconds: z.number().int().nullable(),
});
export type CallLogEntryDto = z.infer<typeof callLogEntrySchema>;

/** Socket payload for an incoming call. `caller` is null for PIN-locked numbers (rule 27). */
export interface IncomingCallEvent {
  callId: string;
  conversationId: string;
  caller: { id: string; code: string; displayName: string; avatarUrl: string | null } | null;
  to: { personaId: string; code: string; labelIcon: string; labelName: string };
}

export type CallSignal =
  | { callId: string; kind: 'offer' | 'answer'; data: { type: string; sdp: string } }
  | { callId: string; kind: 'ice'; data: Record<string, unknown> };
