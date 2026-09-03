import type { SeasonStatus } from "@/types/season";

export interface HeaderSeason {
  slug: string;
  name: string;
  status: SeasonStatus;
  registrationOpensAt: Date | null;
  registrationOpenedAt: Date | null;
  registrationClosesAt: Date | null;
}

export interface HeaderSession {
  userId: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}
