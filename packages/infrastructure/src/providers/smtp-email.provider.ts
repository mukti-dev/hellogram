import type { EmailProvider } from '@hellogram/domain';
import nodemailer, { type Transporter } from 'nodemailer';

/** SMTP delivery — works with AWS SES (SMTP credentials), Brevo, Resend, etc. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendOtp(email: string, code: string, purpose: 'login' | 'verify'): Promise<void> {
    const subject = purpose === 'login' ? 'Your Hellogram login code' : 'Verify your recovery email';
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject,
      text: `${code} is your Hellogram code. It expires in 5 minutes. If you didn’t ask for it, ignore this email.`,
    });
  }
}
