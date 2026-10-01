'use client';

import { useEffect, useState } from 'react';
import { DashboardCard } from './DashboardCard';

interface CalendarEvent {
  date: string;
  name: string;
  description: string | null;
}

/** The signed-in employee's upcoming events, from every calendar that covers them
 *  (`/api/calendar/my-events`, next 60 days). */
export function UpcomingEventsWidget() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/calendar/my-events', { credentials: 'include' })
      .then((res) => res.json().then((body) => ({ ok: res.ok && body?.success, body })))
      .then(({ ok, body }) => {
        if (!active) return;
        if (ok) setEvents((body.data as CalendarEvent[]).slice(0, 5));
        else setFailed(true);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  return (
    <DashboardCard title="Upcoming Events" actionLabel="View calendar" actionHref="/calendar">
      {failed ? (
        <p className="text-xs text-slate-400">Events couldn&apos;t be loaded right now.</p>
      ) : events === null ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-slate-400">No upcoming events in the next 60 days.</p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const d = new Date(`${event.date}T00:00:00`);
            return (
              <div key={`${event.date}:${event.name}`} className="flex gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex flex-col items-center justify-center shrink-0 leading-none">
                  <span className="text-[9px] font-semibold text-blue-600">
                    {d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}
                  </span>
                  <span className="text-sm font-bold text-blue-700">{String(d.getDate()).padStart(2, '0')}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{event.name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {d.toLocaleDateString('en-US', { weekday: 'long' })}
                  </p>
                  {event.description ? <p className="text-xs text-slate-400 truncate">{event.description}</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}
