import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { clearLogs, getRecentLogs } from '@/lib/monitoring';

export async function GET() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const logs = await getRecentLogs(100);
    return NextResponse.json({ success: true, logs });
  } catch (error) {
    console.error('Failed to load logs:', error);
    return NextResponse.json({ success: false, error: 'Failed to load logs' }, { status: 500 });
  }
}

export async function DELETE() {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await clearLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to clear logs:', error);
    return NextResponse.json({ success: false, error: 'Failed to clear logs' }, { status: 500 });
  }
}
