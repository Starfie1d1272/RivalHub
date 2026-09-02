"use client";

import { useState, useTransition, useEffect } from "react";
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
} from "@/types/season";
import { checkStandardMajorCapabilities } from "@/lib/competition/definition";
import { createCompetitionTemplate, type CompetitionTemplate } from "@/lib/competition/templates";
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
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function SeasonForm({ mode, initial, competitivePlatforms }: SeasonFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The persisted competitionTemplate is the sole identity owner. Missing
  // identity is treated as custom instead of inferred from capability shape.
  const initialTemplate = initial?.template ?? "custom";
  const defaultTemplate = createCompetitionTemplate(initialTemplate);

  const defaultConfig = initial?.registrationConfig ?? defaultTemplate.registrationConfig;
  const defaultTeamConfig = initial?.teamRegistrationConfig ?? defaultTemplate.teamRegistrationConfig;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
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

  const coreLocked = mode === "edit" && initial?.status !== "draft";
  const isBuiltIn = template !== "custom";
  const title = mode === "create" ? "新建赛季" : "赛季设置";

  const fieldHelp = coreLocked
    ? "当前赛季不在 draft 状态，slug、赛制、队伍规模等核心配置不可修改。"
    : null;

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

  // Auto-set slug from name when slug is empty and in create mode
  useEffect(() => {
    if (mode === "create" && !slug && name) {
      setSlug(slugFromName(name));
    }
  }, [mode, name, slug]);

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
      slug: slug || slugFromName(name),
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
        </div>

        <section className="space-y-2">
          <Label>赛事体系</Label>
          <Select value={template} onValueChange={(v) => requestTemplate(v as CompetitionTemplate)}>
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
              <Input id="season-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
              <p className="text-xs text-[var(--color-fg-dim)] mt-1">URL 路径标识，输入名称后自动生成，可手动修改</p>
            </div>
            <div><Label>赛事体系</Label><Input value={template === "major" ? "Major" : template === "rivals" ? "Rivals" : "自定义赛事"} disabled /></div>
            <div><Label>主题色</Label><ThemeColorPicker value={themeColor} onChange={setThemeColor} /></div>
            <div>
              <Label htmlFor="registration-opens-at">报名开放时间</Label>
              <Input id="registration-opens-at" type="datetime-local" value={registrationOpensAt ?? ""} onChange={(e) => setRegistrationOpensAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="registration-closes-at">报名截止时间</Label>
              <Input id="registration-closes-at" type="datetime-local" value={registrationClosesAt ?? ""} onChange={(e) => setRegistrationClosesAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="roster-change-closes-at">名单调整截止时间</Label>
              <Input id="roster-change-closes-at" type="datetime-local" value={rosterChangeClosesAt ?? ""} onChange={(e) => setRosterChangeClosesAt(e.target.value)} />
            </div>
            <div><Label htmlFor="end-at">赛季结束时间</Label><Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} /></div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold">参赛与队伍设置</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>报名模式</Label>
              <Select value={registrationMode} disabled={isBuiltIn} onValueChange={(v) => handleRegistrationModeChange(v as "solo" | "team")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solo">个人报名</SelectItem>
                  <SelectItem value="team">队伍报名</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <PositionEditor value={positions} onChange={setPositions} />
            <div><Label htmlFor="max-team-size">每队人数上限</Label><Input id="max-team-size" type="number" min={1} value={maxTeamSize} disabled={isBuiltIn} onChange={(e) => setMaxTeamSize(Number(e.target.value))} /></div>
            <div><Label htmlFor="min-team-size">每队人数下限</Label><Input id="min-team-size" type="number" min={1} value={minTeamSize} disabled={isBuiltIn} onChange={(e) => setMinTeamSize(Number(e.target.value))} /></div>
            <div><Label htmlFor="starter-count">首发人数</Label><Input id="starter-count" type="number" min={1} value={starterCount} disabled={isBuiltIn} onChange={(e) => setStarterCount(Number(e.target.value))} /></div>
          </div>
          {isBuiltIn && registrationMode === "team" && (
            <p className="text-xs text-[var(--color-fg-dim)]">内置赛事体系的报名模式、队伍规模与首发人数由标准规则固定。</p>
          )}
          {registrationMode === "solo" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={hasCaptainVoting} disabled={isBuiltIn} onChange={(e) => setHasCaptainVoting(e.target.checked)} />队长投票</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={hasDraft} disabled={isBuiltIn} onChange={(e) => setHasDraft(e.target.checked)} />蛇形选秀</label>
            </div>
          )}
        </section>

        {registrationMode === "solo" && isBuiltIn && (
          <section className="space-y-4">
            <h2 className="font-semibold">比赛图池</h2>
            <MapPoolEditor value={mapPool} onChange={setMapPool} />
          </section>
        )}

        {registrationMode === "solo" && !isBuiltIn && (
          <section className="space-y-4">
            <h2 className="font-semibold">报名配置</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              {PLAYER_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2">
                  <input type="checkbox" checked={allowedPlayerTypes.includes(type)} onChange={() => togglePlayerType(type)} />
                  {PLAYER_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>当前段位门槛</Label><Select value={currentMin} onValueChange={setCurrentMin}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_RANK}>无门槛</SelectItem>{rankValues.map((rank) => (<SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>))}</SelectContent></Select></div>
              <div><Label>历史段位门槛</Label><Select value={peakMin} onValueChange={setPeakMin}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_RANK}>无门槛</SelectItem>{rankValues.map((rank) => (<SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>))}</SelectContent></Select></div>
              <div><Label htmlFor="max-position">每位置上限</Label><Input id="max-position" type="number" min={1} max={50} value={maxPerPosition} onChange={(e) => setMaxPerPosition(Number(e.target.value))} /></div>
              <div><Label htmlFor="screenshot-count">截图链接数量</Label><Input id="screenshot-count" type="number" min={1} max={5} value={screenshotCount} onChange={(e) => setScreenshotCount(Number(e.target.value))} /></div>
              <div className="sm:col-span-2"><MapPoolEditor value={mapPool} onChange={setMapPool} /></div>
            </div>
          </section>
        )}

        {registrationMode === "team" && template === "custom" && (
          <section className="space-y-4">
            <h2 className="font-semibold">队伍报名配置</h2>
            <TeamConfigForm value={teamConfig} maxTeamSize={maxTeamSize} competitivePlatforms={competitivePlatforms} onChange={setTeamConfig} />
          </section>
        )}
        {registrationMode === "team" && template === "major" && (
          <section className="space-y-4">
            <h2 className="font-semibold">5E 等效竞技资料</h2>
            <TeamConfigForm value={teamConfig} competitivePlatforms={competitivePlatforms} fallbackOnly disabled={coreLocked} onChange={setTeamConfig} />
          </section>
        )}

        {registrationMode === "team" && <section className="space-y-4"><h2 className="font-semibold">比赛图池</h2><MapPoolEditor value={mapPool} onChange={setMapPool} /></section>}

        {template === "custom" && <section className="space-y-4">
          <h2 className="font-semibold">赛制配置</h2>
          <StagePlanEditor value={stagePlan} onChange={setStagePlan} />
        </section>}

        <div className="flex justify-end">
          <Button type="button" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "保存中…" : "保存为草稿"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        {fieldHelp && <p className="text-sm text-[var(--color-warn)]">{fieldHelp}</p>}
      </div>

      {/* Panel 1: 基础信息 */}
      <Panel label="基础信息" pad={20}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="season-name">名称</Label>
            <Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="season-slug">Slug</Label>
            <Input id="season-slug" value={slug} disabled onChange={(e) => setSlug(e.target.value)} />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">编辑时不可修改 slug</p>
          </div>
          <div><Label>赛事体系</Label><Input value={template === "major" ? "Major" : template === "rivals" ? "Rivals" : "自定义赛事"} disabled /></div>
          <div>
            <Label>主题色</Label>
            <ThemeColorPicker value={themeColor} onChange={setThemeColor} />
          </div>
        </div>
        <SaveBtn />
      </Panel>

      {/* Panel 2: 时间设置 */}
      <Panel label="时间设置" pad={20}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="registration-opens-at">报名开放时间</Label>
            <Input id="registration-opens-at" type="datetime-local" value={registrationOpensAt ?? ""} disabled={Boolean(initial?.registrationOpenedAt)} onChange={(e) => setRegistrationOpensAt(e.target.value)} />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">可稍后填写；留空表示赛事已公开但报名时间待定。实际开放后将冻结竞技参考策略。</p>
          </div>
          <div>
            <Label htmlFor="registration-closes-at">报名截止时间</Label>
            <Input id="registration-closes-at" type="datetime-local" value={registrationClosesAt ?? ""} onChange={(e) => setRegistrationClosesAt(e.target.value)} />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">截止后不再接受新的报名。</p>
          </div>
          <div>
            <Label htmlFor="roster-change-closes-at">名单调整截止时间</Label>
            <Input id="roster-change-closes-at" type="datetime-local" value={rosterChangeClosesAt ?? ""} onChange={(e) => setRosterChangeClosesAt(e.target.value)} />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">已报名队伍可在此之前自行调整本届名单；留空时回退到报名截止时间。</p>
          </div>
          <div>
            <Label htmlFor="end-at">赛季结束时间</Label>
            <Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
        <SaveBtn />
      </Panel>

      <Panel label="参赛与队伍设置" pad={20}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>报名模式</Label>
            <Select value={registrationMode} disabled={coreLocked || isBuiltIn} onValueChange={(v) => handleRegistrationModeChange(v as "solo" | "team")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="solo">个人报名</SelectItem>
                <SelectItem value="team">队伍报名</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PositionEditor value={positions} disabled={coreLocked} onChange={setPositions} />
          <div><Label htmlFor="max-team-size">每队人数上限</Label><Input id="max-team-size" type="number" min={1} value={maxTeamSize} disabled={coreLocked || isBuiltIn} onChange={(e) => setMaxTeamSize(Number(e.target.value))} /></div>
          <div><Label htmlFor="min-team-size">每队人数下限</Label><Input id="min-team-size" type="number" min={1} value={minTeamSize} disabled={coreLocked || isBuiltIn} onChange={(e) => setMinTeamSize(Number(e.target.value))} /></div>
          <div><Label htmlFor="starter-count">首发人数</Label><Input id="starter-count" type="number" min={1} value={starterCount} disabled={coreLocked || isBuiltIn} onChange={(e) => setStarterCount(Number(e.target.value))} /></div>
        </div>
        {isBuiltIn && registrationMode === "team" && (
          <p className="text-xs text-[var(--color-fg-dim)] mt-4">内置赛事体系的报名模式、队伍规模与首发人数由标准规则固定。</p>
        )}
        {registrationMode === "solo" && (
          <div className="flex flex-wrap gap-4 text-sm mt-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasCaptainVoting} disabled={coreLocked || isBuiltIn} onChange={(e) => setHasCaptainVoting(e.target.checked)} />队长投票</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasDraft} disabled={coreLocked || isBuiltIn} onChange={(e) => setHasDraft(e.target.checked)} />蛇形选秀</label>
          </div>
        )}
        <SaveBtn />
      </Panel>

      {/* Panel 4: 比赛图池 (built-in solo) / 报名规则 (custom solo) / 队伍报名配置 (custom team) */}
      {registrationMode === "solo" && isBuiltIn && (
        <Panel label="比赛图池" pad={20}>
          <MapPoolEditor value={mapPool} disabled={coreLocked} onChange={setMapPool} />
          <SaveBtn />
        </Panel>
      )}
      {registrationMode === "solo" && !isBuiltIn && (
        <Panel label="报名规则" pad={20}>
          <div className="flex flex-wrap gap-4 text-sm mb-4">
            {PLAYER_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2">
                <input type="checkbox" checked={allowedPlayerTypes.includes(type)} onChange={() => togglePlayerType(type)} />
                {PLAYER_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>当前段位门槛</Label>
              <Select value={currentMin} onValueChange={setCurrentMin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RANK}>无门槛</SelectItem>
                  {rankValues.map((rank) => (<SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>历史段位门槛</Label>
              <Select value={peakMin} onValueChange={setPeakMin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RANK}>无门槛</SelectItem>
                  {rankValues.map((rank) => (<SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="max-position">每位置上限</Label><Input id="max-position" type="number" min={1} max={50} value={maxPerPosition} onChange={(e) => setMaxPerPosition(Number(e.target.value))} /></div>
            <div><Label htmlFor="screenshot-count">截图链接数量</Label><Input id="screenshot-count" type="number" min={1} max={5} value={screenshotCount} onChange={(e) => setScreenshotCount(Number(e.target.value))} /></div>
            <div className="sm:col-span-2"><MapPoolEditor value={mapPool} disabled={coreLocked} onChange={setMapPool} /></div>
          </div>
          <SaveBtn />
        </Panel>
      )}
      {registrationMode === "team" && template === "custom" && (
        <Panel label="队伍报名配置" pad={20}>
          <TeamConfigForm value={teamConfig} maxTeamSize={maxTeamSize} competitivePlatforms={competitivePlatforms} onChange={setTeamConfig} />
          <SaveBtn />
        </Panel>
      )}
      {registrationMode === "team" && template === "major" && (
        <Panel label="5E 等效竞技资料" pad={20}>
          <TeamConfigForm value={teamConfig} competitivePlatforms={competitivePlatforms} fallbackOnly disabled={coreLocked} onChange={setTeamConfig} />
          <SaveBtn />
        </Panel>
      )}

      {registrationMode === "team" && <Panel label="比赛图池" pad={20}><MapPoolEditor value={mapPool} disabled={coreLocked} onChange={setMapPool} /><SaveBtn /></Panel>}

      {template === "custom" && <Panel label="赛程阶段" pad={20}>
        <StagePlanEditor value={stagePlan} onChange={setStagePlan} />
        <SaveBtn />
      </Panel>}

      {/* 底部操作区（按赛季状态展示不同操作） */}
      {initial?.status === "draft" && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="destructive" disabled={isPending} onClick={() => setDangerAction("delete")}>
            删除赛季
          </Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setPublishConfirmationOpen(true)}>
            发布赛季
          </Button>
        </div>
      )}
      {initial?.status === "registration" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          {!initial.registrationOpenedAt && (
            <Button type="button" disabled={isPending} onClick={handleOpenRegistration}>
              立即开放报名
            </Button>
          )}
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("revert-draft")}>
            撤回至草稿
          </Button>
        </div>
      )}
      {initial?.status === "voting" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("revert-registration")}>
            撤回至报名阶段
          </Button>
        </div>
      )}
      {initial?.status === "playing" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("finish")}>
            手动结束赛季
          </Button>
        </div>
      )}
      {initial?.status === "finished" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setDangerAction("archive")}>
            归档赛季
          </Button>
        </div>
      )}
      <SeasonDangerConfirmation action={dangerAction} onOpenChange={(open) => { if (!open) setDangerAction(null); }} onConfirm={() => { const action = dangerAction; setDangerAction(null); if (action === "delete") handleDelete(); if (action === "revert-draft") handleRevertToDraft(); if (action === "revert-registration") handleRevertToRegistration(); if (action === "finish") handleForceFinish(); if (action === "archive") handleArchive(); }} />
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
