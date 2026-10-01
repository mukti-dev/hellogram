import { DomainError, type HostedSmsVerification } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

export interface MessageCentralConfig {
  customerId: string;
  /** The auth token from the Message Central dashboard. Used as-is. */
  authToken?: string | undefined;
  /** Or the account password: the app then logs in for a token (base64-encoded as `key`) and renews it itself. */
  password?: string | undefined;
  email?: string | undefined;
  baseUrl?: string;
}

export interface VerificationLogger {
  warn(obj: object, msg: string): void;
}

interface McReply {
  responseCode?: number | string;
  message?: string;
  token?: string;
  authToken?: string;
  data?: {
    verificationId?: string | number;
    responseCode?: number | string;
    errorMessage?: string | null;
    verificationStatus?: string;
    authToken?: string | null;
  } | null;
}

const TOKEN_FALLBACK_TTL_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_EARLY_MS = 60 * 1000;

const unavailable = () =>
  new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'We couldn’t send or check the code right now. Please try again in a minute.');

/** Expiry from the JWT's `exp`, if the token is a JWT. */
function tokenExpiry(token: string, now: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp === 'number') return payload.exp * 1000;
  } catch {
    /* not a JWT */
  }
  return now + TOKEN_FALLBACK_TTL_MS;
}

/**
 * Message Central VerifyNow (https://cpaas.messagecentral.com): sends an SMS code it generates,
 * and checks the code the user typed. We only ever hold its verificationId.
 * Indian numbers only (country code 91), 6-digit codes to match the rest of the app.
 */
export class MessageCentralVerification implements HostedSmsVerification {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly baseUrl: string;

  constructor(
    private readonly config: MessageCentralConfig,
    private readonly logger: VerificationLogger,
  ) {
    this.baseUrl = (config.baseUrl ?? 'https://cpaas.messagecentral.com').replace(/\/$/, '');
    if (!config.authToken && !config.password) throw new Error('Message Central needs an auth token or a password');
  }

  async send(phone: string): Promise<{ reference: string }> {
    const mobile = this.mobileOf(phone);
    const reply = await this.call('POST', '/verification/v3/send', {
      countryCode: '91',
      customerId: this.config.customerId,
      flowType: 'SMS',
      mobileNumber: mobile,
      otpLength: '6',
    });
    const code = this.codeOf(reply);
    const id = reply.data?.verificationId;
    if (code === 200 && id !== undefined && id !== null && String(id) !== '') return { reference: String(id) };
    if (code === 506) {
      // REQUEST_ALREADY_EXISTS: a code for this number is still live on their side.
      throw new DomainError(ErrorCode.RATE_LIMITED, 'A code was just sent. Wait a minute before asking for another.');
    }
    this.logger.warn({ to: this.masked(mobile), responseCode: code, reason: reply.message ?? reply.data?.errorMessage }, 'Message Central refused to send the code');
    throw unavailable();
  }

  async check(phone: string, reference: string, code: string): Promise<'valid' | 'invalid' | 'expired'> {
    const mobile = this.mobileOf(phone);
    const reply = await this.call('GET', '/verification/v3/validateOtp', {
      countryCode: '91',
      mobileNumber: mobile,
      verificationId: reference,
      customerId: this.config.customerId,
      code,
    });
    const result = this.codeOf(reply);
    if (result === 200 && reply.data?.verificationStatus === 'VERIFICATION_COMPLETED') return 'valid';
    if (result === 702 || result === 700) return 'invalid'; // WRONG_OTP_PROVIDED / VERIFICATION_FAILED
    if (result === 705 || result === 703 || result === 800 || result === 505) return 'expired'; // expired, used, too many, unknown id
    this.logger.warn({ to: this.masked(mobile), responseCode: result, reason: reply.message ?? reply.data?.errorMessage }, 'Message Central could not check the code');
    throw unavailable();
  }

  // ─── HTTP ───

  private async call(method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<McReply> {
    let response = await this.request(method, path, params, await this.authToken());
    if (response.status === 401 || response.status === 403) {
      // Token revoked or expired early: fetch a fresh one once.
      response = await this.request(method, path, params, await this.authToken(true));
    }
    return response.body;
  }

  private async request(method: 'GET' | 'POST', path: string, params: Record<string, string>, token: string) {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params)}`;
    try {
      const res = await fetch(url, { method, headers: { authToken: token, accept: '*/*' }, signal: AbortSignal.timeout(10_000) });
      // Errors (e.g. a wrong code) come back as non-2xx with a JSON body carrying responseCode.
      return { status: res.status, body: (await res.json().catch(() => ({}))) as McReply };
    } catch (error) {
      this.logger.warn({ path, err: String(error) }, 'Message Central unreachable');
      throw unavailable();
    }
  }

  private async authToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.token && this.token.expiresAt - TOKEN_REFRESH_EARLY_MS > now) return this.token.value;
    // A dashboard token is used as-is; with a password we can also log in again when it expires.
    if (this.config.authToken && (!force || !this.config.password)) {
      if (force) {
        this.logger.warn({}, 'Message Central rejected the auth token — create a new one in the dashboard (or set MESSAGECENTRAL_PASSWORD)');
        throw unavailable();
      }
      return this.config.authToken;
    }
    if (!this.config.password) throw unavailable();

    const params = new URLSearchParams({
      customerId: this.config.customerId,
      key: Buffer.from(this.config.password, 'utf8').toString('base64'),
      scope: 'NEW',
      country: '91',
      ...(this.config.email ? { email: this.config.email } : {}),
    });
    let reply: McReply;
    try {
      const res = await fetch(`${this.baseUrl}/auth/v1/authentication/token?${params}`, {
        method: 'GET',
        headers: { accept: '*/*' },
        signal: AbortSignal.timeout(10_000),
      });
      reply = (await res.json().catch(() => ({}))) as McReply;
    } catch (error) {
      this.logger.warn({ err: String(error) }, 'Message Central unreachable (token)');
      throw unavailable();
    }
    const value = reply.token ?? reply.authToken ?? reply.data?.authToken ?? null;
    if (!value) {
      this.logger.warn({ responseCode: this.codeOf(reply), reason: reply.message }, 'Message Central refused the login (check customer id and password)');
      throw unavailable();
    }
    this.token = { value, expiresAt: tokenExpiry(value, now) };
    return value;
  }

  private codeOf(reply: McReply): number {
    return Number(reply.responseCode ?? reply.data?.responseCode ?? 0);
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
