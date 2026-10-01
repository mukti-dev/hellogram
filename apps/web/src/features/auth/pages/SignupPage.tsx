import { Button, TextField, cn } from '@hellogram/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuthConfig } from '../../../core/phone/delivery.js';
import { setPendingVerification, startPhoneVerification } from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { Turnstile, turnstileEnabled } from '../../../shared/Turnstile.js';
import { authApi, type Gender } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { FormError } from '../components/FormError.js';
import { MobileField, isValidMobile, mobileDigits } from '../components/MobileField.js';
import { OtpDeliveryNote } from '../components/OtpDeliveryNote.js';
import { PasswordField } from '../components/PasswordField.js';
import { withNext } from '../model/next-path.js';
import { ageFrom, latestAdultBirthday, passwordProblem } from '../model/password-rules.js';

const GENDERS: Gender[] = ['male', 'female', 'other', 'prefer_not_to_say'];

/** Name, mobile, date of birth, gender, password → a code to the mobile → account. 18+ only. */
export function SignupPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const config = useAuthConfig();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState(false);
  const [human, setHuman] = useState<string | null>(null);
  const onToken = useCallback((token: string | null) => setHuman(token), []);

  const age = ageFrom(dateOfBirth);
  const errors = {
    name: name.trim() ? null : t('auth.nameRequired'),
    mobile: isValidMobile(mobile) ? null : t('auth.invalidMobile'),
    dateOfBirth: age === null ? t('auth.dobRequired') : age < 18 ? t('auth.underAge') : null,
    gender: gender ? null : t('auth.genderRequired'),
    password: passwordProblem(password),
    confirm: confirm === password ? null : t('auth.passwordsDontMatch'),
    terms: terms ? null : t('auth.termsRequired'),
  };
  const valid = Object.values(errors).every((e) => e === null) && (!turnstileEnabled || Boolean(human));
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  const signup = useMutation({
    mutationFn: async () => {
      const phone = `+91${mobileDigits(mobile)}`;
      const { signupId } = await authApi.signup(
        {
          name: name.trim(),
          phone,
          dateOfBirth,
          gender: gender!,
          password,
          termsAccepted: true,
          consentVersion: config.data?.consentVersion ?? '',
        },
        human,
      );
      // Our server has sent the code (or Firebase sends it from here).
      setPendingVerification(phone, await startPhoneVerification(phone, async () => undefined));
      return { phone, signupId };
    },
    onSuccess: ({ phone, signupId }) =>
      navigate(withNext('/signup/verify', search), { state: { flow: 'signup', phone, signupId } }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (valid) signup.mutate();
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight">{t('auth.signupTitle')}</h1>
      <p className="mt-1 text-sm text-muted">{t('auth.signupSubtitle')}</p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <TextField
          label={t('auth.nameLabel')}
          placeholder={t('auth.namePlaceholder')}
          autoComplete="name"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={show('name')}
          autoFocus
        />
        <MobileField value={mobile} onChange={setMobile} error={show('mobile')} />
        <TextField
          label={t('auth.dobLabel')}
          type="date"
          autoComplete="bday"
          max={latestAdultBirthday()}
          min="1900-01-01"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          hint={t('auth.dobHint')}
          error={show('dateOfBirth') ?? (age !== null && age < 18 ? t('auth.underAge') : null)}
        />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{t('auth.genderLabel')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {GENDERS.map((g) => (
              <label
                key={g}
                className={cn(
                  'flex h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40',
                  gender === g ? 'border-primary bg-primary-soft font-semibold text-fg' : 'border-border text-muted hover:bg-surface-2',
                )}
              >
                <input type="radio" name="gender" value={g} checked={gender === g} onChange={() => setGender(g)} className="sr-only" />
                {t(`auth.genders.${g}`)}
              </label>
            ))}
          </div>
          {show('gender') && (
            <p className="text-xs font-medium text-danger" role="alert">
              {show('gender')}
            </p>
          )}
        </fieldset>

        <PasswordField
          label={t('auth.newPasswordLabel')}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t('auth.passwordHint')}
          error={show('password')}
        />
        <PasswordField
          label={t('auth.confirmPasswordLabel')}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={confirm ? errors.confirm : show('confirm')}
        />

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 rounded border-border accent-[var(--hg-primary)]"
          />
          <span>
            {t('auth.iAgree')}{' '}
            <Link to="/terms" target="_blank" className="text-primary underline underline-offset-2">
              {t('auth.terms')}
            </Link>{' '}
            {t('auth.and')}{' '}
            <Link to="/privacy" target="_blank" className="text-primary underline underline-offset-2">
              {t('auth.privacy')}
            </Link>
          </span>
        </label>
        {show('terms') && (
          <p className="-mt-2 text-xs font-medium text-danger" role="alert">
            {show('terms')}
          </p>
        )}

        <Turnstile onToken={onToken} />
        <FormError message={signup.error?.message ?? null} />

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          fullWidth
          disabled={signup.isPending || config.isPending}
          rightIcon={<ArrowRight className="size-5" aria-hidden />}
        >
          {t('auth.signupContinue')}
        </Button>
        <OtpDeliveryNote when="before" />

        <p className="text-center text-sm text-muted">
          {t('auth.haveAccount')}{' '}
          <Link to={withNext('/login', search)} className="font-semibold text-primary underline underline-offset-4">
            {t('auth.logIn')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
