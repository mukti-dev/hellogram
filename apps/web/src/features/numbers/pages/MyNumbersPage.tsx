import { Avatar, Button, Card, Logo } from '@hellogram/ui';
import { Bell, ChevronRight, Crown, Plus, Smartphone } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { EmptyState, PageHeader } from '../../../app/layouts/PageHeader.js';
import { t } from '../../../i18n/t.js';
import { NumberCard } from '../components/NumberCard.js';
import { useNumbers } from '../model/queries.js';

export function MyNumbersPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useNumbers();
  const plan = data?.plan;
  const atMax = plan ? plan.used >= plan.max : false;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center justify-between px-4 pt-4 lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('common.notifications')}
            className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <Bell className="size-5" aria-hidden />
          </button>
          <Link
            to="/settings/profile"
            aria-label={t('profile.open')}
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2"
          >
            <Avatar name={t('common.myAccount')} size={36} />
          </Link>
        </div>
      </div>

      <PageHeader
        title={t('numbers.title')}
        subtitle={
          plan && (
            <>
              {t('numbers.summary', { used: plan.used, max: plan.max })}
              {plan.freeLeft > 0 && (
                <>
                  {' · '}
                  <span className="font-medium text-primary">{t('numbers.freeLeft', { free: plan.freeLeft })}</span>
                </>
              )}
            </>
          )
        }
        actions={
          <Button
            variant="gradient"
            size="sm"
            disabled={atMax}
            onClick={() => navigate('/numbers/new')}
            leftIcon={<Plus className="size-4" aria-hidden />}
          >
            {t('nav.addNumber')}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 px-4 pb-8 lg:px-8">
        {isLoading && <p className="py-8 text-center text-sm text-muted">{t('common.loading')}</p>}

        {data && data.items.length === 0 && (
          <Card>
            <EmptyState icon={<Smartphone className="size-6" aria-hidden />} title={t('numbers.empty')} hint={t('numbers.emptyHint')} />
            <div className="px-6 pb-8 text-center">
              <Button variant="gradient" onClick={() => navigate('/numbers/new')} leftIcon={<Plus className="size-4" aria-hidden />}>
                {t('numbers.createFirst')}
              </Button>
            </div>
          </Card>
        )}

        {data?.items.map((number) => <NumberCard key={number.id} number={number} />)}

        {plan && plan.freeLeft === 0 && !atMax && (
          <button type="button" onClick={() => navigate('/numbers/new')} className="text-left">
            <Card className="flex items-center gap-4 border-transparent bg-gradient-to-r from-label-olx/20 via-primary/20 to-label-dating/20 p-4">
              <span className="inline-flex size-12 items-center justify-center rounded-md bg-label-olx/20">
                <Crown className="size-6 text-label-olx" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-sm text-muted">{t('numbers.upsellTitle')}</span>
                <span className="block font-semibold">{t('numbers.upsellPrice')}</span>
              </span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </Card>
          </button>
        )}
      </div>
    </div>
  );
}
