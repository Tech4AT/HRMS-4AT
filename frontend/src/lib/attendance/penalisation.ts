import { useEffect, useState } from 'react';
import { policySettingsApi } from '@/lib/api/policySettings';

/** Policy Settings — what governs Penalisation (grace period, absconding
 *  threshold, per-violation rules, Comp Off accrual). Real backend since
 *  PLAN.md Step 6/11. The `PenalisationRecord` data itself (auto-applied,
 *  HR-overturnable) is real too as of Step 8 — see `lib/api/penalisation.ts`,
 *  not this file. */

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
  /** The one leave type every enabled rule below deducts from - a single
   *  shared setting, not one per rule. Null until HR configures one, in
   *  which case a Penalisation still gets created but consumes no leave
   *  (`attendance/penalisation.py`'s `_deduct_leave`). */
  penaltyLeaveTypeId: string | null;
  noAttendance: PenalisationRuleConfig;
  lateArrival: PenalisationRuleConfig;
  earlyLeaving: PenalisationRuleConfig;
  workHours: PenalisationRuleConfig;
  compOffAccrual: CompOffAccrualConfig;
}

export const DEFAULT_PENALIZATION_SETTINGS: PenalizationSettings = {
  regularisationGraceDays: 3,
  abscondingThresholdDays: 5,
  penaltyLeaveTypeId: null,
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

/** Shared hook for Policy Settings — real backend now (PLAN.md Step 6/11):
 *  `policySettingsApi` reads/writes the one `PolicySettings` row through
 *  `/api/attendance/policy-settings`. `settings` starts at the same defaults
 *  used before, then updates once the real value loads, so the read-only
 *  policy popup (Attendance Policy, on My Attendance) and the Settings >
 *  Policy Settings page both end up showing whatever HR actually configured,
 *  same as the localStorage version did — just fed from the network. Consumers
 *  that only read `settings` (the popup) are unaffected by `updateSettings`
 *  becoming async; `PenalizationSettingsPanel.tsx` (the only writer) awaits it.
 *
 *  The third tuple element, `loaded`, exists specifically for that panel's own
 *  draft-sync effect: `settings` flips from the hardcoded defaults to the real
 *  fetched value asynchronously, one render after mount, and a naive
 *  "sync once" guard in the panel (a boolean flipped inside a plain
 *  `useEffect([settings])`) fires on that *first* render too — while
 *  `settings` still holds the defaults, before the fetch resolves — locking
 *  the panel's draft into the defaults forever and making every edit look
 *  like it silently reverts on refresh. `loaded` only flips true once the
 *  fetch (success or failure) has actually completed, so the panel can gate
 *  its one-time sync on that instead of on its own render count. */
export function usePenalizationSettings() {
  const [settings, setSettingsState] = useState<PenalizationSettings>(DEFAULT_PENALIZATION_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    policySettingsApi
      .get()
      .then((loadedSettings) => {
        if (!cancelled) setSettingsState(loadedSettings);
      })
      .catch(() => {
        // Leave the defaults in place — the popup/panel still render something
        // sensible rather than an error state for what's a read-mostly settings object.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = async (next: PenalizationSettings) => {
    const saved = await policySettingsApi.update(next);
    setSettingsState(saved);
  };

  return [settings, updateSettings, loaded] as const;
}
