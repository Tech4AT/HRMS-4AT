import { CheckCircleIcon, ClockIcon, XCircleIcon, AlertTriangleIcon } from '@/components/icons';

/** The five states every document-ish thing in this module can be in.
 * Status is never color-only (accessibility) — each renders an icon and a
 * text label too, not just a tinted background. */
export type DocumentDisplayStatus = 'verified' | 'pending_verification' | 'pending_upload' | 'rejected' | 'expired';

const CONFIG: Record<DocumentDisplayStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  verified: { label: 'Verified', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircleIcon },
  pending_verification: { label: 'Pending Verification', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: ClockIcon },
  pending_upload: { label: 'Pending Upload', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangleIcon },
  rejected: { label: 'Rejected', className: 'bg-red-50 text-red-700 border-red-200', icon: XCircleIcon },
  expired: { label: 'Expired', className: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangleIcon },
};

export function DocumentStatusBadge({ status, className = '' }: { status: DocumentDisplayStatus; className?: string }) {
  const cfg = CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className} ${className}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
