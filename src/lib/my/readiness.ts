import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionEntryParticipants,
  competitiveRankFacts,
  disciplinaryCases,
  seasons,
  teamMemberships,
  teams,
} from "@/db/schema";
import {
  loadCompetitivePlatformCatalog,
  resolvePlatformCatalog,
  toCompetitiveProfileConfig,
  type CompetitivePlatformCatalogEntry,
} from "@/lib/competitive/catalog";
import { serializeSanctionPublic, type SanctionEffect } from "@/lib/discipline/service";
import {
  presentCompetitionEntryParticipation,
  presentCompetitionEntryRegistration,
  type CompetitionEntryParticipantStatus,
  type CompetitionEntryRegistrationStatus,
} from "@/lib/competition-entries/presentation";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import {
  computeParticipantReadiness,
  getCompetitiveProfileBlockers,
  getParticipantIdentityBlockers,
  loadParticipantQualificationFacts,
  type ParticipantQualificationFacts,
} from "@/lib/qualification/service";
import { normalizeTeamRegistrationConfig } from "@/types/season";

export type MyReadinessState = "ready" | "incomplete" | "waiting" | "blocked" | "unknown";

export interface MyReadinessCta {
  href: string;
  label: string;
}

export interface MyReadinessItem {
  id: string;
  title: string;
  state: MyReadinessState;
  detail: string;
  owner: string;
  cta: MyReadinessCta;
}

export interface MyCompetitionSource {
  id: string;
  name: string;
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  registrationStatus: CompetitionEntryRegistrationStatus;
  participantStatus: CompetitionEntryParticipantStatus | null;
  representativeUserId: string;
  teamRegistrationConfig: Parameters<typeof normalizeTeamRegistrationConfig>[0];
}

