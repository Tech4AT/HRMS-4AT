import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

/** Component breakdown of one of the caller's own released payslips. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/payroll/my/payslips/${id}/`);
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    if (status < 200 || status >= 300 || !body?.success) {
      return NextResponse.json(body ?? { success: false, error: { message: 'Failed to load payslip' } }, {
        status: status || 502,
      });
    }
    const payload = body.data.payload ?? {};
    const components = [
      ...(payload.earnings ?? []).map((line: any) => ({ ...line, componentType: 'earnings' })),
      ...(payload.deductions ?? []).map((line: any) => ({
        ...line,
        componentType: line.code === 'TDS' ? 'tax' : 'deduction',
      })),
    ].map((line: any) => ({
      id: `${line.code}`,
      componentName: line.name,
      componentType: line.componentType,
      amount: Number(line.amount),
    }));
    const resp = NextResponse.json({ success: true, data: { components, payslipId: id } });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/payroll/slips/[id]/breakdown] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load payslip' } }, { status: 500 });
  }
}
