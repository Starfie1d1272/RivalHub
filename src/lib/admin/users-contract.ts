export const ADMIN_USERS_PAGE_SIZE = 50;
export const ADMIN_USERS_DEFAULTS = {
  q: "",
  filter: "all",
  education: "all",
  team: "all",
  activity: "all",
} as const;

export type AdminUserParticipationFilter = "all" | "participated" | "none";
export type AdminUserEducationFilter = "all" | "approved" | "unverified";
export type AdminUserTeamFilter = "all" | "in_team" | "none";
export type AdminUserActivityFilter = "all" | "24h" | "7d" | "30d";
