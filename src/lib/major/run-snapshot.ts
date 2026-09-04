import { z } from "zod";
import { AppError, ErrorCode } from "@/lib/errors";

const stageSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  teamCount: z.number().int().positive(),
  matchFormat: z.string().min(1),
  finalFormat: z.string().nullable(),
  advanceTiers: z.array(z.unknown()).default([]),
  entrySeeds: z.number().int().nullable().optional(),
  seeds: z.array(z.number().int()).nullable().optional(),
});

const frozenEntrantSchema = z.object({
  entrantId: z.string().uuid(),
  competitionEntryId: z.string().uuid(),
  tournamentSeed: z.number().int().min(1).max(32),
});

const qualificationPolicySchema = z.object({
  externalStrengthGap: z.object({
    enabled: z.boolean(),
    maxGap: z.number().int().nonnegative(),
  }),
});

const qualificationFindingSnapshotSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  waivable: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const frozenRestrictionOverrideSchema = z.object({
  entryId: z.string().uuid(),
  rosterRevisionId: z.string().uuid(),
  restrictionCode: z.string().min(1),
  findingSnapshot: qualificationFindingSnapshotSchema,
  reason: z.string().min(1),
  grantedBy: z.string().min(1),
  grantedAt: z.string().min(1),
}).superRefine((value, ctx) => {
  if (value.restrictionCode !== value.findingSnapshot.code) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "解除记录的 restrictionCode 必须与 finding snapshot code 一致" });
  }
  if (!value.findingSnapshot.waivable) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "StageRun 只能冻结可解除的 qualification finding" });
  }
  if (!value.reason.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "解除记录必须包含具体理由" });
  }
});

const frozenInputObject = z.object({
  stagePlan: z.array(stageSchema).min(1),
  rosterRules: z.object({ minTeamSize: z.number().int().positive(), maxTeamSize: z.number().int().positive(), starterCount: z.number().int().positive() }),
  affiliationRules: z.array(z.unknown()).readonly(),
  competitiveProfile: z.unknown().nullable(),
  frozenCompetitiveFacts: z.array(z.unknown()),
  /** Explicit capability marker; absent means a legacy StageRun. */
  qualificationPolicy: qualificationPolicySchema.optional(),
  /** Active waivable restrictions frozen for the approved roster revisions. */
  frozenRestrictionOverrides: z.array(frozenRestrictionOverrideSchema).optional(),
});

const frozenInputSchema = frozenInputObject.superRefine((value, ctx) => {
  const keys = new Set<string>();
  for (const stage of value.stagePlan) {
    if (keys.has(stage.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "重复的 StagePlan key" });
    keys.add(stage.key);
  }
  if (value.rosterRules.starterCount > value.rosterRules.maxTeamSize || value.rosterRules.minTeamSize > value.rosterRules.maxTeamSize) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "无效的 roster policy" });
  }
});

function withFrozenInputInvariants<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((value, ctx) => {
    const result = frozenInputSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue(issue);
    }
  }) as unknown as T;
}

const v3Schema = withFrozenInputInvariants(frozenInputObject.extend({
  version: z.literal(3),
  stage: stageSchema,
  tournamentEntrants: z.array(frozenEntrantSchema).length(32),
  tournamentSeeds: z.array(z.unknown()).optional(),
  openingPairings: z.array(z.unknown()).optional(),
  hasThirdPlaceMatch: z.boolean().optional(),
}));

const v4Schema = withFrozenInputInvariants(frozenInputObject.extend({
  version: z.literal(4),
  runOptions: z.object({ hasThirdPlaceMatch: z.boolean().optional() }).default({}),
}));

export type MajorRunStage = z.infer<typeof stageSchema>;
export type MajorRunQualificationPolicy = z.infer<typeof qualificationPolicySchema>;
export type FrozenRestrictionOverrideSnapshot = z.infer<typeof frozenRestrictionOverrideSchema>;
export type MajorRunSnapshot = z.infer<typeof frozenInputSchema> & {
  version: 3 | 4;
  stage: MajorRunStage;
  tournamentEntrants?: readonly z.infer<typeof frozenEntrantSchema>[];
  hasThirdPlaceMatch?: boolean;
};

function fail(message: string): never {
  throw new AppError(ErrorCode.INTERNAL_ERROR, `StageRun snapshot 无效：${message}`);
}

function validateEntrants(entrants: readonly z.infer<typeof frozenEntrantSchema>[]): void {
  const entrantIds = new Set<string>();
  const entryIds = new Set<string>();
  const seeds = new Set<number>();
  for (const entrant of entrants) {
    if (entrantIds.has(entrant.entrantId) || entryIds.has(entrant.competitionEntryId) || seeds.has(entrant.tournamentSeed)) fail("冻结赛事入口重复");
    entrantIds.add(entrant.entrantId); entryIds.add(entrant.competitionEntryId); seeds.add(entrant.tournamentSeed);
  }
}

/** The only parser/normalizer for persisted Major StageRun snapshots. */
export function parseMajorRunSnapshot(value: unknown, stageKey: string): MajorRunSnapshot {
  const v4 = v4Schema.safeParse(value);
  if (v4.success) {
    const stage = v4.data.stagePlan.find((candidate) => candidate.key === stageKey);
    if (!stage) fail("v4 stagePlan 不包含 StageRun stageKey");
    return { ...v4.data, stage, hasThirdPlaceMatch: v4.data.runOptions.hasThirdPlaceMatch };
  }
  const v3 = v3Schema.safeParse(value);
  if (!v3.success) fail("不支持或结构损坏的版本");
  const planStage = v3.data.stagePlan.find((candidate) => candidate.key === stageKey);
  if (!planStage || v3.data.stage.key !== stageKey) fail("v3 stage 与 StageRun stageKey 不一致");
  validateEntrants(v3.data.tournamentEntrants);
  return { ...v3.data, stage: planStage, hasThirdPlaceMatch: v3.data.hasThirdPlaceMatch };
}

/** v4 only freezes inputs; persisted membership/seeds/matches remain relational facts. */
export function makeMajorRunSnapshotV4(input: z.input<typeof frozenInputSchema> & { hasThirdPlaceMatch?: boolean }) {
  const parsed = frozenInputSchema.safeParse(input);
  if (!parsed.success) fail("无法写入冻结输入");
  return {
    version: 4 as const,
    stagePlan: parsed.data.stagePlan,
    rosterRules: parsed.data.rosterRules,
    affiliationRules: parsed.data.affiliationRules,
    competitiveProfile: parsed.data.competitiveProfile,
    frozenCompetitiveFacts: parsed.data.frozenCompetitiveFacts,
    ...(parsed.data.qualificationPolicy ? { qualificationPolicy: parsed.data.qualificationPolicy } : {}),
    ...(parsed.data.frozenRestrictionOverrides ? { frozenRestrictionOverrides: parsed.data.frozenRestrictionOverrides } : {}),
    runOptions: input.hasThirdPlaceMatch === undefined ? {} : { hasThirdPlaceMatch: input.hasThirdPlaceMatch },
  };
}
