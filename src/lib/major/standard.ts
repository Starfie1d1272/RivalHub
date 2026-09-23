import type { Season } from "@/db/schema/seasons";
import { capabilitiesFromSeason, checkStandardMajorCapabilities, resolveManagedMajorProfile, type SeasonCapabilityRow } from "@/lib/competition/definition";
import { AppError, ErrorCode } from "@/lib/errors";
import { materializeMajorStagePlan, parseMajorRunSnapshot } from "@/lib/major/run-snapshot";

type StandardMajorSeason = Pick<Season, "competitionTemplate"> & SeasonCapabilityRow;

export interface StandardMajorDefinition {
  capabilities: ReturnType<typeof capabilitiesFromSeason>;
  entrantCapacity: number;
  managedProfile: NonNullable<ReturnType<typeof checkStandardMajorCapabilities>["managedProfile"]>;
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
  if (!result.managedProfile) throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前 Major 没有可运行的 managed profile。");
  return { capabilities, entrantCapacity: result.entrantCapacity, managedProfile: result.managedProfile };
}

/** Resolve result capacity only from the immutable playoff StageRun snapshot. */
export function getManagedMajorProfileFromRunSnapshot(ruleSnapshot: unknown, stageKey: string) {
  const snapshot = parseMajorRunSnapshot(ruleSnapshot, stageKey);
  const stagePlan = materializeMajorStagePlan(snapshot);
  const profile = resolveManagedMajorProfile({ stagePlan });
  if (!profile) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式结果关联的冻结 StageRun 不包含受支持的 Major profile。");
  return profile;
}
