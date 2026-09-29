import { ReactNode } from 'react';

export const TH = 'px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase whitespace-nowrap';
export const SELECT =
  'text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-purple-400 disabled:bg-gray-50 disabled:text-gray-400';
export const BTN_PRIMARY =
  'px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_OUTLINE =
  'px-4 py-2 text-sm font-medium text-purple-600 bg-white border border-purple-200 rounded-lg hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed';

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-gray-500">{children}</p>;
}

export function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}
