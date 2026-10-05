/** Placeholder body for a widget whose backend does not exist yet - says so
 *  plainly instead of showing sample numbers. */
export function NotImplemented({ what }: { what: string }) {
  return (
    <p className="text-sm text-slate-400">
      {what} is yet to be implemented.
    </p>
  );
}
