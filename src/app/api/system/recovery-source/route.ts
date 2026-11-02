import { assertReleaseIdentity } from "@/lib/release/identity";
import { readInstanceRecoverySource } from "@/lib/runtime/instance-recovery-source";

// The project URL is already public runtime configuration. Never return DB
// credentials, raw connection URLs, or any other environment values.
export function GET(): Response {
  try {
    if (process.env.RIVALHUB_PRESENCE_MODE !== "single-process") throw new Error("Independent instance required.");
    const release = assertReleaseIdentity({ releaseTag: process.env.RIVALHUB_RELEASE_TAG, releaseCommit: process.env.RIVALHUB_RELEASE_COMMIT });
    const source = readInstanceRecoverySource(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.DATABASE_URL);
    return Response.json({ ...release, ...source }, { headers: { "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate" } });
  } catch {
    return Response.json({ error: "Instance recovery source unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
