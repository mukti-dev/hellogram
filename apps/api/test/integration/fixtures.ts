import type { IncomingRequestDto, OwnPersonaDto } from '@hellogram/shared';
import type { Harness, User } from './harness.js';

export async function createNumber(user: User, name: string, extra: Record<string, unknown> = {}): Promise<OwnPersonaDto> {
  const res = await user.request<OwnPersonaDto>({
    method: 'POST',
    url: '/v1/personas',
    payload: { displayName: name, labelName: 'OLX', labelIcon: 'shopping-bag', allowCalls: true, ...extra },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

/** Two users with one number each and an accepted conversation between them. */
export async function connectedPair(h: Harness, intro = 'Hi, is this still available?') {
  const owner = await h.signUp();
  const visitor = await h.signUp();
  const ownerNumber = await createNumber(owner, 'Rahul Deals');
  const visitorNumber = await createNumber(visitor, 'Amit Kumar');
  await visitor.request({
    method: 'POST',
    url: '/v1/requests',
    payload: { fromPersonaId: visitorNumber.id, toCode: ownerNumber.code, introMessage: intro },
  });
  const list = await owner.request<{ items: IncomingRequestDto[] }>({ method: 'GET', url: '/v1/requests' });
  const accepted = await owner.request<{ conversationId: string }>({
    method: 'POST',
    url: `/v1/requests/${list.body.items[0]!.id}/accept`,
  });
  return { owner, visitor, ownerNumber, visitorNumber, conversationId: accepted.body.conversationId };
}

let counter = 0;
export const clientId = () => `c-${Date.now()}-${counter++}-xxxxxxxx`;

export const sendMessage = (user: User, conversationId: string, body: string, cid = clientId()) =>
  user.request<{ id: string; status: string; error?: { code: string } }>({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    payload: { clientMessageId: cid, body },
  });
