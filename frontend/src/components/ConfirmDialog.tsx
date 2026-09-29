'use client';

/** Generic "are you sure?" modal for destructive actions (deleting a shift,
 *  a leave type, ...). Confirm is styled as a destructive (red) action since
 *  every current caller is a delete; add a `confirmClassName` prop if a
 *  future caller needs a non-destructive confirmation instead. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  confirming = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-5">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500 mt-2">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button
            onClick={onCancel}
            className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {confirming ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
