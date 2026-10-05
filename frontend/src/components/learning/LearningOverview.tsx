'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CERT_STATUS_LABEL,
  COURSE_STATUS_LABEL,
  LearningApiError,
  fmtDate,
  learningApi,
  type Assessment,
  type Certification,
  type Course,
  type LearningSummary,
  type Skill,
} from '@/lib/api/learning';
import { OpenLmsButton } from './OpenLmsButton';

type Section = 'courses' | 'assessments' | 'certifications' | 'skills';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'courses', label: 'Courses' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'skills', label: 'Skill Passport' },
];

interface Data {
  summary: LearningSummary;
  courses: Course[];
  assessments: Assessment[];
  certifications: Certification[];
  skills: Skill[];
}

export const COURSE_TONE: Record<Course['status'], string> = {
  assigned: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

export const CERT_TONE: Record<Certification['status'], string> = {
  active: 'bg-green-100 text-green-700',
  expiring: 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-700',
  revoked: 'bg-gray-100 text-gray-600',
};

const LINK_NOTE: Record<LearningSummary['link']['status'], string | null> = {
  linked: null,
  not_linked: 'This person does not have an LMS learner account yet.',
  pending: 'The LMS learner account is being set up.',
  deactivated: 'LMS access has ended for this person.',
  conflict: 'The LMS account link needs attention from HR.',
};

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>{children}</span>;
}

