'use client';

import { useState } from 'react';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type CreateTicketInput,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
} from '@/lib/api/help';

/** Create/edit form for a help ticket - shared between the "Raise a ticket"
 * flow and editing an open ticket of your own (mirrors ESSL's
 * CreateTicketModal/EmployeeEditPanel, merged into one component since both
 * collect the same four fields). */
export function TicketFormModal({
  mode,
  ticket,
  initialCategory,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  ticket?: Ticket;
  /** Preselects the category select in create mode - set when the employee
   * got here via a support-area card rather than the generic "Raise a
   * ticket" button. Ignored in edit mode (the ticket's own category wins). */
  initialCategory?: TicketCategory;
  onClose: () => void;
  onSubmit: (input: CreateTicketInput) => Promise<void>;
}) {
  const [subject, setSubject] = useState(ticket?.subject ?? '');
  const [category, setCategory] = useState<TicketCategory>(ticket?.category ?? initialCategory ?? 'IT & Access');
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? 'Medium');
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = subject.trim().length >= 2 && description.trim().length >= 2;

  const handleSubmit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ subject: subject.trim(), category, priority, description: description.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-base font-bold text-slate-900">{mode === 'create' ? 'Raise a ticket' : 'Edit ticket'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={255}
              placeholder="Short summary of the issue"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              >
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              >
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={5000}
              placeholder="What's going on? Include anything that would help us resolve it faster."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
          </div>

          {error ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          ) : null}
        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !valid}
            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {submitting ? 'Saving…' : mode === 'create' ? 'Raise ticket' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
