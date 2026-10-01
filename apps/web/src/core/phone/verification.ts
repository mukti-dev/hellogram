/**
 * One phone-verification API for every flow (login, public page, PIN reset,
 * account deletion, phone change):
 *  - "otp" mode: our server sends the SMS; the proof is the typed code.
 *  - "firebase" mode: Firebase sends and checks it; the proof is a Firebase ID token.
 */
export type PhoneProof = { code: string } | { idToken: string };

export const phoneAuthMode: 'otp' | 'firebase' = import.meta.env.VITE_PHONE_AUTH === 'firebase' ? 'firebase' : 'otp';

export interface VerificationSession {
  /** Turns the 6-digit code the user typed into a proof. Call once. */
  confirm(code: string): Promise<PhoneProof>;
}

export async function startPhoneVerification(phoneE164: string, sendOwnOtp: () => Promise<unknown>): Promise<VerificationSession> {
  if (phoneAuthMode === 'otp') {
    await sendOwnOtp();
    return { confirm: async (code) => ({ code }) };
  }
  const { sendFirebaseCode } = await import('./firebase.js');
  const confirm = await sendFirebaseCode(phoneE164);
  return { confirm: async (code) => ({ idToken: await confirm(code) }) };
}

/** The pending verification for the login → OTP screen hand-off (kept in memory only). */
let pending: { target: string; session: VerificationSession } | null = null;
export const setPendingVerification = (target: string, session: VerificationSession) => {
  pending = { target, session };
};
export const getPendingVerification = (target: string) => (pending?.target === target ? pending.session : null);
