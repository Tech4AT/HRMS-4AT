'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { codeSchemesApi, OrgAdminError, type CodeScheme } from '@/lib/api/org-config';
import { PageHeader } from '@/components/org-module/ui';

const inputCls =
  'mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400';

function SchemeCard({
  scheme,
  onSaved,
  onDeleted,
}: {
  scheme: CodeScheme;
  onSaved: (saved: CodeScheme) => void;
  onDeleted: (id: number) => void;
}) {
  const [prefix, setPrefix] = useState(scheme.prefix);
  const [separator, setSeparator] = useState(scheme.separator);
  const [padding, setPadding] = useState(String(scheme.padding));
  const [nextSeq, setNextSeq] = useState(String(scheme.nextSeq));
  const [active, setActive] = useState(scheme.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  useEffect(() => {
    setPrefix(scheme.prefix);
    setSeparator(scheme.separator);
    setPadding(String(scheme.padding));
    setNextSeq(String(scheme.nextSeq));
    setActive(scheme.isActive);
    setError(null);
    setOk(false);
    setConfirming(false);
  }, [scheme.id, scheme.prefix, scheme.separator, scheme.padding, scheme.nextSeq, scheme.isActive]);

  async function save() {
    const pad = Number(padding);
    const seq = Number(nextSeq);
    if (!Number.isInteger(pad) || pad < 1) {
      setError('Padding must be a whole number of 1 or more.');
      return;
    }
    if (!Number.isInteger(seq) || seq < 1) {
      setError('Next sequence must be a whole number of 1 or more.');
      return;
    }
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const saved = await codeSchemesApi.update(scheme.id, {
        prefix,
        separator,
        padding: pad,
        next_seq: seq,
        is_active: active,
      });
      onSaved(saved);
      setOk(true);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function issueNext() {
    setSaving(true);
    setError(null);
    setIssued(null);
    try {
      const { code } = await codeSchemesApi.nextCode(scheme.id);
      setIssued(code);
      // The counter advanced server-side — refresh this row from the list.
      const rows = await codeSchemesApi.list();
      const fresh = rows.find((r) => r.id === scheme.id);
      if (fresh) onSaved(fresh);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Could not issue a code. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await codeSchemesApi.remove(scheme.id);
      onDeleted(scheme.id);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Delete failed. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900 font-mono">{scheme.entityType}</p>
          <p className="text-xs text-slate-500">
            Next up: <span className="font-mono font-semibold text-indigo-700">{scheme.nextCodePreview}</span>
            {!scheme.isActive ? <span className="ml-2 text-amber-600 font-semibold">(inactive)</span> : null}
          </p>
        </div>
        {confirming ? (
          <span className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${scheme.entityType} scheme`}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-300 shrink-0"
          >
            Delete
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-4">
        <label className="block text-xs font-semibold text-slate-600">
          Prefix
          <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label="Prefix" className={`${inputCls} font-mono`} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Separator
          <input type="text" value={separator} onChange={(e) => setSeparator(e.target.value)} aria-label="Separator" className={`${inputCls} font-mono`} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Padding
          <input type="number" min={1} value={padding} onChange={(e) => setPadding(e.target.value)} aria-label="Padding" className={inputCls} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Next seq
          <input type="number" min={1} value={nextSeq} onChange={(e) => setNextSeq(e.target.value)} aria-label="Next sequence" className={inputCls} />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="w-4 h-4 accent-indigo-600"
        />
        Active (inactive schemes refuse to issue codes)
      </label>

      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
      {ok ? <p className="mt-2 text-xs font-medium text-emerald-600">Saved.</p> : null}
      {issued ? (
        <p className="mt-2 text-xs font-medium text-indigo-700">
          Issued <span className="font-mono font-bold">{issued}</span> — the counter has advanced.
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={issueNext}
          disabled={saving || !scheme.isActive}
          title={scheme.isActive ? 'Issues the next code and advances the counter' : 'Activate the scheme first'}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
        >
          {saving ? 'Working…' : 'Issue next code'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function NamingCodesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage');

  const [schemes, setSchemes] = useState<CodeScheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newEntity, setNewEntity] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSchemes(await codeSchemesApi.list());
    } catch (e) {
      setSchemes([]);
      setLoadError(e instanceof OrgAdminError ? e.message : 'Couldn’t load code schemes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) refresh();
    else setLoading(false);
  }, [canManage, refresh]);

  async function create() {
    const entity = newEntity.trim();
    if (!entity) {
      setCreateError('Entity type is required (e.g. employee, department).');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const saved = await codeSchemesApi.create({ entity_type: entity });
      setSchemes((prev) => [...prev, saved].sort((a, b) => a.entityType.localeCompare(b.entityType)));
      setNewEntity('');
      setShowAdd(false);
    } catch (e) {
      setCreateError(e instanceof OrgAdminError ? e.message : 'Create failed. Try again.');
    } finally {
      setCreating(false);
    }
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Naming / Codes" />
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            Code schemes need the <span className="font-mono font-semibold">org.manage</span> permission.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Naming / Codes" subtitle="Prefix and sequence conventions per entity. Issuing a code advances its counter." />
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          {showAdd ? 'Close' : 'Add scheme'}
        </button>
      </div>

      {showAdd ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-2xl">
          <label className="block text-xs font-semibold text-slate-600">
            Entity type
            <input
              type="text"
              value={newEntity}
              onChange={(e) => setNewEntity(e.target.value)}
              placeholder="e.g. employee, department, position"
              aria-label="New scheme entity type"
              className={`${inputCls} font-mono`}
            />
          </label>
          <p className="mt-1 text-[11px] text-slate-400">
            A default prefix is derived from the name; tune it below after creating.
          </p>
          {createError ? <p className="mt-2 text-xs font-medium text-rose-600">{createError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              {creating ? 'Adding…' : 'Add scheme'}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
          <div className="h-5 w-40 bg-slate-100 rounded" />
          <div className="mt-3 h-40 bg-slate-50 rounded-xl" />
        </div>
      ) : loadError ? (
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">{loadError}</p>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : schemes.length === 0 ? (
        <p className="mt-4 bg-white border border-slate-200 rounded-xl px-6 py-12 text-center text-sm text-slate-500">
          No code schemes yet — add the first one above.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {schemes.map((s) => (
            <SchemeCard
              key={s.id}
              scheme={s}
              onSaved={(saved) => setSchemes((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))}
              onDeleted={(id) => setSchemes((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
