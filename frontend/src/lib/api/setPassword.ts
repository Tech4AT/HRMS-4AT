/**
 * "Set your password" API client — the candidate's first-ever login, via
 * the secure token in the welcome email (sent on offer acceptance; see
 * backend/onboarding/services.py::accept_offer). Unauthenticated by design,
 * same shape as lib/api/offers.ts: the token in the URL is the credential.
 */

export interface PasswordSetupInfo {
  email: string;
  firstName: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

export class SetPasswordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SetPasswordApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/auth/set-password${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
  });

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;
    throw new SetPasswordApiError(message, res.status);
  }

  return json.data as T;
}

export const setPasswordApi = {
  get: (token: string) => request<PasswordSetupInfo>(`/${token}`),
  complete: (token: string, password: string, confirmPassword: string) =>
    request<{ user: { id: number; email: string } }>(`/${token}`, {
      method: 'POST',
      body: JSON.stringify({ password, confirmPassword }),
    }),
};
