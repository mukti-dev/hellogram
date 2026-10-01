import { ApiError } from './api-error.js';

/**
 * Framework-free HTTP client (reusable by the React Native app later).
 * - Adds the access token and the CSRF client header.
 * - On 401, refreshes once (serialised across tabs) and retries.
 */
export interface TokenStore {
  getAccessToken(): string | null;
  setAccessToken(token: string | null): void;
  onSessionEnded(): void;
}

const CLIENT_HEADER = { 'X-Hellogram-Client': 'web' };

let tokenStore: TokenStore | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function configureHttp(store: TokenStore): void {
  tokenStore = store;
}

async function doRefresh(): Promise<string | null> {
  const run = async () => {
    const res = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: CLIENT_HEADER });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken: string };
    return body.accessToken;
  };
  // Web Locks keep two tabs from rotating the same refresh token at once (which would look like reuse).
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('hg-refresh', run) : run();
}

/** Single-flight refresh. Returns the new access token, or null if the session is over. */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= doRefresh()
    .then((token) => {
      tokenStore?.setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sent as-is (file uploads) with `contentType`. */
  rawBody?: Blob;
  contentType?: string;
  auth?: boolean;
  /** Extra headers, e.g. X-Persona-Unlock. */
  headers?: Record<string, string>;
}

let extraHeaders: () => Record<string, string> = () => ({});

/** Lets features add headers to every request (Phase 7: X-Persona-Unlock tokens). */
export function configureExtraHeaders(fn: () => Record<string, string>): void {
  extraHeaders = fn;
}

export async function api<T>(
  path: string,
  { method = 'GET', body, rawBody, contentType, auth = true, headers = {} }: RequestOptions = {},
): Promise<T> {
  const send = (token: string | null) =>
    fetch(path, {
      method,
      credentials: 'include',
      headers: {
        ...CLIENT_HEADER,
        ...(auth ? extraHeaders() : {}),
        ...(rawBody ? { 'Content-Type': contentType ?? 'application/octet-stream' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });

  let res: Response;
  try {
    res = await send(tokenStore?.getAccessToken() ?? null);
    if (res.status === 401 && auth) {
      const fresh = await refreshAccessToken();
      if (!fresh) {
        tokenStore?.onSessionEnded();
        throw await ApiError.fromResponse(res);
      }
      res = await send(fresh);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Can’t reach Hellogram. Check your connection.');
  }

  if (!res.ok) throw await ApiError.fromResponse(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
