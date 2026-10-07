import React from "react";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
export function TeamIdentityLinks({ ids, names, links, seasonSlug, fallback = "—" }: {
  ids: readonly string[]; names: ReadonlyMap<string, string>; links?: Record<string, string>; seasonSlug?: string; fallback?: string | null;
}) {
  if (!ids.length) return fallback ?? "—";
  return <span>{ids.map((id, index) => <React.Fragment key={id}>{index > 0 && " / "}<TeamProfileLink entryId={id} seasonSlug={seasonSlug} profileHref={links?.[id]}>{names.get(id) ?? (ids.length === 1 ? fallback : "队伍") ?? "队伍"}</TeamProfileLink></React.Fragment>)}</span>;
}
