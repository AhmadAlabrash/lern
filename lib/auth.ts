import crypto from 'crypto';
import { cookies } from 'next/headers';

/**
 * Compute a deterministic signature for the admin using the email and password
 * from environment variables and a secret. This signature is stored in
 * the admin session cookie to verify subsequent requests.
 */
export function computeAdminSignature() {
  const email = process.env.ADMIN_EMAIL ?? '';
  const password = process.env.ADMIN_PASSWORD ?? '';
  const secret = process.env.SESSION_SECRET ?? '';
  return crypto
    .createHmac('sha256', secret)
    .update(`${email}:${password}`)
    .digest('hex');
}

/**
 * Set the admin session cookie with the computed signature. Cookies set
 * via this function are HTTP‑only and scoped to the entire site.
 */
export function setAdminCookie() {
  const signature = computeAdminSignature();
  const cookieStore = cookies();
  cookieStore.set({
    name: 'admin_session',
    value: signature,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // one week
  });
}

/**
 * Clear the admin session cookie, effectively logging the admin out.
 */
export function clearAdminCookie() {
  const cookieStore = cookies();
  cookieStore.set({
    name: 'admin_session',
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Check whether the incoming request has a valid admin session cookie.
 * If the cookie does not match the expected signature, returns false.
 */
export function isAdminAuthenticated(): boolean {
  const cookieStore = cookies();
  const session = cookieStore.get('admin_session');
  if (!session || !session.value) return false;
  return session.value === computeAdminSignature();
}