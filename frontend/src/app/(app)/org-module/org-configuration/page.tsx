'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { orgSettingsApi, OrgAdminError, type OrgSetting } from '@/lib/api/org-config';
import { PageHeader } from '@/components/org-module/ui';

const inputCls =
  'mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400';

function toJsonText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
}

function SettingCard({
  setting,
  onSaved,
  onDeleted,
}: {
  setting: OrgSetting;
  onSaved: (saved: OrgSetting) => void;
  onDeleted: (id: number) => void;
}) {
  const [text, setText] = useState(toJsonText(setting.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setText(toJsonText(setting.value));
    setError(null);
    setOk(false);
    setConfirming(false);
  }, [setting.id, setting.value]);

  const dirty = text !== toJsonText(setting.value);

  async function save() {
    let parsed: unknown;
    try {
      parsed = text.trim() === '' ? null : JSON.parse(text);
    } catch {
      // Plain strings are valid values too — store the raw text.
      parsed = text;
    }
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const saved = await orgSettingsApi.update(setting.id, { value: parsed });
      onSaved(saved);
      setOk(true);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await orgSettingsApi.remove(setting.id);
      onDeleted(setting.id);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Delete failed. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 font-mono break-all">{setting.key}</p>
          {setting.category ? (
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">{setting.category}</p>
          ) : null}
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
            aria-label={`Delete ${setting.key}`}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-300 shrink-0"
          >
            Delete
          </button>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        spellCheck={false}
        aria-label={`Value for ${setting.key}`}
        className={`${inputCls} font-mono text-xs`}
      />
      <div className="mt-2 flex items-center gap-2 justify-end">
        {ok ? <span className="text-xs font-medium text-emerald-600">Saved.</span> : null}
        {error ? <span className="text-xs font-medium text-rose-600">{error}</span> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function OrgConfigurationPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage');

  const [settings, setSettings] = useState<OrgSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newValue, setNewValue] = useState('""');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSettings(await orgSettingsApi.list());
    } catch (e) {
      setSettings([]);
      setLoadError(e instanceof OrgAdminError ? e.message : 'Couldn’t load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) refresh();
    else setLoading(false);
  }, [canManage, refresh]);

  const grouped = useMemo(() => {
    const map = new Map<string, OrgSetting[]>();
    for (const s of settings) {
      const cat = s.category?.trim() || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [settings]);

  function handleSaved(saved: OrgSetting) {
    setSettings((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
  }

  function handleDeleted(id: number) {
    setSettings((prev) => prev.filter((s) => s.id !== id));
  }

  async function create() {
    const key = newKey.trim();
    if (!key) {
      setCreateError('Key is required.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = newValue.trim() === '' ? null : JSON.parse(newValue);
    } catch {
      parsed = newValue;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const saved = await orgSettingsApi.create({
        key,
        value: parsed,
        category: newCategory.trim(),
      });
      setSettings((prev) => [...prev, saved].sort((a, b) => a.key.localeCompare(b.key)));
      setNewKey('');
      setNewCategory('');
      setNewValue('""');
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
        <PageHeader title="Organization Configuration" />
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            Org settings need the <span className="font-mono font-semibold">org.manage</span> permission.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Organization Configuration" subtitle="Key/value rows, grouped by category. Values are JSON." />
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          {showAdd ? 'Close' : 'Add setting'}
        </button>
      </div>

      {showAdd ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-2xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">
              Key
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. onboarding.default_probation_months"
                aria-label="New setting key"
                className={`${inputCls} font-mono`}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Category
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="e.g. onboarding"
                aria-label="New setting category"
                className={inputCls}
              />
            </label>
          </div>
          <label className="mt-3 block text-xs font-semibold text-slate-600">
            Value (JSON — strings need quotes)
            <textarea
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              rows={3}
              spellCheck={false}
              aria-label="New setting value"
              className={`${inputCls} font-mono text-xs`}
            />
          </label>
          {createError ? <p className="mt-2 text-xs font-medium text-rose-600">{createError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              {creating ? 'Adding…' : 'Add setting'}
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
      ) : settings.length === 0 ? (
        <p className="mt-4 bg-white border border-slate-200 rounded-xl px-6 py-12 text-center text-sm text-slate-500">
          No org settings yet — add the first one above.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {grouped.map(([cat, rows]) => (
            <section key={cat}>
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                {cat} ({rows.length})
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {rows.map((s) => (
                  <SettingCard key={s.id} setting={s} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
