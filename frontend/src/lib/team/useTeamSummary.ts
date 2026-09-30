'use client';

import { useEffect, useRef, useState } from 'react';
import { teamAttendanceApi, type TeamGroup, type TeamSummary } from '@/lib/api/teamAttendance';

export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** One group of the caller's team, from a single backend read per (group, month).
 *  Membership, today's presence and coverage all come from the same response, so
 *  the cards, counts and calendar cannot describe different populations.
 *
 *  While the calendar moves to another month the previous response stays in place
 *  for everything but the calendar (today's figures do not change), and
 *  `monthRows` is `undefined` until the new month arrives. */
export function useTeamSummary(group: TeamGroup, shownMonthKey: string) {
  const [cache, setCache] = useState<Record<string, TeamSummary>>({});
  const [latest, setLatest] = useState<Partial<Record<TeamGroup, TeamSummary>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());

  const id = `${group}|${shownMonthKey}`;

  useEffect(() => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    teamAttendanceApi
      .getSummary(group, shownMonthKey)
      .then((summary) => {
        setCache((prev) => ({ ...prev, [id]: summary }));
        setLatest((prev) => ({ ...prev, [group]: summary }));
        setErrors((prev) => {
          const { [id]: _cleared, ...rest } = prev;
          return rest;
        });
      })
      .catch((e) => {
        requested.current.delete(id);
        setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : 'Could not load your team' }));
      });
  }, [id, group, shownMonthKey]);

  const forMonth = cache[id];
  const summary = forMonth ?? latest[group];
  return {
    /** `undefined` until this group has loaded once. */
    summary,
    /** Day rows for the shown month; `undefined` while that month is loading. */
    monthRows: forMonth?.rows,
    error: errors[id] ?? null,
  };
}
