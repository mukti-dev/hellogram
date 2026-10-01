import type { EmailProvider } from '@hellogram/domain';
import type { ConsoleLogger } from './console-sms.provider.js';

/** Development email provider: logs the OTP. Replaced by AWS SES later. */
export class ConsoleEmailProvider implements EmailProvider {
  constructor(private readonly logger: ConsoleLogger) {}

  async sendOtp(email: string, code: string, purpose: 'login' | 'verify'): Promise<void> {
    const [user = '', domain = ''] = email.split('@');
    this.logger.info({ devOtp: code, purpose, to: `${user.slice(0, 2)}•••@${domain}` }, 'DEV EMAIL: OTP');
  }
}
