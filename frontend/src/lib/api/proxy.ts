import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_API_URL } from './backend';

const ACCESS_MAX_AGE = 15 * 60; // 15 minutes — matches the access-token JWT
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days — matches the refresh-token JWT

function cookieBase() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

/** Write the access + refresh cookies onto an outgoing response. */
export function setAuthCookies(
  resp: NextResponse,
  accessToken: string,
  refreshToken: string,
) {
  resp.cookies.set({
    name: 'accessToken',
    value: accessToken,
    ...cookieBase(),
    maxAge: ACCESS_MAX_AGE,
  });
  resp.cookies.set({
    name: 'refreshToken',
    value: refreshToken,
    ...cookieBase(),
    maxAge: REFRESH_MAX_AGE,
  });
}

/** Expire both auth cookies. */
export function clearAuthCookies(resp: NextResponse) {
  resp.cookies.set({ name: 'accessToken', value: '', ...cookieBase(), maxAge: 0 });
  resp.cookies.set({ name: 'refreshToken', value: '', ...cookieBase(), maxAge: 0 });
}

type Rotated = { accessToken: string; refreshToken: string };

export type ProxyResult = {
  status: number;
  body: any;
  /** Set when the tokens were rotated during this call; the route handler must
   *  persist them with {@link setAuthCookies}. */
  rotated?: Rotated;
  /** Set when the session is unrecoverable; the route handler should clear cookies. */
  sessionExpired?: boolean;
};

