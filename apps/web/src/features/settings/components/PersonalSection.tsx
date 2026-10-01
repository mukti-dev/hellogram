import { Button, Card } from '@hellogram/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../../i18n/t.js';
import { meApi } from '../../auth/api/auth.api.js';
import { FormError } from '../../auth/components/FormError.js';
import { meKeys, useMe } from '../../auth/model/queries.js';

/** Name (editable), date of birth and gender (set at sign-up). Private: never shown to others. */
export function PersonalSection() {
  const me = useMe();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => meApi.updateName(name),
    onSuccess: (updated) => {
      client.setQueryData(meKeys.me, updated);
      setEditing(false);
    },
  });

  const dob = me.data?.dateOfBirth
    ? new Date(`${me.data.dateOfBirth}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';
  const gender = me.data?.gender ? t(`auth.genders.${me.data.gender}`) : '—';

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <UserRound className="mt-0.5 size-5 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('profile.personal')}</h2>
          {editing ? (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) save.mutate();
              }}
            >
              <label htmlFor="account-name" className="sr-only">
                {t('auth.nameLabel')}
              </label>
              <input
                id="account-name"
                value={name}
                maxLength={50}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                className="h-11 flex-1 rounded-md border border-border bg-surface-2 px-3 text-sm outline-none focus:border-primary"
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-11" disabled={!name.trim() || save.isPending}>
                  {t('common.save')}
                </Button>
                <Button variant="ghost" size="sm" className="h-11" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">{t('auth.nameLabel')}</dt>
              <dd className="flex items-center gap-2 font-medium">
                <span className="truncate">{me.data?.name ?? '—'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setName(me.data?.name ?? '');
                    setEditing(true);
                  }}
                  className="text-xs font-semibold text-primary underline underline-offset-2"
                >
                  {t('profile.editName')}
                </button>
              </dd>
              <dt className="text-muted">{t('auth.dobLabel')}</dt>
              <dd className="font-medium">{dob}</dd>
              <dt className="text-muted">{t('auth.genderLabel')}</dt>
              <dd className="font-medium">{gender}</dd>
            </dl>
          )}
          <FormError message={save.error?.message ?? null} />
          <p className="mt-2 text-xs text-muted">{t('profile.personalHint')}</p>
        </div>
      </div>
    </Card>
  );
}
