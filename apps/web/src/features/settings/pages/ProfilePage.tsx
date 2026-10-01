import { Avatar } from '@hellogram/ui';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { formatPhone, useMe } from '../../auth/model/queries.js';
import { DevicesSection } from '../components/DevicesSection.js';
import { EmailSection } from '../components/EmailSection.js';
import { PersonalSection } from '../components/PersonalSection.js';
import { PhoneSection } from '../components/PhoneSection.js';
import { SoundsSection } from '../components/SoundsSection.js';

/** My profile: the account itself (phone, email), how this device rings, and where I'm logged in. */
export function ProfilePage() {
  const me = useMe();
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-2 px-4 pt-4 pb-4 lg:px-8 lg:pt-8">
        <button type="button" onClick={() => navigate('/settings')} aria-label={t('numbers.back')} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-2xl font-bold tracking-tight">{t('profile.title')}</h1>
      </div>
      <div className="flex flex-col gap-4 px-4 pb-8 lg:px-8">
        <div className="flex items-center gap-4 px-1">
          <Avatar name={me.data?.name ?? t('common.myAccount')} size={64} />
          <div className="min-w-0">
            <p className="text-lg font-semibold">{me.data?.name ?? t('common.myAccount')}</p>
            <p className="truncate text-sm text-muted">
              {me.data ? formatPhone(me.data.phone) : ' '}
              {me.data?.email && ` · ${me.data.email}`}
            </p>
            {me.data && (
              <p className="text-xs text-muted">
                {t('profile.memberSince', { date: new Date(me.data.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })}
              </p>
            )}
          </div>
        </div>
        <p className="px-1 text-xs text-muted">{t('profile.privateNote')}</p>
        <PersonalSection />
        <PhoneSection />
        <EmailSection />
        <SoundsSection />
        <DevicesSection />
      </div>
    </div>
  );
}
