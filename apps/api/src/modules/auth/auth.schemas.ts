import { GENDERS, LIMITS } from '@hellogram/shared';
import { z } from 'zod';
import { withProof } from '../shared-proof.js';

const deviceName = z.string().trim().max(60).optional();
const turnstileToken = z.string().max(4096).optional();
const phone = z.string().trim().min(10).max(20);
// Length rules are checked by the domain (with friendly messages); this only bounds the input.
const password = z.string().min(1).max(LIMITS.PASSWORD_MAX + 50);
const ticket = z.string().min(16).max(64);

export const signupBody = z.object({
  name: z.string().max(200),
  phone,
  dateOfBirth: z.string().max(10),
  gender: z.enum(GENDERS),
  password,
  termsAccepted: z.literal(true, { error: 'Accept the Terms of Service and Privacy Policy to continue' }),
  consentVersion: z.string().max(40),
  turnstileToken,
});
export const signupResponse = z.object({ signupId: z.string() });
export const signupResendBody = z.object({ signupId: ticket });
export const signupVerifyBody = withProof(z.object({ signupId: ticket, deviceName }));

export const loginBody = z.object({ phone, password, deviceName, turnstileToken });
export const loginResendBody = z.object({ ticket });
export const loginVerifyBody = withProof(z.object({ ticket, deviceName }));

export const forgotPasswordBody = z.object({ phone, turnstileToken });
export const resetPasswordBody = withProof(z.object({ phone, password, deviceName }));

export const tokenResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});

export const loginResponse = tokenResponse;

/** Password login: signed in, or (new device) a code was sent and `ticket` continues the login. */
export const passwordLoginResponse = z.discriminatedUnion('status', [
  tokenResponse.extend({ status: z.literal('ok') }),
  z.object({ status: z.literal('verify_device'), ticket: z.string() }),
]);
