/** Cloudflare Turnstile server-side check (bot protection before sending OTPs / grievances). */
export class TurnstileVerifier {
  constructor(private readonly secret: string) {}

  async verify(token: string | undefined, ip: string): Promise<boolean> {
    if (!token) return false;
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: this.secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!res?.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  }
}
