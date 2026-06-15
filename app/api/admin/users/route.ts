import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { sendSecretEmail } from '@/lib/mailer';
import { randomBytes } from 'crypto';

/**
 * GET /api/admin/users – return a list of all webhook users. Only available to
 * authenticated admins.
 */
export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from('webhook_users').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, users: data ?? [] });
}

/**
 * POST /api/admin/users – create a new webhook user. Requires `email` and
 * optional `telegram_chat_id` in the JSON body. Generates a secret and
 * emails it to the user. Only available to authenticated admins.
 */
export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const email = (body.email ?? '').trim();
    const telegramChatId = (body.telegram_chat_id ?? '').trim() || null;
    const notifyEmail = body.notify_email !== undefined ? Boolean(body.notify_email) : true;
    const notifyTelegram = body.notify_telegram !== undefined ? Boolean(body.notify_telegram) : true;
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }
    // Generate secret – 32 bytes converted to hex
    const secret = randomBytes(32).toString('hex');
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from('webhook_users').insert({ email, telegram_chat_id: telegramChatId, secret, notify_email: notifyEmail, notify_telegram: notifyTelegram }).select().single();
    if (error) {
      console.error(error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    // Send secret by email
    try {
      await sendSecretEmail(email, secret);
    } catch (e) {
      console.error('Failed to send secret email', e);
      // Do not fail the request if email sending fails. Still return the user.
    }
    return NextResponse.json({ success: true, user: data });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}