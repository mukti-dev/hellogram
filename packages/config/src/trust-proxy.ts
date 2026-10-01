/**
 * Converts TRUST_PROXY config into Fastify's option. A hop count becomes a function
 * trusting exactly that many proxies; never "true" (that trusts forged X-Forwarded-For).
 */
export function toTrustProxy(value: boolean | number | string[] | undefined): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof value === 'number') return (_address: string, hop: number) => hop < value;
  if (value === true) throw new Error('TRUST_PROXY=true is unsafe; use a hop count or CIDRs');
  return value ?? false;
}
