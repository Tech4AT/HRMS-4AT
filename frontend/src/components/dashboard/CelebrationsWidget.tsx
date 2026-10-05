'use client';

import { DashboardCard } from './DashboardCard';
import { NotImplemented } from './NotImplemented';

/** Birthdays and work anniversaries have no backend feed yet (date of birth is a
 *  restricted personal field), so nothing here is shown as data. */
export function CelebrationsWidget() {
  return (
    <DashboardCard title="Celebrations">
      <NotImplemented what="Birthdays and work anniversaries" />
    </DashboardCard>
  );
}
