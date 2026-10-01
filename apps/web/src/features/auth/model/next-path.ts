/** Where to go after signing in: `?next=/A482719K` from a public number page, else My numbers. Same-site paths only. */
export function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/numbers';
}

export const withNext = (path: string, search: string) => {
  const next = new URLSearchParams(search).get('next');
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
};
