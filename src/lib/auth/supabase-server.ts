import "server-only";

import { requireSupabaseOrigin, runtimePublicValue } from "@/lib/runtime/public-config";


import { requireSupabasePublicKey, requireSupabaseSecretKey } from "@/lib/runtime/supabase-keys";
import { createClient } from "@supabase/supabase-js";
import { assertPreviewAuthEnvironment } from "@/lib/runtime/preview";

/** Privileged Supabase client. This module is server-only because its key bypasses RLS. */
export function createServiceClient(options: { fetch?: typeof fetch } = {}) {
  assertPreviewAuthEnvironment();
  const url = requireSupabaseOrigin(runtimePublicValue("NEXT_PUBLIC_SUPABASE_URL"));
  return createClient(
    url,
    requireSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY, url),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: options.fetch ?? fetch },
    },
  );
}

/** Server-side anonymous client for public Auth flows such as sign-up. */
export function createPublicAuthClient() {
  assertPreviewAuthEnvironment();
  const url = requireSupabaseOrigin(runtimePublicValue("NEXT_PUBLIC_SUPABASE_URL"));
  return createClient(
    url,
    requireSupabasePublicKey(runtimePublicValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), url),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch },
    },
  );
}
