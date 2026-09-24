'use client';

import { useState } from 'react';
import {
  compOffAccrualSentence,
  penalisationRuleSentence,
  usePenalizationSettings,
  type CompOffAccrualConfig,
  type PenalisationRuleConfig,
  type PenalizationSettings,
} from '@/lib/attendance/penalisation';

type RuleKind = 'noAttendance' | 'lateArrival' | 'earlyLeaving' | 'workHours';

const RULE_TITLES: Record<RuleKind, string> = {
  noAttendance: 'No Attendance',
  lateArrival: 'Late Arrival',
  earlyLeaving: 'Early Leaving',
  workHours: 'Work Hours',
};

function RuleRow({
  kind,
  rule,
  onChange,
}: {
  kind: RuleKind;
  rule: PenalisationRuleConfig;
  onChange: (next: PenalisationRuleConfig) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="py-4 border-b border-slate-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{RULE_TITLES[kind]}</p>
          <p className="text-xs text-slate-500 mt-1">{penalisationRuleSentence(kind, rule)}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 shrink-0"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3 bg-slate-50 rounded-lg p-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
              className="rounded border-slate-300"
            />
            Enable penalization
          </label>

          {rule.enabled ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
              <span className="flex items-center gap-2">
                Deduct
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={rule.leaveDaysDeducted}
                  onChange={(e) => onChange({ ...rule, leaveDaysDeducted: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-16 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                />
                day(s) leave
              </span>

              {rule.thresholdCount !== undefined ? (
                <span className="flex items-center gap-2">
                  after
                  <input
                    type="number"
                    min={1}
                    value={rule.thresholdCount}
                    onChange={(e) => onChange({ ...rule, thresholdCount: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-16 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                  />
                  occurrence(s)/month
                </span>
              ) : null}

              {rule.minWorkHours !== undefined ? (
                <span className="flex items-center gap-2">
                  if below
                  <input
                    type="number"
                    min={1}
                    max={24}
                    step={0.5}
                    value={rule.minWorkHours}
                    onChange={(e) => onChange({ ...rule, minWorkHours: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-16 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                  />
                  hour(s)/day
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CompOffAccrualRow({
  rule,
  onChange,
}: {
  rule: CompOffAccrualConfig;
  onChange: (next: CompOffAccrualConfig) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Comp Offs</p>
          <p className="text-xs text-slate-500 mt-1">{compOffAccrualSentence(rule)}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 shrink-0"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3 bg-slate-50 rounded-lg p-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
              className="rounded border-slate-300"
            />
            Earn Comp Offs from overtime
          </label>

          {rule.enabled ? (
            <span className="flex items-center gap-2 text-xs text-slate-600">
              1 Comp Off for every
              <input
                type="number"
                min={1}
                max={80}
                value={rule.overtimeHoursPerCompOff}
                onChange={(e) =>
                  onChange({ ...rule, overtimeHoursPerCompOff: Math.max(1, Number(e.target.value) || 1) })
                }
                className="w-16 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
              />
              overtime hour(s)
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Settings > Policy Settings. Frontend-only for now (no real backend to
 *  persist to - settings round-trip through localStorage via
 *  {@link usePenalizationSettings} instead) - configures the rules that
 *  drive the sample data shown under Approvals > Penalisation: the
 *  regularisation grace period, the absconding threshold, a penalty (or "no
 *  penalization") for each of No Attendance, Late Arrival, Early Leaving,
 *  and Work Hours, and the Comp Off accrual rate (the one reward rule
 *  alongside all the penalties - a Comp Off is earned from overtime hours
 *  instead of being deducted for a violation). The saved settings are also
 *  what the read-only "Attendance Policy" popup on My Attendance shows. */
export function PenalizationSettingsPanel() {
  const [saved, setSaved] = usePenalizationSettings();
  const [draft, setDraft] = useState<PenalizationSettings>(saved);
  const [savedMessage, setSavedMessage] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const handleSave = () => {
    setSaved(draft);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
  };

  const setRule = (kind: RuleKind, next: PenalisationRuleConfig) => {
    setDraft((d) => ({ ...d, [kind]: next }));
  };

  return (
    <div className="max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Policy Settings</h3>
        <p className="text-xs text-slate-500 mt-1">
          Configure the rules used to penalise attendance violations for the organisation.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1">Regularisation grace period</label>
          <p className="text-xs text-slate-500 mb-2">
            Days an employee has, after an unexplained absence, to submit a regularisation request before a
            penalisation is raised against them.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={30}
              value={draft.regularisationGraceDays}
              onChange={(e) =>
                setDraft((d) => ({ ...d, regularisationGraceDays: Math.max(1, Number(e.target.value) || 1) }))
              }
              className="w-24 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
            />
            <span className="text-sm text-slate-500">day(s)</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-1">Absconding threshold</label>
          <p className="text-xs text-slate-500 mb-2">
            An employee who is continuously absent for this many days is flagged as absconded from the organisation.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={90}
              value={draft.abscondingThresholdDays}
              onChange={(e) =>
                setDraft((d) => ({ ...d, abscondingThresholdDays: Math.max(1, Number(e.target.value) || 1) }))
              }
              className="w-24 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
            />
            <span className="text-sm text-slate-500">consecutive day(s)</span>
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100">
        <label className="block text-sm font-semibold text-slate-800 mb-1">Attendance violation penalties</label>
        <p className="text-xs text-slate-500 mb-2">What each kind of attendance violation costs an employee, if anything.</p>
        <div>
          <RuleRow kind="noAttendance" rule={draft.noAttendance} onChange={(next) => setRule('noAttendance', next)} />
          <RuleRow kind="lateArrival" rule={draft.lateArrival} onChange={(next) => setRule('lateArrival', next)} />
          <RuleRow kind="earlyLeaving" rule={draft.earlyLeaving} onChange={(next) => setRule('earlyLeaving', next)} />
          <RuleRow kind="workHours" rule={draft.workHours} onChange={(next) => setRule('workHours', next)} />
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100">
        <label className="block text-sm font-semibold text-slate-800 mb-1">Comp Off accrual</label>
        <p className="text-xs text-slate-500 mb-2">
          The one reward rule here - grants a Comp Off once an employee's overtime hours cross this threshold.
        </p>
        <CompOffAccrualRow
          rule={draft.compOffAccrual}
          onChange={(next) => setDraft((d) => ({ ...d, compOffAccrual: next }))}
        />
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save changes
        </button>
        {savedMessage ? <span className="text-sm text-emerald-600 font-medium">Settings saved.</span> : null}
      </div>
    </div>
  );
}
