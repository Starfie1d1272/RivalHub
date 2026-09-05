import "server-only";

import { createClient } from "@supabase/supabase-js";
import { providerFetch } from "@/lib/observability/fetch";

/** Service-role client. This module is server-only because the key bypasses RLS. */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: providerFetch("supabase") },
    },
  );
}

/** Server-side anonymous client for public Auth flows such as sign-up. */
export function createPublicAuthClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: providerFetch("supabase") },
    },
  );
}
