import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getSettingsMap, upsertSettings } from '@/lib/settings';

export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await getSettingsMap();

  return NextResponse.json({ success: true, settings });
}

export async function PATCH(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const settings = body.settings || {};

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid settings body' }, { status: 400 });
    }

    await upsertSettings(settings);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  }
}