async function callRefresh(refreshToken: string): Promise<Rotated | null> {
  try {
    const r = await fetch(`${BACKEND_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
    };
  } catch {
    return null;
  }
}

/**
 * Proxy an authenticated request to the backend from a route handler.
 * Reads the access/refresh cookies off `req`; if the access token is missing or
 * rejected it transparently refreshes once and retries.
 */
export async function proxyToBackend(
  req: NextRequest,
  path: string,
  init: RequestInit = {},
): Promise<ProxyResult> {
  let accessToken = req.cookies.get('accessToken')?.value;
  const refreshToken = req.cookies.get('refreshToken')?.value;
  let rotated: Rotated | undefined;

  if (!accessToken && refreshToken) {
    const r = await callRefresh(refreshToken);
    if (!r) return { status: 401, body: null, sessionExpired: true };
    accessToken = r.accessToken;
    rotated = r;
  }
  if (!accessToken) {
    return { status: 401, body: null, sessionExpired: true };
  }

  const send = (token: string) =>
    fetch(`${BACKEND_API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await send(accessToken);

  if (res.status === 401 && refreshToken) {
    const r = await callRefresh(refreshToken);
    if (!r) {
      return { status: 401, body: null, sessionExpired: true };
    }
    rotated = r;
    res = await send(r.accessToken);
    if (res.status === 401) {
      return { status: 401, body: null, sessionExpired: true };
    }
  }

  const body = await res.json().catch(() => null);
  return { status: res.status, body, rotated };
}

type RouteContext = { params: Promise<{ path?: string[] }> };
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Build a set of catch-all route handlers that transparently forward
 * `/<local prefix>/...` to `<prefix>/...` on the NestJS backend, carrying the
 * session cookie, refreshing it on 401, and passing the backend's response
 * envelope straight through. Use from `app/api/<prefix>/[...path]/route.ts`.
 */
export function createBackendProxyRoute(
  backendPrefix: string,
): Record<Method, RouteHandler> {
  const make =
    (method: Method): RouteHandler =>
    async (req, ctx) => {
      const { path = [] } = await ctx.params;
      const backendPath = `/${backendPrefix}/${path.join('/')}${req.nextUrl.search}`;

      const init: RequestInit = { method };
      if (method !== 'GET') {
        const text = await req.text();
        if (text) init.body = text;
      }

      const { status, body, rotated, sessionExpired } = await proxyToBackend(
        req,
        backendPath,
        init,
      );

      if (sessionExpired || status === 401) {
        const resp = NextResponse.json(
          {
            success: false,
            error: {
              code: 'SESSION_EXPIRED',
              message: 'Your session has expired. Please sign in again.',
            },
          },
          { status: 401 },
        );
        clearAuthCookies(resp);
        return resp;
      }

      // A 204 (e.g. a successful DELETE) has no body, and a Response with a
      // body and a 204 status is invalid, so it must be passed through empty.
      const resp =
        status === 204
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json(
              body ?? { success: false, error: { message: 'Upstream error' } },
              { status: status || 502 },
            );
      if (rotated) {
        setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
      }
      return resp;
    };

  return {
    GET: make('GET'),
    POST: make('POST'),
    PUT: make('PUT'),
    PATCH: make('PATCH'),
    DELETE: make('DELETE'),
  };
}

/**
 * Same auth/refresh handling as {@link proxyToBackend}, but for a multipart
 * file upload — the body is a `FormData`, forwarded as-is (never JSON), and
 * the response is still the ordinary JSON envelope.
 */
export async function proxyFormDataToBackend(
  req: NextRequest,
  path: string,
  formData: FormData,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST',
): Promise<ProxyResult> {
  let accessToken = req.cookies.get('accessToken')?.value;
  const refreshToken = req.cookies.get('refreshToken')?.value;
  let rotated: Rotated | undefined;

  if (!accessToken && refreshToken) {
    const r = await callRefresh(refreshToken);
    if (!r) return { status: 401, body: null, sessionExpired: true };
    accessToken = r.accessToken;
    rotated = r;
  }
  if (!accessToken) {
    return { status: 401, body: null, sessionExpired: true };
  }

  // No Content-Type header here — fetch sets the multipart boundary itself
  // when the body is a FormData instance.
  const send = (token: string) =>
    fetch(`${BACKEND_API_URL}${path}`, {
      method,
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });

  let res = await send(accessToken);

  if (res.status === 401 && refreshToken) {
    const r = await callRefresh(refreshToken);
    if (!r) return { status: 401, body: null, sessionExpired: true };
    rotated = r;
    res = await send(r.accessToken);
    if (res.status === 401) {
      return { status: 401, body: null, sessionExpired: true };
    }
  }

  const body = await res.json().catch(() => null);
  return { status: res.status, body, rotated };
}

export type BinaryProxyResult = ProxyResult & {
  arrayBuffer?: ArrayBuffer;
  contentType?: string | null;
  contentDisposition?: string | null;
};

/**
 * Same auth/refresh handling as {@link proxyToBackend}, but for a response
 * whose success case is raw bytes (a PDF, an image, a ZIP) rather than the
 * JSON envelope — `res.json()` would fail on that body, so this reads it as
 * an ArrayBuffer instead and carries the content headers through.
 */
export async function proxyBinaryFromBackend(
  req: NextRequest,
  path: string,
): Promise<BinaryProxyResult> {
  let accessToken = req.cookies.get('accessToken')?.value;
  const refreshToken = req.cookies.get('refreshToken')?.value;
  let rotated: Rotated | undefined;

  if (!accessToken && refreshToken) {
    const r = await callRefresh(refreshToken);
    if (!r) return { status: 401, body: null, sessionExpired: true };
    accessToken = r.accessToken;
    rotated = r;
  }
  if (!accessToken) {
    return { status: 401, body: null, sessionExpired: true };
  }

  const send = (token: string) =>
    fetch(`${BACKEND_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  let res = await send(accessToken);

  if (res.status === 401 && refreshToken) {
    const r = await callRefresh(refreshToken);
    if (!r) return { status: 401, body: null, sessionExpired: true };
    rotated = r;
    res = await send(r.accessToken);
    if (res.status === 401) {
      return { status: 401, body: null, sessionExpired: true };
    }
  }

  if (res.status !== 200) {
    const body = await res.json().catch(() => null);
    return { status: res.status, body, rotated };
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    status: res.status,
    body: null,
    rotated,
    arrayBuffer,
    contentType: res.headers.get('Content-Type'),
    contentDisposition: res.headers.get('Content-Disposition'),
  };
}
