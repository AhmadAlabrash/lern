import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { createServiceSupabaseClient } from '@/lib/supabase';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = params;
  if (!id) {
    return NextResponse.json({ success: false, error: 'Missing user ID' }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const email = body.email !== undefined ? (body.email ?? '').trim() : undefined;
    const telegramChatId = body.telegram_chat_id !== undefined ? (body.telegram_chat_id ?? '').trim() || null : undefined;
    const notifyEmail = body.notify_email !== undefined ? Boolean(body.notify_email) : undefined;
    const notifyTelegram = body.notify_telegram !== undefined ? Boolean(body.notify_telegram) : undefined;
    if (
      email === undefined &&
      telegramChatId === undefined &&
      notifyEmail === undefined &&
      notifyTelegram === undefined
    ) {
      return NextResponse.json({ success: false, error: 'No changes provided' }, { status: 400 });
    }
    const updateFields: any = {};
    if (email !== undefined) updateFields.email = email;
    if (telegramChatId !== undefined) updateFields.telegram_chat_id = telegramChatId;
    if (notifyEmail !== undefined) updateFields.notify_email = notifyEmail;
    if (notifyTelegram !== undefined) updateFields.notify_telegram = notifyTelegram;
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.from('webhook_users').update(updateFields).eq('id', id).select().single();
    if (error) {
      console.error(error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, user: data });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = params;
  if (!id) {
    return NextResponse.json({ success: false, error: 'Missing user ID' }, { status: 400 });
  }
  try {
    const supabase = createServiceSupabaseClient();
    const { error } = await supabase.from('webhook_users').delete().eq('id', id);
    if (error) {
      console.error(error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}