'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface PickerPerson {
  id: string;
  name: string;
  /** Shown beside the name and searchable, e.g. a department. */
  hint?: string;
}

/** Pick any number of people from a long list by typing to search.
 *
 *  The chosen people show as removable chips; the box filters `options` as you
 *  type (name or hint). Chosen people that are not in `options` (for example
 *  someone outside the caller's directory scope) still show and can be removed.
 *  `onChange` receives the full list of chosen ids, in the order they were chosen. */
export function PeoplePicker({
  options,
  selected,
  onChange,
  disabled = false,
  busy = false,
  placeholder = 'Search people…',
  ariaLabel,
}: {
  options: PickerPerson[];
  selected: PickerPerson[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** A change is being saved: further changes are ignored until it finishes, but
   *  the list stays open so several people can be added in a row. */
  busy?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedIds = useMemo(() => new Set(selected.map((p) => p.id)), [selected]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((p) => p.name.toLowerCase().includes(q) || (p.hint ?? '').toLowerCase().includes(q))
      : options;
    return list;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlight on a real row as the list narrows.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  const toggle = (id: string) => {
    if (busy) return;
    const next = selectedIds.has(id) ? selected.filter((p) => p.id !== id).map((p) => p.id) : [...selected.map((p) => p.id), id];
    onChange(next);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && matches[active]) toggle(matches[active].id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      onChange(selected.slice(0, -1).map((p) => p.id));
    }
  };

  return (
    <div ref={rootRef} className="relative w-full sm:w-96">
      <div
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          inputRef.current?.focus();
        }}
        className={`flex flex-wrap items-center gap-1.5 min-h-[38px] border border-slate-200 rounded-lg px-2 py-1 bg-white ${
          disabled ? 'opacity-50' : 'focus-within:ring-2 focus-within:ring-indigo-500/10 focus-within:border-slate-300'
        } ${busy ? 'opacity-70' : ''}`}
        aria-busy={busy}
      >
        {selected.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full pl-2.5 pr-1 py-0.5">
            {p.name}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                toggle(p.id);
              }}
              aria-label={`Remove ${p.name}`}
              className="w-4 h-4 rounded-full text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder={selected.length === 0 ? placeholder : 'Add another…'}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex-1 min-w-[7rem] text-sm text-slate-700 bg-transparent outline-none py-1 px-1 placeholder:text-slate-400"
        />
      </div>

      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">No one matches &ldquo;{query}&rdquo;.</li>
          ) : (
            matches.map((p, i) => {
              const chosen = selectedIds.has(p.id);
              return (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={chosen}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(p.id)}
                  className={`flex items-center justify-between gap-3 px-3 py-1.5 text-sm cursor-pointer ${
                    i === active ? 'bg-indigo-50' : ''
                  }`}
                >
                  <span className="min-w-0 truncate text-slate-800">
                    {p.name}
                    {p.hint ? <span className="ml-2 text-xs text-slate-400">{p.hint}</span> : null}
                  </span>
                  {chosen ? <span className="text-indigo-600 text-xs font-semibold shrink-0">✓</span> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
