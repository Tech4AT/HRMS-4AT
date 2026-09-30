'use client';

import { useState } from 'react';
import { errorText } from '@/components/admin/ui';
import { employee360Api, type Employee360 } from '@/lib/api/employee360';
import { EditButton, Field, FormActions, SectionCard, TextField } from './parts';

/** Work email is fixed (it is the login); personal email and phone are editable. */
export function ContactCard({
  profile,
  onChange,
}: {
  profile: Employee360;
  onChange: (next: Employee360) => void;
}) {
  const { personal, access } = profile;
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setEmail(personal?.personal_email ?? '');
    setPhone(personal?.phone ?? '');
    setError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      onChange(
        await employee360Api.updatePersonal(profile.id, {
          personal_email: email.trim(),
          phone: phone.trim(),
        }),
      );
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Contact Information"
      action={
        access.can_edit_personal && !editing ? (
          <EditButton onClick={start} label="Edit contact information" />
        ) : null
      }
    >
      {editing ? (
        <form onSubmit={save}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <TextField label="Work email" value={profile.work_email} disabled readOnly />
            <TextField
              label="Personal email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
            <TextField
              label="Phone number"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              placeholder="+91 98765 43210"
            />
          </div>
          <FormActions saving={saving} error={error} onCancel={() => setEditing(false)} />
        </form>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Field label="Work email" value={profile.work_email} />
          <Field label="Personal email" value={personal?.personal_email} />
          <Field label="Phone number" value={personal?.phone} />
        </div>
      )}
    </SectionCard>
  );
}
