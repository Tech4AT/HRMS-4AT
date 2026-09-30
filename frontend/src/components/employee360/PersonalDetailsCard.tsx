'use client';

import { useState } from 'react';
import { errorText } from '@/components/admin/ui';
import { fmtDate } from '@/lib/admin/orgApi';
import { employee360Api, type Employee360 } from '@/lib/api/employee360';
import {
  EditButton,
  Field,
  FormActions,
  SectionCard,
  SelectField,
  TextField,
  GENDER_OPTIONS,
  genderLabel,
} from './parts';

/** Legal name, date of birth and gender. The name and the personal fields are
 *  separate permissions on the backend, so each input is enabled on its own. */
export function PersonalDetailsCard({
  profile,
  onChange,
  onNameChanged,
}: {
  profile: Employee360;
  onChange: (next: Employee360) => void;
  onNameChanged: () => void;
}) {
  const { access, personal } = profile;
  const canEdit = access.can_edit_name || access.can_edit_personal;

  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setFirst(profile.first_name);
    setLast(profile.last_name);
    setDob(personal?.dob ?? '');
    setGender(personal?.gender ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    let latest = profile;
    try {
      const personalChanged =
        access.can_edit_personal && (dob !== (personal?.dob ?? '') || gender !== (personal?.gender ?? ''));
      if (personalChanged) {
        latest = await employee360Api.updatePersonal(profile.id, { dob: dob || null, gender });
        onChange(latest);
      }
      const nameChanged =
        access.can_edit_name && (first.trim() !== profile.first_name || last.trim() !== profile.last_name);
      if (nameChanged) {
        latest = await employee360Api.updateName(profile.id, {
          first_name: first,
          last_name: last,
        });
        onChange(latest);
        onNameChanged();
      }
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Personal Details"
      action={canEdit && !editing ? <EditButton onClick={start} label="Edit personal details" /> : null}
    >
      {editing ? (
        <form onSubmit={save}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <TextField
              label="First name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              disabled={!access.can_edit_name}
              maxLength={60}
              required
            />
            <TextField
              label="Last name"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              disabled={!access.can_edit_name}
              maxLength={60}
            />
            <TextField
              label="Date of birth"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              disabled={!access.can_edit_personal}
              max={new Date().toISOString().slice(0, 10)}
            />
            <SelectField
              label="Gender"
              value={gender}
              onChange={setGender}
              options={GENDER_OPTIONS}
              disabled={!access.can_edit_personal}
            />
          </div>
          <FormActions saving={saving} error={error} onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Field label="Name" value={`${profile.first_name} ${profile.last_name}`.trim()} />
          <Field label="Date of birth" value={personal?.dob ? fmtDate(personal.dob) : ''} />
          <Field label="Gender" value={personal?.gender ? genderLabel(personal.gender) : ''} />
        </div>
      )}
    </SectionCard>
  );
}
