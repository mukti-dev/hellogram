import { DomainError, type SmsNotice, type SmsProvider } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

export interface Fast2SmsConfig {
  apiKey: string;
  /**
   * "otp": Fast2SMS's own OTP route (their sender and fixed wording, no DLT registration of ours).
   * "dlt": the OTP API with our own DLT-approved template (`otpTemplateId`).
   */
  route: 'otp' | 'dlt';
  otpTemplateId?: string | undefined;
}

export interface SmsFailureLogger {
  warn(obj: object, msg: string): void;
  info(obj: object, msg: string): void;
}

interface Fast2SmsReply {
  return?: boolean;
  status_code?: number;
  message?: string | string[];
  request_id?: string;
}

const API = 'https://www.fast2sms.com/dev';
const masked = (tenDigits: string) => `${tenDigits.slice(0, 3)}•••••${tenDigits.slice(-2)}`;

/**
 * Fast2SMS (India). The code is generated and checked by our server; Fast2SMS only delivers it.
 * Indian numbers only. Notices aren't sent: these routes only carry OTPs.
 */
export class Fast2SmsProvider implements SmsProvider {
  constructor(
    private readonly config: Fast2SmsConfig,
    private readonly logger: SmsFailureLogger,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    const mobile = /^\+91([6-9]\d{9})$/.exec(phone)?.[1];
    if (!mobile) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Only Indian mobile numbers are supported');

    const [url, body] =
      this.config.route === 'dlt'
        ? [`${API}/otp/send`, { mobile, otp_id: this.config.otpTemplateId, otp: code, otp_length: code.length, otp_expiry: 10 }]
        : [`${API}/bulkV2`, { route: 'otp', variables_values: code, numbers: mobile }];

    let status: number;
    let reply: Fast2SmsReply;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: this.config.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      reply = (await res.json().catch(() => ({}))) as Fast2SmsReply;
    } catch (error) {
      this.logger.warn({ to: masked(mobile), err: String(error) }, 'Fast2SMS unreachable');
      throw unavailable();
    }

    // Fast2SMS reports failures in the body ("return": false), sometimes with HTTP 200.
    if (status < 200 || status >= 300 || reply.return !== true) {
      this.logger.warn(
        { to: masked(mobile), route: this.config.route, httpStatus: status, code: reply.status_code, reason: reply.message },
        'Fast2SMS rejected the OTP',
      );
      throw unavailable();
    }
  }

  async sendNotice(phone: string, notice: SmsNotice): Promise<void> {
    this.logger.info({ notice, to: `${phone.slice(0, 5)}•••••${phone.slice(-2)}` }, 'SMS notice skipped (Fast2SMS sends OTPs only)');
  }
}

const unavailable = () =>
  new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'We couldn’t send the SMS right now. Please try again in a minute.');
