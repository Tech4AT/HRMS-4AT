'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { onboardingApi, MyOnboarding } from '@/lib/api/onboarding';
import { ClipboardCheckIcon } from '@/components/icons';

/** Only renders for a new hire with their own steps still open — the one
 * place a new hire lands after login, so it's how they find /me/onboarding
 * (which has no menu entry of its own). */
export function OnboardingPromptBanner() {
  const [mine, setMine] = useState<MyOnboarding | null>(null);

  useEffect(() => {
    onboardingApi.getMine().then(setMine).catch(() => setMine(null));
  }, []);

  if (!mine || mine.stage === 'completed') return null;

  const openSteps = mine.tasks.filter(
    (t) => t.owner === 'new_hire' && t.status !== 'done' && t.status !== 'skipped',
  );
  if (openSteps.length === 0) return null;

  const uploads = openSteps.filter((t) => t.requiresDocument).length;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between bg-purple-50 border border-purple-200 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <ClipboardCheckIcon className="w-6 h-6 text-purple-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-gray-900">
            Complete your onboarding — {openSteps.length} step{openSteps.length === 1 ? '' : 's'} left
          </p>
          <p className="text-sm text-gray-600">
            {uploads > 0
              ? `Includes ${uploads} document${uploads === 1 ? '' : 's'} to upload before your joining date.`
              : 'A few quick steps before your joining date.'}
          </p>
        </div>
      </div>
      <Link
        href="/me/onboarding"
        className="px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 text-center shrink-0"
      >
        Open my checklist
      </Link>
    </div>
  );
}
