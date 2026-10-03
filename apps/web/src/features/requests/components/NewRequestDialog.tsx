import { isValidNumberCode, normalizeNumberCode } from '@hellogram/shared';
import { Avatar, Button, Dialog, NumberCode, TextField } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '../../../i18n/t.js';
import { FormError } from '../../auth/components/FormError.js';
import { useNumbers } from '../../numbers/model/queries.js';
import { requestsApi } from '../api/requests.api.js';

const INTRO_MAX = 300;

/**
 * Inbox "+": type someone's Hellogram number and send them a contact request — the same request
 * (and the same limits) as opening their shared link. Shows whose number it is before sending.
 */
export function NewRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [raw, setRaw] = useState('');
  const [touched, setTouched] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [intro, setIntro] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const code = normalizeNumberCode(raw);
  const valid = isValidNumberCode(code);
  const mine = (useNumbers().data?.items ?? []).filter((p) => p.status === 'active');
  const own = valid && mine.some((p) => p.code === code);
  const from = fromId && mine.some((p) => p.id === fromId) ? fromId : (mine[0]?.id ?? null);

  const card = useQuery({
    queryKey: ['public', code],
    queryFn: () => requestsApi.publicCard(code),
    enabled: open && valid && !own,
    retry: false,
  });
  const person = valid && !own ? card.data : undefined;

  const send = useMutation({
    mutationFn: () => requestsApi.send({ fromPersonaId: from!, toCode: code, introMessage: intro }),
    onSuccess: () => {
      setSentTo(person?.displayName ?? code);
      void queryClient.invalidateQueries({ queryKey: ['requests'] });
    },
  });

  const reset = () => {
    setRaw('');
    setTouched(false);
    setFromId(null);
    setIntro('');
    setSentTo(null);
    send.reset();
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const codeError =
    touched && raw.trim() && !valid ? t('requests.invalidNumber') : own ? t('requests.ownNumber') : null;
  const canSend = Boolean(person?.acceptsRequests && from && !send.isPending);

  if (sentTo) {
    return (
      <Dialog open={open} onOpenChange={close} title={t('public.sent')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <p className="text-sm text-muted">{t('public.sentHint', { name: sentTo })}</p>
          <Button variant="gradient" fullWidth onClick={() => close(false)}>
            {t('requests.done')}
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close} title={t('requests.newRequest')} description={t('requests.newRequestHint')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (canSend) send.mutate();
        }}
      >
        <TextField
          label={t('requests.theirNumber')}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value.toUpperCase().replace(/\s+/g, ''));
            send.reset();
          }}
          onBlur={() => setTouched(true)}
          placeholder="A482719K"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          autoFocus
          className="font-mono tracking-wider"
          error={codeError}
        />

        {valid && !own && (
          <div aria-live="polite" className="rounded-md border border-border bg-surface-2 p-3">
            {card.isLoading ? (
              <p className="text-sm text-muted">{t('requests.lookingUp')}</p>
            ) : person ? (
              <div className="flex items-center gap-3">
                <Avatar name={person.displayName} src={person.avatarUrl} size={44} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{person.displayName}</p>
                  <NumberCode code={person.code} className="text-sm text-muted" />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('public.notFound')}</p>
            )}
            {person && !person.acceptsRequests && (
              <p className="mt-2 text-sm text-muted">{t('public.notAccepting', { name: person.displayName })}</p>
            )}
          </div>
        )}

        {mine.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
            <p className="text-muted">{t('requests.needNumber')}</p>
            <Link to="/numbers/new" onClick={() => close(false)} className="mt-2 inline-block font-medium text-primary">
              {t('requests.createNumber')}
            </Link>
          </div>
        ) : mine.length === 1 ? (
          <p className="text-sm text-muted">{t('requests.sendingFrom', { name: mine[0]!.displayName, code: mine[0]!.code })}</p>
        ) : (
          (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="new-request-from" className="text-sm font-medium">
                {t('public.fromNumber')}
              </label>
              <select
                id="new-request-from"
                value={from ?? ''}
                onChange={(e) => setFromId(e.target.value)}
                className="h-12 rounded-md border border-border bg-surface-2 px-3 text-sm"
              >
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} · {p.labelName} · {p.code}
                  </option>
                ))}
              </select>
            </div>
          )
        )}

        {person?.acceptsRequests && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-request-intro" className="text-sm font-medium">
              {t('public.intro')}
            </label>
            <textarea
              id="new-request-intro"
              rows={3}
              maxLength={INTRO_MAX}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder={t('requests.introPlaceholder')}
              className="resize-none rounded-md border border-border bg-surface-2 p-3 text-sm outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/40"
            />
            <p className="text-right text-xs text-muted">
              {intro.length}/{INTRO_MAX}
            </p>
          </div>
        )}

        <FormError message={send.error?.message ?? null} />
        <Button type="submit" variant="gradient" size="lg" fullWidth disabled={!canSend}>
          {send.isPending ? t('common.loading') : t('public.sendRequest')}
        </Button>
      </form>
    </Dialog>
  );
}
