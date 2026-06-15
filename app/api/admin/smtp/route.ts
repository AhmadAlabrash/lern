import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getSmtpConfigStatus } from '@/lib/mailer';

export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    smtp: getSmtpConfigStatus(),
    note:
      'On Vercel, environment variables cannot be edited safely from the app at runtime. Update SMTP values in Vercel Project Settings → Environment Variables, then redeploy.',
  });
}
