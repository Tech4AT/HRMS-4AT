'use client';

/**
 * Small UI kit for the payroll module, following the payroll design reference:
 * white cards on slate, navy primary actions, coloured icon tiles, soft status
 * pills and right-hand detail drawers.
 */

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

// ------------------------------------------------------------------ format

export function inr(value: string | number | null | undefined, opts: { decimals?: boolean } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return (
    '₹' +
    n.toLocaleString('en-IN', {
      minimumFractionDigits: opts.decimals ? 2 : 0,
      maximumFractionDigits: opts.decimals ? 2 : 0,
    })
  );
}

/** Compact Indian notation for KPI tiles: ₹48.6L, ₹1.2Cr. */
export function inrShort(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return inr(n);
}

export function num(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function fmtDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export function monthLong(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ icons

type IconProps = { className?: string };
const stroke = (d: ReactNode) =>
  function Icon({ className = 'h-5 w-5' }: IconProps) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {d}
      </svg>
    );
  };

export const Icons = {
  users: stroke(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" /></>),
  money: stroke(<><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5M18 9.5v5" /></>),
  hand: stroke(<><path d="M3 15h3l4 3h6a2 2 0 002-2v0a2 2 0 00-2-2h-4" /><path d="M6 15v5H3v-5" /><circle cx="15" cy="7" r="3" /></>),
  pie: stroke(<><path d="M21 12A9 9 0 1112 3v9z" /><path d="M15 3.5A9 9 0 0120.5 9H15z" /></>),
  bank: stroke(<><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>),
  layers: stroke(<><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>),
  percent: stroke(<><path d="M19 5L5 19" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></>),
  lock: stroke(<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 018 0v3.5" /></>),
  alert: stroke(<><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18h.01" /></>),
  error: stroke(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></>),
  check: stroke(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>),
  clock: stroke(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  calendar: stroke(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  file: stroke(<><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>),
  gift: stroke(<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13" /><path d="M12 8S10.5 3 8 4s0 4 4 4zM12 8s1.5-5 4-4 0 4-4 4z" /></>),
  trend: stroke(<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>),
  userPlus: stroke(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M19 8v6M16 11h6" /></>),
  userMinus: stroke(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 11h6" /></>),
  wallet: stroke(<><path d="M3 7a2 2 0 012-2h13v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M16 13.5h2" /></>),
  settings: stroke(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>),
  search: stroke(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>),
  plus: stroke(<path d="M12 5v14M5 12h14" />),
  x: stroke(<path d="M6 6l12 12M18 6L6 18" />),
  chevronLeft: stroke(<path d="M15 6l-6 6 6 6" />),
  chevronRight: stroke(<path d="M9 6l6 6-6 6" />),
  arrowRight: stroke(<path d="M5 12h14M13 6l6 6-6 6" />),
  arrowLeft: stroke(<path d="M19 12H5M11 6l-6 6 6 6" />),
  download: stroke(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 19h16" /></>),
  upload: stroke(<><path d="M12 16V5M7 10l5-5 5 5" /><path d="M4 19h16" /></>),
  refresh: stroke(<><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 5v6h-6" /></>),
  edit: stroke(<><path d="M4 20h4L19 9l-4-4L4 16v4z" /></>),
  eye: stroke(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  history: stroke(<><path d="M3 12a9 9 0 103-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>),
  shield: stroke(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  info: stroke(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  printer: stroke(<><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></>),
  hourglass: stroke(<><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" /></>),
  report: stroke(<><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>),
};

// ------------------------------------------------------------------ layout

export function PageHeader({
  title, subtitle, crumbs, actions, back, badge,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: { label: string; href?: string }[];
  actions?: ReactNode;
  back?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {crumbs && (
        <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <Icons.chevronRight className="h-3.5 w-3.5" />}
              {c.href ? (
                <Link href={c.href} className="hover:text-blue-700">{c.label}</Link>
              ) : (
                <span className="font-medium text-slate-800">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {back && (
            <Link href={back} className="mt-1 rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Back">
              <Icons.arrowLeft className="h-4 w-4" />
            </Link>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
              {badge}
            </div>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {actions}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

const TONES = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-rose-50 text-rose-600',
  purple: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600',
};
export type Tone = keyof typeof TONES;

export function StatCard({ label, value, sub, icon: Icon, tone = 'blue', trend, onClick, active }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: (p: IconProps) => React.ReactElement; tone?: Tone;
  trend?: string | null; onClick?: () => void; active?: boolean;
}) {
  const t = trend !== undefined && trend !== null ? Number(trend) : null;
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper onClick={onClick}
      className={cx('flex w-full items-start gap-3 rounded-xl border bg-white p-4 text-left shadow-sm',
        active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200', onClick && 'hover:border-blue-300')}>
      {Icon && (
        <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', TONES[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="mt-0.5 text-2xl font-bold text-slate-900">{value}</div>
        {(sub || t !== null) && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {t !== null && (
              <span className={t >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                {t >= 0 ? '↑' : '↓'} {Math.abs(t).toFixed(1)}%
              </span>
            )}
            {sub}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

const BADGE_TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const STATUS_TONE: Record<string, string> = {
  active: 'green', ready: 'green', completed: 'green', approved: 'green', final: 'green', released: 'green',
  paid: 'green', finalized: 'green', included: 'green', process: 'green', yes: 'green', ok: 'green',
  draft: 'slate', inactive: 'slate', superseded: 'slate', cancelled: 'slate', not_created: 'slate', upcoming: 'slate',
  generated: 'blue', in_progress: 'blue', current: 'blue', submitted: 'blue', calculated: 'blue', reopened: 'purple',
  ready_for_review: 'blue', pending_approval: 'amber', pending: 'amber', warning: 'amber', review: 'amber',
  returned: 'amber', lop: 'amber', hold: 'amber', on_hold: 'amber', ff_pending: 'amber', items_to_review: 'amber',
  acknowledged: 'slate', rejected: 'red', error: 'red', blocking: 'red', missing: 'red', validation_failed: 'red',
  info: 'blue', new_joiner: 'green',
};

export function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Badge({ status, label, tone, dot = true }: { status?: string; label?: ReactNode; tone?: string; dot?: boolean }) {
  const key = (status || '').toLowerCase();
  const color = BADGE_TONES[tone || STATUS_TONE[key] || 'slate'];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', color)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label ?? statusLabel(status || '')}
    </span>
  );
}

export function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-slate-400">–</span>;
  return value ? <Badge tone="green" label="Yes" /> : <Badge tone="slate" label="No" />;
}

// ------------------------------------------------------------------ controls

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const BUTTONS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-900 text-white hover:bg-blue-800 disabled:bg-blue-900/50',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-blue-700 hover:bg-blue-50 disabled:text-slate-400',
};

export function Button({ variant = 'secondary', size = 'md', loading, children, className, ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button type="button" {...props} disabled={props.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm', BUTTONS[variant], className)}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = 'secondary', children, className }: {
  href: string; variant?: ButtonVariant; children: ReactNode; className?: string;
}) {
  return (
    <Link href={href} className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium', BUTTONS[variant], className)}>
      {children}
    </Link>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: ReactNode; count?: number | null; tone?: 'red' | 'default' }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="mb-4 overflow-x-auto border-b border-slate-200">
      <nav className="flex gap-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
            className={cx('flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium',
              value === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900')}>
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={cx('rounded-full px-1.5 text-xs', t.tone === 'red' && t.count ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Field({ label, required, error, hint, children, className }: {
  label: ReactNode; required?: boolean; error?: string | string[]; hint?: ReactNode; children: ReactNode; className?: string;
}) {
  const message = Array.isArray(error) ? error.join(' ') : error;
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-rose-600">*</span>}
      </span>
      {children}
      {hint && !message && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {message && <span className="mt-1 block text-xs text-rose-600">{message}</span>}
    </label>
  );
}

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputClass, props.className)} />;
}

export function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string | number; label: string }[]; placeholder?: string;
}) {
  return (
    <select {...props} className={cx(inputClass, props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean;
}) {
  return (
    <label className={cx('flex items-center gap-2 text-sm text-slate-700', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-blue-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <Icons.search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={cx(inputClass, 'pl-9')} />
    </div>
  );
}

// ------------------------------------------------------------------ overlays

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-xl' }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode;
  footer?: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className={cx('relative flex h-full w-full flex-col bg-white shadow-2xl', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <Icons.x />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={cx('relative w-full rounded-xl bg-white shadow-2xl', size)}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><Icons.x /></button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirm with an optional mandatory reason (reopen, reject, override...). */
export function ReasonDialog({ open, title, message, confirmLabel = 'Confirm', requireReason, variant = 'primary', onClose, onConfirm }: {
  open: boolean; title: string; message?: ReactNode; confirmLabel?: string; requireReason?: boolean | string;
  variant?: ButtonVariant; onClose: () => void; onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(''); }, [open]);
  const label = typeof requireReason === 'string' ? requireReason : 'Reason';
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={variant} loading={busy} disabled={!!requireReason && !reason.trim()}
          onClick={async () => { setBusy(true); try { await onConfirm(reason); } finally { setBusy(false); } }}>
          {confirmLabel}
        </Button>
      </>}>
      {message && <div className="mb-3 text-sm text-slate-600">{message}</div>}
      {requireReason !== undefined && (
        <Field label={label} required={!!requireReason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ feedback

export function Alert({ tone = 'blue', title, children, action }: {
  tone?: 'blue' | 'amber' | 'red' | 'green'; title?: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  const styles = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-rose-200 bg-rose-50 text-rose-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  const Icon = { blue: Icons.info, amber: Icons.alert, red: Icons.error, green: Icons.check }[tone];
  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', styles)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e: any = error;
  const fields: string[] = e?.fieldMessages ?? [];
  return (
    <Alert tone="red" title={e?.message || 'Something went wrong'}>
      {fields.length > 0 && (
        <ul className="list-inside list-disc">
          {fields.slice(0, 8).map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </Alert>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      {label}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <div className="text-base font-semibold text-slate-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type ToastItem = { id: number; tone: 'green' | 'red' | 'blue'; text: string };
let pushToast: ((t: Omit<ToastItem, 'id'>) => void) | null = null;

export const toast = {
  success: (text: string) => pushToast?.({ tone: 'green', text }),
  error: (e: unknown) => pushToast?.({ tone: 'red', text: (e as any)?.message || String(e) }),
  info: (text: string) => pushToast?.({ tone: 'blue', text }),
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { ...t, id }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 5000);
    };
    return () => { pushToast = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto rounded-lg px-4 py-3 text-sm text-white shadow-lg',
          t.tone === 'green' ? 'bg-emerald-600' : t.tone === 'red' ? 'bg-rose-600' : 'bg-blue-700')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ tables

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, align = 'left', className }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return (
    <th className={cx('whitespace-nowrap bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)}>
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className, colSpan }: {
  children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cx('whitespace-nowrap px-3 py-2.5 text-slate-700',
      align === 'right' ? 'text-right tabular-nums' : align === 'center' ? 'text-center' : 'text-left', className)}>
      {children}
    </td>
  );
}

export function Avatar({ name }: { name?: string }) {
  const initials = (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800">
      {initials}
    </span>
  );
}

export function EmployeeCell({ employee, onClick, href }: { employee: any; onClick?: () => void; href?: string }) {
  const name = employee?.name || employee?.employee_code;
  const body = (
    <span className="flex items-center gap-2.5">
      <Avatar name={name} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-blue-700">{name}</span>
        <span className="block text-xs text-slate-500">{employee?.employee_code}{employee?.department ? ` · ${employee.department}` : ''}</span>
      </span>
    </span>
  );
  if (href) return <Link href={href} className="hover:underline">{body}</Link>;
  if (onClick) return <button onClick={onClick} className="text-left hover:underline">{body}</button>;
  return body;
}

export function KeyValue({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3 text-sm', cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-4')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words font-medium text-slate-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ stepper

export function Stepper({ steps, current, onSelect }: {
  steps: { key: string; label: string; status?: string | null }[];
  current: string;
  onSelect?: (key: string) => void;
}) {
  const index = steps.findIndex((s) => s.key === current);
  return (
    <ol className="mb-6 flex items-start overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = s.status === 'completed' || i < index;
        const active = s.key === current;
        return (
          <li key={s.key} className="flex min-w-[120px] flex-1 flex-col items-start">
            <div className="flex w-full items-center">
              <button onClick={() => onSelect?.(s.key)} disabled={!onSelect}
                className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  active ? 'bg-blue-600 text-white ring-4 ring-blue-100' : done ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-white')}>
                {done && !active ? '✓' : i + 1}
              </button>
              {i < steps.length - 1 && <div className={cx('mx-2 h-0.5 flex-1', done ? 'bg-emerald-500' : 'bg-slate-200')} />}
            </div>
            <button onClick={() => onSelect?.(s.key)} disabled={!onSelect}
              className={cx('mt-2 pr-3 text-left text-xs', active ? 'font-semibold text-blue-700' : 'text-slate-600')}>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------ data hook

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Download table rows as CSV (client-side export of what is on screen). */
export function downloadCsvRows(fileName: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
