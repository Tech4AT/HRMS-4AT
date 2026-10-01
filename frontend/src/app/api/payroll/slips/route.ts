import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

/** The caller's own released payslips, shaped for the My Finances page. */
export async function GET(req: NextRequest) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, '/payroll/my/payslips/');
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    if (status < 200 || status >= 300 || !body?.success) {
      return NextResponse.json(body ?? { success: false, error: { message: 'Failed to load payslips' } }, {
        status: status || 502,
      });
    }
    const slips = (body.data as any[]).map((slip) => ({
      id: slip.id,
      month: String(slip.period_label ? slip.released_at?.slice(0, 7) : ''),
      periodLabel: slip.period_label,
      grossAmount: 0,
      totalDeductions: 0,
      netAmount: Number(slip.net_pay),
      status: slip.status === 'released' ? 'paid' : 'approved',
    }));
    // Month is the payroll period (YYYY-MM), not the release date.
    const detailed = await Promise.all(
      slips.map(async (slip) => {
        const detail = await proxyToBackend(req, `/payroll/my/payslips/${slip.id}/`);
        const payload = detail.body?.data?.payload;
        if (payload) {
          slip.month = String(payload.period?.start ?? '').slice(0, 7);
          slip.grossAmount = Number(payload.gross);
          slip.totalDeductions = Number(payload.total_deductions);
        }
        return slip;
      }),
    );
    const resp = NextResponse.json({ success: true, data: detailed });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/payroll/slips] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load payslips' } }, { status: 500 });
  }
}
