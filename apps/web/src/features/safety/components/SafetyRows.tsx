import type { ConversationDto } from '@hellogram/shared';
import { Button, Dialog } from '@hellogram/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleSlash } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { safetyApi } from '../api/safety.api.js';
import { ReportDialog } from './ReportDialog.js';

/** Report + Block rows in chat settings (screen 10). */
export function SafetyRows({ conversation: c, onDone }: { conversation: ConversationDto; onDone: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const name = c.nickname ?? c.counterpart.displayName;

  const block = useMutation({
    mutationFn: () => safetyApi.blockConversation(c.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['conversations'] });
      void client.invalidateQueries({ queryKey: ['blocks'] });
      setBlocking(false);
      onDone();
      navigate('/inbox', { replace: true });
    },
  });

  if (c.counterpart.masked) return null;

  return (
    <>
      <button type="button" onClick={() => setReporting(true)} className="flex min-h-14 w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-surface-2">
        <CircleAlert className="size-5 text-danger" aria-hidden />
        <span>
          <span className="block text-sm font-medium text-danger">{t('chat.report')}</span>
          <span className="block text-xs text-muted">{t('chat.reportHint')}</span>
        </span>
      </button>
      <button type="button" onClick={() => setBlocking(true)} className="flex min-h-14 w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-surface-2">
        <CircleSlash className="size-5 text-danger" aria-hidden />
        <span>
          <span className="block text-sm font-medium text-danger">{t('chat.block')}</span>
          <span className="block text-xs text-muted">{t('chat.blockHint')}</span>
        </span>
      </button>

      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        target={{ conversationId: c.id }}
        name={name}
        onDone={() => {
          onDone();
          navigate('/inbox', { replace: true });
        }}
      />
      <Dialog open={blocking} onOpenChange={setBlocking} title={t('requests.blockTitle', { name })} description={t('requests.blockBody')}>
        <Button variant="danger" fullWidth disabled={block.isPending} onClick={() => block.mutate()}>
          {t('requests.blockConfirm')}
        </Button>
      </Dialog>
    </>
  );
}
