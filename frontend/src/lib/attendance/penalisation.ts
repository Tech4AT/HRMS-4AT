import { useEffect, useState } from 'react';

/** Sample (frontend-only) data for the Penalisation approvals tab and the
 *  Penalization Settings panel. There's no backend for this yet — a
 *  penalisation is meant to be raised automatically (no approval step) when
 *  an employee is absent and doesn't submit a regularisation request within
 *  the grace period configured below, and an employee who stays absent past
 *  the absconding threshold gets flagged as absconded.
 *
 *  HR can't "approve" a penalisation since it already took effect on its own
 *  - HR can overturn one directly from the Applied list, or an employee can
 *  submit an overturn request (with a required reason) from their own Leave
 *  Management page, which HR then approves or rejects from the "Overturn
 *  Requested" list. Until real automation exists on the backend, records
 *  round-trip through localStorage via {@link usePenalisations} so the
 *  employee-request and HR-decision sides of the flow see the same data
 *  within a browser session. */

export type PenalisationStatus = 'applied' | 'overturn_requested' | 'overturned';

export interface PenalisationRecord {
  id: string;
  employeeName: string;
  absentDate: string;
  regularisationDeadline: string;
  daysOverdue: number;
  reason: string;
  status: PenalisationStatus;
  /** Set once the employee submits a request to overturn this penalisation. */
  overturnRequestReason?: string;
  overturnRequestedOn?: string;
  /** Set once HR finalizes the overturn (directly, or by approving a request). */
  overturnedBy?: string;
  overturnedReason?: string;
}

/** One penalty rule - e.g. "No Attendance", "Late Arrival". Disabled means
 *  the violation is tracked but nothing is deducted ("No penalization for
 *  ..."); enabled deducts `leaveDaysDeducted` day(s) of leave once the
 *  violation happens (No Attendance) or recurs `thresholdCount` times in a
 *  month (Late Arrival / Early Leaving), or once daily hours fall below
 *  `minWorkHours` (Work Hours). Each rule only uses the fields relevant to
 *  its own kind - see {@link penalisationRuleSentence}. */
export interface PenalisationRuleConfig {
  enabled: boolean;
  leaveDaysDeducted: number;
  thresholdCount?: number;
  minWorkHours?: number;
}

/** The reward counterpart to the penalty rules above - accrues a Comp Off
 *  (see the "Comp Offs" leave type in Leave Settings) once an employee's
 *  overtime hours cross a threshold, instead of deducting anything. */
export interface CompOffAccrualConfig {
  enabled: boolean;
  overtimeHoursPerCompOff: number;
}

export interface PenalizationSettings {
  /** Days an employee has, after an unexplained absence, to submit a
   *  regularisation request before a penalisation is raised against them. */
  regularisationGraceDays: number;
  /** Consecutive absent days after which an employee is flagged as
   *  absconded from the organisation. */
  abscondingThresholdDays: number;
  noAttendance: PenalisationRuleConfig;
  lateArrival: PenalisationRuleConfig;
  earlyLeaving: PenalisationRuleConfig;
  workHours: PenalisationRuleConfig;
  compOffAccrual: CompOffAccrualConfig;
}

export const DEFAULT_PENALIZATION_SETTINGS: PenalizationSettings = {
  regularisationGraceDays: 3,
  abscondingThresholdDays: 5,
  noAttendance: { enabled: true, leaveDaysDeducted: 1 },
  lateArrival: { enabled: false, leaveDaysDeducted: 0.5, thresholdCount: 3 },
  earlyLeaving: { enabled: false, leaveDaysDeducted: 0.5, thresholdCount: 3 },
  workHours: { enabled: false, leaveDaysDeducted: 0.5, minWorkHours: 8 },
  compOffAccrual: { enabled: true, overtimeHoursPerCompOff: 8 },
};

/** "1 Comp Off earned for every 8 overtime hour(s)." / "No Comp Offs earned
 *  from overtime." */
export function compOffAccrualSentence(rule: CompOffAccrualConfig): string {
  if (!rule.enabled) return 'No Comp Offs earned from overtime.';
  return `1 Comp Off earned for every ${rule.overtimeHoursPerCompOff} overtime hour(s).`;
}

function fmtDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** The human-readable sentence shown for a rule - "1 day leave for every no
 *  attendance day." when enabled, "No penalization for X" when not. */
