'use client';

import { DashboardCard } from './DashboardCard';
import { NotImplemented } from './NotImplemented';

/** There is no timesheet backend yet, so nothing here is shown as data. */
export function TimesheetOverview() {
  return (
    <DashboardCard title="Timesheet Overview">
      <NotImplemented what="Timesheet tracking" />
    </DashboardCard>
  );
}
