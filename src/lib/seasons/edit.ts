import { resolveCompetitiveSourceSelection } from "@/lib/competitive/source-selection";
import { isReservedSeasonSlug } from "./slug";
import { z } from "zod";
import { createCompetitionTemplate, type CompetitionTemplate } from "@/lib/competition/templates";
import { checkStandardMajorCapabilities } from "@/lib/competition/definition";
import { competitiveProfileSchema, qualificationPolicySchema, qualificationPolicyV2Schema } from "@/lib/competition/qualification-policy";
import { decodeSeasonRules, encodeDraftSeasonRules, seasonRuleExtensionsSchema } from "@/lib/seasons/rules";
import { AppError, ErrorCode } from "@/lib/errors";
import { parseCSTInput } from "@/lib/utils/date";
import {
  normalizeAffiliationRules,
  normalizeRegistrationConfig,
  normalizeTeamRegistrationConfig,
  teamRegistrationConfigForWrite,
} from "@/lib/seasons/compatibility";
import {
  type InstitutionAffiliationRule,
  type CompetitiveFallbackConversion,
  type RegistrationConfig,
  type StagePlan,
  type PlayerType,
  type TeamRegistrationConfig,
  type StoredTeamRegistrationConfig,
  type StoredTeamRegistrationConfigV2,
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
  id: z.guid().optional(),
  name: z.string().min(1, "请填写赛季名称"),
  slug: z.string().min(1, "请填写 slug").regex(/^[a-z0-9][a-z0-9-]*$/, "slug 只能使用小写字母、数字和连字符").refine((slug) => !isReservedSeasonSlug(slug), "slug 与平台保留路由冲突"),
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
  hasCommunityAwards: z.boolean(),
  minTeamSize: z.number().int().min(1).max(20),
  maxTeamSize: z.number().int().min(1).max(20),
  starterCount: z.number().int().min(1).max(20),
  positions: z.array(z.string().min(1)).min(1),
  stagePlan: stagePlanSchema,
  registrationConfig: registrationConfigSchema,
  teamRegistrationConfig: z.union([z.object({
    qualificationPolicy: qualificationPolicySchema.optional(),
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
    competitiveProfile: competitiveProfileSchema.optional(),
  }), seasonRuleExtensionsSchema.extend({
    qualificationPolicy: qualificationPolicyV2Schema,
    requirePositions: z.boolean(),
    maxPerPositionPerTeam: z.number().int().min(0),
    requireUniqueTeamName: z.boolean(),
    requireTeamLogo: z.boolean(),
  }).strict()]).optional(),
  affiliationRules: z.array(z.object({
    institutionCode: z.string().min(1),
    eligibleAcademicStatuses: z.array(z.enum(["enrolled", "graduated"])).min(1).readonly(),
    minRosterMembers: z.number().int().min(0),
    minStartingMembers: z.number().int().min(0),
  })).optional(),
});

export const seasonFormSchema = withSeasonRefinements(seasonFormBaseSchema);
const seasonUpdateFormBaseSchema = seasonFormBaseSchema.extend({ id: z.guid() });

/**
 * Validates the shape of an update request before the persisted row is read.
 * Cross-field date rules are applied later to the capability-projected dates,
 * because a locked date is not client-owned input.
 */
export const seasonUpdatePayloadSchema = withStructuralSeasonRefinements(seasonUpdateFormBaseSchema);
export const seasonUpdateFormSchema = withSeasonRefinements(seasonUpdateFormBaseSchema);

type SeasonFormSchemaInput = z.input<typeof seasonFormSchema>;
type SeasonFormData = Omit<SeasonFormSchemaInput, "registrationConfig" | "teamRegistrationConfig" | "affiliationRules"> & {
  registrationConfig: Omit<SeasonFormSchemaInput["registrationConfig"], "allowedPlayerTypes"> & {
    allowedPlayerTypes: readonly PlayerType[];
  };
  teamRegistrationConfig?: StoredTeamRegistrationConfig;
  affiliationRules?: readonly InstitutionAffiliationRule[];
};
export type SeasonFormInput = SeasonFormData;
// Keep planner input tied to the concrete object schema. The refinement helper
// intentionally accepts a generic Zod schema, so inferring from the refined
// value would otherwise erase the fields to `any`.
type ParsedSeasonForm = SeasonFormData;

type SeasonRefinementFields = {
  starterCount: number;
  maxTeamSize: number;
  minTeamSize: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  rosterChangeClosesAt: string | null;
};

