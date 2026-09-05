"use client";

import { useState, useTransition, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSeason, deleteSeason, openSeasonRegistration, publishSeason, updateSeason, revertSeasonToDraft, revertSeasonToRegistration, forceFinishSeason, archiveSeason, type SeasonFormInput } from "@/actions/seasons";
import {
  PLAYER_TYPE_LABELS,
  type PlayerType,
  type RegistrationConfig,
  type SeasonCapabilities,
  type InstitutionAffiliationRule,
  type TeamRegistrationConfig,
  type StagePlan,
  type SeasonStatus,
  STAGE_TYPE_LABELS,
} from "@/types/season";
import { checkStandardMajorCapabilities } from "@/lib/competition/definition";
import { createCompetitionTemplate, type CompetitionTemplate } from "@/lib/competition/templates";
import { getSeasonEditCapabilities, type SeasonEditPhase } from "@/lib/seasons/edit";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { formatCST } from "@/lib/utils/date";
import { rankValues, RANK_LABELS } from "@/lib/validators/registration";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { InlineConfirm, Panel } from "@/components/rivalhub";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StagePlanEditor } from "@/components/admin/StagePlanEditor";
import { TeamConfigForm } from "@/components/admin/TeamConfigForm";
import { ThemeColorPicker } from "@/components/admin/ThemeColorPicker";
import { PositionEditor } from "@/components/admin/PositionEditor";
import { MapPoolEditor } from "@/components/admin/MapPoolEditor";

const PLAYER_TYPES: PlayerType[] = ["enrolled", "graduated", "external"];
const NO_RANK = "__none__";

