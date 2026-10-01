'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CERT_TONE } from '@/components/learning/LearningOverview';
import { CERT_STATUS_LABEL, fmtDate, learningApi, type ComplianceOverview } from '@/lib/api/learning';

/** HR Dashboard → Learning: completion, mandatory compliance and expiring
 * certifications over whoever the caller may see (their lms.read scope). */
export default function LearningCompliancePage() {
  const [data, setData] = useState<ComplianceOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    learningApi
      .compliance()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load compliance data.'));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-8 max-w-6xl space-y-5">
        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}
        {!data && !error && <div className="h-64 rounded-xl bg-gray-100 animate-pulse" aria-busy="true" />}
        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Mandatory compliance" value={`${data.mandatoryCompliance}%`} hint={`${data.courses.mandatoryCompleted} of ${data.courses.mandatoryTotal} mandatory courses done`} />
              <Kpi label="Course completion" value={`${data.courses.completionRate}%`} hint={`${data.courses.completed} of ${data.courses.assigned} assigned`} />
              <Kpi label="Overdue" value={data.courses.overdue} hint="Assigned courses past their due date" tone={data.courses.overdue ? 'text-red-600' : undefined} />
              <Kpi label="On the LMS" value={`${data.linkedLearners}/${data.headcount}`} hint="Active employees with a linked learner" />
            </div>

            <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <h3 className="text-base font-bold text-slate-900 mb-3">Completion by department</h3>
              {data.byDepartment.length ? (
                <ul className="space-y-3">
                  {data.byDepartment.map((d) => (
                    <li key={d.department} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                      <span className="font-medium text-gray-800 truncate">{d.department}</span>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${d.completionRate >= 80 ? 'bg-green-500' : d.completionRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${d.completionRate}%` }}
                        />
                      </div>
                      <span className="text-gray-600 tabular-nums w-28 text-right">
                        {d.completionRate}% · {d.completed}/{d.assigned}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No learning has been assigned yet.</p>
              )}
            </section>

            <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
              <h3 className="text-base font-bold text-slate-900">Certifications expiring in the next 30 days</h3>
              <p className="text-sm text-gray-500 mb-3">Includes certifications that have already expired.</p>
              {data.expiringCertifications.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                        <th className="py-2 pr-4 font-semibold">Employee</th>
                        <th className="py-2 pr-4 font-semibold">Department</th>
                        <th className="py-2 pr-4 font-semibold">Certification</th>
                        <th className="py-2 pr-4 font-semibold">Expires</th>
                        <th className="py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.expiringCertifications.map((c) => (
                        <tr key={`${c.employeeId}-${c.certificationId}`}>
                          <td className="py-2 pr-4">
                            <Link href={`/org/${c.employeeId}`} className="font-medium text-purple-700 hover:underline">
                              {c.employeeName || c.employeeCode}
                            </Link>
                          </td>
                          <td className="py-2 pr-4 text-gray-600">{c.department ?? '—'}</td>
                          <td className="py-2 pr-4 text-gray-800">{c.name}</td>
                          <td className="py-2 pr-4 text-gray-600 tabular-nums">{fmtDate(c.expiresAt)}</td>
                          <td className="py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${CERT_TONE[c.status]}`}>
                              {CERT_STATUS_LABEL[c.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Nothing expiring soon.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint: string; tone?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}
