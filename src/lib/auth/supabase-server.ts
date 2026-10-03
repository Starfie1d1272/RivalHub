import "server-only";

import { requireSupabasePublicKey, requireSupabaseSecretKey } from "@/lib/runtime/supabase-keys";
import { createClient } from "@supabase/supabase-js";
import { providerFetch } from "@/lib/observability/fetch";
import { assertPreviewAuthEnvironment } from "@/lib/runtime/preview";

/** Privileged Supabase client. This module is server-only because its key bypasses RLS. */
export function createServiceClient() {
  assertPreviewAuthEnvironment();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    requireSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY),
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
  assertPreviewAuthEnvironment();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    requireSupabasePublicKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: providerFetch("supabase") },
    },
  );
}
