import type { User } from './auth-context';

/**
 * Whether the signed-in user may see the "To Approve" inbox.
 *
 * Two independent signals (either one suffices):
 * - management scope: the backend resolves `{kind:'team'|'org'}` for anyone
 *   holding a broader-than-self grant (manager with direct reports, HR admin,
 *   …) and `{kind:'self'}` for an ordinary employee
 *   (backend `core/scope.py::resolve_management_scope`).
 * - approve-scoped permission: any `<module>.approve` code (leave.approve,
 *   attendance.approve, expense.approve, …) or the `approvals.manage`
 *   oversight capability.
 */
export function canSeeToApprove(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.scope && user.scope.kind !== 'self') return true;
  const perms = user.permissions ?? [];
  return perms.some((p) => p === 'approvals.manage' || p.endsWith('.approve'));
}
