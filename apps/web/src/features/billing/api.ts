import { api } from '../../core/http/client.js';

export interface BillingDto {
  subscription: {
    status: string;
    quantity: number;
    monthlyAmountPaise: number;
    currentPeriodEnd: string | null;
    graceUntil: string | null;
    provider: string;
  } | null;
  invoices: InvoiceDto[];
  devTools: boolean;
}

export interface InvoiceDto {
  id: string;
  invoiceNo: string;
  amountPaise: number;
  gstPaise: number;
  paidAt: string;
}

export const billingApi = {
  summary: () => api<BillingDto>('/v1/billing'),
  invoice: (id: string) => api<InvoiceDto>(`/v1/billing/invoices/${id}`),
  devFail: () => api<void>('/v1/billing/dev/fail', { method: 'POST' }),
};

export const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
