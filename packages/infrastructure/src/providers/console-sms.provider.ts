import type { SmsNotice, SmsProvider } from '@hellogram/domain';

export interface ConsoleLogger {
  info(obj: object, msg: string): void;
}

/**
 * Development SMS provider: prints the OTP to the API log instead of sending it.
 * Replaced by MSG91 once DLT registration is done.
 */
export class ConsoleSmsProvider implements SmsProvider {
  constructor(private readonly logger: ConsoleLogger) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.info({ devOtp: code, to: `${phone.slice(0, 5)}•••••${phone.slice(-2)}` }, 'DEV SMS: OTP');
  }

  async sendNotice(phone: string, notice: SmsNotice): Promise<void> {
    this.logger.info({ notice, to: `${phone.slice(0, 5)}•••••${phone.slice(-2)}` }, 'DEV SMS: notice');
  }
}
