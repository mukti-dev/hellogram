import type { OwnPersonaDto } from '@hellogram/shared';
import { Button, Dialog, TextField } from '@hellogram/ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { useRetireNumber } from '../model/queries.js';

/** Rule 7: deleting is irreversible, so it needs the word DELETE typed out. */
export function DeleteNumberDialog({
  number,
  open,
  onOpenChange,
}: {
  number: OwnPersonaDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const retire = useRetireNumber();
  const navigate = useNavigate();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setTyped('');
        onOpenChange(next);
      }}
      title={t('numbers.deleteTitle', { name: number.displayName })}
      description={t('numbers.deleteBody', { code: number.code })}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed !== 'DELETE') return;
          retire.mutate(number.id, {
            onSuccess: () => {
              onOpenChange(false);
              navigate('/numbers', { replace: true });
            },
          });
        }}
      >
        <TextField
          label={t('numbers.deleteConfirmLabel')}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="DELETE"
          error={retire.error?.message ?? null}
        />
        <Button type="submit" variant="danger" fullWidth disabled={typed !== 'DELETE' || retire.isPending}>
          {t('numbers.deleteConfirm')}
        </Button>
      </form>
    </Dialog>
  );
}
