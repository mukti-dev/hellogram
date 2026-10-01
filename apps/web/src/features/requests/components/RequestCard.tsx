import type { IncomingRequestDto } from '@hellogram/shared';
import { Avatar, Button, Card, Dialog } from '@hellogram/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { timeAgo } from '../../../shared/format.js';
import { ReportDialog } from '../../safety/components/ReportDialog.js';
import { useRequestAction } from '../model/queries.js';
import { NumberLabel } from '../../numbers/components/NumberLabel.js';

export function RequestCard({ request }: { request: IncomingRequestDto }) {
  const action = useRequestAction();
  const navigate = useNavigate();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const busy = action.isPending;

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <Avatar name={request.from.displayName} src={request.from.avatarUrl} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{request.from.displayName}</p>
            <NumberLabel of={request.to} prefix={t('requests.to')} />
            <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(request.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm text-muted">{request.introMessage}</p>
        </div>
      </div>
      {request.status === 'pending' && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => action.mutate({ id: request.id, action: 'decline' })}>
            {t('requests.decline')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() =>
              action.mutate(
                { id: request.id, action: 'accept' },
                { onSuccess: (result) => result && navigate(`/inbox/${result.conversationId}`) },
              )
            }
          >
            {t('requests.accept')}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmBlock(true)}>
            {t('requests.block')}
          </Button>
        </div>
      )}
      {action.error && <p className="mt-2 text-sm text-danger">{action.error.message}</p>}

      <Dialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title={t('requests.blockTitle', { name: request.from.displayName })}
        description={t('requests.blockBody')}
      >
        <div className="flex flex-col gap-2">
          <Button
            variant="danger"
            fullWidth
            disabled={busy}
            onClick={() => action.mutate({ id: request.id, action: 'block' }, { onSuccess: () => setConfirmBlock(false) })}
          >
            {t('requests.blockConfirm')}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => {
              setConfirmBlock(false);
              setReporting(true);
            }}
          >
            {t('requests.report')}
          </Button>
        </div>
      </Dialog>
      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        target={{ requestId: request.id }}
        name={request.from.displayName}
        onDone={() => undefined}
      />
    </Card>
  );
}
