import { useEffect, useRef } from 'react';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

let loader: Promise<void> | null = null;
const load = () =>
  (loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(s);
  }));

export const turnstileEnabled = Boolean(SITE_KEY);

/**
 * Cloudflare Turnstile bot check before sending OTPs. Renders nothing when no site key
 * is configured (development); the server only enforces it when it has the secret.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let id: string | undefined;
    let cancelled = false;
    void load().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [onToken]);
  return SITE_KEY ? <div ref={ref} className="min-h-16" /> : null;
}
