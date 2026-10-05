import { CheckCircleIcon, AlertTriangleIcon } from '@/components/icons';
import { formatDate } from '@/lib/api/onboarding';

export type ExpiryState = 'valid' | 'expiring_soon' | 'expired';

const SOON_THRESHOLD_DAYS = 30;

export function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function expiryState(expiryDate: string, isExpired: boolean): ExpiryState {
  if (isExpired) return 'expired';
  return daysUntil(expiryDate) <= SOON_THRESHOLD_DAYS ? 'expiring_soon' : 'valid';
}

/** Small inline expiry readout ("✓ Valid" / "⚠ Expires in 24 days" /
 * "⚠ Expired on 12 Aug 2026") — used anywhere a document with an
 * `expiryDate` is shown (identity documents today; any future document
 * type with an expiry works the same way). Renders nothing when there's no
 * expiry date to report. */
export function ExpiryIndicator({ expiryDate, isExpired }: { expiryDate: string | null; isExpired: boolean }) {
  if (!expiryDate) return null;
  const state = expiryState(expiryDate, isExpired);

  if (state === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
        <AlertTriangleIcon className="w-3.5 h-3.5" />
        Expired on {formatDate(expiryDate)}
      </span>
    );
  }
  if (state === 'expiring_soon') {
    const days = daysUntil(expiryDate);
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
        <AlertTriangleIcon className="w-3.5 h-3.5" />
        Expires in {days} day{days === 1 ? '' : 's'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
      <CheckCircleIcon className="w-3.5 h-3.5" />
      Valid
    </span>
  );
}
