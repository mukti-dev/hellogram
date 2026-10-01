import type { SmsNotice, SmsProvider } from '@hellogram/domain';

export interface Msg91Config {
  authKey: string;
  otpTemplateId: string;
  noticeTemplateId: string;
}

/**
 * MSG91 (India, DLT-registered templates). OTP via the v5 OTP API; notices via Flow.
 * Numbers go out as "91XXXXXXXXXX".
 */
export class Msg91SmsProvider implements SmsProvider {
  constructor(private readonly config: Msg91Config) {}

  private async post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authkey: this.config.authKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`MSG91 request failed: ${res.status}`);
  }

  sendOtp(phone: string, code: string): Promise<void> {
    const params = new URLSearchParams({ template_id: this.config.otpTemplateId, mobile: phone.replace(/^\+/, ''), otp: code });
    return this.post(`https://control.msg91.com/api/v5/otp?${params}`);
  }

  sendNotice(phone: string, notice: SmsNotice): Promise<void> {
    return this.post('https://control.msg91.com/api/v5/flow', {
      template_id: this.config.noticeTemplateId,
      short_url: '0',
      recipients: [{ mobiles: phone.replace(/^\+/, ''), notice }],
    });
  }
}
