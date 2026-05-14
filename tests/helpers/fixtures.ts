import { randomUUID } from "crypto";

export function createFakeSeason(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    name: "Test Season",
    slug: "test-season",
    status: "registration",
    kind: "联赛",
    hasDraft: true,
    hasCaptainVoting: true,
    registrationMode: "solo",
    positions: ["opener", "closer", "anchor"],
    registrationConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createFakeUser(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    email: `user-${Date.now()}@test.com`,
    role: "user" as const,
    adminSeasonIds: [],
    authId: randomUUID(),
    steam64: null,
    qq: null,
    studentId: null,
    perfectName: null,
    steamName: null,
    steamProfileUrl: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createFakeRegistration(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    seasonId: randomUUID(),
    playerType: "normal",
    primaryPosition: "opener",
    secondaryPosition: "closer",
    status: "pending",
    peakRank: "巅峰S",
    peakRankSeason: "S1",
    peakRating: 20000,
    peakWe: 0.6,
    currentSeasonPeakRank: "魔王",
    currentRating: 18000,
    currentWe: 0.55,
    screenshotUrls: [],
    mapPreferences: null,
    gameplayStyle: null,
    competitionHistory: null,
    highlightVideoUrl: null,
    willingToBeCaptain: false,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createFakeTeam(overrides?: Record<string, unknown>) {
  return {
    id: randomUUID(),
    seasonId: randomUUID(),
    name: "Test Team",
    captainRegistrationId: randomUUID(),
    draftOrder: 1,
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
