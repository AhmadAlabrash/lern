import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getSmtpConfigStatus } from '@/lib/mailer';

export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    smtp: await getSmtpConfigStatus(),
    note:
      'SMTP can be configured globally in the Routing & API tab. If a dashboard value is empty, the app falls back to environment variables.',
  });
}
