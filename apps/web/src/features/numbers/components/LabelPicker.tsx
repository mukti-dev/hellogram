import type { LabelKind } from '@hellogram/shared';
import { cn } from '@hellogram/ui';
import { t } from '../../../i18n/t.js';

const OPTIONS: { kind: LabelKind; text: string; tone: string }[] = [
  { kind: 'olx', text: 'OLX', tone: 'data-[on=true]:border-label-olx data-[on=true]:bg-label-olx/15 text-label-olx' },
  { kind: 'dating', text: 'Dating', tone: 'data-[on=true]:border-label-dating data-[on=true]:bg-label-dating/15 text-label-dating' },
  { kind: 'tenants', text: 'Tenants', tone: 'data-[on=true]:border-label-tenants data-[on=true]:bg-label-tenants/15 text-label-tenants' },
  { kind: 'other', text: 'Other', tone: 'data-[on=true]:border-muted data-[on=true]:bg-surface-3 text-fg' },
];

export function LabelPicker({ value, onChange }: { value: LabelKind; onChange: (kind: LabelKind) => void }) {
  return (
    <div role="radiogroup" aria-label={t('numbers.label')} className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.kind}
          type="button"
          role="radio"
          aria-checked={value === o.kind}
          data-on={value === o.kind}
          onClick={() => onChange(o.kind)}
          className={cn('h-10 rounded-md border border-border px-4 text-sm font-semibold transition hover:bg-surface-2', o.tone)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}
