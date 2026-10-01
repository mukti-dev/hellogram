import type { CheckoutDto } from '@hellogram/shared';
import { create } from 'zustand';
import { api } from '../../core/http/client.js';

/**
 * Opens payment for a paid number and resolves with the new number's id once paid
 * (null if the user closes the payment sheet).
 */
interface CheckoutUi {
  pending: { checkout: CheckoutDto; resolve: (personaId: string | null) => void; reject: (e: Error) => void } | null;
  open: (checkout: CheckoutDto) => Promise<string | null>;
  close: () => void;
}

export const useCheckoutUi = create<CheckoutUi>()((set, get) => ({
  pending: null,
  open: (checkout) =>
    new Promise((resolve, reject) => {
      set({ pending: { checkout, resolve, reject } });
    }),
  close: () => {
    get().pending?.resolve(null);
    set({ pending: null });
  },
}));

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: () => void) => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Razorpay'));
    document.head.appendChild(script);
  });
}

/** The webhook creates the number; poll until it exists. */
async function waitForDraft(draftId: string): Promise<string | null> {
  for (let i = 0; i < 40; i++) {
    const { personaId } = await api<{ personaId: string | null }>(`/v1/billing/drafts/${draftId}`);
    if (personaId) return personaId;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

export async function startCheckout(checkout: CheckoutDto): Promise<string | null> {
  if (checkout.provider === 'dev') return useCheckoutUi.getState().open(checkout);

  await loadRazorpay();
  const p = checkout.payload as { key: string; subscriptionId: string; name: string; description: string };
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: p.key,
      subscription_id: p.subscriptionId,
      name: p.name,
      description: p.description,
      theme: { color: '#7C5CFF' },
      handler: () => void waitForDraft(checkout.draftId).then(resolve),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.open();
  });
}
