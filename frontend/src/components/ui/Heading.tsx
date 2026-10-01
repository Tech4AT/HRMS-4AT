import type { ReactNode } from 'react';

/** Canonical section/subsection headings, visually constant across the app.
 * Margins (mb-3, mt-6, ...) pass through via className; the font-size/weight/
 * color triple is fixed here so every section title matches. */

interface HeadingProps {
  children: ReactNode;
  className?: string;
}

export function SectionHeading({ children, className }: HeadingProps) {
  return (
    <h2 className={`text-base font-bold text-slate-900${className ? ` ${className}` : ''}`}>
      {children}
    </h2>
  );
}

export function SubsectionHeading({ children, className }: HeadingProps) {
  return (
    <h3 className={`text-sm font-bold text-slate-900${className ? ` ${className}` : ''}`}>
      {children}
    </h3>
  );
}
