import { t } from '../../../i18n/t.js';

/** The same basics the server checks, shown before submitting. The server has the final say. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return t('auth.tooShort');
  return null;
}

/** Whole years old today, from a YYYY-MM-DD date input. */
export function ageFrom(dateOfBirth: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age;
}

/** Latest birthday allowed (18 years ago today), for the date picker's max. */
export function latestAdultBirthday(today = new Date()): string {
  const d = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
