import { z } from 'zod';

const deviceName = z.string().trim().max(60).optional();

const turnstileToken = z.string().max(4096).optional();

export const sendPhoneOtpBody = z.object({ phone: z.string().trim().min(10).max(20), turnstileToken });

export const verifyPhoneOtpBody = z.object({
  phone: z.string().trim().min(10).max(20),
  code: z.string().trim().max(10),
  ageConfirmed: z.boolean().optional(),
  consentVersion: z.string().max(40).optional(),
  deviceName,
});

export const sendEmailOtpBody = z.object({ email: z.email().max(254), turnstileToken });

export const verifyEmailOtpBody = z.object({
  email: z.email().max(254),
  code: z.string().trim().max(10),
  deviceName,
});

export const firebaseLoginBody = z.object({
  idToken: z.string().min(20).max(4096),
  ageConfirmed: z.boolean().optional(),
  consentVersion: z.string().max(40).optional(),
  deviceName,
});

export const tokenResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});

export const loginResponse = tokenResponse.extend({ isNewAccount: z.boolean() });
