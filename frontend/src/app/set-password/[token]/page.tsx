'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { setPasswordApi, PasswordSetupInfo, SetPasswordApiError } from '@/lib/api/setPassword';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

export default function SetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  const [info, setInfo] = useState<PasswordSetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    setPasswordApi
      .get(token)
      .then(setInfo)
      .catch((e) => setLoadError(e instanceof SetPasswordApiError ? e.message : 'Something went wrong loading this link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (password.length < 10) {
      setSubmitError('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await setPasswordApi.complete(token, password, confirmPassword);
      setDone(true);
      // A hard navigation, not router.push(): AuthProvider (app/layout.tsx)
      // only fetches /api/auth/me once, on mount — a client-side route
      // change reuses that same mounted instance and its now-stale `user`
      // state (whoever's session, if any, was active in this browser
      // before), even though the cookies this POST just set are already
      // correct. A full page load forces a fresh mount that reads them.
      // Set-password links are only ever issued to a new hire on offer
      // acceptance, so land them straight on their document-upload checklist.
      setTimeout(() => {
        window.location.href = '/me/onboarding';
      }, 1200);
    } catch (e) {
      setSubmitError(e instanceof SetPasswordApiError ? e.message : 'Failed to set your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-50 px-4 font-['Inter']">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-lg mb-4">
            <span className="text-white font-bold text-xl">E</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Elevate HR</h1>
          <p className="text-gray-600 text-sm mt-2">Set your password to get started</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          {loading && <p className="text-gray-500 text-sm text-center">Checking your link…</p>}

          {!loading && loadError && (
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 mb-2">Can&rsquo;t open this link</p>
              <p className="text-gray-500 text-sm">{loadError}</p>
            </div>
          )}

          {!loading && !loadError && done && (
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 mb-2">You&rsquo;re all set!</p>
              <p className="text-gray-500 text-sm">Taking you to your onboarding checklist to upload your documents…</p>
            </div>
          )}

          {!loading && !loadError && !done && info && (
            <>
              <p className="text-gray-600 text-sm mb-6">
                Setting a password for <strong className="text-gray-900">{info.email}</strong>. You&rsquo;ll use this to log
                in and work through your preboarding checklist.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">New password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setSubmitError(null); }}
                      placeholder="At least 10 characters"
                      autoComplete="new-password"
                      className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Confirm password</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setSubmitError(null); }}
                      placeholder="Re-enter your password"
                      autoComplete="new-password"
                      className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      <EyeIcon open={showConfirm} />
                    </button>
                  </div>
                </div>

                {confirmPassword && (
                  <p className={`text-xs font-medium ${password === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
                    {password === confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                  </p>
                )}

                {submitError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{submitError}</div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-semibold py-3 rounded-lg hover:from-indigo-700 hover:to-indigo-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Setting password…' : 'Set Password & Continue'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
