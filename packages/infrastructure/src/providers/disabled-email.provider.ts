import { DomainError, type EmailProvider } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

/** Production without an SMTP account yet (EMAIL_PROVIDER=none): adding an email address is refused. */
export class DisabledEmailProvider implements EmailProvider {
  async sendOtp(): Promise<never> {
    throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, "Email verification isn't available yet. Please try again later.");
  }
}
