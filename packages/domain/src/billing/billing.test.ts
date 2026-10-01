import { describe, expect, it } from 'vitest';
import { gstBreakup, invoiceNumber, monthlyAmountPaise } from './billing.js';

describe('billing maths', () => {
  it('₹49 is GST-inclusive (₹7.47 GST + ₹41.53 base)', () => {
    expect(gstBreakup(4900)).toEqual({ gstPaise: 747, basePaise: 4153 });
  });
  it('charges ₹49 per paid number', () => {
    expect(monthlyAmountPaise(3)).toBe(14700);
  });
  it('numbers invoices by Indian financial year', () => {
    expect(invoiceNumber(42, new Date('2026-09-28T00:00:00Z'))).toBe('HG/2026-27/000042');
    expect(invoiceNumber(7, new Date('2027-02-01T00:00:00Z'))).toBe('HG/2026-27/000007');
    expect(invoiceNumber(1, new Date('2027-04-01T00:00:00Z'))).toBe('HG/2027-28/000001');
  });
});
