'use client';

import { useState } from 'react';
import { errorText } from '@/components/admin/ui';
import {
  employee360Api,
  type Employee360,
  type Employee360Address,
} from '@/lib/api/employee360';
import { EditButton, Field, FormActions, SectionCard, TextField } from './parts';

type Kind = 'current' | 'permanent';

const LINE_FIELDS = ['line1', 'line2', 'city', 'state', 'postal_code', 'country'] as const;

function format(address: Employee360Address, kind: Kind): string {
  const get = (f: (typeof LINE_FIELDS)[number]) =>
    address[`${kind}_${f}` as keyof Employee360Address] as string;
  const cityLine = [get('city'), get('state')].filter(Boolean).join(', ');
  return [get('line1'), get('line2'), [cityLine, get('postal_code')].filter(Boolean).join(' '), get('country')]
    .filter(Boolean)
    .join(', ');
}

function AddressFields({
  kind,
  draft,
  set,
}: {
  kind: Kind;
  draft: Employee360Address;
  set: (key: keyof Employee360Address, value: string) => void;
}) {
  const key = (f: (typeof LINE_FIELDS)[number]) => `${kind}_${f}` as keyof Employee360Address;
  const val = (f: (typeof LINE_FIELDS)[number]) => draft[key(f)] as string;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <TextField
          label="Address line 1"
          value={val('line1')}
          onChange={(e) => set(key('line1'), e.target.value)}
          maxLength={200}
        />
      </div>
      <div className="sm:col-span-2">
        <TextField
          label="Address line 2"
          value={val('line2')}
          onChange={(e) => set(key('line2'), e.target.value)}
          maxLength={200}
        />
      </div>
      <TextField label="City" value={val('city')} onChange={(e) => set(key('city'), e.target.value)} maxLength={100} />
      <TextField label="State" value={val('state')} onChange={(e) => set(key('state'), e.target.value)} maxLength={100} />
      <TextField
        label="Postal code"
        value={val('postal_code')}
        onChange={(e) => set(key('postal_code'), e.target.value)}
        maxLength={12}
      />
      <TextField
        label="Country"
        value={val('country')}
        onChange={(e) => set(key('country'), e.target.value)}
        maxLength={100}
      />
    </div>
  );
}

export function AddressCard({
  profile,
  address,
  onChange,
}: {
  profile: Employee360;
  address: Employee360Address;
  onChange: (next: Employee360) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Employee360Address>(address);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof Employee360Address, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const start = () => {
    setDraft(address);
    setError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      onChange(await employee360Api.saveAddress(profile.id, draft));
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Address"
      action={
        profile.access.can_edit_personal && !editing ? (
          <EditButton onClick={start} label="Edit address" />
        ) : null
      }
    >
      {editing ? (
        <form onSubmit={save}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Current address</p>
          <AddressFields kind="current" draft={draft} set={set} />

          <label className="flex items-center gap-2 mt-5 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={draft.permanent_same_as_current}
              onChange={(e) => setDraft((d) => ({ ...d, permanent_same_as_current: e.target.checked }))}
              className="rounded border-slate-300"
            />
            Permanent address is the same as current
          </label>

          {!draft.permanent_same_as_current ? (
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Permanent address
              </p>
              <AddressFields kind="permanent" draft={draft} set={set} />
            </div>
          ) : null}
          <FormActions saving={saving} error={error} onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <div className="space-y-5">
          <Field label="Current address" value={format(address, 'current')} />
          <Field
            label="Permanent address"
            value={address.permanent_same_as_current ? 'Same as current address' : format(address, 'permanent')}
          />
        </div>
      )}
    </SectionCard>
  );
}