interface SeasonFormProps {
  mode: "create" | "edit";
  initial?: SeasonFormInput & { registrationOpenedAt?: Date | null };
  competitivePlatforms: Array<{
    key: string;
    displayName: string;
    seasons?: Array<{ seasonKey: string; label: string; active: boolean }>;
    ranks?: Array<{ rankKey: string; label: string }>;
  }>;
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function slugFromName(name: string): string {
  if (!name) return "";
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function lifecycleExplanation(phase: SeasonEditPhase): string {
  switch (phase) {
    case "draft":
      return "所有赛事定义仍可调整。发布后 URL 标识、赛事体系和公开竞赛规则将锁定。";
    case "published_preopen":
      return "公开赛事规则已锁定。仍可调整报名时间和本届临时 5E fallback；实际开放报名后竞技上下文与开放时间冻结。";
    case "registration_opened":
      return "竞技上下文、5E fallback 和实际开放时间已冻结；报名截止与名单调整截止在比赛开始前仍可运营调整。";
    case "playing":
      return "比赛已开始，公开规则和报名期配置已经冻结，只保留允许的 metadata。";
    case "terminal":
      return "赛事已结束，公开规则和报名期配置已经冻结，只保留允许的 metadata。";
  }
}

function LifecycleExplanation({ phase }: { phase: SeasonEditPhase }) {
  return (
    <div data-testid="season-lifecycle-explanation" className="rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-hi)] px-4 py-3 text-sm text-[var(--color-fg-mid)]">
      {lifecycleExplanation(phase)}
    </div>
  );
}

type CompetitivePlatformOption = SeasonFormProps["competitivePlatforms"][number];

const EDIT_PHASE_LABELS: Record<SeasonEditPhase, string> = {
  draft: "草稿编辑",
  published_preopen: "已发布 · 报名未开放",
  registration_opened: "报名已开放",
  playing: "比赛进行中",
  terminal: "赛事已结束",
};

function templateLabel(template: CompetitionTemplate): string {
  return template === "major" ? "Major" : template === "rivals" ? "Rivals" : "自定义赛事";
}

function SettingsPanel({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Panel label={<h2 id={`${id}-title`}>{label}</h2>} pad={20}>
        {children}
      </Panel>
    </section>
  );
}

function FrozenFact({ title, children }: { title: string; children: ReactNode }) {
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

function LifecycleFacts({
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

function TeamQualificationSummary({ config }: { config: TeamRegistrationConfig }) {
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

function TeamRegistrationSummary({ config }: { config: TeamRegistrationConfig }) {
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

function SoloQualificationSummary({
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

function AffiliationRulesSummary({ rules }: { rules: readonly InstitutionAffiliationRule[] }) {
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

function CompetitiveReferenceSummary({
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
  const sourcePlatform = profile.fallbackConversion?.sourcePlatform === "fivee" || profile.platform === "perfect_world" ? "5E" : "平台换算策略";
  const primaryPlatform = formatPlatform(profile.platform, platforms);
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
        <FrozenFact title={`${sourcePlatform} → ${primaryPlatform} · ConversionPolicy ${policyVersion ?? "未标记版本"}`}>
          {frozen
            ? "本届已在报名开放时冻结；全局 policy 后续变化不会影响本届。"
            : "当前赛事绑定已批准的 policy identity；报名开放时会把对应赛季与换算快照一并冻结。"}
          {policyId && <span className="mt-1 block font-mono text-xs">策略 ID：{policyId}</span>}
          {profile.fallbackConversion?.version && <span className="mt-1 block text-xs">事件换算快照版本：{profile.fallbackConversion.version} · 来源：{sourcePlatform}</span>}
        </FrozenFact>
      ) : (
        <FrozenFact title={`${sourcePlatform} → ${primaryPlatform} · ConversionPolicy 尚未绑定`}>
          发布时由服务端选择已批准的 policy；这里不手工编辑 mapping 或 version。实际开放报名时，平台赛季、段位顺序与换算快照由 canonical lifecycle owner 冻结。
        </FrozenFact>
      )}
    </div>
  );
}

function StagePlanSummary({ stagePlan }: { stagePlan: StagePlan }) {
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

export function SeasonForm({ mode, initial, competitivePlatforms }: SeasonFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The persisted competitionTemplate is the sole identity owner. Missing
  // identity is treated as custom instead of inferred from capability shape.
  const initialTemplate: CompetitionTemplate = initial?.template ?? "custom";
  const defaultTemplate = createCompetitionTemplate(initialTemplate);

  const defaultConfig = initial?.registrationConfig ?? defaultTemplate.registrationConfig;
  const defaultTeamConfig = initial?.teamRegistrationConfig ?? defaultTemplate.teamRegistrationConfig;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(mode === "edit");
  const [template, setTemplate] = useState<CompetitionTemplate>(initialTemplate);
  const [kind, setKind] = useState(initial?.kind ?? "Major");
  const [themeColor, setThemeColor] = useState(initial?.themeColor ?? "");
  const [pendingTemplate, setPendingTemplate] = useState<CompetitionTemplate | null>(null);
  const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false);
  const [dangerAction, setDangerAction] = useState<"delete" | "revert-draft" | "revert-registration" | "finish" | "archive" | null>(null);
  const [registrationOpensAt, setRegistrationOpensAt] = useState(initial?.registrationOpensAt ?? "");
  const [registrationClosesAt, setRegistrationClosesAt] = useState(initial?.registrationClosesAt ?? "");
  const [rosterChangeClosesAt, setRosterChangeClosesAt] = useState(initial?.rosterChangeClosesAt ?? "");
  const [endAt, setEndAt] = useState(initial?.endAt ?? "");
  const [registrationMode, setRegistrationMode] = useState<"solo" | "team">(
    initial?.registrationMode ?? defaultTemplate.registrationMode,
  );
  const [hasCaptainVoting, setHasCaptainVoting] = useState(initial?.hasCaptainVoting ?? defaultTemplate.hasCaptainVoting);
  const [hasDraft, setHasDraft] = useState(initial?.hasDraft ?? defaultTemplate.hasDraft);
  const [hasCommunityAwards, setHasCommunityAwards] = useState(initial?.hasCommunityAwards ?? defaultTemplate.hasCommunityAwards);
  const [maxTeamSize, setMaxTeamSize] = useState(initial?.maxTeamSize ?? defaultTemplate.maxTeamSize);
  const [minTeamSize, setMinTeamSize] = useState(initial?.minTeamSize ?? defaultTemplate.minTeamSize);
  const [starterCount, setStarterCount] = useState(initial?.starterCount ?? defaultTemplate.starterCount);
  const [positions, setPositions] = useState(initial?.positions ?? defaultTemplate.positions);
  const [stagePlan, setStagePlan] = useState<StagePlan>(
    initial?.stagePlan ?? defaultTemplate.stagePlan,
  );
  const [allowedPlayerTypes, setAllowedPlayerTypes] = useState<PlayerType[]>(
    defaultConfig.allowedPlayerTypes,
  );
  const [currentMin, setCurrentMin] = useState(defaultConfig.rankThreshold.currentMin ?? NO_RANK);
  const [peakMin, setPeakMin] = useState(defaultConfig.rankThreshold.peakMin ?? NO_RANK);
  const [maxPerPosition, setMaxPerPosition] = useState(defaultConfig.maxPerPosition);
  const [screenshotCount, setScreenshotCount] = useState(defaultConfig.screenshotCount);
  const [maxTotal, setMaxTotal] = useState(defaultConfig.maxTotal);
  const [mapPool, setMapPool] = useState(defaultConfig.mapPool);
  const [teamConfig, setTeamConfig] = useState<TeamRegistrationConfig>(defaultTeamConfig);
  const [affiliationRules, setAffiliationRules] = useState<InstitutionAffiliationRule[]>(
    initial?.affiliationRules ?? defaultTemplate.affiliationRules,
  );

  const editCapabilities = getSeasonEditCapabilities({
    status: initial?.status ?? "draft",
    registrationOpenedAt: initial?.registrationOpenedAt ?? null,
    competitionTemplate: initialTemplate,
  });
  const isBuiltIn = template !== "custom";
  const title = mode === "create" ? "新建赛季" : "赛季设置";
  const slugNeedsManualInput = mode === "create" && Boolean(name.trim()) && !slug.trim();

  function togglePlayerType(type: PlayerType) {
    setAllowedPlayerTypes((current) => {
      if (current.includes(type)) {
        return current.length === 1 ? current : current.filter((item) => item !== type);
      }
      return [...current, type];
    });
  }

  function applyTemplate(nextTemplate: CompetitionTemplate) {
    const next = createCompetitionTemplate(nextTemplate);
    setTemplate(nextTemplate);
    setKind(nextTemplate === "major" ? "Major" : nextTemplate === "rivals" ? "Rivals" : "自定义赛事");
    applyCapabilities(next);
  }

  function requestTemplate(nextTemplate: CompetitionTemplate) {
    if (mode === "edit" && nextTemplate !== template) setPendingTemplate(nextTemplate);
    else applyTemplate(nextTemplate);
  }

  function applyCapabilities(capabilities: SeasonCapabilities) {
    setRegistrationMode(capabilities.registrationMode);
    setHasCaptainVoting(capabilities.hasCaptainVoting);
    setHasDraft(capabilities.hasDraft);
    setMaxTeamSize(capabilities.maxTeamSize);
    setMinTeamSize(capabilities.minTeamSize);
    setStarterCount(capabilities.starterCount);
    setPositions([...capabilities.positions]);
    setStagePlan(capabilities.stagePlan);
    setAllowedPlayerTypes(capabilities.registrationConfig.allowedPlayerTypes);
    setCurrentMin(capabilities.registrationConfig.rankThreshold.currentMin ?? NO_RANK);
    setPeakMin(capabilities.registrationConfig.rankThreshold.peakMin ?? NO_RANK);
    setMaxPerPosition(capabilities.registrationConfig.maxPerPosition);
    setScreenshotCount(capabilities.registrationConfig.screenshotCount);
    setMaxTotal(capabilities.registrationConfig.maxTotal);
    setMapPool([...capabilities.registrationConfig.mapPool]);
    setTeamConfig(capabilities.teamRegistrationConfig);
    setAffiliationRules([...capabilities.affiliationRules]);
  }

  // A create slug follows the name until the operator explicitly takes it over.
  useEffect(() => {
    if (mode === "create" && !slugManuallyEdited) {
      const nextSlug = slugFromName(name);
      if (slug !== nextSlug) setSlug(nextSlug);
    }
  }, [mode, name, slug, slugManuallyEdited]);

  function handleRegistrationModeChange(value: "solo" | "team") {
    setRegistrationMode(value);
    if (value === "team") {
      setHasCaptainVoting(false);
      setHasDraft(false);
    } else {
      setHasCaptainVoting(true);
      setHasDraft(true);
    }
  }

  function buildPayload(): SeasonFormInput {
    const registrationConfig: RegistrationConfig = {
      allowedPlayerTypes,
      rankThreshold: {
        currentMin: currentMin === NO_RANK ? null : currentMin,
        peakMin: peakMin === NO_RANK ? null : peakMin,
      },
      maxPerPosition,
      screenshotCount,
      maxTotal,
      mapPool,
    };

    return {
      id: initial?.id,
      name,
      slug,
      kind,
      template,
      themeColor: emptyToNull(themeColor),
      registrationOpensAt: emptyToNull(registrationOpensAt),
      registrationClosesAt: emptyToNull(registrationClosesAt),
      rosterChangeClosesAt: emptyToNull(rosterChangeClosesAt),
      endAt: emptyToNull(endAt),
      registrationMode,
      hasCaptainVoting: registrationMode === "team" ? false : hasCaptainVoting,
      hasDraft: registrationMode === "team" ? false : hasDraft,
      hasCommunityAwards,
      minTeamSize,
      maxTeamSize,
      starterCount,
      positions,
      stagePlan,
      registrationConfig: { ...registrationConfig, mapPool },
      teamRegistrationConfig: teamConfig,
      affiliationRules,
    };
  }

  const standardMajorCheck = checkStandardMajorCapabilities(buildPayload() as SeasonCapabilities);
  const isMajorDisplayContext = template === "major";

  function handleSubmit() {
    const payload = buildPayload();
    if (slugNeedsManualInput) {
      toast.error("URL 标识无法从当前名称自动生成，请填写小写字母、数字或连字符。");
      return;
    }
    startTransition(async () => {
      const result = mode === "create"
        ? await createSeason(payload)
        : await updateSeason(payload);
      if (result.success) {
        toast.success(mode === "create" ? "赛季已创建" : "赛季已更新");
        router.push(`/admin/${result.data.slug}/settings` as never);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handlePublish() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await publishSeason(initial.id!);
      if (result.success) {
        toast.success("赛季已发布");
        router.push(`/admin/${result.data.slug}/settings` as never);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleOpenRegistration() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await openSeasonRegistration(initial.id);
      if (result.success) {
        toast.success("报名已开放，竞技参考策略已冻结");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleDelete() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await deleteSeason(initial.id!);
      if (result.success) {
        toast.success("赛季已删除");
        router.push("/admin");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleRevertToDraft() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await revertSeasonToDraft(initial.id!);
      if (result.success) {
        toast.success("已撤回至草稿");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleRevertToRegistration() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await revertSeasonToRegistration(initial.id!);
      if (result.success) {
        toast.success("已撤回至报名阶段");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleForceFinish() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await forceFinishSeason(initial.id!);
      if (result.success) {
        toast.success("赛季已手动结束");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleArchive() {
    if (!initial?.id) return;
    startTransition(async () => {
      const result = await archiveSeason(initial.id!);
      if (result.success) {
        toast.success("赛季已归档");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  const SaveBtn = () => (
    mode === "edit" ? (
      <div className="flex justify-end pt-2">
        <Button type="button" size="sm" disabled={isPending} onClick={handleSubmit}>
          {isPending ? "保存中…" : "保存"}
        </Button>
      </div>
    ) : null
  );

  if (mode === "create") {
    return (
      <Card className="p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-dim)]">创建后仅保存为内部草稿；时间字段均可稍后填写。</p>
          <div className="mt-4"><LifecycleExplanation phase={editCapabilities.phase} /></div>
        </div>

        <section className="space-y-2">
          <Label>赛事体系</Label>
          <Select disabled={!editCapabilities.canEditTemplate} value={template} onValueChange={(v) => requestTemplate(v as CompetitionTemplate)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rivals">Rivals</SelectItem>
              <SelectItem value="major">Major</SelectItem>
              <SelectItem value="custom">自定义赛事</SelectItem>
            </SelectContent>
          </Select>
          {pendingTemplate && <InlineConfirm title="切换赛事体系会覆盖当前赛制配置" sub="请确认后应用新的内置模板。" onCancel={() => setPendingTemplate(null)} onConfirm={() => { applyTemplate(pendingTemplate); setPendingTemplate(null); }} />}
        </section>

        {isMajorDisplayContext && <section
          aria-live="polite"
          className={standardMajorCheck.isStandardMajor
            ? "rounded-sm border border-[var(--color-ok-edge)] bg-[var(--color-ok-soft)] p-4 text-sm"
            : "rounded-sm border border-[var(--color-warn-edge)] bg-[var(--color-warn-soft)] p-4 text-sm"}
        >
          {standardMajorCheck.isStandardMajor ? (
            <>
              <h2 className="font-semibold">标准 Major 摘要</h2>
              <p className="mt-1 text-[var(--color-fg-mid)]">
                32 支队伍；队伍整体报名；每队 {minTeamSize}–{maxTeamSize} 人；三阶段瑞士轮；8 队单败淘汰。
              </p>
              <p className="mt-1 text-[var(--color-fg-mid)]">
                阶段一、二：普通比赛 BO1，晋级/淘汰局 BO3；阶段三：全部 BO3；淘汰赛：四分之一决赛、半决赛 BO3，决赛 BO5。
              </p>
            </>
          ) : (
            <>
              <h2 className="font-semibold">Major 标准规则尚未完整应用。</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--color-fg-mid)]">
                {standardMajorCheck.failures.slice(0, 4).map((check) => (
                  <li key={check.key}>{check.reason}</li>
                ))}
              </ul>
            </>
          )}
        </section>}

        <section className="space-y-4">
          <h2 className="font-semibold">基础信息</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label htmlFor="season-name">名称</Label><Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div>
              <Label htmlFor="season-slug">Slug</Label>
              <Input id="season-slug" value={slug} aria-invalid={slugNeedsManualInput} onChange={(e) => { setSlugManuallyEdited(true); setSlug(e.target.value); }} />
              {slugNeedsManualInput ? (
                <p className="text-xs text-[var(--color-danger)] mt-1">URL 标识无法从当前名称自动生成，请填写小写字母、数字或连字符。</p>
              ) : (
                <p className="text-xs text-[var(--color-fg-dim)] mt-1">URL 路径标识，输入名称后自动生成，可手动修改</p>
              )}
            </div>
            <div><Label>赛事体系</Label><Input value={template === "major" ? "Major" : template === "rivals" ? "Rivals" : "自定义赛事"} disabled /></div>
            <div><Label>主题色</Label><ThemeColorPicker value={themeColor} onChange={setThemeColor} /></div>
            <div>
              <Label htmlFor="registration-opens-at">报名开放时间</Label>
              <Input id="registration-opens-at" type="datetime-local" value={registrationOpensAt ?? ""} disabled={!editCapabilities.canEditRegistrationOpenSchedule} onChange={(e) => setRegistrationOpensAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="registration-closes-at">报名截止时间</Label>
              <Input id="registration-closes-at" type="datetime-local" value={registrationClosesAt ?? ""} disabled={!editCapabilities.canEditRegistrationDeadlines} onChange={(e) => setRegistrationClosesAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="roster-change-closes-at">名单调整截止时间</Label>
              <Input id="roster-change-closes-at" type="datetime-local" value={rosterChangeClosesAt ?? ""} disabled={!editCapabilities.canEditRegistrationDeadlines} onChange={(e) => setRosterChangeClosesAt(e.target.value)} />
            </div>
            <div><Label htmlFor="end-at">赛季结束时间</Label><Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} /></div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold">功能</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="社区奖"
              checked={hasCommunityAwards}
              disabled={!editCapabilities.canEditPublicRules}
              onChange={(e) => setHasCommunityAwards(e.target.checked)}
            />
            <span>
              <span className="font-medium">社区奖</span>
              <span className="mt-1 block text-xs text-[var(--color-fg-dim)]">默认启用；发布后按赛事公开规则锁定。关闭后公开页、后台入口和社区奖操作均不可用。</span>
            </span>
          </label>
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold">参赛与队伍设置</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>报名模式</Label>
              <Select value={registrationMode} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onValueChange={(v) => handleRegistrationModeChange(v as "solo" | "team")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solo">个人报名</SelectItem>
                  <SelectItem value="team">队伍报名</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <PositionEditor value={positions} disabled={!editCapabilities.canEditPublicRules} onChange={setPositions} />
            <div><Label htmlFor="max-team-size">每队人数上限</Label><Input id="max-team-size" type="number" min={1} value={maxTeamSize} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setMaxTeamSize(Number(e.target.value))} /></div>
            <div><Label htmlFor="min-team-size">每队人数下限</Label><Input id="min-team-size" type="number" min={1} value={minTeamSize} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setMinTeamSize(Number(e.target.value))} /></div>
            <div><Label htmlFor="starter-count">首发人数</Label><Input id="starter-count" type="number" min={1} value={starterCount} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setStarterCount(Number(e.target.value))} /></div>
          </div>
          {isBuiltIn && registrationMode === "team" && (
            <p className="text-xs text-[var(--color-fg-dim)]">内置赛事体系的报名模式、队伍规模与首发人数由标准规则固定。</p>
          )}
          {registrationMode === "solo" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={hasCaptainVoting} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setHasCaptainVoting(e.target.checked)} />队长投票</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={hasDraft} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setHasDraft(e.target.checked)} />蛇形选秀</label>
            </div>
          )}
        </section>

        {registrationMode === "solo" && isBuiltIn && (
          <section className="space-y-4">
            <h2 className="font-semibold">比赛图池</h2>
            <MapPoolEditor value={mapPool} disabled={!editCapabilities.canEditPublicRules} onChange={setMapPool} />
          </section>
        )}

        {registrationMode === "solo" && !isBuiltIn && (
          <section className="space-y-4">
            <h2 className="font-semibold">报名配置</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              {PLAYER_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2">
                  <input type="checkbox" checked={allowedPlayerTypes.includes(type)} disabled={!editCapabilities.canEditPublicRules} onChange={() => togglePlayerType(type)} />
                  {PLAYER_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>当前段位门槛</Label><Select disabled={!editCapabilities.canEditPublicRules} value={currentMin} onValueChange={setCurrentMin}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_RANK}>无门槛</SelectItem>{rankValues.map((rank) => (<SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>))}</SelectContent></Select></div>
              <div><Label>历史段位门槛</Label><Select disabled={!editCapabilities.canEditPublicRules} value={peakMin} onValueChange={setPeakMin}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_RANK}>无门槛</SelectItem>{rankValues.map((rank) => (<SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>))}</SelectContent></Select></div>
              <div><Label htmlFor="max-position">每位置上限</Label><Input id="max-position" type="number" min={1} max={50} value={maxPerPosition} disabled={!editCapabilities.canEditPublicRules} onChange={(e) => setMaxPerPosition(Number(e.target.value))} /></div>
              <div><Label htmlFor="screenshot-count">截图链接数量</Label><Input id="screenshot-count" type="number" min={1} max={5} value={screenshotCount} disabled={!editCapabilities.canEditPublicRules} onChange={(e) => setScreenshotCount(Number(e.target.value))} /></div>
              <div className="sm:col-span-2"><MapPoolEditor value={mapPool} disabled={!editCapabilities.canEditPublicRules} onChange={setMapPool} /></div>
            </div>
          </section>
        )}

        {registrationMode === "team" && template === "custom" && (
          <section className="space-y-4">
            <h2 className="font-semibold">队伍报名配置</h2>
            <TeamConfigForm value={teamConfig} maxTeamSize={maxTeamSize} competitivePlatforms={competitivePlatforms} disabled={!editCapabilities.canEditPublicRules} onChange={setTeamConfig} />
          </section>
        )}
        {registrationMode === "team" && template === "major" && (
          <section className="space-y-4">
            <h2 className="font-semibold">5E 等效竞技资料</h2>
            <TeamConfigForm value={teamConfig} competitivePlatforms={competitivePlatforms} fallbackOnly disabled={!editCapabilities.canEditFallbackConversion} onChange={setTeamConfig} />
          </section>
        )}

        {registrationMode === "team" && <section className="space-y-4"><h2 className="font-semibold">比赛图池</h2><MapPoolEditor value={mapPool} disabled={!editCapabilities.canEditPublicRules} onChange={setMapPool} /></section>}

        {template === "custom" && <section className="space-y-4">
          <h2 className="font-semibold">赛制配置</h2>
          <StagePlanEditor value={stagePlan} disabled={!editCapabilities.canEditPublicRules} onChange={setStagePlan} />
        </section>}

        <div className="flex justify-end">
            <Button type="button" disabled={isPending || slugNeedsManualInput} onClick={handleSubmit}>
            {isPending ? "保存中…" : "保存为草稿"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <LifecycleExplanation phase={editCapabilities.phase} />
      </div>

      <SettingsPanel id="basic" label="基本信息">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="season-name">名称</Label>
            <Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="season-slug">Slug</Label>
            <Input id="season-slug" value={slug} disabled={!editCapabilities.canEditSlug} onChange={(e) => { setSlugManuallyEdited(true); setSlug(e.target.value); }} />
            <p className="mt-1 text-xs text-[var(--color-fg-dim)]">{editCapabilities.canEditSlug ? "草稿可修改 slug；名称修改不会自动重写已有 URL 标识。" : "发布后锁定 URL 标识。"}</p>
          </div>
          <div>
            <Label>赛事体系</Label>
            {editCapabilities.canEditTemplate ? (
              <>
                <Select value={template} onValueChange={(v) => requestTemplate(v as CompetitionTemplate)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rivals">Rivals</SelectItem>
                    <SelectItem value="major">Major</SelectItem>
                    <SelectItem value="custom">自定义赛事</SelectItem>
                  </SelectContent>
                </Select>
                {pendingTemplate && <InlineConfirm title="切换赛事体系会覆盖当前赛制配置" sub="请确认后应用新的内置模板。" onCancel={() => setPendingTemplate(null)} onConfirm={() => { applyTemplate(pendingTemplate); setPendingTemplate(null); }} />}
              </>
            ) : (
              <Input value={templateLabel(template)} disabled />
            )}
            {!editCapabilities.canEditTemplate && (
              <div className="mt-3">
                <FrozenFact title={`赛事体系：${templateLabel(template)}`}>已发布后不可修改赛事体系与其 canonical 公开规则。</FrozenFact>
              </div>
            )}
          </div>
          <div>
            <Label>主题色</Label>
            <ThemeColorPicker value={themeColor} onChange={setThemeColor} />
          </div>
        </div>
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="lifecycle" label="时间与生命周期">
        <LifecycleFacts status={initial?.status ?? "draft"} phase={editCapabilities.phase} registrationOpenedAt={initial?.registrationOpenedAt} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="registration-opens-at">报名开放时间</Label>
            <Input id="registration-opens-at" type="datetime-local" value={registrationOpensAt ?? ""} disabled={!editCapabilities.canEditRegistrationOpenSchedule} onChange={(e) => setRegistrationOpensAt(e.target.value)} />
            <p className="mt-1 text-xs text-[var(--color-fg-dim)]">{editCapabilities.canEditRegistrationOpenSchedule ? "可稍后填写；留空表示赛事已公开但报名时间待定。" : "实际开放后锁定报名开放时间。"}</p>
          </div>
          <div>
            <Label htmlFor="registration-closes-at">报名截止时间</Label>
            <Input id="registration-closes-at" type="datetime-local" value={registrationClosesAt ?? ""} disabled={!editCapabilities.canEditRegistrationDeadlines} onChange={(e) => setRegistrationClosesAt(e.target.value)} />
            <p className="mt-1 text-xs text-[var(--color-fg-dim)]">截止后不再接受新的报名。{editCapabilities.canEditRegistrationDeadlines ? "比赛开始前仍可运营调整。" : "比赛开始后锁定。"}</p>
          </div>
          <div>
            <Label htmlFor="roster-change-closes-at">名单调整截止时间</Label>
            <Input id="roster-change-closes-at" type="datetime-local" value={rosterChangeClosesAt ?? ""} disabled={!editCapabilities.canEditRegistrationDeadlines} onChange={(e) => setRosterChangeClosesAt(e.target.value)} />
            <p className="mt-1 text-xs text-[var(--color-fg-dim)]">已报名队伍可在此之前自行调整本届名单；留空时回退到报名截止时间。{editCapabilities.canEditRegistrationDeadlines ? "比赛开始前仍可运营调整。" : "比赛开始后锁定。"}</p>
          </div>
          <div>
            <Label htmlFor="end-at">赛季结束时间</Label>
            <Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} />
            <p className="mt-1 text-xs text-[var(--color-fg-dim)]">仅作为赛事 metadata 与赛后收尾参考，不替代生命周期 transition owner。</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--color-border)] pt-4">
          {initial?.status === "draft" && <Button type="button" variant="outline" disabled={isPending} onClick={() => setPublishConfirmationOpen(true)}>发布赛季</Button>}
          {initial?.status === "registration" && !initial.registrationOpenedAt && <Button type="button" disabled={isPending} onClick={handleOpenRegistration}>立即开放报名</Button>}
        </div>
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="registration" label="报名与名单">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>报名模式</Label>
            <Select value={registrationMode} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onValueChange={(v) => handleRegistrationModeChange(v as "solo" | "team")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="solo">个人报名</SelectItem>
                <SelectItem value="team">队伍报名</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PositionEditor value={positions} disabled={!editCapabilities.canEditPublicRules} onChange={setPositions} />
          <div><Label htmlFor="max-team-size">每队人数上限</Label><Input id="max-team-size" type="number" min={1} value={maxTeamSize} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setMaxTeamSize(Number(e.target.value))} /></div>
          <div><Label htmlFor="min-team-size">每队人数下限</Label><Input id="min-team-size" type="number" min={1} value={minTeamSize} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setMinTeamSize(Number(e.target.value))} /></div>
          <div><Label htmlFor="starter-count">首发人数</Label><Input id="starter-count" type="number" min={1} value={starterCount} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setStarterCount(Number(e.target.value))} /></div>
        </div>
        {isBuiltIn && registrationMode === "team" && (
          <>
            <FrozenFact title={`${templateLabel(template)} · 队伍报名规则`}>
              报名模式、队伍规模和首发人数由当前赛事 template canonical owner 固定；页面不会让客户端绕过标准规则提交另一套值。
            </FrozenFact>
            <TeamRegistrationSummary config={teamConfig} />
          </>
        )}
        {registrationMode === "solo" && (
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasCaptainVoting} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setHasCaptainVoting(e.target.checked)} />队长投票</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasDraft} disabled={!editCapabilities.canEditPublicRules || isBuiltIn} onChange={(e) => setHasDraft(e.target.checked)} />蛇形选秀</label>
          </div>
        )}
        {registrationMode === "team" && template === "custom" && (
          <div className="mt-5 border-t border-[var(--color-border)] pt-5">
            <TeamConfigForm view="team" value={teamConfig} maxTeamSize={maxTeamSize} competitivePlatforms={competitivePlatforms} disabled={!editCapabilities.canEditPublicRules} onChange={setTeamConfig} />
          </div>
        )}
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="qualification" label="资格规则">
        {registrationMode === "solo" && !isBuiltIn ? (
          <div className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-medium">个人报名资格</h3>
              <div className="flex flex-wrap gap-4 text-sm">
                {PLAYER_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2">
                    <input type="checkbox" checked={allowedPlayerTypes.includes(type)} disabled={!editCapabilities.canEditPublicRules} onChange={() => togglePlayerType(type)} />
                    {PLAYER_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>当前段位门槛</Label>
                  <Select disabled={!editCapabilities.canEditPublicRules} value={currentMin} onValueChange={setCurrentMin}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NO_RANK}>无门槛</SelectItem>{rankValues.map((rank) => <SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>历史段位门槛</Label>
                  <Select disabled={!editCapabilities.canEditPublicRules} value={peakMin} onValueChange={setPeakMin}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={NO_RANK}>无门槛</SelectItem>{rankValues.map((rank) => <SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label htmlFor="max-position">每位置上限</Label><Input id="max-position" type="number" min={1} max={50} value={maxPerPosition} disabled={!editCapabilities.canEditPublicRules} onChange={(e) => setMaxPerPosition(Number(e.target.value))} /></div>
                <div><Label htmlFor="screenshot-count">截图链接数量</Label><Input id="screenshot-count" type="number" min={1} max={5} value={screenshotCount} disabled={!editCapabilities.canEditPublicRules} onChange={(e) => setScreenshotCount(Number(e.target.value))} /></div>
              </div>
            </div>
            <AffiliationRulesSummary rules={affiliationRules} />
          </div>
        ) : (
          <div className="space-y-5">
            {registrationMode === "solo" && (
              <SoloQualificationSummary
                allowedPlayerTypes={allowedPlayerTypes}
                currentMin={currentMin}
                peakMin={peakMin}
                maxPerPosition={maxPerPosition}
                screenshotCount={screenshotCount}
              />
            )}
            {registrationMode === "team" && <TeamQualificationSummary config={teamConfig} />}
            <AffiliationRulesSummary rules={affiliationRules} />
          </div>
        )}
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="format" label="赛制与地图">
        <div className="space-y-5">
          <MapPoolEditor value={mapPool} disabled={!editCapabilities.canEditPublicRules} onChange={setMapPool} />
          {template === "custom" ? (
            <div className="border-t border-[var(--color-border)] pt-5">
              <h3 className="mb-3 text-sm font-medium">赛程阶段</h3>
              <StagePlanEditor value={stagePlan} disabled={!editCapabilities.canEditPublicRules} onChange={setStagePlan} />
            </div>
          ) : (
            <div className="border-t border-[var(--color-border)] pt-5">
              <StagePlanSummary stagePlan={stagePlan} />
            </div>
          )}
        </div>
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="competitive" label="竞技参考">
        {template === "custom" && registrationMode === "team" && !initial?.registrationOpenedAt ? (
          <>
            {!editCapabilities.canEditPublicRules && (
              <div className="mb-4">
                <FrozenFact title="竞技参考：已发布后不可修改">实际开放报名时由 canonical lifecycle owner 冻结平台赛季、段位顺序与策略快照。</FrozenFact>
              </div>
            )}
            <TeamConfigForm view="competitive" value={teamConfig} competitivePlatforms={competitivePlatforms} disabled={!editCapabilities.canEditPublicRules} onChange={setTeamConfig} />
          </>
        ) : (
          <CompetitiveReferenceSummary config={teamConfig} platforms={competitivePlatforms} frozen={Boolean(initial?.registrationOpenedAt)} />
        )}
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="features" label="功能">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" aria-label="社区奖" checked={hasCommunityAwards} disabled={!editCapabilities.canEditPublicRules} onChange={(e) => setHasCommunityAwards(e.target.checked)} />
          <span>
            <span className="font-medium">社区奖</span>
            <span className="mt-1 block text-xs text-[var(--color-fg-dim)]">默认启用；发布后按赛事公开规则锁定。关闭后公开页、后台入口和社区奖操作均不可用。</span>
          </span>
        </label>
        {!editCapabilities.canEditPublicRules && <div className="mt-4"><FrozenFact title={`社区奖：${hasCommunityAwards ? "已启用" : "已关闭"}`}>社区奖是赛事公开 capability；发布后不能再改变，入口和服务端操作会继续消费这个事实。</FrozenFact></div>}
        <SaveBtn />
      </SettingsPanel>

      <SettingsPanel id="danger" label="危险操作">
        <div className="space-y-3">
          {initial?.status === "draft" && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">删除草稿赛季</p><p className="text-sm text-[var(--color-fg-mid)]">只有尚未产生报名、队伍或赛程事实的草稿可以删除。</p></div><Button type="button" variant="destructive" disabled={isPending} onClick={() => setDangerAction("delete")}>删除赛季</Button></div>}
          {initial?.status === "registration" && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">撤回至草稿</p><p className="text-sm text-[var(--color-fg-mid)]">撤回前由服务端检查赛事是否仍没有历史事实。</p></div><Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("revert-draft")}>撤回至草稿</Button></div>}
          {initial?.status === "voting" && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">撤回至报名阶段</p><p className="text-sm text-[var(--color-fg-mid)]">该操作会清空投票事实，并继续由现有 transition owner 校验。</p></div><Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("revert-registration")}>撤回至报名阶段</Button></div>}
          {initial?.status === "playing" && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">手动结束赛事</p><p className="text-sm text-[var(--color-fg-mid)]">仅用于无法自动结束的极端情况；结果与审计仍由服务端 owner 处理。</p></div><Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("finish")}>手动结束赛季</Button></div>}
          {initial?.status === "finished" && <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">归档赛事</p><p className="text-sm text-[var(--color-fg-mid)]">归档后赛事进入只读历史状态。</p></div><Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("archive")}>归档赛季</Button></div>}
          {!(["draft", "registration", "voting", "playing", "finished"] as const).includes(initial?.status as never) && <p className="text-sm text-[var(--color-fg-mid)]">当前状态没有可用的危险操作。</p>}
        </div>
        <SeasonDangerConfirmation action={dangerAction} onOpenChange={(open) => { if (!open) setDangerAction(null); }} onConfirm={() => { const action = dangerAction; setDangerAction(null); if (action === "delete") handleDelete(); if (action === "revert-draft") handleRevertToDraft(); if (action === "revert-registration") handleRevertToRegistration(); if (action === "finish") handleForceFinish(); if (action === "archive") handleArchive(); }} />
      </SettingsPanel>

      <AlertDialog open={publishConfirmationOpen} onOpenChange={setPublishConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>发布 {name || "这个赛季"}？</AlertDialogTitle>
            <AlertDialogDescription>
              发布后赛事将对用户公开，核心赛制与资格规则将锁定。报名{registrationOpensAt ? `计划于 ${registrationOpensAt} 开放` : "时间待定"}；竞技参考赛季会在实际开放报名时冻结。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setPublishConfirmationOpen(false); handlePublish(); }}>确认发布</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const DANGER_CONFIRMATION = {
  delete: { title: "确认删除这个草稿赛季？", description: "删除后该草稿赛季及其配置不能恢复。", action: "删除赛季" },
  "revert-draft": { title: "确认撤回至草稿？", description: "此操作仅在无任何报名记录时允许。", action: "撤回至草稿" },
  "revert-registration": { title: "确认撤回至报名阶段？", description: "所有投票记录将被清空。", action: "撤回至报名阶段" },
  finish: { title: "确认手动结束赛季？", description: "此操作只用于无法自动结束的极端情况。", action: "手动结束" },
  archive: { title: "确认归档赛季？", description: "归档后赛季将移至历史记录。", action: "归档赛季" },
} as const;

function SeasonDangerConfirmation({ action, onOpenChange, onConfirm }: { action: keyof typeof DANGER_CONFIRMATION | null; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const content = action ? DANGER_CONFIRMATION[action] : null;
  return <AlertDialog open={Boolean(content)} onOpenChange={onOpenChange}>{content && <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{content.title}</AlertDialogTitle><AlertDialogDescription>{content.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>{content.action}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>}</AlertDialog>;
}
