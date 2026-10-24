import "server-only";

import { db } from "@/db/client";
import { loadOrFetchSteamProfiles } from "@/lib/steam-profiles";
import { captureException, traceOperation } from "@/lib/observability/server";
import type { AdminDemoReviewMap } from "./types";

/** Display enrichment only, called after all canonical validation transactions finish. */
export async function enrichAdminDemoReviewPersonas(reviews: AdminDemoReviewMap[]): Promise<void> {
  try {
    const profiles = await traceOperation("admin.match.persona", { scope: "admin", operation: "match.persona", stage: "provider", provider: "steam" },
      () => loadOrFetchSteamProfiles(db, reviews.flatMap(review => review.participants.map(participant => participant.observedSteam64))));
    for (const review of reviews) for (const participant of review.participants) {
      const profile = profiles.get(participant.observedSteam64);
      if (profile) participant.observedSteamProfile = { personaName: profile.personaName, profileUrl: profile.profileUrl, avatarUrl: profile.avatarUrl };
    }
  } catch (error) {
    // Canonical identity/preflight is outside this catch. Cache read/upsert failure
    // must not hide actionable blockers or make the core workbench unavailable.
    captureException("admin.match.persona_unavailable", error, {
      scope: "admin", operation: "match.persona", errorClass: "dependency", retryable: true,
    });
  }
}
