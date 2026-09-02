import { z } from "zod";
import { createCompetitionTemplate, type CompetitionTemplate } from "@/lib/competition/templates";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseCSTInput } from "@/lib/utils/date";
import {
  normalizeAffiliationRules,
  normalizeRegistrationConfig,
  normalizeTeamRegistrationConfig,
  type InstitutionAffiliationRule,
  type CompetitiveFallbackConversion,
  type RegistrationConfig,
  type StagePlan,
  type TeamRegistrationConfig,
  type SeasonStatus,
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
  registrationOpensAt: z.string().nullable(),
  registrationClosesAt: z.string().nullable(),
  rosterChangeClosesAt: z.string().nullable(),
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
      evidencePolicy: z.object({
        historicalWeight: z.literal(50),
        referenceSeasonKey: z.string().min(1).max(128),
        referenceSeasonWeight: z.literal(20),
        recentSeasonKeys: z.array(z.string().min(1).max(128)).min(1).max(8),
        recentSeasonWeight: z.literal(30),
      }).optional(),
      fallbackConversion: z.object({
        sourcePlatform: z.literal("fivee"),
        // A draft can deliberately retain an incomplete operator mapping. It
        // becomes usable only when registration freeze validates every actual
        // evidence slot; empty placeholders are never persisted.
        version: z.string().max(128),
        seasonKeyMap: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
        rankMap: z.record(z.string().min(1).max(64), z.string().min(1).max(64)),
      }).optional(),
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
// Keep planner input tied to the concrete object schema. The refinement helper
// intentionally accepts a generic Zod schema, so inferring from the refined
// value would otherwise erase the fields to `any`.
type ParsedSeasonForm = z.infer<typeof seasonFormBaseSchema>;

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
        if (!data.registrationOpensAt || !data.registrationClosesAt) return true;
        return new Date(data.registrationClosesAt) > new Date(data.registrationOpensAt);
      },
      {
        path: ["registrationClosesAt"],
        message: "报名截止时间必须晚于报名开始时间",
      },
    )
    .refine(
      (data) => {
        if (!data.registrationClosesAt || !data.rosterChangeClosesAt) return true;
        return new Date(data.rosterChangeClosesAt) >= new Date(data.registrationClosesAt);
      },
      {
        path: ["rosterChangeClosesAt"],
        message: "名单调整截止时间不能早于报名截止时间",
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
export function resolveCompetitionDefinition(data: ParsedSeasonForm, applyTemplate: boolean): Omit<ParsedSeasonForm, "template"> {
  const { template, ...input } = data;
  if (!template || !applyTemplate || template === "custom") return input;
  const builtIn = createCompetitionTemplate(template as CompetitionTemplate);
  // Built-in competition semantics remain template-owned. Major's reviewed
  // 5E equivalence map is the sole event-operator overlay and is frozen when
  // registration opens; no other client team setting can escape canonicalization.
  const fallbackConversion = template === "major"
    ? input.teamRegistrationConfig?.competitiveProfile?.fallbackConversion
    : undefined;
  return {
    ...input,
    kind: template === "major" ? "Major" : "Rivals",
    registrationMode: builtIn.registrationMode,
    hasCaptainVoting: builtIn.hasCaptainVoting,
    hasDraft: builtIn.hasDraft,
    stagePlan: builtIn.stagePlan,
    teamRegistrationConfig: {
      ...builtIn.teamRegistrationConfig,
      competitiveProfile: builtIn.teamRegistrationConfig.competitiveProfile
        ? { ...builtIn.teamRegistrationConfig.competitiveProfile, fallbackConversion }
        : undefined,
    },
    affiliationRules: builtIn.affiliationRules.map((rule) => ({
      ...rule,
      eligibleAcademicStatuses: [...rule.eligibleAcademicStatuses],
    })),
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

export type SeasonEditPhase =
  | "draft"
  | "published_preopen"
  | "registration_opened"
  | "playing"
  | "terminal";

export interface SeasonEditCapabilities {
  phase: SeasonEditPhase;
  canEditSlug: boolean;
  canEditTemplate: boolean;
  canEditPublicRules: boolean;
  canEditRegistrationOpenSchedule: boolean;
  canEditRegistrationDeadlines: boolean;
  canEditFallbackConversion: boolean;
  canEditMetadata: boolean;
}

export interface SeasonEditLifecycleInput {
  status: SeasonStatus;
  registrationOpenedAt: Date | null;
  competitionTemplate: CompetitionTemplate;
}

/**
 * The single lifecycle-derived capability contract shared by the server
 * planner and the admin editor. `registrationOpenedAt` is the immutable
 * transition fact; a scheduled opening time is only editable before it.
 */
export function getSeasonEditCapabilities({
  status,
  registrationOpenedAt,
  competitionTemplate,
}: SeasonEditLifecycleInput): SeasonEditCapabilities {
  const phase: SeasonEditPhase = status === "draft"
    ? "draft"
    : status === "playing"
      ? "playing"
      : status === "finished" || status === "archived"
        ? "terminal"
        : status === "registration" && !registrationOpenedAt
          ? "published_preopen"
          : "registration_opened";
  const isDraft = phase === "draft";

  return {
    phase,
    canEditSlug: isDraft,
    canEditTemplate: isDraft,
    canEditPublicRules: isDraft,
    canEditRegistrationOpenSchedule: !registrationOpenedAt,
    canEditRegistrationDeadlines: phase === "draft" || phase === "published_preopen" || phase === "registration_opened",
    canEditFallbackConversion: isDraft || (phase === "published_preopen" && competitionTemplate === "major"),
    canEditMetadata: true,
  };
}

type SeasonDateInput = Pick<ParsedSeasonForm, "registrationOpensAt" | "registrationClosesAt" | "rosterChangeClosesAt" | "endAt">;

function toDbDates(data: SeasonDateInput): Pick<typeof seasons.$inferInsert, "registrationOpensAt" | "registrationClosesAt" | "rosterChangeClosesAt" | "endAt"> {
  return {
    registrationOpensAt: parseCSTInput(data.registrationOpensAt),
    registrationClosesAt: parseCSTInput(data.registrationClosesAt),
    rosterChangeClosesAt: parseCSTInput(data.rosterChangeClosesAt),
    endAt: parseCSTInput(data.endAt),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined): boolean {
  if (!left || !right) return left === right;
  return left.getTime() === right.getTime();
}

function withoutFallback(config: TeamRegistrationConfig): TeamRegistrationConfig {
  const result = { ...config };
  if (config.competitiveProfile) {
    const profile = { ...config.competitiveProfile };
    delete profile.fallbackConversion;
    result.competitiveProfile = profile;
  }
  return result;
}

function withFallback(config: TeamRegistrationConfig, fallback: CompetitiveFallbackConversion | undefined): TeamRegistrationConfig {
  if (!config.competitiveProfile) return config;
  const competitiveProfile = { ...config.competitiveProfile };
  if (fallback) competitiveProfile.fallbackConversion = fallback;
  else delete competitiveProfile.fallbackConversion;
  return { ...config, competitiveProfile };
}

/**
 * Plans one season edit against the persisted row. The capability contract is
 * the only lifecycle authority: draft edits are canonicalized by the selected
 * template, while published edits reject every unauthorized delta instead of
 * silently dropping it. The temporary Major fallback exception only returns a
 * team config whose sole changed leaf is competitiveProfile.fallbackConversion.
 */
export function planSeasonUpdate(existing: SeasonRow, parsed: ParsedSeasonForm): { template: CompetitionTemplate; set: SeasonUpdateSet } {
  const template = parsed.template ?? existing.competitionTemplate ?? "custom";
  const capabilities = getSeasonEditCapabilities({
    status: existing.status,
    registrationOpenedAt: existing.registrationOpenedAt,
    competitionTemplate: existing.competitionTemplate,
  });
  if (!capabilities.canEditTemplate && template !== existing.competitionTemplate) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可切换赛事体系");
  }
  if (!capabilities.canEditSlug && parsed.slug !== existing.slug) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "已发布赛事不能修改 slug");
  }
  const data = resolveCompetitionDefinition(parsed, capabilities.canEditTemplate && template !== "custom");
  assertUniqueStageKeys(data.stagePlan as StagePlan);
  const submittedDates = toDbDates(data);
  if (!capabilities.canEditRegistrationOpenSchedule && !sameDate(existing.registrationOpensAt, submittedDates.registrationOpensAt)) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "报名实际开放后不能修改报名开放时间");
  }
  if (!capabilities.canEditRegistrationDeadlines && (
    !sameDate(existing.registrationClosesAt, submittedDates.registrationClosesAt) ||
    !sameDate(existing.rosterChangeClosesAt, submittedDates.rosterChangeClosesAt)
  )) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "比赛开始后不能修改报名运营截止时间");
  }
  const normalizedTeamConfig = normalizeTeamRegistrationConfig(
    (data.teamRegistrationConfig ?? {}) as TeamRegistrationConfig,
  );
  const existingTeamConfig = normalizeTeamRegistrationConfig(existing.teamRegistrationConfig);
  const registrationConfig = normalizeRegistrationConfig(data.registrationConfig as RegistrationConfig);
  const affiliationRules = normalizeAffiliationRules(data.affiliationRules as InstitutionAffiliationRule[] | undefined);
  const teamConfigChangedWithoutFallback = !sameJson(withoutFallback(existingTeamConfig), withoutFallback(normalizedTeamConfig));
  const fallbackChanged = !sameJson(
    existingTeamConfig.competitiveProfile?.fallbackConversion,
    normalizedTeamConfig.competitiveProfile?.fallbackConversion,
  );
  const publicRulesChanged =
    existing.registrationMode !== data.registrationMode ||
    existing.hasCaptainVoting !== data.hasCaptainVoting ||
    existing.hasDraft !== data.hasDraft ||
    existing.maxTeamSize !== data.maxTeamSize ||
    existing.minTeamSize !== data.minTeamSize ||
    existing.starterCount !== data.starterCount ||
    !sameJson(existing.positions, data.positions) ||
    !sameJson(existing.stagePlan, data.stagePlan) ||
    !sameJson(normalizeRegistrationConfig(existing.registrationConfig), registrationConfig) ||
    teamConfigChangedWithoutFallback ||
    !sameJson(normalizeAffiliationRules(existing.affiliationRules), affiliationRules);

  if (!capabilities.canEditPublicRules && (publicRulesChanged || (fallbackChanged && !capabilities.canEditFallbackConversion))) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可修改核心赛季配置");
  }

  const metadata: SeasonUpdateSet = {
    slug: capabilities.canEditSlug ? data.slug : existing.slug,
    name: data.name,
    kind: data.kind,
    competitionTemplate: template,
    themeColor: data.themeColor,
    registrationOpensAt: capabilities.canEditRegistrationOpenSchedule ? submittedDates.registrationOpensAt : existing.registrationOpensAt,
    registrationClosesAt: capabilities.canEditRegistrationDeadlines ? submittedDates.registrationClosesAt : existing.registrationClosesAt,
    rosterChangeClosesAt: capabilities.canEditRegistrationDeadlines ? submittedDates.rosterChangeClosesAt : existing.rosterChangeClosesAt,
    endAt: submittedDates.endAt,
    updatedAt: new Date(),
  };

  if (!capabilities.canEditPublicRules) {
    return {
      template,
      set: fallbackChanged
        ? { ...metadata, teamRegistrationConfig: withFallback(existingTeamConfig, normalizedTeamConfig.competitiveProfile?.fallbackConversion) }
        : metadata,
    };
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
      registrationConfig,
      teamRegistrationConfig: normalizedTeamConfig,
      affiliationRules,
    },
  };
}

export function planSeasonCreate(parsed: ParsedSeasonForm): { template: CompetitionTemplate; set: typeof seasons.$inferInsert } {
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
      ...toDbDates(data),
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
