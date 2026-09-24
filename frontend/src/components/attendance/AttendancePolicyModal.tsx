'use client';

import {
  compOffAccrualSentence,
  penalisationRuleSentence,
  usePenalizationSettings,
} from '@/lib/attendance/penalisation';

const RULE_TITLES = {
  noAttendance: 'No Attendance',
  lateArrival: 'Late Arrival',
  earlyLeaving: 'Early Leaving',
  workHours: 'Work Hours',
} as const;

/** Read-only view of Settings > Policy Settings, opened from the "Attendance
 *  Policy" button on My Attendance so employees can see the rules that apply
 *  to them without being able to change anything. Reads the same
 *  localStorage-backed settings HR configures there - see
 *  usePenalizationSettings. */
export function AttendancePolicyModal({ onClose }: { onClose: () => void }) {
  const [settings] = usePenalizationSettings();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Attendance Policy</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Regularisation grace period</p>
            <p className="text-sm text-slate-700">
              You have {settings.regularisationGraceDays} day(s) after an unexplained absence to submit a
              regularisation request before a penalisation is raised.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Absconding threshold</p>
            <p className="text-sm text-slate-700">
              {settings.abscondingThresholdDays} consecutive absent day(s) flags an employee as absconded from the
              organisation.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Attendance violation penalties</p>
            <div className="space-y-2.5">
              {(Object.keys(RULE_TITLES) as (keyof typeof RULE_TITLES)[]).map((kind) => (
                <div key={kind}>
                  <p className="text-sm font-medium text-slate-800">{RULE_TITLES[kind]}</p>
                  <p className="text-xs text-slate-500">{penalisationRuleSentence(kind, settings[kind])}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Comp Off accrual</p>
            <p className="text-sm text-slate-700">{compOffAccrualSentence(settings.compOffAccrual)}</p>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="w-full text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
