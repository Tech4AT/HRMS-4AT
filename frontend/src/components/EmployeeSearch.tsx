'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from '@/components/icons';

interface DirectoryRow {
  id: string;
  first_name: string;
  last_name: string;
  work_email?: string;
}

/** Header search for HR/admins: type a name (or email), pick a match, land on
 *  that employee's full profile (/org/[id]). Reads the company directory once
 *  on first focus and filters client-side. */
export function EmployeeSearch() {
  const router = useRouter();
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const load = () => {
    if (rows) return;
    fetch('/api/org-directory', { credentials: 'include' })
      .then((r) => r.json())
      .then((b) => setRows(b?.success ? (b.data as DirectoryRow[]) : []))
      .catch(() => setRows([]));
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return [];
    return rows
      .filter((e) => `${e.first_name} ${e.last_name} ${e.work_email ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [rows, query]);

  const go = (e: DirectoryRow) => {
    setOpen(false);
    setQuery('');
    router.push(`/org/${e.id}`);
  };

  return (
    <div ref={box} className="relative">
      <input
        type="text"
        value={query}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && matches[active]) go(matches[active]);
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search employees by name or email..."
        className="w-full pl-4 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-2 focus:ring-indigo-500/10 transition-all"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
        <SearchIcon className="w-4 h-4" />
      </span>
      {open && query.trim() ? (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {rows === null ? (
            <p className="px-4 py-3 text-sm text-slate-500">Searching…</p>
          ) : matches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No employees found</p>
          ) : (
            matches.map((e, i) => {
              const name = `${e.first_name} ${e.last_name}`.trim();
              return (
                <button
                  key={e.id}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(e)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === active ? 'bg-indigo-50' : ''}`}
                >
                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {`${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '—'}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{name || e.work_email}</span>
                    {e.work_email ? <span className="block text-xs text-slate-500 truncate">{e.work_email}</span> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
