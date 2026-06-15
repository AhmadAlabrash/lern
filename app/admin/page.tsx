import { isAdminAuthenticated } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AdminDashboard from '@/components/AdminDashboard';

/**
 * Admin dashboard page. Performs a server‑side authentication check and
 * renders the dashboard UI if the admin is authenticated. Otherwise
 * redirects to the login page.
 */
export default function AdminPage() {
  if (!isAdminAuthenticated()) {
    redirect('/admin/login');
  }
  return <AdminDashboard />;
}