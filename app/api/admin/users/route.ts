import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { sendSecretEmail } from '@/lib/mailer';
import { randomBytes } from 'crypto';
import { getCurrentSmsUsageMonth } from '@/lib/plans';

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

  const users = data ?? [];
  const month = getCurrentSmsUsageMonth();
  const userIds = users.map((user) => user.id);
  let usageByUser: Record<string, number> = {};

  if (userIds.length > 0) {
    const { data: usageRows } = await supabase
      .from('sms_usage')
      .select('user_id,count')
      .eq('month', month)
      .in('user_id', userIds);

    usageByUser = Object.fromEntries((usageRows || []).map((row: any) => [row.user_id, Number(row.count || 0)]));
  }

  return NextResponse.json({
    success: true,
    users: users.map((user) => ({
      ...user,
      current_sms_month: month,
      current_sms_count: usageByUser[user.id] || 0,
    })),
  });
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
    const notifySms = body.notify_sms !== undefined ? Boolean(body.notify_sms) : false;
    const bookingUrl = (body.booking_url ?? '').trim() || null;
    const whatsappNumber = (body.whatsapp_number ?? '').trim() || null;
    const smsProvider = body.sms_provider === 'future_provider' ? 'future_provider' : 'twilio';
    const plan = body.plan === 'pro' || body.plan === 'ultimate' ? body.plan : 'free';
    const sendSecretNow = body.send_secret_email === true;
    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }
    // Generate secret – 32 bytes converted to hex
    const secret = randomBytes(32).toString('hex');
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from('webhook_users').insert({
      email,
      telegram_chat_id: telegramChatId,
      secret,
      notify_email: notifyEmail,
      notify_telegram: notifyTelegram,
      notify_sms: notifySms,
      booking_url: bookingUrl,
      whatsapp_number: whatsappNumber,
      sms_provider: smsProvider,
      plan,
    }).select().single();
    if (error) {
      console.error(error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    let secretEmailSent = false;

    if (sendSecretNow) {
      try {
        await sendSecretEmail(email, secret);
        secretEmailSent = true;
      } catch (e) {
        console.error('Failed to send secret email', e);
      }
    }

    return NextResponse.json({ success: true, user: data, secretEmailSent });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}