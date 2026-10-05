'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '@/components/admin/ui';
import {
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  MapPinIcon,
  TeamIcon,
} from '@/components/icons';
import { employee360Api, type TimelineEvent } from '@/lib/api/employee360';
import { EmptyNote } from './parts';

const ICONS: Record<string, ReactNode> = {
  joined: <CheckCircleIcon className="w-4 h-4" />,
  promotion: <BriefcaseIcon className="w-4 h-4" />,
  dept_transfer: <BriefcaseIcon className="w-4 h-4" />,
  position_change: <BriefcaseIcon className="w-4 h-4" />,
  location_transfer: <MapPinIcon className="w-4 h-4" />,
  manager_change: <TeamIcon className="w-4 h-4" />,
  direct_report_added: <TeamIcon className="w-4 h-4" />,
};

function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Career milestones, newest first, grouped by year. `employeeId` is an id or `me`. */
export function TimelinePanel({ employeeId }: { employeeId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await employee360Api.timeline(employeeId);
        if (!cancelled) setEvents(rows);
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const body = (() => {
    if (error) {
      return (
        <p role="alert" className="text-sm font-medium text-red-600">
          {error}
        </p>
      );
    }
    if (!events) return <EmptyNote>Loading timeline…</EmptyNote>;
    if (events.length === 0) {
      return <EmptyNote>No timeline events yet. Joining, promotions, transfers and other milestones show up here.</EmptyNote>;
    }

    const years: { year: string; items: TimelineEvent[] }[] = [];
    for (const event of events) {
      const year = event.date?.slice(0, 4) ?? '—';
      const last = years[years.length - 1];
      if (last && last.year === year) last.items.push(event);
      else years.push({ year, items: [event] });
    }

    return (
      <div className="space-y-6">
        {years.map(({ year, items }) => (
          <div key={year}>
            <span className="inline-block text-[11px] font-bold text-white bg-slate-500 rounded px-1.5 py-0.5">
              {year}
            </span>
            <ol className="mt-4 ml-4 border-l border-slate-200 space-y-6">
              {items.map((event) => (
                <li key={event.id} className="relative pl-8">
                  <span className="absolute -left-4 top-0 w-8 h-8 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center ring-4 ring-white">
                    {ICONS[event.kind] ?? <CalendarIcon className="w-4 h-4" />}
                  </span>
                  <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{fmt(event.date)}</p>
                  {event.detail ? <p className="text-sm text-slate-600 mt-1">{event.detail}</p> : null}
                  {event.person ? (
                    <span className="inline-flex items-center gap-2 mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold">
                        {initials(event.person.name)}
                      </span>
                      <span className="text-sm font-medium text-slate-800">{event.person.name}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    );
  })();

  return (
    <section className="max-w-3xl bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-5">
      <h3 className="text-base font-bold text-slate-900 mb-4">Timeline</h3>
      {body}
    </section>
  );
}
