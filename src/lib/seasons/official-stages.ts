import type { StageConfig, StagePlan } from "@/types/season";

/** A read directory, never a replacement for a StageRun/qualification rule owner. */
export interface OfficialStage {
  key: string;
  name: string;
  source: "main" | "qualification" | "historical";
  config: StageConfig | null;
  qualification: QualificationStageFact | null;
}

export interface QualificationStageFact {
  format: "direct_bo3" | "short_swiss_2w2l";
  playInEntryCount: number;
  qualifierCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

export function buildOfficialStageDirectory(
  mainPlan: StagePlan,
  qualification: QualificationStageFact | null = null,
  officialMatchStageKeys: readonly string[] = [],
): OfficialStage[] {
  const stages: OfficialStage[] = mainPlan.map((config) => ({ key: config.key, name: config.name, source: "main", config, qualification: null }));
  if (qualification || officialMatchStageKeys.includes("play-in")) {
    // Qualification identity takes precedence over an accidental mutable plan alias.
    const alias = stages.findIndex((stage) => stage.key === "play-in");
    if (alias >= 0) stages.splice(alias, 1);
    stages.unshift({ key: "play-in", name: "Play-in", source: "qualification", config: null, qualification });
  }
  const keys = new Set(stages.map((stage) => stage.key));
  for (const key of [...new Set(officialMatchStageKeys)].sort()) {
    if (!keys.has(key)) {
      stages.push({ key, name: key, source: "historical", config: null, qualification: null });
      keys.add(key);
    }
  }
  return stages;
}

/** Unknown filters must never silently expand the requested statistical corpus. */
export function isOfficialStageKey(stages: readonly Pick<OfficialStage, "key">[], key: string): boolean {
  return stages.some((stage) => stage.key === key);
}
