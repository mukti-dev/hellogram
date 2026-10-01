import { DomainError, type HostedSmsVerification } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

export interface TwoFactorConfig {
  apiKey: string;
  /**
   * Name of an approved OTP SMS template in the 2Factor dashboard. Without one,
   * 2Factor may deliver the code as a voice call instead of an SMS.
   */
  templateName?: string | undefined;
  baseUrl?: string;
  /** Pause before re-checking a "mismatch" (2Factor can briefly reject a correct, fresh code). */
  retryDelayMs?: number;
}

export interface TwoFactorLogger {
  warn(obj: object, msg: string): void;
}

/** Every 2Factor reply is `{ Status: "Success" | "Error", Details: string }`. */
interface TwoFactorReply {
  Status?: string;
  Details?: string;
}

const unavailable = () =>
  new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'We couldn’t send or check the code right now. Please try again in a minute.');

/**
 * 2Factor.in OTP (https://2factor.in/API/V1): 2Factor makes the 6-digit code, delivers it
 * (SMS or voice call) and checks it. We only hold its session id.
 * The API key sits in the URL path, so URLs are never logged.
 */
export class TwoFactorVerification implements HostedSmsVerification {
  private readonly baseUrl: string;

  constructor(
    private readonly config: TwoFactorConfig,
    private readonly logger: TwoFactorLogger,
  ) {
    this.baseUrl = (config.baseUrl ?? 'https://2factor.in/API/V1').replace(/\/$/, '');
  }

  async send(phone: string): Promise<{ reference: string }> {
    const mobile = this.mobileOf(phone);
    const template = this.config.templateName ? `/${encodeURIComponent(this.config.templateName)}` : '';
    const reply = await this.get(`SMS/${mobile}/AUTOGEN${template}`);
    if (reply.Status === 'Success' && reply.Details) return { reference: reply.Details };
    this.logger.warn({ to: this.masked(mobile), reason: reply.Details }, '2Factor refused to send the code');
    throw unavailable();
  }

  async check(phone: string, reference: string, code: string): Promise<'valid' | 'invalid' | 'expired'> {
    this.mobileOf(phone);
    let result = this.outcome(await this.get(`SMS/VERIFY/${encodeURIComponent(reference)}/${encodeURIComponent(code)}`));
    if (result === 'invalid') {
      // Right after sending, VERIFY can briefly answer "OTP Mismatch" for the correct code; check once more.
      await new Promise((resolve) => setTimeout(resolve, this.config.retryDelayMs ?? 800));
      result = this.outcome(await this.get(`SMS/VERIFY/${encodeURIComponent(reference)}/${encodeURIComponent(code)}`));
    }
    if (result === 'error') throw unavailable();
    return result;
  }

  private outcome(reply: TwoFactorReply): 'valid' | 'invalid' | 'expired' | 'error' {
    // Judge by Details: 2Factor's own examples show "OTP Matched" with either Status.
    const details = (reply.Details ?? '').toLowerCase();
    if (details === 'otp matched') return 'valid';
    if (details === 'otp mismatch') return 'invalid';
    if (details.includes('expired')) return 'expired';
    if (details.includes('session')) return 'expired'; // unknown/invalid session id: ask for a new code
    this.logger.warn({ reason: reply.Details }, '2Factor could not check the code');
    return 'error';
  }

  private async get(path: string): Promise<TwoFactorReply> {
    try {
      const res = await fetch(`${this.baseUrl}/${encodeURIComponent(this.config.apiKey)}/${path}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      return (await res.json().catch(() => ({}))) as TwoFactorReply;
    } catch (error) {
      // Never the URL: it contains the API key.
      this.logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, '2Factor unreachable');
      throw unavailable();
    }
  }

  private mobileOf(phone: string): string {
    const mobile = /^\+91([6-9]\d{9})$/.exec(phone)?.[1];
    if (!mobile) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Only Indian mobile numbers are supported');
    return mobile;
  }

  private masked(mobile: string): string {
    return `${mobile.slice(0, 3)}•••••${mobile.slice(-2)}`;
  }
}
