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

/** An incoming call (socket event, or GET /calls/:id). `caller` is null for PIN-locked numbers (rule 27). */
export const incomingCallSchema = z.object({
  callId: z.uuid(),
  conversationId: z.uuid(),
  caller: z.object({ id: z.uuid(), code: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }).nullable(),
  to: z.object({ personaId: z.uuid(), code: z.string(), labelIcon: z.string(), labelName: z.string() }),
});
export type IncomingCallEvent = z.infer<typeof incomingCallSchema>;

export type CallSignal =
  | { callId: string; kind: 'offer' | 'answer'; data: { type: string; sdp: string } }
  | { callId: string; kind: 'ice'; data: Record<string, unknown> };
