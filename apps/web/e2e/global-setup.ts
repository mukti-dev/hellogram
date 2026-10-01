import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The tests sign up made-up phone numbers. If the local API were sending real codes
 * (2Factor, Message Central, MSG91, Fast2SMS…), those would reach real people's phones
 * and cost money. Refuse to run unless apps/api/.env is in test mode.
 */
export default function guardAgainstRealSms(): void {
  if (process.env.E2E_BASE_URL) return; // a remote/staging target manages its own settings

  let env = '';
  try {
    env = readFileSync(fileURLToPath(new URL('../../api/.env', import.meta.url)), 'utf8');
  } catch {
    return; // no .env: the API runs on its safe defaults (console SMS)
  }
  const values = (key: string) =>
    [...env.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'gm'))].map((m) => m[1]!.replace(/^["']|["']$/g, ''));

  const providers = values('SMS_PROVIDER');
  const bypass = values('OTP_BYPASS');
  const realSms = providers.some((p) => p !== 'console');
  const realCodes = bypass.length === 0 || bypass.some((b) => b !== 'true');
  if (realSms || realCodes) {
    throw new Error(
      [
        'E2E tests stopped: apps/api/.env would send REAL verification codes to made-up numbers.',
        `  SMS_PROVIDER=${providers.join(', ') || '(unset)'}  OTP_BYPASS=${bypass.join(', ') || '(unset)'}`,
        'Run the tests with SMS_PROVIDER=console and OTP_BYPASS=true (and restart `pnpm dev`).',
      ].join('\n'),
    );
  }
}
