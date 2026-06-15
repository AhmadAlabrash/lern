import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client using the service role key. This client has full
 * access to the database and should only ever be used on the server. It is
 * configured without session persistence to prevent accidental exposure of
 * credentials.
 */
export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase URL or service key is not set');
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}