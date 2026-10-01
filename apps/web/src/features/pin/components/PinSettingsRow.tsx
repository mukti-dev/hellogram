import type { OwnPersonaDto } from '@hellogram/shared';
import { Button, Dialog, Switch } from '@hellogram/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/http/api-error.js';
import { t } from '../../../i18n/t.js';
import { pinApi } from '../api/pin.api.js';
import { useUnlockTokens } from '../model/unlock-tokens.js';
import { PinPad } from './PinPad.js';

type Mode = null | 'set' | 'confirm' | 'remove' | 'change-current' | 'change-new' | 'change-confirm';

/** "Lock with PIN" on the number detail screen (rule 24). */
export function PinSettingsRow({ number, icon }: { number: OwnPersonaDto; icon: ReactNode }) {
  const client = useQueryClient();
  const setToken = useUnlockTokens((s) => s.set);
  const [mode, setMode] = useState<Mode>(null);
  const [first, setFirst] = useState('');
  const [current, setCurrent] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode(null);
    setFirst('');
    setCurrent('');
    setValue('');
    setError(null);
  };

  const finish = async (fn: () => Promise<{ unlockToken: string } | void>) => {
    try {
      const result = await fn();
      if (result) setToken(number.id, result.unlockToken);
      await client.invalidateQueries();
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
      setValue('');
    }
  };

  const titles: Record<Exclude<Mode, null>, string> = {
    set: t('pin.chooseNew'),
    confirm: t('pin.confirmNew'),
    remove: t('pin.enterToRemove'),
    'change-current': t('pin.enterCurrent'),
    'change-new': t('pin.chooseNew'),
    'change-confirm': t('pin.confirmNew'),
  };

  const onComplete = (v: string) => {
    setError(null);
    switch (mode) {
      case 'set':
      case 'change-new':
        setFirst(v);
        setValue('');
        setMode(mode === 'set' ? 'confirm' : 'change-confirm');
        return;
      case 'confirm':
      case 'change-confirm':
        if (v !== first) {
          setError(t('pin.mismatch'));
          setValue('');
          return;
        }
        void finish(() => pinApi.set(number.id, v, mode === 'change-confirm' ? current : undefined));
        return;
      case 'remove':
        void finish(() => pinApi.remove(number.id, v));
        return;
      case 'change-current':
        setCurrent(v);
        setValue('');
        setMode('change-new');
    }
  };

  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <span className="text-muted">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-medium">{t('numbers.lockWithPin')}</p>
        {number.hasPin && (
          <button type="button" onClick={() => setMode('change-current')} className="text-xs font-semibold text-primary">
            {t('pin.change')}
          </button>
        )}
      </div>
      <Switch
        checked={number.hasPin}
        onCheckedChange={(on) => setMode(on ? 'set' : 'remove')}
        label={t('numbers.lockWithPin')}
      />
      <Dialog open={mode !== null} onOpenChange={(open) => !open && reset()} title={mode ? titles[mode] : ''} description={t('pin.hint')}>
        <div className="flex flex-col items-center gap-4 py-2">
          <PinPad key={mode} value={value} onChange={setValue} onComplete={onComplete} error={Boolean(error)} />
          <p role="alert" className="min-h-5 text-sm text-danger">{error}</p>
          <Button variant="ghost" onClick={reset}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
