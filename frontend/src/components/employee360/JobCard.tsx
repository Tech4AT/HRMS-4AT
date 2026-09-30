'use client';

import { BriefcaseIcon } from '@/components/icons';
import { EMPLOYMENT_TYPES, STATUS_LABELS, fmtDate, type EmployeeStatus } from '@/lib/admin/orgApi';
import type { Employee360Job } from '@/lib/api/employee360';
import { Field, SectionCard } from './parts';

/** Read-only work information. Job fields are changed by HR from the
 *  directory's edit drawer, never from here. */
export function JobCard({ job }: { job: Employee360Job }) {
  const employmentType = EMPLOYMENT_TYPES.find((t) => t.value === job.employment_type)?.label ?? job.employment_type;
  const status = STATUS_LABELS[job.status as EmployeeStatus] ?? job.status;

  return (
    <SectionCard title="Work Information" icon={<BriefcaseIcon className="w-4 h-4" />}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
        <Field label="Employee code" value={job.employee_code} />
        <Field label="Work email" value={job.work_email} />
        <Field label="Status" value={status} />
        <Field label="Job title" value={job.designation_name} />
        <Field label="Department" value={job.department_name} />
        <Field label="Work location" value={job.location_name} />
        <Field label="Reporting manager" value={job.manager?.name ?? 'No manager'} />
        <Field label="Employment type" value={employmentType} />
        <Field label="Date of joining" value={job.date_of_joining ? fmtDate(job.date_of_joining) : ''} />
        <Field label="Business unit" value={job.business_unit_name} />
        <Field label="Cost centre" value={job.cost_center_name} />
        <Field label="Legal entity" value={job.legal_entity_name} />
        {job.status === 'exited' ? (
          <Field label="Last working day" value={job.date_of_exit ? fmtDate(job.date_of_exit) : ''} />
        ) : null}
      </div>
    </SectionCard>
  );
}
