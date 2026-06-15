import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { sendSmtpTestEmail } from '@/lib/mailer';

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email ?? '').trim();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    await sendSmtpTestEmail(email);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('SMTP test failed:', error);

    return NextResponse.json(
      { success: false, error: 'Failed to send SMTP test email' },
      { status: 500 }
    );
  }
}
