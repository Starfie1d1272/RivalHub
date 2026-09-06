"use client";

import type { ReactNode } from "react";
import {
  PLAYER_TYPE_LABELS,
  STAGE_TYPE_LABELS,
  type InstitutionAffiliationRule,
  type PlayerType,
  type SeasonStatus,
  type StagePlan,
  type TeamRegistrationConfig,
} from "@/types/season";
import type { CompetitionTemplate } from "@/lib/competition/templates";
import { type SeasonEditPhase } from "@/lib/seasons/edit";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { formatCST } from "@/lib/utils/date";
import { RANK_LABELS } from "@/lib/validators/registration";
import { Panel } from "@/components/rivalhub";

export const NO_RANK = "__none__";

export type CompetitivePlatformOption = {
  key: string;
  displayName: string;
  seasons?: Array<{ seasonKey: string; label: string; active: boolean }>;
  ranks?: Array<{ rankKey: string; label: string }>;
};

const EDIT_PHASE_LABELS: Record<SeasonEditPhase, string> = {
  draft: "草稿编辑",
  published_preopen: "已发布 · 报名未开放",
  registration_opened: "报名已开放",
  playing: "比赛进行中",
  terminal: "赛事已结束",
};

export function templateLabel(template: CompetitionTemplate): string {
  return template === "major" ? "Major" : template === "rivals" ? "Rivals" : "自定义赛事";
}

export function SettingsPanel({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Panel label={<h2 id={`${id}-title`}>{label}</h2>} contentClassName="p-5">
        {children}
      </Panel>
    </section>
  );
}

export function FrozenFact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-[var(--color-info-edge)] bg-[var(--color-info-soft)] px-4 py-3 text-sm" data-testid="season-frozen-fact">
      <p className="font-medium text-[var(--color-fg)]">{title}</p>
      <p className="mt-1 leading-6 text-[var(--color-fg-mid)]">{children}</p>
    </div>
  );
}

function formatDateFact(value: Date | null | undefined): string {
  return value ? formatCST(value) : "未配置";
}

function formatPlatform(platform: string | undefined, platforms: readonly CompetitivePlatformOption[]): string {
  if (!platform) return "未配置";
  return platforms.find((item) => item.key === platform)?.displayName ?? platform;
}

function formatPlatformSeason(
  platform: string | undefined,
  seasonKey: string | undefined,
  platforms: readonly CompetitivePlatformOption[],
): string {
  if (!seasonKey) return "未配置";
  const season = platforms.find((item) => item.key === platform)?.seasons?.find((item) => item.seasonKey === seasonKey);
  return season ? `${season.label}（${season.seasonKey}）` : seasonKey;
}

export function LifecycleFacts({
  status,
  phase,
  registrationOpenedAt,
}: {
  status: SeasonStatus;
  phase: SeasonEditPhase;
  registrationOpenedAt?: Date | null;
}) {
  return (
    <dl className="mb-5 grid gap-3 border-b border-[var(--color-border)] pb-5 text-sm sm:grid-cols-3">
      <div><dt className="text-[var(--color-fg-mid)]">当前状态</dt><dd className="mt-1 font-medium">{presentSeasonStatus(status).label}</dd></div>
      <div><dt className="text-[var(--color-fg-mid)]">编辑阶段</dt><dd className="mt-1 font-medium">{EDIT_PHASE_LABELS[phase]}</dd></div>
      <div><dt className="text-[var(--color-fg-mid)]">实际报名开放</dt><dd className="mt-1 font-medium">{formatDateFact(registrationOpenedAt)}</dd></div>
    </dl>
  );
}

export function TeamQualificationSummary({ config }: { config: TeamRegistrationConfig }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">队伍教育与归属要求</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">外校成员</dt><dd className="mt-1 font-medium">{config.allowExternal ? "允许" : "不允许"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">毕业生计入本校</dt><dd className="mt-1 font-medium">{config.graduateCountsAsHome ? "计入" : "不计入"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">本校成员下限</dt><dd className="mt-1 font-medium">{config.minHomeMembers} 人</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">在读成员下限</dt><dd className="mt-1 font-medium">{config.minEnrolledMembers} 人</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">外校成员上限</dt><dd className="mt-1 font-medium">{config.maxExternalMembers} 人</dd></div>
      </dl>
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">以上是当前赛事配置的 canonical 资格事实；实际报名、名单与首发资格由对应 qualification owner 在服务端复核。</p>
    </div>
  );
}

