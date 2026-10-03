import type { ConversationDto, IncomingCallEvent } from '@hellogram/shared';
import type { QueryClient } from '@tanstack/react-query';
import { chatKeys } from '../../chat/model/keys.js';
import type { CallParty } from './call-store.js';

export function partyFor(client: QueryClient, event: IncomingCallEvent): CallParty {
  // My private nickname for this chat, if I set one.
  const conversation = client.getQueryData<ConversationDto>(chatKeys.one(event.conversationId));
  return {
    name: event.caller ? (conversation?.nickname ?? event.caller.displayName) : 'Incoming call',
    avatarUrl: event.caller?.avatarUrl ?? null,
    labelIcon: event.to.labelIcon,
    labelName: event.to.labelName,
    code: event.to.code,
  };
}
