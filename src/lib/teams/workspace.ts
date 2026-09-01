import type { Team } from "@/db/schema";

/**
 * Public team DTO for the client team workspace. Server pages must pass teams
 * through this read model; DB rows (creator/lifecycle metadata, timestamps)
 * never cross the Client Component boundary implicitly.
 */
export interface LongLivedTeamDto {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  recruiting: boolean;
  captainUserId: string;
}

export function toLongLivedTeamDto(team: Pick<Team, keyof LongLivedTeamDto>): LongLivedTeamDto {
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    logoUrl: team.logoUrl,
    description: team.description,
    recruiting: team.recruiting,
    captainUserId: team.captainUserId,
  };
}
