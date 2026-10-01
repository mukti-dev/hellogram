import { cn } from '@hellogram/ui';
import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { EmptyState } from '../../../app/layouts/PageHeader.js';
import { ApiError } from '../../../core/http/api-error.js';
import { t } from '../../../i18n/t.js';
import { useStartCall } from '../../calls/model/start-call.js';
import { openUnlock } from '../../pin/model/unlock-ui.js';
import { ChatDetailsPanel } from '../components/ChatDetailsPanel.js';
import { ChatHeader } from '../components/ChatHeader.js';
import { ChatPane } from '../components/ChatPane.js';
import { ConversationList } from '../components/ConversationList.js';
import { useConversation } from '../model/queries.js';

/**
 * Desktop: list | chat | details (collapsible). Mobile: list, or chat, or settings.
 * Routes: /inbox, /inbox/:conversationId, /inbox/:conversationId/settings
 */
export function InboxLayout() {
  const { conversationId } = useParams();
  const settingsRoute = useLocation().pathname.endsWith('/settings');

  return (
    <div className="flex h-full min-h-0">
      <section
        className={cn(
          'w-full shrink-0 border-r border-border bg-bg lg:block lg:w-[360px]',
          conversationId ? 'hidden' : 'block',
        )}
      >
        <ConversationList />
      </section>
      <section className={cn('min-w-0 flex-1', conversationId ? 'flex' : 'hidden lg:flex')}>
        {conversationId ? (
          <Conversation key={conversationId} id={conversationId} settingsRoute={settingsRoute} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<MessageSquareText className="size-6" aria-hidden />} title={t('chat.selectChat')} hint={t('chat.selectChatHint')} />
          </div>
        )}
      </section>
    </div>
  );
}

function Conversation({ id, settingsRoute }: { id: string; settingsRoute: boolean }) {
  const navigate = useNavigate();
  const conversation = useConversation(id);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const startCall = useStartCall();

  if (conversation.error instanceof ApiError) {
    if (conversation.error.code === 'PERSONA_LOCKED') {
      const personaId = (conversation.error.details as { personaId?: string } | undefined)?.personaId;
      if (personaId) openUnlock(personaId);
    }
    return <Navigate to="/inbox" replace />;
  }
  const c = conversation.data;
  if (!c) return <div className="flex-1" />;

  const onCall = startCall ? () => startCall(c) : undefined;
  const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
  const toggleDetails = () => (isDesktop() ? setDetailsOpen((o) => !o) : navigate(`/inbox/${id}/settings`));

  if (settingsRoute) {
    return (
      <div className="flex-1 lg:hidden">
        <ChatDetailsPanel conversation={c} onClose={() => navigate(`/inbox/${id}`)} onCall={onCall} />
      </div>
    );
  }

  return (
    <div className="relative flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <ChatHeader conversation={c} onToggleDetails={toggleDetails} onCall={onCall} />
        <ChatPane conversation={c} />
      </div>
      {detailsOpen && (
        // Overlays the chat on narrower desktops; sits inline on wide screens (as in the design).
        <div className="absolute inset-y-0 right-0 z-20 hidden w-80 shrink-0 border-l border-border shadow-2xl lg:block xl:static xl:shadow-none">
          <ChatDetailsPanel conversation={c} onClose={() => setDetailsOpen(false)} onCall={onCall} />
        </div>
      )}
    </div>
  );
}
