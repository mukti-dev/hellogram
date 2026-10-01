import { Button, Card } from '@hellogram/ui';
import { t } from '../../../i18n/t.js';
import { useBlocks, useUnblock } from '../../requests/model/queries.js';

/** Settings → Blocked (rule 16), listed by the codes involved. */
export function BlockedSection() {
  const blocks = useBlocks();
  const unblock = useUnblock();
  const items = blocks.data?.items ?? [];

  return (
    <Card className="p-4" id="blocked">
      <h2 className="text-sm font-semibold">{t('settings.blocked')}</h2>
      <p className="text-xs text-muted">{t('settings.blockedHint')}</p>
      {items.length === 0 && <p className="mt-3 text-sm text-muted">{t('settings.noBlocked')}</p>}
      <ul className="mt-2 divide-y divide-border">
        {items.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{b.blockedDisplayName}</p>
              <p className="font-mono text-xs text-muted">{t('settings.blockedFrom', { code: b.blockedCode, from: b.fromCode })}</p>
            </div>
            <Button variant="outline" size="sm" disabled={unblock.isPending} onClick={() => unblock.mutate(b.id)}>
              {t('settings.unblock')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
