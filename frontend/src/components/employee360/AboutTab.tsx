'use client';

import { useState, type ReactNode } from 'react';
import { errorText } from '@/components/admin/ui';
import { MailIcon } from '@/components/icons';
import {
  ABOUT_MAX_LENGTH,
  employee360Api,
  MAX_SKILLS,
  SKILL_MAX_LENGTH,
  type Employee360,
  type EmployeeAbout,
} from '@/lib/api/employee360';
import { EmptyNote, FormActions, SectionCard } from './parts';
import { TimelinePanel } from './TimelinePanel';

const SUB_TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'wall', label: 'Wall Activity' },
] as const;

type SubTab = (typeof SUB_TABS)[number]['id'];

const QUESTIONS: {
  field: keyof EmployeeAbout;
  heading: string | null; // null: the card's own title is the heading
  prompt: string;
}[] = [
  { field: 'about', heading: null, prompt: 'Share a short introduction about yourself.' },
  { field: 'love_about_job', heading: 'What I love about my job?', prompt: 'Tell your colleagues what you enjoy most.' },
  { field: 'interests', heading: 'My interests and hobbies', prompt: 'Share what you enjoy outside of work.' },
];

const BUTTON_CLS =
  'px-4 py-2 border border-blue-600 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 transition-colors';

/** One answer on the About card: text, an "Add your response" button, or an inline editor. */
function Answer({
  profile,
  field,
  prompt,
  heading,
  onChange,
}: {
  profile: Employee360;
  field: keyof EmployeeAbout;
  prompt: string;
  heading: string | null;
  onChange: (next: Employee360) => void;
}) {
  const value = profile.about[field];
  const canEdit = profile.access.can_edit_personal;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      onChange(await employee360Api.updateAbout(profile.id, { [field]: draft }));
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  let body: ReactNode;
  if (editing) {
    body = (
      <form onSubmit={save}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={ABOUT_MAX_LENGTH}
          rows={4}
          autoFocus
          aria-label={heading ?? 'About'}
          className="w-full px-3 py-2 text-sm text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
        />
        <p className="text-[11px] text-slate-400 mt-1 text-right">
          {draft.length}/{ABOUT_MAX_LENGTH}
        </p>
        <FormActions saving={saving} error={error} onCancel={() => setEditing(false)} />
      </form>
    );
  } else if (value) {
    body = (
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-800 whitespace-pre-line break-words min-w-0">{value}</p>
        {canEdit ? (
          <button
            type="button"
            onClick={start}
            aria-label={`Edit ${heading ?? 'about'}`}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 shrink-0"
          >
            Edit
          </button>
        ) : null}
      </div>
    );
  } else if (canEdit) {
    body = (
      <>
        <p className="text-sm text-slate-400 mb-3">{prompt}</p>
        <button type="button" onClick={start} className={BUTTON_CLS}>
          Add your response
        </button>
      </>
    );
  } else {
    body = <p className="text-sm text-slate-400">Not shared yet.</p>;
  }

  return (
    <div>
      {heading ? <h3 className="text-base font-bold text-slate-900 mb-3">{heading}</h3> : null}
      {body}
    </div>
  );
}

function SkillsCard({ profile, onChange }: { profile: Employee360; onChange: (next: Employee360) => void }) {
  const canEdit = profile.access.can_edit_personal;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await employee360Api.addSkill(profile.id, name.trim()));
      setName('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      onChange(await employee360Api.removeSkill(profile.id, id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const full = profile.skills.length >= MAX_SKILLS;

  return (
    <SectionCard title="Skills">
      {profile.skills.length === 0 ? (
        <EmptyNote>
          {canEdit ? 'No skills added yet. Showcase your skills to your colleagues!' : 'No skills listed.'}
        </EmptyNote>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {profile.skills.map((skill) => (
            <li
              key={skill.id}
              className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded-full pl-3 pr-2 py-1"
            >
              {skill.name}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => remove(skill.id)}
                  disabled={busy}
                  aria-label={`Remove ${skill.name}`}
                  className="w-5 h-5 rounded-full text-blue-500 hover:bg-blue-100 hover:text-blue-800 disabled:opacity-50 leading-none"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form onSubmit={add} className="mt-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={SKILL_MAX_LENGTH}
            disabled={full || busy}
            placeholder={full ? `Up to ${MAX_SKILLS} skills` : 'Add a skill'}
            aria-label="Add a skill"
            className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={full || busy || !name.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            Add
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-600 mt-2">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}

function WallPlaceholder() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_2px_8px_rgba(15,23,42,0.04)] py-20 flex flex-col items-center text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
        <MailIcon className="w-7 h-7" />
      </div>
      <h2 className="text-base font-bold text-slate-900 mb-1">No wall activity yet</h2>
      <p className="text-sm text-slate-500 max-w-sm">Posts, praise, and comments involving you will show up here.</p>
    </div>
  );
}

/** The About tab: introduction answers and skills, the career timeline, and the wall. */
export function AboutTab({ profile, onChange }: { profile: Employee360; onChange: (next: Employee360) => void }) {
  const [sub, setSub] = useState<SubTab>('summary');

  return (
    <>
      <div className="flex gap-6 mb-5 border-b border-slate-200" role="tablist">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            onClick={() => setSub(t.id)}
            className={`pb-3 -mb-px text-sm font-medium border-b-2 transition-colors ${
              sub === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'summary' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <SectionCard title="About">
              <div className="space-y-6 divide-y divide-slate-100 [&>*:not(:first-child)]:pt-6">
                {QUESTIONS.map((q) => (
                  <Answer
                    key={q.field}
                    profile={profile}
                    field={q.field}
                    prompt={q.prompt}
                    heading={q.heading}
                    onChange={onChange}
                  />
                ))}
              </div>
            </SectionCard>
          </div>
          <div>
            <SkillsCard profile={profile} onChange={onChange} />
          </div>
        </div>
      )}
      {sub === 'timeline' && <TimelinePanel employeeId={profile.id} />}
      {sub === 'wall' && <WallPlaceholder />}
    </>
  );
}
