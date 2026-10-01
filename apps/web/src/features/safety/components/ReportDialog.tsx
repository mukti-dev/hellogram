import { REPORT_REASONS } from '@hellogram/shared';
import { Button, Dialog, cn } from '@hellogram/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { t } from '../../../i18n/t.js';
import { safetyApi } from '../api/safety.api.js';

const REASON_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  harassment: 'Harassment',
  spam: 'Spam',
  scam: 'Scam or fraud',
  sexual_content: 'Sexual content',
  threat: 'Threat or violence',
  other: 'Something else',
};

export function ReportDialog({
  open,
  onOpenChange,
  target,
  name,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { conversationId: string } | { requestId: string };
  name: string;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const report = useMutation({
    mutationFn: () => safetyApi.report({ ...target, reason: reason!, note: note || null, alsoBlock }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['conversations'] });
      void client.invalidateQueries({ queryKey: ['requests'] });
      void client.invalidateQueries({ queryKey: ['blocks'] });
      onOpenChange(false);
      onDone();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${t('safety.reportTitle', { name })}`} description={t('chat.reportHint')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason) report.mutate();
        }}
      >
        <div role="radiogroup" aria-label={t('safety.reason')} className="grid grid-cols-2 gap-2">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                'h-11 rounded-md border px-3 text-left text-sm font-medium transition',
                reason === r ? 'border-danger bg-danger/10 text-fg' : 'border-border hover:bg-surface-2',
              )}
            >
              {REASON_LABEL[r]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('safety.note')}
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="resize-none rounded-md border border-border bg-surface-2 p-3 text-sm font-normal outline-none focus:border-primary"
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} className="size-5 accent-[var(--hg-primary)]" />
          {t('safety.alsoBlock')}
        </label>
        {report.error && <p className="text-sm text-danger">{report.error.message}</p>}
        <Button type="submit" variant="danger" fullWidth disabled={!reason || report.isPending}>
          {t('safety.submitReport')}
        </Button>
      </form>
    </Dialog>
  );
}
