import { DomainError, type SmsProvider } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

export interface NoticeLogger {
  info(obj: object, msg: string): void;
}

/**
 * Firebase Phone Auth mode: Google sends the verification SMS from the device, so the
 * server never sends OTPs. Transactional notices are logged (and go out as push/email).
 */
export class NoSmsProvider implements SmsProvider {
  constructor(private readonly logger: NoticeLogger) {}

  async sendOtp(): Promise<void> {
    throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'Verification codes are sent by Firebase in this app');
  }

  async sendNotice(phone: string, notice: string): Promise<void> {
    this.logger.info({ notice, to: `${phone.slice(0, 5)}•••••${phone.slice(-2)}` }, 'SMS notice skipped (no SMS provider)');
  }
}
