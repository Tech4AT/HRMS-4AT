'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { fullName, orgApi, type NamedEntity, type OrgEmployee } from '@/lib/api/org';
import { hierarchyRulesApi, OrgAdminError, type HierarchyRule } from '@/lib/api/org-config';
import { PageHeader } from '@/components/org-module/ui';

const inputCls =
  'mt-1 block w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400';

const idOf = (v: number | string | null | undefined): string =>
  v === null || v === undefined ? '' : String(v);

function ruleText(r: HierarchyRule): string {
  const who = r.fromLevelName ?? r.fromJobTitleName ?? 'Everyone';
  const must = r.mustReportToLevelName ? `must report to ${r.mustReportToLevelName}` : 'must have a manager';
  const dept = r.sameDepartment ? ' in the same department' : '';
  return `${who} ${must}${dept}`;
}

function RuleCard({
  rule,
  levels,
  titles,
  onSaved,
  onDeleted,
}: {
  rule: HierarchyRule;
  levels: NamedEntity[];
  titles: NamedEntity[];
  onSaved: (saved: HierarchyRule) => void;
  onDeleted: (id: number) => void;
}) {
  const [fromLevel, setFromLevel] = useState(idOf(rule.fromLevel));
  const [fromTitle, setFromTitle] = useState(idOf(rule.fromJobTitle));
  const [mustLevel, setMustLevel] = useState(idOf(rule.mustReportToLevel));
  const [sameDept, setSameDept] = useState(rule.sameDepartment);
  const [active, setActive] = useState(rule.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setFromLevel(idOf(rule.fromLevel));
    setFromTitle(idOf(rule.fromJobTitle));
    setMustLevel(idOf(rule.mustReportToLevel));
    setSameDept(rule.sameDepartment);
    setActive(rule.active);
    setError(null);
    setOk(false);
    setConfirming(false);
  }, [rule.id, rule.fromLevel, rule.fromJobTitle, rule.mustReportToLevel, rule.sameDepartment, rule.active]);

  async function save() {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const saved = await hierarchyRulesApi.update(rule.id, {
        from_level: fromLevel ? Number(fromLevel) : null,
        from_job_title: fromTitle ? Number(fromTitle) : null,
        must_report_to_level: mustLevel ? Number(mustLevel) : null,
        same_department: sameDept,
        active,
      });
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
      await hierarchyRulesApi.remove(rule.id);
      onDeleted(rule.id);
    } catch (e) {
      setError(e instanceof OrgAdminError ? e.message : 'Delete failed. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className={`bg-white border rounded-xl p-4 ${rule.active ? 'border-slate-200' : 'border-slate-200 opacity-75'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">Rule #{rule.id}</p>
          <p className="text-xs text-slate-500">{ruleText(rule)}</p>
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
            aria-label={`Delete rule ${rule.id}`}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-300 shrink-0"
          >
            Delete
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-slate-600">
          Applies to level (blank = any)
          <select value={fromLevel} onChange={(e) => setFromLevel(e.target.value)} aria-label="Applies to level" className={inputCls}>
            <option value="">Any level</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Applies to job title (blank = any)
          <select value={fromTitle} onChange={(e) => setFromTitle(e.target.value)} aria-label="Applies to job title" className={inputCls}>
            <option value="">Any title</option>
            {titles.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Must report to level (blank = any manager)
          <select value={mustLevel} onChange={(e) => setMustLevel(e.target.value)} aria-label="Must report to level" className={inputCls}>
            <option value="">Any manager</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={sameDept} onChange={(e) => setSameDept(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          Same department
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          Active (inactive rules are ignored)
        </label>
      </div>

      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
      {ok ? <p className="mt-2 text-xs font-medium text-emerald-600">Saved.</p> : null}

      <div className="mt-3 flex justify-end">
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

export default function HierarchyRulesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage');

  const [rules, setRules] = useState<HierarchyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [levels, setLevels] = useState<NamedEntity[]>([]);
  const [titles, setTitles] = useState<NamedEntity[]>([]);
  const [directory, setDirectory] = useState<OrgEmployee[]>([]);

  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [valEmployee, setValEmployee] = useState('');
  const [valManager, setValManager] = useState('');
  const [validating, setValidating] = useState(false);
  const [valResult, setValResult] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [valError, setValError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ruleRows, levelRows, titleRows, dirRows] = await Promise.all([
        hierarchyRulesApi.list(),
        orgApi.listLevels(),
        orgApi.listJobTitles(),
        orgApi.listDirectory(),
      ]);
      setRules(ruleRows);
      setLevels(levelRows);
      setTitles(titleRows);
      setDirectory(dirRows);
    } catch (e) {
      setRules([]);
      setLoadError(e instanceof OrgAdminError || e instanceof Error ? e.message : 'Couldn’t load hierarchy rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) refresh();
    else setLoading(false);
  }, [canManage, refresh]);

  const empOptions = useMemo(
    () => directory.map((e) => ({ id: e.id, name: `${fullName(e)} (${e.employee_code})` })),
    [directory],
  );

  async function create() {
    setCreating(true);
    setCreateError(null);
    try {
      const saved = await hierarchyRulesApi.create({ active: true });
      setRules((prev) => [...prev, saved]);
      setShowAdd(false);
    } catch (e) {
      setCreateError(e instanceof OrgAdminError ? e.message : 'Create failed. Try again.');
    } finally {
      setCreating(false);
    }
  }

  async function validate() {
    if (!valEmployee) {
      setValError('Pick an employee to check.');
      return;
    }
    setValidating(true);
    setValError(null);
    setValResult(null);
    try {
      const result = await hierarchyRulesApi.validate(valEmployee, valManager || null);
      setValResult(result);
    } catch (e) {
      setValError(e instanceof OrgAdminError ? e.message : 'Validation failed. Try again.');
    } finally {
      setValidating(false);
    }
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Hierarchy Rules" />
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-800">
            Hierarchy rules need the <span className="font-mono font-semibold">org.manage</span> permission.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader title="Hierarchy Rules" subtitle="Reporting-line constraints, enforced on employee writes." />
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          {showAdd ? 'Close' : 'Add rule'}
        </button>
      </div>

      {showAdd ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-2xl">
          <p className="text-sm text-slate-600">
            A new active rule with no criteria applies to everyone. Tune it below after creating.
          </p>
          {createError ? <p className="mt-2 text-xs font-medium text-rose-600">{createError}</p> : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              {creating ? 'Adding…' : 'Add rule'}
            </button>
          </div>
        </div>
      ) : null}

      {/* validate preview */}
      <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4 max-w-2xl">
        <h3 className="text-sm font-bold text-slate-900">Check a reporting line</h3>
        <p className="text-[11px] text-slate-400">Pre-checks against the active rules without saving anything.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600">
            Employee
            <select value={valEmployee} onChange={(e) => setValEmployee(e.target.value)} aria-label="Employee to check" className={inputCls}>
              <option value="">Select…</option>
              {empOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Manager (blank = no manager)
            <select value={valManager} onChange={(e) => setValManager(e.target.value)} aria-label="Manager to check" className={inputCls}>
              <option value="">No manager</option>
              {empOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        </div>
        {valError ? <p className="mt-2 text-xs font-medium text-rose-600">{valError}</p> : null}
        {valResult ? (
          valResult.valid ? (
            <p className="mt-2 text-xs font-semibold text-emerald-600">Valid — no rule is violated.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {valResult.errors.map((err) => (
                <li key={err} className="text-xs font-medium text-rose-600">• {err}</li>
              ))}
            </ul>
          )
        ) : null}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={validate}
            disabled={validating}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-60"
          >
            {validating ? 'Checking…' : 'Validate'}
          </button>
        </div>
      </div>

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
      ) : rules.length === 0 ? (
        <p className="mt-4 bg-white border border-slate-200 rounded-xl px-6 py-12 text-center text-sm text-slate-500">
          No hierarchy rules yet — employee writes are unconstrained. Add the first rule above.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              levels={levels}
              titles={titles}
              onSaved={(saved) => setRules((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))}
              onDeleted={(id) => setRules((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
