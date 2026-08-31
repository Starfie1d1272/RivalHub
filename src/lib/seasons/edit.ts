import { z } from "zod";
import { createCompetitionTemplate, type CompetitionTemplate } from "@/lib/competition/templates";
import { AppError, ErrorCode } from "@/lib/errors";
import {
  normalizeAffiliationRules,
  normalizeRegistrationConfig,
  normalizeTeamRegistrationConfig,
  type InstitutionAffiliationRule,
  type RegistrationConfig,
  type StagePlan,
  type TeamRegistrationConfig,
} from "@/types/season";
import type { seasons } from "@/db/schema";

const stageConfigSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  type: z.enum(["round_robin", "double_elim", "single_elim", "swiss"]),
  teamCount: z.number().int().min(2).max(128),
  advanceTiers: z.array(z.object({
    placement: z.string().min(1),
    count: z.number().int().min(1),
    targetRound: z.string().optional(),
  })),
  groupCount: z.number().int().min(1).optional(),
  matchFormat: z.enum(["bo1", "bo3", "bo5"]).optional(),
  finalFormat: z.enum(["bo3", "bo5"]).optional(),
  hasThirdPlaceMatch: z.boolean().optional(),
  seeds: z.array(z.number().int().positive()).optional(),
  entrySeeds: z.number().int().min(0).optional(),
});

const stagePlanSchema = z.array(stageConfigSchema);

const registrationConfigSchema = z.object({
  allowedPlayerTypes: z.array(z.enum(["enrolled", "graduated", "external"])).min(1),
  rankThreshold: z.object({
    currentMin: z.string().min(1).nullable(),
    peakMin: z.string().min(1).nullable(),
  }),
  maxPerPosition: z.number().int().min(1).max(50),
  screenshotCount: z.number().int().min(1).max(5),
  maxTotal: z.number().int().min(1).max(1000),
  mapPool: z.array(z.string().min(1).regex(/^de_[a-z0-9_]+$/)).min(3).max(12),
});

const seasonFormBaseSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "请填写赛季名称"),
  slug: z.string().min(1, "请填写 slug").regex(/^[a-z0-9][a-z0-9-]*$/, "slug 只能使用小写字母、数字和连字符"),
  kind: z.string().min(1, "请填写赛事类型"),
  template: z.enum(["rivals", "major", "custom"]).optional(),
  status: z.enum(["draft", "registration", "voting", "drafting", "playing", "finished", "archived"]).optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "主题色需为 #RRGGBB 格式").nullable(),
  startAt: z.string().nullable(),
  registrationDeadline: z.string().nullable(),
  endAt: z.string().nullable(),
  registrationMode: z.enum(["solo", "team"]),
  hasCaptainVoting: z.boolean(),
  hasDraft: z.boolean(),
  minTeamSize: z.number().int().min(1).max(20),
  maxTeamSize: z.number().int().min(1).max(20),
  starterCount: z.number().int().min(1).max(20),
  positions: z.array(z.string().min(1)).min(1),
  stagePlan: stagePlanSchema,
  registrationConfig: registrationConfigSchema,
  teamRegistrationConfig: z.object({
    allowExternal: z.boolean(),
    graduateCountsAsHome: z.boolean(),
    minHomeMembers: z.number().int().min(0),
    minEnrolledMembers: z.number().int().min(0),
    maxExternalMembers: z.number().int().min(0),
    requirePositions: z.boolean(),
    maxPerPositionPerTeam: z.number().int().min(1),
    captainCanKick: z.boolean(),
    captainCanTransfer: z.boolean(),
    lockAfterRegistration: z.boolean(),
    requireUniqueTeamName: z.boolean(),
    requireTeamLogo: z.boolean(),
    requireCompetitiveProfile: z.boolean().optional(),
    competitiveProfile: z.object({
      platform: z.string().min(1).max(64),
      currentSeasonKey: z.string().max(128),
      previousSeasonKey: z.string().max(128),
      rankOrder: z.array(z.string().min(1).max(64)).max(64),
    }).optional(),
  }).optional(),
  affiliationRules: z.array(z.object({
    institutionCode: z.string().min(1),
    eligibleAcademicStatuses: z.array(z.enum(["enrolled", "graduated"])).min(1),
    minRosterMembers: z.number().int().min(0),
    minStartingMembers: z.number().int().min(0),
  })).optional(),
});

export const seasonFormSchema = withSeasonRefinements(seasonFormBaseSchema);
export const seasonUpdateFormSchema = withSeasonRefinements(seasonFormBaseSchema.extend({ id: z.string().uuid() }));

export type SeasonFormInput = z.input<typeof seasonFormSchema>;

export function withSeasonRefinements<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((data) => data.starterCount <= data.maxTeamSize, {
      path: ["starterCount"],
      message: "首发人数不能超过队伍上限",
    })
    .refine((data) => data.minTeamSize <= data.maxTeamSize, {
      path: ["minTeamSize"],
      message: "最小人数不能超过最大人数",
    })
    .refine(
      (data) => {
        if (!data.startAt || !data.registrationDeadline) return true;
        return new Date(data.registrationDeadline) > new Date(data.startAt);
      },
      {
        path: ["registrationDeadline"],
        message: "报名截止时间必须晚于报名开始时间",
      },
    );
}

export function assertUniqueStageKeys(stagePlan: StagePlan): void {
  const keys = new Set<string>();
  for (const stage of stagePlan) {
    if (keys.has(stage.key)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `stage key 重复: ${stage.key}`);
    }
    keys.add(stage.key);
  }
}

