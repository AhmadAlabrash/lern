import { redirect } from 'next/navigation';

/**
 * Root page – redirect to the admin login. You can customise this to show a
 * landing page or documentation.
 */
export default function Home() {
  redirect('/admin/login');
}