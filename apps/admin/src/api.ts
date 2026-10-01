/** Admin API client. The token lives in sessionStorage: closing the tab logs out. */
const KEY = 'hg-admin-token';

export const session = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) sessionStorage.setItem(KEY, token);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  },
};

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function adminApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get();
  const res = await fetch(`/admin/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401) {
    session.set(null);
    if (!path.startsWith('/auth')) window.location.assign('/login');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new AdminApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