function withStructuralSeasonRefinements<T extends z.ZodType>(schema: T): T {
  return schema
    .refine((data) => {
      const value = data as SeasonRefinementFields;
      return value.starterCount <= value.maxTeamSize;
    }, {
      path: ["starterCount"],
      message: "首发人数不能超过队伍上限",
    })
    .refine((data) => {
      const value = data as SeasonRefinementFields;
      return value.minTeamSize <= value.maxTeamSize;
    }, {
      path: ["minTeamSize"],
      message: "最小人数不能超过最大人数",
    }) as unknown as T;
}

function withDateSeasonRefinements<T extends z.ZodType>(schema: T): T {
  return schema
    .refine(
      (data) => {
        const value = data as SeasonRefinementFields;
        if (!value.registrationOpensAt || !value.registrationClosesAt) return true;
        return new Date(value.registrationClosesAt) > new Date(value.registrationOpensAt);
      },
      {
        path: ["registrationClosesAt"],
        message: "报名截止时间必须晚于报名开始时间",
      },
    )
    .refine(
      (data) => {
        const value = data as SeasonRefinementFields;
        if (!value.registrationClosesAt || !value.rosterChangeClosesAt) return true;
        return new Date(value.rosterChangeClosesAt) >= new Date(value.registrationClosesAt);
      },
      {
        path: ["rosterChangeClosesAt"],
        message: "名单调整截止时间不能早于报名截止时间",
      },
    ) as unknown as T;
}

function withSeasonRefinements<T extends z.ZodType>(schema: T): T {
  return withDateSeasonRefinements(withStructuralSeasonRefinements(schema));
}