function ProgressBar({ value, tone = 'bg-purple-600' }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function isOverdue(course: Course) {
  return course.status !== 'completed' && !!course.dueAt && new Date(course.dueAt) < new Date();
}

export function CourseRow({ course }: { course: Course }) {
  const overdue = isOverdue(course);
  return (
    <li className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-gray-900 truncate">{course.title || course.courseId}</p>
          {course.mandatory && <Pill className="bg-purple-100 text-purple-700">Mandatory</Pill>}
          {overdue && <Pill className="bg-red-100 text-red-700">Overdue</Pill>}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {[course.pathName, course.category].filter(Boolean).join(' · ') || 'Course'}
          {course.status === 'completed'
            ? ` · Completed ${fmtDate(course.completedAt)}`
            : course.dueAt
              ? ` · Due ${fmtDate(course.dueAt)}`
              : ''}
          {course.score != null && ` · Score ${Number(course.score)}`}
        </p>
      </div>
      <div className="flex items-center gap-3 sm:w-56">
        <div className="flex-1">
          <ProgressBar value={course.progress} tone={course.status === 'completed' ? 'bg-green-500' : 'bg-purple-600'} />
        </div>
        <Pill className={COURSE_TONE[course.status]}>{COURSE_STATUS_LABEL[course.status]}</Pill>
      </div>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-sm text-gray-500 text-center">{children}</p>;
}

/**
 * Employee 360 → Learning. Everything shown is HRMS's projection of LMS data;
 * the course player, content and authoring stay in the LMS (PRD §6).
 *
 * `employeeId` is an HRMS employee id or `'me'`. `showLaunch` adds the
 * "Open LMS" button — only meaningful on the caller's own page, since the SSO
 * token always names the signed-in user.
 */
export function LearningOverview({
  employeeId,
  showLaunch = false,
}: {
  employeeId: string | number;
  showLaunch?: boolean;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [section, setSection] = useState<Section>('courses');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [summary, courses, assessments, certifications, skills] = await Promise.all([
        learningApi.summary(employeeId),
        learningApi.courses(employeeId),
        learningApi.assessments(employeeId),
        learningApi.certifications(employeeId),
        learningApi.skills(employeeId),
      ]);
      setData({ summary, courses, assessments, certifications, skills });
    } catch (e) {
      setError({
        message: e instanceof Error ? e.message : 'Could not load learning records.',
        status: e instanceof LearningApiError ? e.status : 0,
      });
    }
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-sm text-red-700" role="alert">
        {error.status === 403 ? "You don't have access to this person's learning records." : error.message}
        {error.status !== 403 && (
          <button onClick={load} className="ml-3 font-semibold underline">
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
        <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  const { summary, courses, assessments, certifications, skills } = data;
  const note = LINK_NOTE[summary.link.status];
  const counts: Record<Section, number> = {
    courses: courses.length,
    assessments: assessments.length,
    certifications: certifications.length,
    skills: skills.length,
  };

  return (
    <div className="space-y-5">
      {(note || showLaunch) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            {note ??
              (summary.link.lastSyncedAt
                ? `Synced from the LMS · last update ${fmtDate(summary.link.lastSyncedAt)}`
                : 'Synced from the LMS')}
          </p>
          {showLaunch && summary.link.status !== 'deactivated' && <OpenLmsButton />}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Courses completed"
          value={`${summary.courses.completed}/${summary.courses.assigned}`}
          hint={`${summary.courses.completionRate}% complete${summary.courses.overdue ? ` · ${summary.courses.overdue} overdue` : ''}`}
        />
        <Stat
          label="Mandatory training"
          value={summary.mandatory.total ? `${summary.mandatory.progress}%` : '—'}
          hint={
            summary.mandatory.total
              ? summary.mandatory.outstanding
                ? `${summary.mandatory.outstanding} still to do`
                : 'All done'
              : 'None assigned'
          }
        />
        <Stat
          label="Certifications"
          value={summary.certifications.active + summary.certifications.expiring}
          hint={
            summary.certifications.expiring || summary.certifications.expired
              ? `${summary.certifications.expiring} expiring · ${summary.certifications.expired} expired`
              : `${summary.certifications.total} on record`
          }
        />
        <Stat label="Skills" value={summary.skills} hint={`${summary.assessments.passed} of ${summary.assessments.taken} assessments passed`} />
      </div>

      {summary.learningPaths.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-base font-bold text-slate-900 mb-3">Learning paths</h3>
          <ul className="space-y-3">
            {summary.learningPaths.map((path) => (
              <li key={path.pathId}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-800">{path.name || path.pathId}</span>
                  <span className="text-gray-500 tabular-nums">
                    {path.completed}/{path.total} · {path.progress}%
                  </span>
                </div>
                <ProgressBar value={path.progress} tone={path.progress === 100 ? 'bg-green-500' : 'bg-purple-600'} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex gap-5 px-4 border-b border-gray-200 overflow-x-auto" role="tablist">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={section === s.id}
              onClick={() => setSection(s.id)}
              className={`py-3 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                section === s.id ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {s.label} <span className="text-gray-400 font-normal">{counts[s.id]}</span>
            </button>
          ))}
        </div>
        <div className="px-4">
          {section === 'courses' &&
            (courses.length ? (
              <ul className="divide-y divide-gray-100">
                {courses.map((c) => (
                  <CourseRow key={c.id} course={c} />
                ))}
              </ul>
            ) : (
              <Empty>No courses assigned yet.</Empty>
            ))}

          {section === 'assessments' &&
            (assessments.length ? (
              <ul className="divide-y divide-gray-100">
                {assessments.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{a.title || a.assessmentId}</p>
                      <p className="text-xs text-gray-500">{fmtDate(a.completedAt)}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {a.score != null && (
                        <span className="text-sm font-semibold text-gray-800 tabular-nums">
                          {Number(a.score)}
                          {a.maxScore != null && <span className="text-gray-400">/{Number(a.maxScore)}</span>}
                        </span>
                      )}
                      <Pill
                        className={
                          a.status.toLowerCase() === 'passed'
                            ? 'bg-green-100 text-green-700'
                            : a.status.toLowerCase() === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                        }
                      >
                        {a.status ? a.status[0].toUpperCase() + a.status.slice(1) : 'Completed'}
                      </Pill>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No assessments taken yet.</Empty>
            ))}

          {section === 'certifications' &&
            (certifications.length ? (
              <ul className="divide-y divide-gray-100">
                {certifications.map((c) => (
                  <li key={c.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">
                        {c.credentialUrl ? (
                          <a href={c.credentialUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {c.name}
                          </a>
                        ) : (
                          c.name
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        Issued {fmtDate(c.issuedAt)} · {c.expiresAt ? `Expires ${fmtDate(c.expiresAt)}` : 'No expiry'}
                      </p>
                    </div>
                    <Pill className={CERT_TONE[c.status]}>{CERT_STATUS_LABEL[c.status]}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No certifications yet.</Empty>
            ))}

          {section === 'skills' &&
            (skills.length ? (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-4">
                {skills.map((s) => (
                  <li key={s.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900 truncate">{s.name}</p>
                      {s.proficiency && <Pill className="bg-purple-100 text-purple-700">{s.proficiency}</Pill>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {s.evidenceRefs.length
                        ? `${s.evidenceRefs.length} piece${s.evidenceRefs.length === 1 ? '' : 's'} of evidence`
                        : 'No evidence recorded'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No skills recorded yet. Skills come from completed courses and assessments in the LMS.</Empty>
            ))}
        </div>
      </div>
    </div>
  );
}
