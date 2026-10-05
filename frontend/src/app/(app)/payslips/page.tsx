'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { printPayslip } from '@/components/payroll/payslipDocument';
import { payrollApi, PayrollApiError } from '@/lib/payroll/api';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { IdCardIcon, FileTextIcon, ReceiptIcon, TrendingUpIcon, ChevronDownIcon } from '@/components/icons';

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value || '—'}</div>
    </div>
  );
}

interface IdentityDoc {
  id: number;
  document_type: string;
  document_type_display: string;
  document_number_masked: string;
  full_name: string;
  date_of_birth: string | null;
  address: string;
  gender: string;
  parent_or_guardian_name: string;
  file_url: string | null;
  verification_status: 'pending' | 'verified' | 'rejected';
  verification_status_display: string;
}

const verificationBadge: Record<IdentityDoc['verification_status'], string> = {
  verified: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
};

function DocBlock({ doc, fields }: { doc: IdentityDoc; fields: { label: string; value?: string | null }[] }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{doc.document_type_display}</span>
          <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 uppercase ${verificationBadge[doc.verification_status]}`}>
            {doc.verification_status_display}
          </span>
        </div>
        {doc.file_url ? (
          <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0">
            View file
          </a>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {fields.map((f) => (
          <Field key={f.label} label={f.label} value={f.value} />
        ))}
      </div>
    </div>
  );
}

interface Compensation {
  annual_ctc: string;
  monthly_gross: string;
  net_take_home: string;
  effective_from: string;
  revision_type: string;
  structure: { name: string };
}

interface MySummary {
  compensation: Compensation | null;
  latest_payslip: { id: string; period_label: string } | null;
  ytd: { from: string; to: string; gross: string; deductions: string; net: string; taxable: string } | null;
}

interface MyPayment {
  bank: {
    payment_method: string;
    bank_name: string;
    bank_account_number: string;
    bank_ifsc_code: string;
    bank_account_holder_name: string;
    branch_name?: string;
  } | null;
  statutory: {
    pan_number: string;
    uan_number: string;
    pf_number: string;
    esi_number: string;
    professional_tax_state: string;
    lwf_applicable: boolean;
  } | null;
  profile: {
    payment_mode: string;
    work_state: string;
    tax_regime: 'old' | 'new';
    lwf_applicable: boolean;
    pay_group: string | null;
  } | null;
}

interface LatestSlipPayload {
  period: { label: string; start: string; end: string; pay_date: string };
  working_days: string;
  lop_days: string;
}

const inr = (v?: string | number | null) =>
  v === null || v === undefined || v === '' ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const humanize = (v?: string | null) => (v ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');

const DownloadIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
  </svg>
);

interface SalarySlip {
  id: string;
  month: string;
  grossAmount: number;
  totalDeductions: number;
  netAmount: number;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
}

interface SlipComponent {
  id: string;
  componentName: string;
  componentType: 'earnings' | 'deduction' | 'tax';
  amount: number;
}

const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

function EmptyCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto">{message}</p>
    </div>
  );
}

const TABS = ['summary', 'pay', 'tax', 'expenses'] as const;
type Tab = (typeof TABS)[number];

export default function PayslipsPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const selectedTab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'summary';
  const [salaryExpanded, setSalaryExpanded] = useState(false);

  const [summary, setSummary] = useState<MySummary | null>(null);
  const [payment, setPayment] = useState<MyPayment | null>(null);
  const [identityDocs, setIdentityDocs] = useState<IdentityDoc[]>([]);
  const [latestSlip, setLatestSlip] = useState<LatestSlipPayload | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [slips, setSlips] = useState<SalarySlip[]>([]);
  const [slipsLoading, setSlipsLoading] = useState(true);
  const [slipsError, setSlipsError] = useState<string | null>(null);
  const [selectedPayslip, setSelectedPayslip] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<SlipComponent[] | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: mySummary }, { data: myPayment }] = await Promise.all([
          payrollApi.get<MySummary>('my/summary'),
          payrollApi.get<MyPayment>('my/payment'),
        ]);
        const docs = await fetchJson<IdentityDoc[]>('/api/onboarding/me/identity-documents').catch(() => []);
        const slip = mySummary.latest_payslip
          ? await payrollApi
              .get<{ payload: LatestSlipPayload }>(`my/payslips/${mySummary.latest_payslip.id}`)
              .then((r) => r.data.payload)
              .catch(() => null)
          : null;
        if (cancelled) return;
        setSummary(mySummary);
        setPayment(myPayment);
        setIdentityDocs(docs);
        setLatestSlip(slip);
      } catch (e) {
        if (cancelled) return;
        setProfileError(
          e instanceof PayrollApiError && e.status === 403
            ? "Your login isn't linked to an employee record, so there is no pay information to show."
            : e instanceof Error
              ? e.message
              : 'Failed to load your finance details',
        );
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setSlipsLoading(true);
        setSlipsError(null);
        const data = await fetchJson<SalarySlip[]>('/api/payroll/slips');
        if (cancelled) return;
        setSlips(data);
        setSelectedPayslip(data[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setSlipsError(e instanceof Error ? e.message : 'Failed to load payslips');
      } finally {
        if (!cancelled) setSlipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPayslip) {
      setBreakdown(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setBreakdownLoading(true);
        const data = await fetchJson<{ components: SlipComponent[] }>(
          `/api/payroll/slips/${selectedPayslip}/breakdown`
        );
        if (!cancelled) setBreakdown(data.components);
      } catch {
        if (!cancelled) setBreakdown(null);
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPayslip]);

  const [downloading, setDownloading] = useState(false);
  // The full payslip document, fetched from the employee's own (released-only) endpoint.
  const downloadPayslip = async (id: string) => {
    setDownloading(true);
    try {
      const { data } = await payrollApi.get<any>(`my/payslips/${id}`);
      printPayslip(data);
    } catch {
      setSlipsError('Could not download the payslip. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const currentPayslip = slips.find((p) => p.id === selectedPayslip);
  const comp = summary?.compensation ?? null;
  const bank = payment?.bank ?? null;
  const statutory = payment?.statutory ?? null;
  const profile = payment?.profile ?? null;
  const panDoc = identityDocs.find((d) => d.document_type === 'pan');
  const aadhaarDoc = identityDocs.find((d) => d.document_type === 'aadhaar');
  const taxRegime = profile ? (profile.tax_regime === 'old' ? 'Old Tax Regime' : 'New Tax Regime') : null;

  const statusBanner = profileLoading ? (
    <p className="text-sm text-gray-500">Loading your details…</p>
  ) : profileError ? (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">{profileError}</div>
  ) : null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-6">
        {/* Summary Tab */}
        {selectedTab === 'summary' && (
          <div className="space-y-5">
            {statusBanner}
            {!profileLoading && !profileError && (
              <>
                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(15,23,42,0.04)] px-5 py-5">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
                    <h2 className="text-lg font-bold text-slate-900 shrink-0">Payroll summary</h2>
                    {latestSlip ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 flex-1">
                        <Field
                          label="Last Processed Cycle"
                          value={`${latestSlip.period.label} (${fmtDate(latestSlip.period.start)} - ${fmtDate(latestSlip.period.end)})`}
                        />
                        <Field label="Working Days" value={String(Number(latestSlip.working_days))} />
                        <Field label="Loss of Pay" value={String(Number(latestSlip.lop_days))} />
                        <div>
                          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payslip</div>
                          <Link href="/payslips?tab=pay" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                            View payslip
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No payroll has been released for you yet.</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <div className="space-y-5">
                    <DashboardCard title="Payment Information" icon={<ReceiptIcon className="w-4 h-4" />}>
                      {bank ? (
                        <>
                          <div className="mb-5 pb-5 border-b border-slate-100">
                            <Field label="Payment Mode" value={humanize(profile?.payment_mode || bank.payment_method)} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-5">
                            <Field label="Bank Name" value={bank.bank_name} />
                            <Field label="Account Number" value={bank.bank_account_number} />
                            <Field label="IFSC Code" value={bank.bank_ifsc_code} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                            <Field label="Name on the Account" value={bank.bank_account_holder_name} />
                            {bank.branch_name ? <Field label="Branch" value={bank.branch_name} /> : null}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">No bank details on file. Ask HR to add your salary account.</p>
                      )}
                    </DashboardCard>

                    <DashboardCard title="Statutory Information" icon={<FileTextIcon className="w-4 h-4" />}>
                      {statutory ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <Field label="PAN" value={statutory.pan_number} />
                          <Field label="UAN" value={statutory.uan_number} />
                          <Field label="PF Number" value={statutory.pf_number} />
                          <Field label="ESI Number" value={statutory.esi_number} />
                          <Field label="Professional Tax State" value={statutory.professional_tax_state} />
                          <Field
                            label="LWF Status"
                            value={(profile?.lwf_applicable ?? statutory.lwf_applicable) ? 'Enabled' : 'Not applicable'}
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No statutory details on file yet.</p>
                      )}
                    </DashboardCard>
                  </div>

                  <DashboardCard title="Identity Information" icon={<IdCardIcon className="w-4 h-4" />}>
                    {panDoc || aadhaarDoc ? (
                      <div className="space-y-6">
                        {panDoc ? (
                          <DocBlock
                            doc={panDoc}
                            fields={[
                              { label: 'Permanent Account Number (PAN)', value: panDoc.document_number_masked },
                              { label: 'Name', value: panDoc.full_name },
                              { label: 'Date of Birth', value: panDoc.date_of_birth ? fmtDate(panDoc.date_of_birth) : null },
                              { label: "Parent's Name", value: panDoc.parent_or_guardian_name },
                            ]}
                          />
                        ) : null}
                        {aadhaarDoc ? (
                          <div className={panDoc ? 'pt-6 border-t border-slate-100' : ''}>
                            <DocBlock
                              doc={aadhaarDoc}
                              fields={[
                                { label: 'Aadhaar Number', value: aadhaarDoc.document_number_masked },
                                { label: 'Name', value: aadhaarDoc.full_name },
                                { label: 'Date of Birth', value: aadhaarDoc.date_of_birth ? fmtDate(aadhaarDoc.date_of_birth) : null },
                                { label: 'Gender', value: aadhaarDoc.gender },
                                { label: 'Address', value: aadhaarDoc.address },
                              ]}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">
                        You haven&apos;t submitted a PAN or Aadhaar yet. Add them under My Onboarding.
                      </p>
                    )}
                  </DashboardCard>
                </div>
              </>
            )}
          </div>
        )}

        {/* My Pay Tab */}
        {selectedTab === 'pay' && (
          <>
            {statusBanner && <div className="mb-5">{statusBanner}</div>}
            {comp ? (
              <>
                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <CalendarIcon />
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Compensation</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900">{inr(comp.annual_ctc)}</div>
                    <div className="text-xs text-slate-500 mt-1">Per annum</div>
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
                        <CalendarIcon />
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Gross / Month</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900">{inr(comp.monthly_gross)}</div>
                    <div className="text-xs text-slate-500 mt-1">{profile?.pay_group ?? 'Monthly pay cycle'}</div>
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                        <CalendarIcon />
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Take-home / Month</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900">{inr(comp.net_take_home)}</div>
                    <div className="text-xs text-slate-500 mt-1">Estimated, before variable pay</div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-5">
                  <h2 className="text-base font-bold text-slate-900 mb-4">Salary Timeline</h2>

                  <div className="flex gap-3">
                    <span className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                      <TrendingUpIcon className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900">{humanize(comp.revision_type) || 'Salary'}</h3>
                        <span className="text-xs text-slate-500">Effective {fmtDate(comp.effective_from)}</span>
                        <span className="text-[10px] font-bold bg-teal-100 text-teal-700 rounded px-1.5 py-0.5 uppercase tracking-wide">
                          Current
                        </span>
                      </div>

                      <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setSalaryExpanded((v) => !v)}
                          className="w-full px-4 py-3 flex items-center gap-4 text-left"
                          aria-expanded={salaryExpanded}
                        >
                          <ChevronDownIcon
                            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${salaryExpanded ? '' : '-rotate-90'}`}
                          />
                          <div>
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Annual CTC</div>
                            <div className="text-sm font-semibold text-emerald-600">{inr(comp.annual_ctc)}</div>
                          </div>
                          <span className="ml-auto text-xs font-semibold text-purple-600">
                            {salaryExpanded ? 'Hide details' : 'View details'}
                          </span>
                        </button>

                        {salaryExpanded && (
                          <div className="border-t border-gray-200 px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <Field label="Salary Structure" value={comp.structure.name} />
                            <Field label="Gross / Month" value={inr(comp.monthly_gross)} />
                            <Field label="Effective From" value={fmtDate(comp.effective_from)} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : !profileLoading && !profileError ? (
              <div className="mb-5">
                <EmptyCard title="No compensation on file" message="HR hasn't assigned your salary structure yet." />
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1">
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-base font-bold text-slate-900">Payslips</h2>
                  </div>

                  {slipsLoading && (
                    <p className="text-sm text-gray-500 px-4 py-3">Loading...</p>
                  )}
                  {slipsError && !slipsLoading && (
                    <p className="text-sm text-red-600 px-4 py-3">{slipsError}</p>
                  )}
                  {!slipsLoading && !slipsError && slips.length === 0 && (
                    <p className="text-sm text-gray-500 px-4 py-3">No payslips yet.</p>
                  )}

                  {!slipsLoading && !slipsError && slips.length > 0 && (
                    <div className="divide-y divide-gray-200">
                      {slips.map((payslip) => (
                        <button
                          key={payslip.id}
                          onClick={() => setSelectedPayslip(payslip.id)}
                          className={`w-full text-left px-4 py-3 transition-all ${
                            selectedPayslip === payslip.id
                              ? 'bg-purple-50 border-l-4 border-purple-600'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="text-sm font-semibold text-slate-900">{monthLabel(payslip.month)}</div>
                          <div className="text-xs text-gray-600 mt-1">₹{payslip.netAmount.toLocaleString()}</div>
                          <div className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                            {payslip.status}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {currentPayslip && (
                <div className="col-span-2">
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-base font-bold text-slate-900">Payslip</h2>
                          <p className="text-xs text-gray-500 mt-0.5">{monthLabel(currentPayslip.month)}</p>
                        </div>
                        <a href={`/payslips/view/${currentPayslip.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                          View full payslip →
                        </a>
                      </div>
                    </div>

                    <div className="p-5">
                      {breakdownLoading && (
                        <p className="text-sm text-gray-500 mb-4">Loading breakdown...</p>
                      )}

                      {!breakdownLoading && (
                        <div className="grid grid-cols-2 gap-6 mb-5">
                          <div>
                            <h3 className="text-base font-bold text-slate-900 mb-3">Earnings</h3>
                            <div className="space-y-2 text-sm">
                              {(breakdown ?? [])
                                .filter((c) => c.componentType === 'earnings')
                                .map((c) => (
                                  <div key={c.id} className="flex justify-between">
                                    <span className="text-gray-600">{c.componentName}</span>
                                    <span className="font-medium text-gray-900">₹{c.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                  </div>
                                ))}
                              <div className="pt-2 border-t border-gray-200 flex justify-between">
                                <span className="font-semibold text-gray-900">Gross</span>
                                <span className="font-semibold text-emerald-600">₹{currentPayslip.grossAmount.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>

                          <div>
                            <h3 className="text-base font-bold text-slate-900 mb-3">Deductions</h3>
                            <div className="space-y-2 text-sm">
                              {(breakdown ?? [])
                                .filter((c) => c.componentType === 'deduction' || c.componentType === 'tax')
                                .map((c) => (
                                  <div key={c.id} className="flex justify-between">
                                    <span className="text-gray-600">{c.componentName}</span>
                                    <span className="font-medium text-gray-900">₹{c.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                  </div>
                                ))}
                              <div className="pt-2 border-t border-gray-200 flex justify-between">
                                <span className="font-semibold text-gray-900">Total Deductions</span>
                                <span className="font-semibold text-rose-600">-₹{currentPayslip.totalDeductions.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200 p-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-xs text-gray-600">Net Pay</p>
                            <p className="text-xl font-bold text-purple-600 mt-0.5">₹{currentPayslip.netAmount.toLocaleString()}</p>
                          </div>
                          <button
                            onClick={() => downloadPayslip(currentPayslip.id)}
                            disabled={downloading}
                            className="flex items-center gap-2 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                          >
                            <DownloadIcon /> {downloading ? 'Preparing…' : 'Download payslip'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Manage Tax Tab */}
        {selectedTab === 'tax' && (
          <div className="space-y-5">
            {statusBanner}
            {!profileLoading && !profileError && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-slate-900">Year-to-date earnings</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {taxRegime ?? 'Tax regime not set'}
                    {summary?.ytd ? ` · ${fmtDate(summary.ytd.from)} – ${fmtDate(summary.ytd.to)}` : ''}
                  </p>
                </div>
                {summary?.ytd ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
                    <Field label="Gross Earnings" value={inr(summary.ytd.gross)} />
                    <Field label="Taxable Earnings" value={inr(summary.ytd.taxable)} />
                    <Field label="Deductions" value={inr(summary.ytd.deductions)} />
                    <Field label="Net Pay" value={inr(summary.ytd.net)} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No payslips released for you this financial year yet.</p>
                )}
              </div>
            )}
            <EmptyCard
              title="Tax declarations and forms"
              message="Investment declarations, proof submission and Form 16 aren't available in HRMS yet."
            />
          </div>
        )}

        {/* Expenses & Travel Tab */}
        {selectedTab === 'expenses' && (
          <EmptyCard
            title="Expenses & Travel"
            message="Expense claims and travel requests aren't available in HRMS yet."
          />
        )}
      </div>
    </div>
  );
}
