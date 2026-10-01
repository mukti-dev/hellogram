import { getApps, initializeApp } from 'firebase/app';
import { RecaptchaVerifier, getAuth, signInWithPhoneNumber, signOut, type Auth } from 'firebase/auth';

/**
 * Firebase Phone Auth (web). Google sends the SMS and checks the code on the device;
 * we only keep the resulting ID token, which our API verifies.
 * Loaded lazily, so the Firebase SDK isn't in the main bundle.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

function firebaseAuth(): Auth {
  const app = getApps()[0] ?? initializeApp(config);
  const auth = getAuth(app);
  auth.useDeviceLanguage();
  return auth;
}

let verifier: RecaptchaVerifier | null = null;

/** Invisible reCAPTCHA (Firebase's bot check) needs a DOM node; one shared hidden container. */
function recaptchaContainer(): HTMLElement {
  let el = document.getElementById('hg-recaptcha');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hg-recaptcha';
    document.body.appendChild(el);
  }
  return el;
}

export class PhoneVerificationError extends Error {}

const MESSAGES: Record<string, string> = {
  'auth/invalid-verification-code': 'That code is incorrect',
  'auth/code-expired': 'This code has expired. Request a new one.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/invalid-phone-number': 'Enter a valid 10-digit Indian mobile number',
  'auth/quota-exceeded': 'We can’t send codes right now. Please try again later.',
  'auth/captcha-check-failed': 'Security check failed. Please try again.',
  'auth/network-request-failed': 'Can’t reach the verification service. Check your connection.',
  'auth/operation-not-allowed': 'Phone sign-in isn’t enabled for this app yet.',
};

const friendly = (error: unknown) => {
  const code = (error as { code?: string }).code ?? '';
  return new PhoneVerificationError(MESSAGES[code] ?? 'Phone verification failed. Please try again.');
};

/** Sends the SMS. Returns a function that turns the typed code into a Firebase ID token. */
export async function sendFirebaseCode(phoneE164: string): Promise<(code: string) => Promise<string>> {
  const auth = firebaseAuth();
  verifier?.clear();
  verifier = new RecaptchaVerifier(auth, recaptchaContainer(), { size: 'invisible' });
  try {
    const confirmation = await signInWithPhoneNumber(auth, phoneE164, verifier);
    return async (code: string) => {
      try {
        const credential = await confirmation.confirm(code);
        const idToken = await credential.user.getIdToken();
        // Privacy: don't leave a user record (with the phone number) in Firebase.
        await credential.user.delete().catch(() => undefined);
        await signOut(auth).catch(() => undefined);
        return idToken;
      } catch (error) {
        throw friendly(error);
      }
    };
  } catch (error) {
    verifier?.clear();
    verifier = null;
    throw friendly(error);
  }
}
