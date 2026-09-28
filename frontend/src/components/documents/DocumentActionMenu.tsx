'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVerticalIcon } from '@/components/icons';

export interface DocumentActionMenuItem {
  key: string;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

/** The three-dot overflow menu used on every document card. Items are
 * built by the caller from whatever that specific user/document-state
 * combination actually permits — this component never decides who can see
 * what; it just renders the list it's given (backend remains the real
 * authorization boundary regardless of what's shown here). */
export function DocumentActionMenu({ items }: { items: DocumentActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);

    const onClickOutside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[activeIndex];
    el?.focus();
  }, [open, activeIndex]);

  if (items.length === 0) return null;

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
  };

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
      >
        <MoreVerticalIcon className="w-4 h-4" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Document actions"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20"
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              tabIndex={-1}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 focus:outline-none focus:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
                item.tone === 'danger' ? 'text-red-600' : 'text-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
