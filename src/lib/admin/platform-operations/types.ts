import { formatCSTShortDate, getCSTDateKey, getCSTDayStart } from "@/lib/utils/date";

export const PLATFORM_OPERATIONS_GROWTH_DAYS = 7;

export type PlatformOperationsGrowthEventKind =
  | "user_created"
  | "education_approval"
  | "team_created"
  | "membership_started";

export interface PlatformOperationsGrowthEvent {
  kind: PlatformOperationsGrowthEventKind;
  entityId: string;
  occurredAt: Date | string;
}

export interface PlatformOperationsGrowthDay {
  date: string;
  label: string;
  newUsers: number;
  newEducationApprovals: number;
  newTeams: number;
  newMemberships: number;
}

export interface PlatformOperationsTeamSizeBucket {
  key: string;
  label: string;
  count: number;
}

export interface PlatformOperationsTeamSummary {
  activeTeamCount: number;
  totalMemberCount: number;
  medianTeamSize: number | null;
  sizeDistribution: PlatformOperationsTeamSizeBucket[];
}

export interface PlatformOperationsPopulation {
  activeUsers: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
  certifiedUsers: number;
  activeTeams: number;
}

export interface PlatformOperationsPlayerPool {
  currentTeamUsers: number;
  certifiedWithoutTeam: number;
  teamWithoutCertification: number;
  publicPlayerLft: number;
  publicTeamRecruiting: number;
}

export interface PlatformOperationsOverview {
  asOf: string;
  population: PlatformOperationsPopulation;
  playerPool: PlatformOperationsPlayerPool;
  teams: PlatformOperationsTeamSummary;
  growth: PlatformOperationsGrowthDay[];
}

export interface PlatformOperationsCurrentMembershipRow {
  teamId: string;
  userId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const TEAM_SIZE_BUCKETS: ReadonlyArray<{ key: string; label: string; matches: (size: number) => boolean }> = [
  { key: "0", label: "0 人", matches: (size) => size === 0 },
  { key: "1", label: "1 人", matches: (size) => size === 1 },
  { key: "2", label: "2 人", matches: (size) => size === 2 },
  { key: "3", label: "3 人", matches: (size) => size === 3 },
  { key: "4", label: "4 人", matches: (size) => size === 4 },
  { key: "5", label: "5 人", matches: (size) => size === 5 },
  { key: "6", label: "6 人", matches: (size) => size === 6 },
  { key: "7", label: "7 人", matches: (size) => size === 7 },
  { key: "8", label: "8 人", matches: (size) => size === 8 },
  { key: "9", label: "9 人", matches: (size) => size === 9 },
  { key: "10-plus", label: "10+ 人", matches: (size) => size >= 10 },
];

export function getPlatformOperationsGrowthStart(
  now: Date,
  dayCount = PLATFORM_OPERATIONS_GROWTH_DAYS,
): Date {
  return new Date(getCSTDayStart(now).getTime() - Math.max(1, dayCount) * DAY_MS + DAY_MS);
}

export function buildTeamSizeDistribution(teamSizes: readonly number[]): PlatformOperationsTeamSizeBucket[] {
  return TEAM_SIZE_BUCKETS.map(({ key, label, matches }) => ({
    key,
    label,
    count: teamSizes.filter((size) => matches(Math.max(0, Math.trunc(size)))).length,
  }));
}

export function summarizeTeamSizes(
  rows: readonly PlatformOperationsCurrentMembershipRow[],
): PlatformOperationsTeamSummary {
  const membersByTeam = new Map<string, Set<string>>();
  for (const row of rows) {
    const members = membersByTeam.get(row.teamId) ?? new Set<string>();
    if (row.userId) members.add(row.userId);
    membersByTeam.set(row.teamId, members);
  }

  const teamSizes = [...membersByTeam.values()].map((members) => members.size);
  const sortedSizes = [...teamSizes].sort((left, right) => left - right);
  const middle = Math.floor(sortedSizes.length / 2);
  const medianTeamSize = sortedSizes.length === 0
    ? null
    : sortedSizes.length % 2 === 1
      ? sortedSizes[middle]!
      : ((sortedSizes[middle - 1] ?? 0) + (sortedSizes[middle] ?? 0)) / 2;

  return {
    activeTeamCount: teamSizes.length,
    totalMemberCount: teamSizes.reduce((total, size) => total + size, 0),
    medianTeamSize,
    sizeDistribution: buildTeamSizeDistribution(teamSizes),
  };
}

export function summarizePlayerPool(input: {
  currentMemberships: readonly PlatformOperationsCurrentMembershipRow[];
  certifiedUserIds: readonly string[];
  publicPlayerLft: number;
  publicTeamRecruiting: number;
}): PlatformOperationsPlayerPool {
  const currentTeamUserIds = new Set(
    input.currentMemberships.flatMap((row) => row.userId ? [row.userId] : []),
  );
  const certifiedUserIds = new Set(input.certifiedUserIds);

  return {
    currentTeamUsers: currentTeamUserIds.size,
    certifiedWithoutTeam: [...certifiedUserIds].filter((userId) => !currentTeamUserIds.has(userId)).length,
    teamWithoutCertification: [...currentTeamUserIds].filter((userId) => !certifiedUserIds.has(userId)).length,
    publicPlayerLft: input.publicPlayerLft,
    publicTeamRecruiting: input.publicTeamRecruiting,
  };
}

export function buildPlatformOperationsGrowth(
  now: Date,
  events: readonly PlatformOperationsGrowthEvent[],
  dayCount = PLATFORM_OPERATIONS_GROWTH_DAYS,
): PlatformOperationsGrowthDay[] {
  const count = Math.max(1, Math.trunc(dayCount));
  const start = getPlatformOperationsGrowthStart(now, count);
  const days = Array.from({ length: count }, (_, index) => {
    const dayStart = new Date(start.getTime() + index * DAY_MS);
    return {
      date: getCSTDateKey(dayStart),
      label: formatCSTShortDate(dayStart),
      newUsers: 0,
      newEducationApprovals: 0,
      newTeams: 0,
      newMemberships: 0,
    };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  const educationUsersByDate = new Map<string, Set<string>>();

  for (const event of events) {
    const day = byDate.get(getCSTDateKey(event.occurredAt));
    if (!day) continue;
    switch (event.kind) {
      case "user_created": day.newUsers += 1; break;
      case "education_approval": {
        const users = educationUsersByDate.get(day.date) ?? new Set<string>();
        if (!users.has(event.entityId)) {
          users.add(event.entityId);
          day.newEducationApprovals += 1;
        }
        educationUsersByDate.set(day.date, users);
        break;
      }
      case "team_created": day.newTeams += 1; break;
      case "membership_started": day.newMemberships += 1; break;
    }
  }

  return days;
}
