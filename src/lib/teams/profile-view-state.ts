import { safeStatsReturn } from "@/lib/stats/return-context";

export type TeamProfileSection = "overview" | "matches" | "stats" | "roster";

export function parseTeamProfileSection(value: string | string[] | undefined): TeamProfileSection {
  return value === "matches" || value === "stats" || value === "roster" ? value : "overview";
}

/** Relative to the current canonical team route; team/event identity never changes. */
export function teamProfileSectionHref(section: TeamProfileSection, fromStats?: string | null) {
  const params = new URLSearchParams();
  if (section !== "overview") params.set("section", section);
  const from = safeStatsReturn(fromStats);
  if (from) params.set("fromStats", from);
  return `?${params}`;
}