/**
 * Built-in draft seasons re-canonicalize their fixed semantics from the
 * template factory on every save, so tampered stage plans / capability inputs
 * can never redefine a draft Major or Rivals — including the fixed team
 * roster (Major 5–9/5, Rivals 7/7/5). Administrators overlay only positions,
 * map pool and general metadata. Custom drafts keep their own input — the
 * persisted template identity is not re-inferred from shape.
 */
export function resolveCompetitionDefinition(data: z.infer<typeof seasonFormSchema>, applyTemplate: boolean): Omit<typeof data, "template"> {
  const { template, ...input } = data;
  if (!template || !applyTemplate || template === "custom") return input;
  const builtIn = createCompetitionTemplate(template as CompetitionTemplate);
  return {
    ...input,
    kind: template === "major" ? "Major" : "Rivals",
    registrationMode: builtIn.registrationMode,
    hasCaptainVoting: builtIn.hasCaptainVoting,
    hasDraft: builtIn.hasDraft,
    stagePlan: builtIn.stagePlan,
    teamRegistrationConfig: builtIn.teamRegistrationConfig,
    affiliationRules: builtIn.affiliationRules,
    minTeamSize: builtIn.minTeamSize,
    maxTeamSize: builtIn.maxTeamSize,
    starterCount: builtIn.starterCount,
    positions: input.positions,
    registrationConfig: {
      ...builtIn.registrationConfig,
      mapPool: input.registrationConfig.mapPool,
    },
  };
}

export type SeasonRow = typeof seasons.$inferSelect;
type SeasonUpdateSet = Partial<Omit<typeof seasons.$inferInsert, "id">>;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Plans one season edit against the persisted row. The persisted
 * competitionTemplate is the identity owner: client input may switch it only
 * while the season is still a draft, and non-draft edits carry only metadata
 * (name, theme, dates) so a published Major's frozen competitiveProfile
 * context can never be rewritten by the template factory or client payload.
 */
export function planSeasonUpdate(existing: SeasonRow, parsed: z.infer<typeof seasonFormSchema>): { template: CompetitionTemplate; set: SeasonUpdateSet } {
  const template = parsed.template ?? existing.competitionTemplate;
  if (template !== existing.competitionTemplate && existing.status !== "draft") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可切换赛事体系");
  }
  const data = resolveCompetitionDefinition(parsed, existing.status === "draft" && template !== "custom");
  assertUniqueStageKeys(data.stagePlan as StagePlan);
  const normalizedTeamConfig = normalizeTeamRegistrationConfig(
    (data.teamRegistrationConfig ?? {}) as TeamRegistrationConfig,
  );

  const metadata: SeasonUpdateSet = {
    name: data.name,
    kind: data.kind,
    competitionTemplate: template,
    themeColor: data.themeColor,
    startAt: data.startAt,
    registrationDeadline: data.registrationDeadline,
    endAt: data.endAt,
    updatedAt: new Date(),
  };

  if (existing.status !== "draft") {
    const coreChanged =
      existing.registrationMode !== data.registrationMode ||
      existing.hasCaptainVoting !== data.hasCaptainVoting ||
      existing.hasDraft !== data.hasDraft ||
      existing.maxTeamSize !== data.maxTeamSize ||
      existing.minTeamSize !== data.minTeamSize ||
      existing.starterCount !== data.starterCount ||
      !sameJson(existing.positions, data.positions) ||
      !sameJson(existing.stagePlan, data.stagePlan) ||
      !sameJson(normalizeTeamRegistrationConfig(existing.teamRegistrationConfig), normalizedTeamConfig) ||
      !sameJson(normalizeAffiliationRules(existing.affiliationRules), normalizeAffiliationRules(data.affiliationRules as InstitutionAffiliationRule[] | undefined));
    if (coreChanged) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可修改核心赛季配置");
    }
    return { template, set: metadata };
  }

  return {
    template,
    set: {
      ...metadata,
      registrationMode: data.registrationMode,
      hasCaptainVoting: data.hasCaptainVoting,
      hasDraft: data.hasDraft,
      minTeamSize: data.minTeamSize,
      maxTeamSize: data.maxTeamSize,
      starterCount: data.starterCount,
      positions: data.positions,
      stagePlan: data.stagePlan as StagePlan,
      registrationConfig: normalizeRegistrationConfig(data.registrationConfig as RegistrationConfig),
      teamRegistrationConfig: normalizedTeamConfig,
      affiliationRules: normalizeAffiliationRules(data.affiliationRules as InstitutionAffiliationRule[] | undefined),
    },
  };
}

export function planSeasonCreate(parsed: z.infer<typeof seasonFormSchema>): { template: CompetitionTemplate; set: typeof seasons.$inferInsert } {
  const template = parsed.template ?? "custom";
  const data = resolveCompetitionDefinition(parsed, true);
  assertUniqueStageKeys(data.stagePlan as StagePlan);
  return {
    template,
    set: {
      slug: data.slug,
      name: data.name,
      kind: data.kind,
      competitionTemplate: template,
      status: "draft",
      themeColor: data.themeColor,
      registrationMode: data.registrationMode,
      hasCaptainVoting: data.hasCaptainVoting,
      hasDraft: data.hasDraft,
      minTeamSize: data.minTeamSize,
      maxTeamSize: data.maxTeamSize,
      starterCount: data.starterCount,
      positions: data.positions,
      stagePlan: data.stagePlan as StagePlan,
      registrationConfig: normalizeRegistrationConfig(data.registrationConfig as RegistrationConfig),
      teamRegistrationConfig: normalizeTeamRegistrationConfig(
        (data.teamRegistrationConfig ?? {}) as TeamRegistrationConfig,
      ),
      affiliationRules: normalizeAffiliationRules(data.affiliationRules as InstitutionAffiliationRule[] | undefined),
    },
  };
}