function assertUniqueStageKeys(stagePlan: StagePlan): void {
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
  // V2 draft configuration is event-owned, not regenerated from a format template.
  if (isV2TeamConfig(input.teamRegistrationConfig)) return input;
  if (!template || !applyTemplate || template === "custom") return input;
  const builtIn = createCompetitionTemplate(template as CompetitionTemplate);
  if (isV2TeamConfig(builtIn.teamRegistrationConfig)) throw new AppError(ErrorCode.INTERNAL_ERROR, "历史模板配置版本无效。 ");
  // Built-in format and team management defaults remain template-owned.
  // A submitted qualification policy belongs to this event, not the preset.
  // Legacy Major's 5E equivalence overlay remains frozen at registration open.
  const fallbackConversion = template === "major"
    ? input.teamRegistrationConfig?.competitiveProfile?.fallbackConversion
    : undefined;
  const majorProfile = template === "major"
    ? checkStandardMajorCapabilities({ ...builtIn, stagePlan: input.stagePlan })
    : null;
  const stagePlan = majorProfile?.isStandardMajor ? structuredClone(input.stagePlan) : builtIn.stagePlan;
  return {
    ...input,
    kind: template === "major" ? "Major" : "Rivals",
    registrationMode: builtIn.registrationMode,
    hasCaptainVoting: builtIn.hasCaptainVoting,
    hasDraft: builtIn.hasDraft,
    // Community awards are an operator-owned capability, not built-in
    // competition semantics. Preserve an explicit draft choice.
    hasCommunityAwards: input.hasCommunityAwards,
    stagePlan,
    teamRegistrationConfig: {
      ...builtIn.teamRegistrationConfig,
      ...(input.teamRegistrationConfig?.qualificationPolicy
        ? { qualificationPolicy: input.teamRegistrationConfig.qualificationPolicy }
        : {}),
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

function isV2TeamConfig(config: StoredTeamRegistrationConfig | undefined | null): config is StoredTeamRegistrationConfigV2 {
  return config?.qualificationPolicy?.version === 2;
}

/** Build and encode the submitted v2 facts through the common rules owner. */
function encodeSubmittedV2(data: ParsedSeasonForm, registrationOpenedAt: Date | null) {
  if (!isV2TeamConfig(data.teamRegistrationConfig)) throw new AppError(ErrorCode.VALIDATION_FAILED, "缺少新版赛事规则。 ");
  const dates = toDbDates(data);
  const columns = {
    registrationMode: data.registrationMode,
    hasCaptainVoting: data.hasCaptainVoting,
    hasDraft: data.hasDraft,
    registrationConfig: { ...data.registrationConfig, allowedPlayerTypes: [...data.registrationConfig.allowedPlayerTypes] },
    teamRegistrationConfig: data.teamRegistrationConfig,
    affiliationRules: data.affiliationRules ?? [],
    minTeamSize: data.minTeamSize,
    maxTeamSize: data.maxTeamSize,
    starterCount: data.starterCount,
    positions: data.positions,
    stagePlan: data.stagePlan,
    registrationOpensAt: dates.registrationOpensAt ?? null,
    registrationOpenedAt,
    registrationClosesAt: dates.registrationClosesAt ?? null,
    rosterChangeClosesAt: dates.rosterChangeClosesAt ?? null,
  };
  return encodeDraftSeasonRules(columns, decodeSeasonRules(columns));
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
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return leftKeys.length === Object.keys(rightRecord).length && leftKeys.every((key) =>
    Object.hasOwn(rightRecord, key) && sameJson(leftRecord[key], rightRecord[key]),
  );
}

/**
 * Published competitive-policy references are created by the publish/freeze
 * owner, not by the Season form. Compare only the operator-editable rule
 * projection so a normal form replay cannot look like a core-rule mutation
 * merely because it omits those server-owned facts.
 */
function editableTeamConfig(config: TeamRegistrationConfig): TeamRegistrationConfig {
  const result = { ...config };
  if (config.competitiveProfile) {
    const profile = { ...config.competitiveProfile };
    delete profile.fallbackConversion;
    delete profile.conversionPolicyId;
    delete profile.conversionPolicyVersion;
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

type SeasonDateProjection = Pick<typeof seasons.$inferInsert, "registrationOpensAt" | "registrationClosesAt" | "rosterChangeClosesAt">;

function assertValidDateProjection({ registrationOpensAt, registrationClosesAt, rosterChangeClosesAt }: SeasonDateProjection): void {
  if (registrationOpensAt && registrationClosesAt && registrationClosesAt.getTime() <= registrationOpensAt.getTime()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "报名截止时间必须晚于报名开始时间");
  }
  if (registrationClosesAt && rosterChangeClosesAt && rosterChangeClosesAt.getTime() < registrationClosesAt.getTime()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "名单调整截止时间不能早于报名截止时间");
  }
}

/**
 * Plans one season edit against the persisted row. The capability contract is
 * the only lifecycle authority: draft edits are canonicalized by the selected
 * template, published public-rule edits reject unauthorized deltas, and
 * lifecycle-owned dates are projected from the persisted row whenever the
 * client has no write authority. The temporary Major fallback exception only
 * returns a team config whose sole changed leaf is
 * competitiveProfile.fallbackConversion.
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
  const projectedDates: SeasonDateProjection = {
    registrationOpensAt: capabilities.canEditRegistrationOpenSchedule
      ? submittedDates.registrationOpensAt
      : existing.registrationOpensAt,
    registrationClosesAt: capabilities.canEditRegistrationDeadlines && template !== "major"
      ? submittedDates.registrationClosesAt
      : existing.registrationClosesAt,
    rosterChangeClosesAt: capabilities.canEditRegistrationDeadlines && template !== "major"
      ? submittedDates.rosterChangeClosesAt
      : existing.rosterChangeClosesAt,
  };
  assertValidDateProjection(projectedDates);
  if (isV2TeamConfig(data.teamRegistrationConfig)) {
    const encoded = encodeSubmittedV2(data, existing.registrationOpenedAt);
    if (!capabilities.canEditPublicRules) {
      if (!isV2TeamConfig(existing.teamRegistrationConfig)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可修改赛事规则。 ");
      const submitted = decodeSeasonRules({ ...existing, ...encoded });
      const current = decodeSeasonRules(existing);
      const editableRules = (rules: typeof current) => {
        const profile = rules.competitive.competitiveProfile;
        const { rosterChangeClosesAt: _deadline, ...roster } = rules.roster;
        void _deadline;
        return { formation: rules.formation, participant: rules.participant, roster, lineup: rules.lineup,
          competition: rules.competition, registrationMode: rules.registration.registrationMode,
          registrationConfig: rules.registration.registrationConfig,
          competitive: { externalStrengthGap: rules.competitive.externalStrengthGap,
            profile: profile ? { platform: profile.platform, sourceSelection: resolveCompetitiveSourceSelection(profile) } : null } };
      };
      if (existing.hasCommunityAwards !== data.hasCommunityAwards || !sameJson(editableRules(current), editableRules(submitted))) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有 draft 状态可修改赛事规则。 ");
      return { template, set: { slug: existing.slug, name: data.name, kind: data.kind, competitionTemplate: template,
        themeColor: data.themeColor, endAt: template === "major" ? existing.endAt : submittedDates.endAt, updatedAt: new Date(),
        ...(capabilities.canEditRegistrationOpenSchedule ? { registrationOpensAt: projectedDates.registrationOpensAt } : {}),
        ...(capabilities.canEditRegistrationDeadlines && template !== "major" ? { registrationClosesAt: projectedDates.registrationClosesAt, rosterChangeClosesAt: projectedDates.rosterChangeClosesAt } : {}) } };
    }
    return { template, set: {
      slug: data.slug, name: data.name, kind: data.kind, competitionTemplate: template,
      themeColor: data.themeColor, endAt: submittedDates.endAt, updatedAt: new Date(),
      hasCommunityAwards: data.hasCommunityAwards,
      ...encoded,
    } };
  }
  if (isV2TeamConfig(existing.teamRegistrationConfig)) throw new AppError(ErrorCode.VALIDATION_FAILED, "新版规则必须完整提交后才能保存。 ");
  const submittedTeamConfig = data.teamRegistrationConfig ?? {} as TeamRegistrationConfig;
  const normalizedTeamConfig = normalizeTeamRegistrationConfig({
    ...submittedTeamConfig,
    // Older forms do not know this field. A metadata save must not erase it.
    qualificationPolicy: submittedTeamConfig.qualificationPolicy ?? existing.teamRegistrationConfig?.qualificationPolicy,
  });
  const existingTeamConfig = normalizeTeamRegistrationConfig(existing.teamRegistrationConfig);
  const registrationConfig = normalizeRegistrationConfig(data.registrationConfig as RegistrationConfig);
  const affiliationRules = normalizedTeamConfig.qualificationPolicy
    ? []
    : normalizeAffiliationRules(data.affiliationRules as InstitutionAffiliationRule[] | undefined);
  const teamConfigChangedWithoutFallback = !sameJson(editableTeamConfig(existingTeamConfig), editableTeamConfig(normalizedTeamConfig));
  const fallbackChanged = !sameJson(
    existingTeamConfig.competitiveProfile?.fallbackConversion,
    normalizedTeamConfig.competitiveProfile?.fallbackConversion,
  );
  const publicRulesChanged =
    existing.registrationMode !== data.registrationMode ||
    existing.hasCaptainVoting !== data.hasCaptainVoting ||
    existing.hasDraft !== data.hasDraft ||
    existing.hasCommunityAwards !== data.hasCommunityAwards ||
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
    endAt: template === "major" ? existing.endAt : submittedDates.endAt,
    updatedAt: new Date(),
  };
  if (capabilities.canEditRegistrationOpenSchedule) {
    metadata.registrationOpensAt = submittedDates.registrationOpensAt;
  }
  if (capabilities.canEditRegistrationDeadlines && template !== "major") {
    metadata.registrationClosesAt = submittedDates.registrationClosesAt;
    metadata.rosterChangeClosesAt = submittedDates.rosterChangeClosesAt;
  }

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
      hasCommunityAwards: data.hasCommunityAwards,
      minTeamSize: data.minTeamSize,
      maxTeamSize: data.maxTeamSize,
      starterCount: data.starterCount,
      positions: data.positions,
      stagePlan: data.stagePlan as StagePlan,
      registrationConfig,
      teamRegistrationConfig: teamRegistrationConfigForWrite(normalizedTeamConfig),
      affiliationRules: normalizedTeamConfig.qualificationPolicy ? [] : affiliationRules,
    },
  };
}

export function planSeasonCreate(parsed: ParsedSeasonForm): { template: CompetitionTemplate; set: typeof seasons.$inferInsert } {
  const template = parsed.template ?? "custom";
  const data = resolveCompetitionDefinition(parsed, true);
  const templateDefaults = createCompetitionTemplate(template);
  if (isV2TeamConfig(templateDefaults.teamRegistrationConfig)) throw new AppError(ErrorCode.INTERNAL_ERROR, "历史模板配置版本无效。 ");
  assertUniqueStageKeys(data.stagePlan as StagePlan);
  if (isV2TeamConfig(data.teamRegistrationConfig)) {
    return { template, set: {
      slug: data.slug, name: data.name, kind: data.kind, competitionTemplate: template,
      status: "draft", themeColor: data.themeColor, endAt: toDbDates(data).endAt,
      hasCommunityAwards: data.hasCommunityAwards,
      ...encodeSubmittedV2(data, null),
    } };
  }
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
      hasCommunityAwards: data.hasCommunityAwards,
      minTeamSize: data.minTeamSize,
      maxTeamSize: data.maxTeamSize,
      starterCount: data.starterCount,
      positions: data.positions,
      stagePlan: data.stagePlan as StagePlan,
      registrationConfig: {
        ...(data.registrationConfig as RegistrationConfig),
        allowedPlayerTypes: [...data.registrationConfig.allowedPlayerTypes],
        rankThreshold: { ...data.registrationConfig.rankThreshold },
        mapPool: [...new Set(data.registrationConfig.mapPool)],
      },
      teamRegistrationConfig: teamRegistrationConfigForWrite(data.teamRegistrationConfig ?? structuredClone(templateDefaults.teamRegistrationConfig)),
      affiliationRules: data.teamRegistrationConfig?.qualificationPolicy ? [] : data.affiliationRules ?? structuredClone(templateDefaults.affiliationRules),
    },
  };
}
