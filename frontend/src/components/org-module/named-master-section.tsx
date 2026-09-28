'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type NamedEntity } from '@/lib/api/org';
import { MasterTable, StatusPill } from '@/components/org-module/ui';

interface Row {
  id: string;
  name: string;
  status: string;
}

interface NamedMasterSectionProps {
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  load: () => Promise<NamedEntity[]>;
  extraColumns?: { key: string; label: string }[];
  extraValues?: (id: string, name: string) => Record<string, string>;
}

/** A live read-only table over a {id, name} reference endpoint. */
export function NamedMasterSection({
  title,
  subtitle,
  searchPlaceholder,
  load,
  extraColumns = [],
  extraValues,
}: NamedMasterSectionProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [extras, setExtras] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  // `load` may be an inline closure; keep the effect stable via a ref.
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const items = await loadRef.current();
      setRows(items.map((i) => ({ id: i.id, name: i.name, status: 'Active' })));
      if (extraValues) {
        const m: Record<string, Record<string, string>> = {};
        for (const i of items) m[i.id] = extraValues(i.id, i.name);
        setExtras(m);
      }
    } catch {
      setRows([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
        <div className="h-5 w-40 bg-slate-100 rounded" />
        <div className="mt-3 h-40 bg-slate-50 rounded-xl" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-sm text-amber-800">Couldn&apos;t reach {title.toLowerCase()}.</p>
        <button
          type="button"
          onClick={refresh}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <MasterTable<Row & Record<string, string>>
      title={title}
      subtitle={subtitle}
      rows={rows.map((r) => ({ ...r, ...(extras[r.id] ?? {}) }))}
      fields={[]}
      addLabel={`Add ${title.slice(0, -1) || title}`}
      canManage={false}
      searchPlaceholder={searchPlaceholder}
      columns={[
        { key: 'name', label: 'Name' },
        ...extraColumns.map((c) => ({
          key: c.key,
          label: c.label,
        })),
        {
          key: 'status',
          label: 'Status',
          render: (r: Row & Record<string, string>) => <StatusPill value={r.status} />,
        },
      ]}
    />
  );
}
