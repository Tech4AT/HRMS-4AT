'use client';

import { useEffect, useState } from 'react';
import { payrollApi } from './api';

export interface PayrollMeta {
  component_types: Option[];
  categories: Option[];
  calculation_types: Option[];
  rounding: Option[];
  statutory_codes: Option[];
  input_types: Option[];
  revision_types: Option[];
  payroll_statuses: Option[];
  payment_modes: Option[];
  proration_bases: Option[];
  output_kinds: Option[];
  legal_entities: { value: number; label: string }[];
  permissions: string[];
  employee_id: number | null;
  config_reader: boolean;
  approver_candidates?: Record<'finance_review' | 'final_approval', { value: number; label: string }[]>;
}

export interface Option {
  value: string;
  label: string;
}

let cache: Promise<PayrollMeta> | null = null;

/** Choice lists + the caller's payroll permission codes (for UI gating only;
 *  the backend enforces every permission). */
export function usePayrollMeta() {
  const [meta, setMeta] = useState<PayrollMeta | null>(null);
  useEffect(() => {
    cache = cache ?? payrollApi.get<PayrollMeta>('meta').then((r) => r.data);
    cache.then(setMeta).catch(() => {
      cache = null;
    });
  }, []);
  const can = (code: string) => !!meta?.permissions.includes(code);
  return { meta, can };
}

export function resetPayrollMeta() {
  cache = null;
}

export const PAYROLL_STAFF_PERMISSIONS = [
  'payroll.process', 'payroll.manage', 'payroll.write', 'payroll.review', 'payroll.approve',
  'payroll.finalize', 'payroll.release', 'payroll.audit',
];
