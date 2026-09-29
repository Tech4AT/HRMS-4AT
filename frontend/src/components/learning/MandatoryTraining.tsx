'use client';

import { useEffect, useState } from 'react';
import { LearningApiError, fmtDate, learningApi, type Course } from '@/lib/api/learning';
import { OpenLmsButton } from './OpenLmsButton';

/**
 * Onboarding → Learning: the mandatory-training checklist. Assignments come
 * from the LMS (the onboarding learning path), completion flows back here.
 */
export function MandatoryTraining({
  employeeId,
  showLaunch = false,
}: {
  employeeId: string | number;
  showLaunch?: boolean;
}) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    learningApi
      .courses(employeeId)
      .then((rows) => !cancelled && setCourses(rows.filter((c) => c.mandatory)))
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof LearningApiError && e.status === 403
            ? "You don't have access to this person's training records."
            : 'Could not load mandatory training.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const done = courses?.filter((c) => c.status === 'completed').length ?? 0;
  const total = courses?.length ?? 0;
  const pct = total ? Math.round((100 * done) / total) : 0;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-gray-900">Mandatory training</h3>
          <p className="text-sm text-gray-500">
            {courses == null
              ? 'Loading…'
              : total
                ? `${done} of ${total} completed`
                : 'No mandatory training assigned yet.'}
          </p>
        </div>
        {showLaunch && total > done && <OpenLmsButton label="Start training" />}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {total > 0 && (
        <>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden mb-3">
            <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-purple-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <ul className="divide-y divide-gray-100">
            {courses!.map((c) => {
              const complete = c.status === 'completed';
              const overdue = !complete && !!c.dueAt && new Date(c.dueAt) < new Date();
              return (
                <li key={c.id} className="py-2.5 flex items-center gap-3">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      complete ? 'bg-green-500 text-white' : 'border-2 border-gray-300'
                    }`}
                    aria-hidden="true"
                  >
                    {complete && (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${complete ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                      {c.title || c.courseId}
                    </p>
                    <p className={`text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      {complete
                        ? `Completed ${fmtDate(c.completedAt)}`
                        : c.dueAt
                          ? `${overdue ? 'Overdue — was due' : 'Due'} ${fmtDate(c.dueAt)}`
                          : c.progress
                            ? `${c.progress}% done`
                            : 'Not started'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
