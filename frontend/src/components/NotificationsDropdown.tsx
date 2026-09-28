'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { BellIcon } from '@/components/icons';
import {
  notificationsApi,
  type AnnounceTarget,
  type Notification,
  NotificationsApiError,
} from '@/lib/api/notifications';
import { useAuth } from '@/lib/auth/useAuth';
import { adminApi, type AdminUser, type Role } from '@/lib/admin/api';

// No link/entity field on the backend row yet (P3-02 hasn't wired up any
// producers, so there's nothing real to point at either) — a light prefix
// match on `type` is enough to route a click somewhere useful once real
// notifications exist, without inventing a backend field ahead of need.
function linkForType(type: string): string {
  if (type.startsWith('leave.')) return '/leave';
  if (type.startsWith('payroll.') || type.startsWith('payslip.')) return '/payslips';
  if (type.startsWith('performance.')) return '/performance';
  if (type.startsWith('attendance.')) return '/me/attendance';
  return '/notifications';
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await notificationsApi.list();
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    } catch (e) {
      setError(e instanceof NotificationsApiError ? e.message : 'Could not load notifications');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch once on mount so the unread badge is accurate before the dropdown
  // is ever opened, then refresh on each open for anything new since.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) load();
  };

  const handleSelect = async (notification: Notification) => {
    setIsOpen(false);
    if (!notification.readAt) {
      // Optimistic - the badge/list should reflect the click immediately,
      // not wait on a round trip before navigating away.
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      notificationsApi.markRead(notification.id).catch(() => {
        // Best-effort - a failed mark-read isn't worth blocking navigation
        // or showing an error for; it'll just show as unread again next load.
      });
    }
    router.push(linkForType(notification.type));
  };

  const handleMarkAllRead = async () => {
    const previous = notifications;
    const previousCount = unreadCount;
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await notificationsApi.markAllRead();
    } catch {
      setNotifications(previous);
      setUnreadCount(previousCount);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggleOpen}
        className="relative p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
        title="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {unreadCount > 0 ? (
          <span className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-lg border border-gray-200 z-50">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            <div className="flex items-center gap-3">
              {isSuperadmin ? (
                <button
                  onClick={() => {
                    setComposeOpen(true);
                    setIsOpen(false);
                  }}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  + Announce
                </button>
              ) : null}
              {unreadCount > 0 ? (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">Loading…</div>
            ) : error ? (
              <div className="px-4 py-8 text-center text-sm text-red-600">{error}</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">You&apos;re all caught up.</div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  onClick={() => handleSelect(notification)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                >
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      notification.readAt ? 'bg-transparent' : 'bg-indigo-600'
                    }`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 truncate">
                      {notification.title}
                    </span>
                    {notification.body ? (
                      <span className="block text-xs text-gray-500 truncate">{notification.body}</span>
                    ) : null}
                    <span className="block text-[11px] text-gray-400 mt-0.5">
                      {timeAgo(notification.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {composeOpen && isSuperadmin ? (
        <AnnounceComposer
          onClose={() => setComposeOpen(false)}
          onSent={() => {
            setComposeOpen(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

type TargetType = 'me' | 'admins' | 'everyone' | 'role' | 'department' | 'users';

/** Superadmin-only announcement composer, portaled to the body. Lets the sender
 * pick the audience (start with "Just me" to test). The backend also enforces
 * is_superuser and resolves the target, so this is the convenience UI, not the
 * security boundary. */
function AnnounceComposer({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('me');
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [people, setPeople] = useState<AdminUser[]>([]);
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Roles + departments load once, for the "By role" / "By department" pickers.
  useEffect(() => {
    adminApi
      .listRoles()
      .then((r) => setRoles(r.results))
      .catch(() => {});
    fetch('/api/departments', { credentials: 'include' })
      .then((r) => r.json())
      .then((b) => setDepartments(b?.data ?? []))
      .catch(() => {});
  }, []);

  // Debounced people search for the "Specific people" target.
  useEffect(() => {
    if (targetType !== 'users' || personSearch.trim().length < 2) {
      setPersonResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      adminApi
        .listUsers({ search: personSearch.trim(), pageSize: 8 })
        .then((p) => !cancelled && setPersonResults(p.results))
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [personSearch, targetType]);

  const buildTarget = (): AnnounceTarget | null => {
    switch (targetType) {
      case 'me':
        return { type: 'me' };
      case 'admins':
        return { type: 'admins' };
      case 'everyone':
        return { type: 'everyone' };
      case 'role':
        return roleId ? { type: 'role', roleId } : null;
      case 'department':
        return departmentId ? { type: 'department', departmentId } : null;
      case 'users':
        return people.length ? { type: 'users', userIds: people.map((p) => p.id) } : null;
    }
  };

  const send = async () => {
    const target = buildTarget();
    if (!title.trim() || !target) return;
    setBusy(true);
    setError(null);
    try {
      await notificationsApi.announce(title.trim(), body, target);
      onSent();
    } catch (e) {
      setError(e instanceof NotificationsApiError ? e.message : 'Could not send announcement');
      setBusy(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md p-5 my-auto">
        <h3 className="text-base font-bold text-slate-900 mb-4">Send announcement</h3>
        {error ? (
          <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </div>
        ) : null}

        <label className="block text-xs font-semibold text-gray-600 mb-1">Send to</label>
        <select
          value={targetType}
          onChange={(e) => setTargetType(e.target.value as TargetType)}
          className={`${inputCls} mb-3`}
        >
          <option value="me">Just me (test)</option>
          <option value="admins">Admins only</option>
          <option value="everyone">Everyone</option>
          <option value="role">By role…</option>
          <option value="department">By department…</option>
          <option value="users">Specific people…</option>
        </select>

        {targetType === 'role' ? (
          <select
            value={roleId ?? ''}
            onChange={(e) => setRoleId(e.target.value ? Number(e.target.value) : null)}
            className={`${inputCls} mb-3`}
          >
            <option value="">Choose a role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        ) : null}

        {targetType === 'department' ? (
          <select
            value={departmentId ?? ''}
            onChange={(e) => setDepartmentId(e.target.value || null)}
            className={`${inputCls} mb-3`}
          >
            <option value="">Choose a department…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}

        {targetType === 'users' ? (
          <div className="mb-3">
            {people.length ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {people.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5 text-xs"
                  >
                    {p.firstName} {p.lastName}
                    <button
                      onClick={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))}
                      className="text-indigo-400 hover:text-indigo-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="relative">
              <input
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search people by name or email…"
                className={inputCls}
              />
              {personResults.length ? (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow max-h-48 overflow-y-auto">
                  {personResults
                    .filter((u) => !people.some((p) => p.id === u.id))
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setPeople((prev) => [...prev, u]);
                          setPersonSearch('');
                          setPersonResults([]);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
                      >
                        {u.firstName} {u.lastName}{' '}
                        <span className="text-gray-500">{u.email}</span>
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className={`${inputCls} mb-3`}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message…"
          rows={6}
          className={`${inputCls} mb-4`}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={busy || !title.trim() || !buildTarget()}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
