'use client';

import { useState } from 'react';
import { errorText } from '@/components/admin/ui';
import { AlertTriangleIcon } from '@/components/icons';
import {
  employee360Api,
  MAX_EMERGENCY_CONTACTS,
  type EmergencyContact,
  type Employee360,
} from '@/lib/api/employee360';
import { EmptyNote, FormActions, SectionCard, TextField } from './parts';

const BLANK = { name: '', relationship: '', phone: '' };

export function EmergencyContactsCard({
  profile,
  contacts,
  onChange,
}: {
  profile: Employee360;
  contacts: EmergencyContact[];
  onChange: (next: Employee360) => void;
}) {
  const canEdit = profile.access.can_edit_personal;
  // `null` = form closed, 'new' = adding, otherwise the id being edited.
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const open = (id: string | 'new', values = BLANK) => {
    setDraft(values);
    setError(null);
    setEditingId(id);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        relationship: draft.relationship.trim(),
        phone: draft.phone.trim(),
      };
      onChange(
        editingId === 'new'
          ? await employee360Api.addContact(profile.id, body)
          : await employee360Api.updateContact(profile.id, editingId as string, body),
      );
      setEditingId(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contact: EmergencyContact) => {
    if (!window.confirm(`Remove ${contact.name} as an emergency contact?`)) return;
    setListError(null);
    try {
      onChange(await employee360Api.deleteContact(profile.id, contact.id));
    } catch (err) {
      setListError(errorText(err));
    }
  };

  const canAdd = canEdit && editingId === null && contacts.length < MAX_EMERGENCY_CONTACTS;

  const form = (
    <form onSubmit={save} className="border border-slate-200 rounded-lg p-4">
      <div className="grid grid-cols-1 gap-4">
        <TextField
          label="Name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          maxLength={150}
          required
        />
        <TextField
          label="Relationship"
          value={draft.relationship}
          onChange={(e) => setDraft({ ...draft, relationship: e.target.value })}
          maxLength={60}
          required
        />
        <TextField
          label="Contact number"
          type="tel"
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
          maxLength={30}
          required
        />
      </div>
      <FormActions saving={saving} error={error} onCancel={() => setEditingId(null)} />
    </form>
  );

  return (
    <SectionCard
      title="Emergency Contacts"
      icon={<AlertTriangleIcon className="w-4 h-4" />}
      action={
        canAdd ? (
          <button
            type="button"
            onClick={() => open('new')}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 shrink-0"
          >
            Add contact
          </button>
        ) : null
      }
    >
      <div className="space-y-3">
        {contacts.length === 0 && editingId !== 'new' ? (
          <EmptyNote>{canEdit ? 'No emergency contact added yet.' : 'No emergency contact on record.'}</EmptyNote>
        ) : null}

        {contacts.map((c) =>
          editingId === c.id ? (
            <div key={c.id}>{form}</div>
          ) : (
            <div key={c.id} className="flex items-start justify-between gap-3 border border-slate-200 rounded-lg p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                <p className="text-xs text-slate-500">
                  {c.relationship} · {c.phone}
                </p>
              </div>
              {canEdit && editingId === null ? (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => open(c.id, { name: c.name, relationship: c.relationship, phone: c.phone })}
                    aria-label={`Edit ${c.name}`}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    aria-label={`Remove ${c.name}`}
                    className="text-xs font-medium text-red-500 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          ),
        )}

        {editingId === 'new' ? form : null}
        {listError ? (
          <p role="alert" className="text-sm font-medium text-red-600">
            {listError}
          </p>
        ) : null}
        {canEdit && contacts.length >= MAX_EMERGENCY_CONTACTS ? (
          <EmptyNote>You can keep up to {MAX_EMERGENCY_CONTACTS} emergency contacts.</EmptyNote>
        ) : null}
      </div>
    </SectionCard>
  );
}