export interface MySanctionSource {
  id: string;
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  effects: SanctionEffect[];
  explanation: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

export interface MyCompetitiveProfileSource {
  key: string;
  displayName: string;
  state: MyReadinessState;
  blockers: string[];
}

export interface MyReadinessModel {
  displayName: string;
  profile: MyReadinessItem;
  education: MyReadinessItem;
  competitiveProfiles: MyCompetitiveProfileSource[];
  team: MyReadinessItem;
  competitions: Array<{
    id: string;
    name: string;
    seasonName: string;
    href: string;
    entry: MyReadinessItem;
    qualification: MyReadinessItem;
    sanctions: MySanctionSource[];
  }>;
  sanctions: MySanctionSource[];
}

function item(
  id: string,
  title: string,
  state: MyReadinessState,
  detail: string,
  owner: string,
  cta: MyReadinessCta,
): MyReadinessItem {
  return { id, title, state, detail, owner, cta };
}

function latestEducationState(fact: ParticipantQualificationFacts | null): MyReadinessItem {
  if (!fact) {
    return item("education", "教育认证", "unknown", "教育认证事实不可确认。", "平台", { href: "/settings/education", label: "查看教育认证" });
  }
  if (fact.approvedEducation) {
    return item("education", "教育认证", "ready", "已存在通过的教育认证。赛事仍会按其当时规则核验。", "我", { href: "/settings/education", label: "查看教育认证" });
  }
  if (fact.educationHistory.some((entry) => entry.status === "pending")) {
    return item("education", "教育认证", "waiting", "教育材料正在等待审核。", "赛事管理员", { href: "/settings/education", label: "查看认证进度" });
  }
  if (fact.educationHistory.some((entry) => entry.status === "rejected")) {
    return item("education", "教育认证", "blocked", "最近的教育认证未通过，需要重新提交材料。", "我", { href: "/settings/education", label: "重新提交材料" });
  }
  return item("education", "教育认证", "incomplete", "尚未提交教育认证。", "我", { href: "/settings/education", label: "开始教育认证" });
}

function profileState(fact: ParticipantQualificationFacts | null): MyReadinessItem {
  if (!fact) {
    return item("profile", "长期个人资料", "unknown", "个人资料事实不可确认。", "平台", { href: "/settings", label: "查看参赛资料" });
  }
  const blockers = getParticipantIdentityBlockers(fact);
  if (blockers.length === 0) {
    return item("profile", "长期个人资料", "ready", "展示昵称、Steam64、完美平台 ID、QQ 与邮箱验证已齐全。", "我", { href: "/settings", label: "查看参赛资料" });
  }
  return item("profile", "长期个人资料", "incomplete", blockers.join(" "), "我", { href: "/settings", label: "完善参赛资料" });
}

function teamState(currentTeam: { id: string; name: string; role: string } | null): MyReadinessItem {
  if (!currentTeam) {
    return item("team", "长期 Team", "incomplete", "你当前没有 active Team。加入队伍不等于自动参加赛事。", "我或队长", { href: "/my/teams", label: "管理我的队伍" });
  }
  return item("team", "长期 Team", "ready", `${currentTeam.name} · ${currentTeam.role === "captain" ? "队长" : "成员"}。长期成员变更不会改写已报名赛事名单。`, "我与队长", { href: "/my/teams", label: "管理我的队伍" });
}

function entryState(source: MyCompetitionSource, userId: string): MyReadinessItem {
  const href = `/${source.seasonSlug}/register`;
  const representative = source.representativeUserId === userId;
  const presentation = representative
    ? presentCompetitionEntryRegistration(source.registrationStatus)
    : presentCompetitionEntryParticipation(source.participantStatus, source.registrationStatus);
  if (!representative) {
    const awaitingConfirmation = source.participantStatus === "invited";
    if (source.participantStatus === "confirmed") {
      const registration = presentCompetitionEntryRegistration(source.registrationStatus);
      const owner = source.registrationStatus === "changes_requested"
        ? "赛事负责人和赛事管理员"
        : source.registrationStatus === "withdrawn"
          ? "赛事负责人"
          : "赛事管理员";
      return item(
        `entry-${source.id}`,
        "当前报名状态",
        registration.state,
        `${presentation.label} · ${registration.label}，${registration.detail}`,
        owner,
        { href, label: "查看本届报名" },
      );
    }
    return item(
      `entry-${source.id}`,
      "当前报名状态",
      presentation.state,
      `${presentation.label}：${presentation.detail}`,
      awaitingConfirmation ? "我" : "赛事负责人",
      { href, label: awaitingConfirmation ? "确认是否参赛" : "查看本届报名" },
    );
  }
  const cta = source.registrationStatus === "changes_requested"
    ? { href, label: "处理补正" }
    : source.registrationStatus === "draft"
      ? { href, label: "继续报名" }
      : source.registrationStatus === "rejected"
        ? { href, label: "查看审核说明" }
        : { href, label: "查看报名" };
  const owner = source.registrationStatus === "draft"
    ? "我"
    : source.registrationStatus === "changes_requested"
      ? "我与赛事管理员"
      : source.registrationStatus === "withdrawn"
        ? "我或赛事负责人"
        : "赛事管理员";
  return item(`entry-${source.id}`, "当前报名状态", presentation.state, `${presentation.label}：${presentation.detail}`, owner, cta);
}

function qualificationState(
  source: MyCompetitionSource,
  fact: ParticipantQualificationFacts | null | undefined,
): MyReadinessItem {
  const href = `/${source.seasonSlug}/register`;
  const config = normalizeTeamRegistrationConfig(source.teamRegistrationConfig);
  if (!config.requireCompetitiveProfile) {
    return item(`qualification-${source.id}`, "个人 qualification", "unknown", "本届赛事没有可展示的个人竞技 qualification 上下文；报名状态不因此推断为通过。", "赛事规则", { href, label: "查看本届报名" });
  }
  if (!config.competitiveProfile || !fact) {
    return item(`qualification-${source.id}`, "个人 qualification", "unknown", "本届赛事的个人 qualification 事实不可确认。", "赛事规则", { href, label: "查看本届报名" });
  }
  const readiness = computeParticipantReadiness(fact, config.competitiveProfile);
  if (readiness.ready) {
    return item(`qualification-${source.id}`, "个人 qualification", "ready", "个人资料满足本届冻结竞技上下文。队伍报名审核、正式 roster 与处罚仍单独决定 event eligibility。", "我与赛事管理员", { href, label: "查看本届报名" });
  }
  return item(`qualification-${source.id}`, "个人 qualification", "blocked", readiness.blockers.join(" "), "我", { href, label: "查看并补齐资料" });
}

export function buildMyReadinessModel(input: {
  user: { displayName: string | null; perfectName: string | null; steamName: string | null };
  baseFact: ParticipantQualificationFacts | null;
  currentTeam: { id: string; name: string; role: string } | null;
  competitiveProfiles: MyCompetitiveProfileSource[];
  competitions: MyCompetitionSource[];
  qualificationFactsByPlatform: Map<string, ParticipantQualificationFacts | null>;
  sanctions: MySanctionSource[];
  userId: string;
}): MyReadinessModel {
  const sanctionsBySeason = new Map<string, MySanctionSource[]>();
  for (const sanction of input.sanctions) {
    const current = sanctionsBySeason.get(sanction.seasonId) ?? [];
    current.push(sanction);
    sanctionsBySeason.set(sanction.seasonId, current);
  }
  return {
    displayName: getPublicDisplayName(input.user),
    profile: profileState(input.baseFact),
    education: latestEducationState(input.baseFact),
    competitiveProfiles: input.competitiveProfiles,
    team: teamState(input.currentTeam),
    competitions: input.competitions.map((competition) => {
      const config = normalizeTeamRegistrationConfig(competition.teamRegistrationConfig);
      const fact = config.competitiveProfile
        ? input.qualificationFactsByPlatform.get(config.competitiveProfile.platform)
        : input.baseFact;
      return {
        id: competition.id,
        name: competition.name,
        seasonName: competition.seasonName,
        href: `/${competition.seasonSlug}/register`,
        entry: entryState(competition, input.userId),
        qualification: qualificationState(competition, fact),
        sanctions: sanctionsBySeason.get(competition.seasonId) ?? [],
      };
    }),
    sanctions: input.sanctions,
  };
}

export function selectMyCompetitiveProfilePlatformKeys(
  catalog: readonly CompetitivePlatformCatalogEntry[],
  requiredPlatforms: ReadonlySet<string>,
  platformsWithFacts: ReadonlySet<string>,
): string[] {
  const selected = new Set([...requiredPlatforms, ...platformsWithFacts]);
  const catalogKeys = catalog.map((platform) => platform.key);
  return [
    ...catalogKeys.filter((key) => selected.has(key)),
    ...[...selected].filter((key) => !catalogKeys.includes(key)).sort(),
  ];
}

export async function loadMyReadiness(userId: string): Promise<MyReadinessModel> {
  const [baseFacts, catalog, currentTeamRows, competitionRows, sanctionRows, platformFactRows] = await Promise.all([
    loadParticipantQualificationFacts([userId]),
    loadCompetitivePlatformCatalog(db),
    db.select({ id: teams.id, name: teams.name, captainUserId: teams.captainUserId })
      .from(teamMemberships)
      .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
      .where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.endedAt), eq(teams.status, "active")))
      .limit(1),
    db.select({
      id: competitionEntries.id,
      name: competitionEntries.name,
      seasonId: seasons.id,
      seasonName: seasons.name,
      seasonSlug: seasons.slug,
      registrationStatus: competitionEntries.registrationStatus,
      participantStatus: competitionEntryParticipants.status,
      representativeUserId: competitionEntries.representativeUserId,
      teamRegistrationConfig: seasons.teamRegistrationConfig,
    })
      .from(competitionEntries)
      .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
      .leftJoin(competitionEntryParticipants, and(eq(competitionEntryParticipants.entryId, competitionEntries.id), eq(competitionEntryParticipants.userId, userId)))
      .where(or(eq(competitionEntries.representativeUserId, userId), eq(competitionEntryParticipants.userId, userId)))
      .orderBy(desc(competitionEntries.createdAt)),
    db.select({ row: disciplinaryCases, seasonName: seasons.name, seasonSlug: seasons.slug })
      .from(disciplinaryCases)
      .innerJoin(seasons, eq(seasons.id, disciplinaryCases.seasonId))
      .where(and(eq(disciplinaryCases.subjectUserId, userId), eq(disciplinaryCases.status, "active"))),
    db.selectDistinct({ platform: competitiveRankFacts.platform })
      .from(competitiveRankFacts)
      .where(eq(competitiveRankFacts.userId, userId)),
  ]);

  const baseFact = baseFacts.get(userId) ?? null;
  const requiredPlatforms = new Set<string>();
  for (const row of competitionRows) {
    const config = normalizeTeamRegistrationConfig(row.teamRegistrationConfig);
    if (config.requireCompetitiveProfile && config.competitiveProfile) requiredPlatforms.add(config.competitiveProfile.platform);
  }
  const platformKeys = selectMyCompetitiveProfilePlatformKeys(
    catalog,
    requiredPlatforms,
    new Set(platformFactRows.map((row) => row.platform)),
  );
  const catalogByKey = new Map(catalog.map((platform) => [platform.key, platform]));

  const factsByPlatform = new Map<string, ParticipantQualificationFacts | null>();
  await Promise.all(platformKeys.map(async (platform) => {
    const facts = await loadParticipantQualificationFacts([userId], { platform });
    factsByPlatform.set(platform, facts.get(userId) ?? null);
  }));

  const competitiveProfiles: MyCompetitiveProfileSource[] = platformKeys.map((key) => {
    const platform = catalogByKey.get(key);
    if (!platform) {
      return { key, displayName: key, state: "unknown", blockers: ["该平台的竞技目录不可确认。"] };
    }
    const context = resolvePlatformCatalog(platform);
    if (!context) {
      return { key: platform.key, displayName: platform.displayName, state: "unknown", blockers: ["平台目录缺少当前赛季、上一赛季或段位表，竞技档案不可确认。"] };
    }
    const fact = factsByPlatform.get(platform.key) ?? null;
    if (!fact) {
      return { key: platform.key, displayName: platform.displayName, state: "unknown", blockers: ["竞技档案事实不可确认。"] };
    }
    const blockers = getCompetitiveProfileBlockers(fact, toCompetitiveProfileConfig({ platform: platform.key, ...context }));
    return { key: platform.key, displayName: platform.displayName, state: blockers.length === 0 ? "ready" : "incomplete", blockers };
  });

  const now = new Date();
  const sanctions = sanctionRows
    .map(({ row, seasonName, seasonSlug }) => ({ publicRow: serializeSanctionPublic(row, now), seasonName, seasonSlug }))
    .filter(({ publicRow }) => publicRow.status === "active")
    .map(({ publicRow, seasonName, seasonSlug }) => ({
      id: publicRow.id,
      seasonId: publicRow.seasonId,
      seasonName,
      seasonSlug,
      effects: publicRow.effects,
      explanation: publicRow.explanation,
      effectiveFrom: publicRow.effectiveFrom,
      effectiveUntil: publicRow.effectiveUntil,
    }));

  return buildMyReadinessModel({
    user: baseFact ?? { displayName: null, perfectName: null, steamName: null },
    baseFact,
    currentTeam: currentTeamRows[0] ? { ...currentTeamRows[0], role: currentTeamRows[0].captainUserId === userId ? "captain" : "member" } : null,
    competitiveProfiles,
    competitions: competitionRows,
    qualificationFactsByPlatform: factsByPlatform,
    sanctions,
    userId,
  });
}

export const SANCTION_EFFECT_LABELS: Record<SanctionEffect, string> = {
  registration_block: "阻止报名",
  roster_block: "阻止进入赛事 roster",
  match_participation_block: "阻止单场出场",
};