export function penalisationRuleSentence(
  kind: 'noAttendance' | 'lateArrival' | 'earlyLeaving' | 'workHours',
  rule: PenalisationRuleConfig,
): string {
  if (!rule.enabled) {
    return {
      noAttendance: 'No penalization for no attendance.',
      lateArrival: 'No penalization for late arrival.',
      earlyLeaving: 'No penalization for early leaving.',
      workHours: 'No penalization for less work hours.',
    }[kind];
  }
  switch (kind) {
    case 'noAttendance':
      return `${fmtDays(rule.leaveDaysDeducted)} leave deducted for every no attendance day.`;
    case 'lateArrival':
      return `${fmtDays(rule.leaveDaysDeducted)} leave deducted after ${rule.thresholdCount} late arrival(s) in a month.`;
    case 'earlyLeaving':
      return `${fmtDays(rule.leaveDaysDeducted)} leave deducted after ${rule.thresholdCount} early leaving(s) in a month.`;
    case 'workHours':
      return `${fmtDays(rule.leaveDaysDeducted)} leave deducted if daily work hours fall below ${rule.minWorkHours} hour(s).`;
  }
}

const SETTINGS_STORAGE_KEY = 'hrms-mock-penalization-settings-v1';

function readSettingsStore(): PenalizationSettings {
  if (typeof window === 'undefined') return DEFAULT_PENALIZATION_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PenalizationSettings;
  } catch {
    // Corrupt or inaccessible storage (private mode, quota) - fall back to defaults.
  }
  return DEFAULT_PENALIZATION_SETTINGS;
}

function writeSettingsStore(settings: PenalizationSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore - the in-memory state still works for the rest of the session.
  }
}

/** Shared client-side "store" for Penalization Settings, so the read-only
 *  policy popup (Attendance Policy, on My Attendance) shows whatever HR
 *  actually configured on the Settings > Policy Settings page, instead of
 *  each holding its own disconnected copy. Same localStorage-backed pattern
 *  as {@link usePenalisations}. */
export function usePenalizationSettings() {
  const [settings, setSettingsState] = useState<PenalizationSettings>(() => readSettingsStore());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) setSettingsState(readSettingsStore());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateSettings = (next: PenalizationSettings) => {
    setSettingsState(next);
    writeSettingsStore(next);
  };

  return [settings, updateSettings] as const;
}

/** Matches MOCK_USER's display name, so the sample data has something to
 *  show on the logged-in employee's own Leave Management page. */
export const SAMPLE_PENALISATIONS: PenalisationRecord[] = [
  {
    id: 'pen-1',
    employeeName: 'Demo User',
    absentDate: '2026-09-15',
    regularisationDeadline: '2026-09-18',
    daysOverdue: 2,
    reason: 'No regularisation request submitted within 3 days of the unexplained absence.',
    status: 'applied',
  },
  {
    id: 'pen-2',
    employeeName: 'Rahul Verma',
    absentDate: '2026-09-10',
    regularisationDeadline: '2026-09-13',
    daysOverdue: 5,
    reason: 'No regularisation request submitted within 3 days of the unexplained absence.',
    status: 'applied',
  },
  {
    id: 'pen-3',
    employeeName: 'Vikram Singh',
    absentDate: '2026-08-28',
    regularisationDeadline: '2026-08-31',
    daysOverdue: 4,
    reason: 'No regularisation request submitted within 3 days of the unexplained absence.',
    status: 'overturn_requested',
    overturnRequestReason: 'Was hospitalized and unable to submit a regularisation request in time. Discharge summary attached.',
    overturnRequestedOn: '2026-09-02',
  },
  {
    id: 'pen-4',
    employeeName: 'Priya Nair',
    absentDate: '2026-08-20',
    regularisationDeadline: '2026-08-23',
    daysOverdue: 0,
    reason: 'No regularisation request submitted within 3 days of the unexplained absence.',
    status: 'overturned',
    overturnedBy: 'Neha Kapoor',
    overturnedReason: 'Regularisation was filed late due to a system outage — waived.',
  },
];

const STORAGE_KEY = 'hrms-mock-penalisations-v1';

function readStore(): PenalisationRecord[] {
  if (typeof window === 'undefined') return SAMPLE_PENALISATIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PenalisationRecord[];
  } catch {
    // Corrupt or inaccessible storage (private mode, quota) - fall back to samples.
  }
  return SAMPLE_PENALISATIONS;
}

function writeStore(records: PenalisationRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore - the in-memory state still works for the rest of the session.
  }
}

/** Shared client-side "store" for the sample penalisation data - see the
 *  module doc comment above. Returns the current records plus an updater
 *  that both applies the change locally and persists it, so other mounted
 *  copies of this hook (including in other tabs) pick it up too. */
export function usePenalisations() {
  const [records, setRecordsState] = useState<PenalisationRecord[]>(() => readStore());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setRecordsState(readStore());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateRecords = (updater: (prev: PenalisationRecord[]) => PenalisationRecord[]) => {
    setRecordsState((prev) => {
      const next = updater(prev);
      writeStore(next);
      return next;
    });
  };

  return [records, updateRecords] as const;
}
