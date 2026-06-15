import { NextResponse } from 'next/server';
import { clearAdminCookie } from '@/lib/auth';

/**
 * Admin logout endpoint. Clears the admin session cookie. The frontend
 * should call this to log out the admin.
 */
export async function POST() {
  try {
    clearAdminCookie();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}