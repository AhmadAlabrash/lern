import { NextResponse } from 'next/server';
import { setAdminCookie, computeAdminSignature } from '@/lib/auth';

/**
 * Admin login endpoint. Accepts JSON with `email` and `password`, verifies
 * them against environment variables and sets a signed HTTP‑only cookie to
 * authenticate the admin. Responds with JSON indicating success or failure.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { email, password } = body as Record<string, string>;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Missing credentials' }, { status: 400 });
    }
    if (email !== adminEmail || password !== adminPassword) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }
    // Set cookie
    setAdminCookie();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}