import { LABEL_ICONS, LIMITS, type LabelIcon } from '@hellogram/shared';
import { TextField, cn } from '@hellogram/ui';
import { t } from '../../../i18n/t.js';
import { LABEL_ICON_SET, NumberLabel, iconName } from './NumberLabel.js';

/** Examples only — there are no preset labels. */
const EXAMPLES = ['OLX', 'Dating', 'Tenants', 'Freelance', 'Car sale'];

export interface LabelValue {
  labelName: string;
  labelIcon: LabelIcon;
}

/** The user's own label text plus an icon, with a live preview of the chip. */
export function LabelEditor({ value, onChange }: { value: LabelValue; onChange: (value: LabelValue) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label={t('numbers.label')}
        placeholder={t('numbers.labelPlaceholder')}
        hint={t('numbers.labelHint', { examples: EXAMPLES.join(', ') })}
        maxLength={LIMITS.LABEL_NAME_MAX}
        value={value.labelName}
        onChange={(e) => onChange({ ...value, labelName: e.target.value })}
        required
      />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('numbers.icon')}</legend>
        <div role="radiogroup" aria-label={t('numbers.icon')} className="grid grid-cols-5 gap-2 sm:grid-cols-10">
          {LABEL_ICONS.map((icon) => {
            const { Icon } = LABEL_ICON_SET[icon];
            const selected = value.labelIcon === icon;
            return (
              <button
                key={icon}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={iconName(icon)}
                title={iconName(icon)}
                onClick={() => onChange({ ...value, labelIcon: icon })}
                className={cn(
                  'inline-flex aspect-square items-center justify-center rounded-md border transition',
                  selected ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                <Icon className="size-5" aria-hidden />
              </button>
            );
          })}
        </div>
      </fieldset>

      {value.labelName.trim() && (
        <p className="flex items-center gap-2 text-xs text-muted">
          {t('numbers.labelPreview')} <NumberLabel of={{ labelIcon: value.labelIcon, labelName: value.labelName.trim() }} />
        </p>
      )}
    </div>
  );
}
