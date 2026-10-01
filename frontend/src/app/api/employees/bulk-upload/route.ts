import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.cookies.get('accessToken')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
    }

    // Read the body as blob
    const body = await req.blob();

    // Forward directly to backend
    const response = await fetch('http://localhost:8000/api/v1/employees/bulk-upload/', {
      method: 'POST',
      body: body,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': req.headers.get('content-type') || 'application/octet-stream',
      },
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { success: false, error: 'Invalid response from server' };
    }

    return NextResponse.json(data, { status: response.status });
  } catch (err) {
    console.error('[api/employees/bulk-upload] error:', err);
    return NextResponse.json(
      { success: false, error: { message: String(err) } },
      { status: 500 }
    );
  }
}