export function TeamRegistrationSummary({ config }: { config: TeamRegistrationConfig }) {
  return (
    <div className="mt-5 space-y-3 border-t border-[var(--color-border)] pt-5">
      <h3 className="text-sm font-medium">队伍报名与名单事实</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">队长可转让</dt><dd className="mt-1 font-medium">{config.captainCanTransfer ? "允许" : "不允许"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">队长可移除成员</dt><dd className="mt-1 font-medium">{config.captainCanKick ? "允许" : "不允许"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">队伍名唯一</dt><dd className="mt-1 font-medium">{config.requireUniqueTeamName ? "要求" : "不要求"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">队伍 Logo</dt><dd className="mt-1 font-medium">{config.requireTeamLogo ? "要求" : "不要求"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">报名后锁定名单</dt><dd className="mt-1 font-medium">{config.lockAfterRegistration ? "是" : "否"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">位置要求</dt><dd className="mt-1 font-medium">{config.requirePositions ? `每位置最多 ${config.maxPerPositionPerTeam} 人` : "无额外位置要求"}</dd></div>
      </dl>
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">这些是当前赛事保存的 roster/registration canonical facts；内置赛事由 template owner 固定。</p>
    </div>
  );
}

export function SoloQualificationSummary({
  allowedPlayerTypes,
  currentMin,
  peakMin,
  maxPerPosition,
  screenshotCount,
}: {
  allowedPlayerTypes: readonly PlayerType[];
  currentMin: string;
  peakMin: string;
  maxPerPosition: number;
  screenshotCount: number;
}) {
  const formatRank = (value: string) => {
    if (value === NO_RANK) return "无门槛";
    return value in RANK_LABELS ? RANK_LABELS[value as keyof typeof RANK_LABELS] : value;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">个人报名资格</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">允许身份</dt><dd className="mt-1 font-medium">{allowedPlayerTypes.map((type) => PLAYER_TYPE_LABELS[type]).join("、")}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">当前段位门槛</dt><dd className="mt-1 font-medium">{formatRank(currentMin)}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">历史段位门槛</dt><dd className="mt-1 font-medium">{formatRank(peakMin)}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">每位置上限</dt><dd className="mt-1 font-medium">{maxPerPosition} 人</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">截图链接数量</dt><dd className="mt-1 font-medium">{screenshotCount}</dd></div>
      </dl>
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">这里展示当前赛事保存的 canonical registrationConfig；报名时由服务端 qualification owner 复核。</p>
    </div>
  );
}

export function AffiliationRulesSummary({ rules }: { rules: readonly InstitutionAffiliationRule[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">学校归属规则</h3>
      {rules.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-mid)]">当前没有额外的学校归属规则。</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rules.map((rule) => (
            <li key={`${rule.institutionCode}-${rule.minRosterMembers}-${rule.minStartingMembers}`} className="rounded-sm border border-[var(--color-border)] px-3 py-2.5">
              <span className="font-medium">机构 {rule.institutionCode}</span>
              <span className="mt-1 block text-[var(--color-fg-mid)]">
                {rule.eligibleAcademicStatuses.includes("enrolled") ? "在读" : ""}
                {rule.eligibleAcademicStatuses.includes("enrolled") && rule.eligibleAcademicStatuses.includes("graduated") ? " / " : ""}
                {rule.eligibleAcademicStatuses.includes("graduated") ? "毕业" : ""}
                · 名单至少 {rule.minRosterMembers} 人 · 预定首发至少 {rule.minStartingMembers} 人
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-[var(--color-fg-dim)]">这里仅展示赛事保存的 canonical affiliation rule，不在页面复制 qualification evaluator。</p>
    </div>
  );
}

export function CompetitiveReferenceSummary({
  config,
  platforms,
  frozen,
}: {
  config: TeamRegistrationConfig;
  platforms: readonly CompetitivePlatformOption[];
  frozen: boolean;
}) {
  const profile = config.competitiveProfile;
  if (!config.requireCompetitiveProfile || !profile) {
    return <p className="text-sm text-[var(--color-fg-mid)]">当前赛事未启用队伍竞技档案要求；报名资格不会从这里推断竞技事实。</p>;
  }

  const evidencePolicy = profile.evidencePolicy;
  const policyVersion = profile.conversionPolicyVersion;
  const policyId = profile.conversionPolicyId;
  const sourcePlatform = profile.fallbackConversion?.sourcePlatform === "fivee" ? "5E" : null;
  const primaryPlatform = formatPlatform(profile.platform, platforms);
  const conversionLabel = sourcePlatform ? `${sourcePlatform} → ${primaryPlatform}` : primaryPlatform;
  const currentSeason = formatPlatformSeason(profile.platform, profile.currentSeasonKey, platforms);
  const previousSeason = formatPlatformSeason(profile.platform, profile.previousSeasonKey, platforms);
  const referenceSeason = formatPlatformSeason(profile.platform, evidencePolicy?.referenceSeasonKey ?? profile.previousSeasonKey, platforms);
  const recentSeasons = (evidencePolicy?.recentSeasonKeys ?? [profile.previousSeasonKey, profile.currentSeasonKey])
    .filter(Boolean)
    .map((key) => formatPlatformSeason(profile.platform, key, platforms));

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--color-fg-mid)]">主平台</dt><dd className="mt-1 font-medium">{primaryPlatform}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">当前平台赛季</dt><dd className="mt-1 font-medium">{currentSeason}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">上一平台赛季</dt><dd className="mt-1 font-medium">{previousSeason}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">历史参考赛季（20%）</dt><dd className="mt-1 font-medium">{referenceSeason}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[var(--color-fg-mid)]">近期竞技事实（30%）</dt><dd className="mt-1 font-medium">{recentSeasons.length > 0 ? recentSeasons.join("、") : "未配置"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">冻结段位顺序</dt><dd className="mt-1 font-medium">{profile.rankOrder.length > 0 ? `${profile.rankOrder.length} 个段位` : "未配置"}</dd></div>
        <div><dt className="text-[var(--color-fg-mid)]">外校实力星差上限</dt><dd className="mt-1 font-medium">{profile.externalStrengthMaxStarGap ?? 3} 星</dd></div>
      </dl>

      {policyVersion || policyId || profile.fallbackConversion ? (
        <FrozenFact title={`${conversionLabel} · ConversionPolicy ${policyVersion ?? "未标记版本"}`}>
          {frozen
            ? "本届已在报名开放时冻结；全局 policy 后续变化不会影响本届。"
            : "当前赛事绑定已批准的 policy identity；报名开放时会把对应赛季与换算快照一并冻结。"}
          {policyId && <span className="mt-1 block font-mono text-xs">策略 ID：{policyId}</span>}
          {profile.fallbackConversion?.version && <span className="mt-1 block text-xs">事件换算快照版本：{profile.fallbackConversion.version} · 来源：{sourcePlatform ?? "ConversionPolicy"}</span>}
        </FrozenFact>
      ) : (
        <FrozenFact title={`${conversionLabel} · ConversionPolicy 尚未绑定`}>
          发布时由服务端选择已批准的 policy；这里不手工编辑 mapping 或 version。实际开放报名时，平台赛季、段位顺序与换算快照由 canonical lifecycle owner 冻结。
        </FrozenFact>
      )}
    </div>
  );
}

export function StagePlanSummary({ stagePlan }: { stagePlan: StagePlan }) {
  if (stagePlan.length === 0) return <p className="text-sm text-[var(--color-fg-mid)]">当前没有配置比赛阶段。</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-fg-dim)]">内置赛事的 StagePlan 由 template canonical owner 固定；此处只读展示阶段与赛制事实。</p>
      <ol className="space-y-2">
        {stagePlan.map((stage, index) => (
          <li key={`${stage.key}-${index}`} className="rounded-sm border border-[var(--color-border)] px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{stage.name}</span>
              <span className="font-mono text-xs text-[var(--color-fg-mid)]">{STAGE_TYPE_LABELS[stage.type]} · {stage.teamCount} 队</span>
            </div>
            <p className="mt-1 text-[var(--color-fg-mid)]">主赛制 {stage.matchFormat?.toUpperCase() ?? "未配置"}{stage.finalFormat ? ` · 决赛 ${stage.finalFormat.toUpperCase()}` : ""}{stage.hasThirdPlaceMatch ? " · 含季军赛" : ""}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
