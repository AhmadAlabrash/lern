import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { sendSecretEmail } from '@/lib/mailer';

/**
 * POST /api/admin/users/:id/send-secret-email – resend the user's secret by email.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = params;
  if (!id) {
    return NextResponse.json({ success: false, error: 'Missing user ID' }, { status: 400 });
  }
  try {
    const supabase = createServiceSupabaseClient();
    const { data: user, error } = await supabase.from('webhook_users').select('*').eq('id', id).single();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    try {
      await sendSecretEmail(user.email, user.secret);
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error(err);
      return NextResponse.json({ success: false, error: 'Failed to send email' }, { status: 500 });
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}