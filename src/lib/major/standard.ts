import type { Season } from "@/db/schema/seasons";
import { capabilitiesFromSeason, checkStandardMajorCapabilities, type SeasonCapabilityRow } from "@/lib/competition/definition";
import { AppError, ErrorCode } from "@/lib/errors";

type StandardMajorSeason = Pick<Season, "competitionTemplate"> & SeasonCapabilityRow;

export interface StandardMajorDefinition {
  capabilities: ReturnType<typeof capabilitiesFromSeason>;
  entrantCapacity: number;
}

/** Canonical persisted-row gate for the managed standard Major runtime. */
export function getStandardMajorDefinition(
  season: StandardMajorSeason,
  messages: { notMajor?: string; notStandard?: string } = {},
): StandardMajorDefinition {
  if (season.competitionTemplate !== "major") {
    throw new AppError(
      ErrorCode.SEASON_CAPABILITY_DISABLED,
      messages.notMajor ?? "当前赛事不是 Major 赛事模板，不能使用标准 Major 运行时。",
    );
  }
  const capabilities = capabilitiesFromSeason(season);
  const result = checkStandardMajorCapabilities(capabilities);
  if (!result.isStandardMajor) {
    throw new AppError(
      ErrorCode.SEASON_CAPABILITY_DISABLED,
      messages.notStandard ?? "当前赛事不是标准 Major，不能使用标准 Major 运行时。",
    );
  }
  return { capabilities, entrantCapacity: result.entrantCapacity };
}
