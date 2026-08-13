"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSeason, deleteSeason, publishSeason, updateSeason, revertSeasonToDraft, revertSeasonToRegistration, forceFinishSeason, archiveSeason, type SeasonFormInput } from "@/actions/seasons";
import {
  CS2_POSITIONS,
  PLAYER_TYPE_LABELS,
  RIVALS_REGISTRATION_CONFIG,
  RIVALS_STAGE_PLAN,
  checkStandardMajorCapabilities,
  createMajorDefaultCapabilities,
  type PlayerType,
  type RegistrationConfig,
  type SeasonCapabilities,
  type TeamRegistrationConfig,
  type StagePlan,
} from "@/types/season";
import { rankValues, RANK_LABELS } from "@/lib/validators/registration";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Panel } from "@/components/rivalhub";
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

const PLAYER_TYPES: PlayerType[] = ["enrolled", "graduated", "external"];
const NO_RANK = "__none__";

interface SeasonFormProps {
  mode: "create" | "edit";
  initial?: SeasonFormInput;
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

export function SeasonForm({ mode, initial }: SeasonFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const majorDefaults = createMajorDefaultCapabilities();

  const defaultConfig = initial?.registrationConfig ?? majorDefaults.registrationConfig;
  const defaultTeamConfig = initial?.teamRegistrationConfig ?? majorDefaults.teamRegistrationConfig;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "Major");
  const [themeColor, setThemeColor] = useState(initial?.themeColor ?? "#f97316");
  const [startAt, setStartAt] = useState(initial?.startAt ?? "");
  const [registrationDeadline, setRegistrationDeadline] = useState(initial?.registrationDeadline ?? "");
  const [endAt, setEndAt] = useState(initial?.endAt ?? "");
  const [registrationMode, setRegistrationMode] = useState<"solo" | "team">(
    initial?.registrationMode ?? "team",
  );
  const [hasCaptainVoting, setHasCaptainVoting] = useState(initial?.hasCaptainVoting ?? majorDefaults.hasCaptainVoting);
  const [hasDraft, setHasDraft] = useState(initial?.hasDraft ?? majorDefaults.hasDraft);
  const [maxTeamSize, setMaxTeamSize] = useState(initial?.maxTeamSize ?? majorDefaults.maxTeamSize);
  const [minTeamSize, setMinTeamSize] = useState(initial?.minTeamSize ?? majorDefaults.minTeamSize);
  const [starterCount, setStarterCount] = useState(initial?.starterCount ?? majorDefaults.starterCount);
  const [positionsText, setPositionsText] = useState(
    (initial?.positions ?? majorDefaults.positions ?? CS2_POSITIONS).join(","),
  );
  const [stagePlan, setStagePlan] = useState<StagePlan>(
    initial?.stagePlan ?? majorDefaults.stagePlan,
  );
  const [allowedPlayerTypes, setAllowedPlayerTypes] = useState<PlayerType[]>(
    defaultConfig.allowedPlayerTypes,
  );
  const [currentMin, setCurrentMin] = useState(defaultConfig.rankThreshold.currentMin ?? NO_RANK);
  const [peakMin, setPeakMin] = useState(defaultConfig.rankThreshold.peakMin ?? NO_RANK);
  const [maxPerPosition, setMaxPerPosition] = useState(defaultConfig.maxPerPosition);
  const [screenshotCount, setScreenshotCount] = useState(defaultConfig.screenshotCount);
  const [maxTotal] = useState(defaultConfig.maxTotal);
  const [mapPoolText, setMapPoolText] = useState(
    defaultConfig.mapPool.join(","),
  );
  const [teamConfig, setTeamConfig] = useState<TeamRegistrationConfig>(defaultTeamConfig);

  const coreLocked = mode === "edit" && initial?.status !== "draft";
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

  function applyPreset(preset: "major" | "rivals") {
    if (!confirm("应用预设将覆盖当前所有配置，是否继续？")) return;
    if (preset === "major") {
      setKind("Major");
      applyCapabilities(createMajorDefaultCapabilities());
    } else {
      setKind("选秀联赛");
      handleRegistrationModeChange("solo");
      setMaxTeamSize(7);
      setMinTeamSize(7);
      setStarterCount(5);
      setPositionsText(CS2_POSITIONS.join(","));
      setStagePlan(structuredClone(RIVALS_STAGE_PLAN));
      setAllowedPlayerTypes(["enrolled"]);
      setCurrentMin("A");
      setPeakMin("A+");
      setMaxPerPosition(15);
      setScreenshotCount(1);
      setMaxTotal(RIVALS_REGISTRATION_CONFIG.maxTotal);
      setMapPoolText(RIVALS_REGISTRATION_CONFIG.mapPool.join(","));
    }
  }

  function applyCapabilities(capabilities: ReturnType<typeof createMajorDefaultCapabilities>) {
    setRegistrationMode(capabilities.registrationMode);
    setHasCaptainVoting(capabilities.hasCaptainVoting);
    setHasDraft(capabilities.hasDraft);
    setMaxTeamSize(capabilities.maxTeamSize);
    setMinTeamSize(capabilities.minTeamSize);
    setStarterCount(capabilities.starterCount);
    setPositionsText(capabilities.positions.join(","));
    setStagePlan(capabilities.stagePlan);
    setAllowedPlayerTypes(capabilities.registrationConfig.allowedPlayerTypes);
    setCurrentMin(capabilities.registrationConfig.rankThreshold.currentMin ?? NO_RANK);
    setPeakMin(capabilities.registrationConfig.rankThreshold.peakMin ?? NO_RANK);
    setMaxPerPosition(capabilities.registrationConfig.maxPerPosition);
    setScreenshotCount(capabilities.registrationConfig.screenshotCount);
    setMaxTotal(capabilities.registrationConfig.maxTotal);
    setMapPoolText(capabilities.registrationConfig.mapPool.join(","));
    setTeamConfig(capabilities.teamRegistrationConfig);
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
      mapPool: mapPoolText.split(",").map((item: string) => item.trim()).filter(Boolean),
    };

    return {
      id: initial?.id,
      name,
      slug: slug || slugFromName(name),
      kind,
      themeColor: emptyToNull(themeColor),
      startAt: emptyToNull(startAt),
      registrationDeadline: emptyToNull(registrationDeadline),
      endAt: emptyToNull(endAt),
      registrationMode,
      hasCaptainVoting: registrationMode === "team" ? false : hasCaptainVoting,
      hasDraft: registrationMode === "team" ? false : hasDraft,
      minTeamSize,
      maxTeamSize,
      starterCount,
      positions: positionsText.split(",").map((item: string) => item.trim()).filter(Boolean),
      stagePlan,
      registrationConfig,
      teamRegistrationConfig: teamConfig,
    };
  }

  const standardMajorCheck = checkStandardMajorCapabilities(buildPayload() as SeasonCapabilities);
  const isMajorDisplayContext = kind === "Major";
  const swissFormats = stagePlan.slice(0, 3).map((stage) => stage.matchFormat?.toUpperCase() ?? "未设置");
  const playoffFormat = stagePlan[3]?.matchFormat?.toUpperCase() ?? "未设置";
  const finalFormat = stagePlan[3]?.finalFormat?.toUpperCase() ?? playoffFormat;

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

  function handleDelete() {
    if (!initial?.id) return;
    if (!confirm("确认删除这个 draft 赛季？")) return;
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
    if (!confirm("确认撤回至草稿？这仅在无任何报名记录时允许。")) return;
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
    if (!confirm("确认撤回至报名阶段？所有投票记录将被清空。")) return;
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
    if (!confirm("确认手动结束赛季？此操作用于无法自动结束的极端情况。")) return;
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
    if (!confirm("确认归档赛季？归档后赛季将移至历史记录。")) return;
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
        </div>

        <section className="space-y-2">
          <Label>快速预设</Label>
          <Select onValueChange={(v) => v !== "__none__" && applyPreset(v as "major" | "rivals")}>
            <SelectTrigger className="w-56"><SelectValue placeholder="选择预设..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="major">Major 公开赛</SelectItem>
              <SelectItem value="rivals">Rivals 选秀联赛</SelectItem>
              <SelectItem value="__none__">手动配置</SelectItem>
            </SelectContent>
          </Select>
        </section>

        {isMajorDisplayContext && <section
          aria-live="polite"
          className={standardMajorCheck.isStandardMajor
            ? "rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"
            : "rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"}
        >
          {standardMajorCheck.isStandardMajor ? (
            <>
              <h2 className="font-semibold">标准 Major 摘要</h2>
              <p className="mt-1 text-[var(--color-fg-mid)]">
                32 支队伍；队伍整体报名；每队 {minTeamSize}–{maxTeamSize} 人；三阶段瑞士轮；8 队单败淘汰。
              </p>
              <p className="mt-1 text-[var(--color-fg-mid)]">
                当前局制：瑞士轮 {swissFormats.join(" / ")}；淘汰赛 {playoffFormat}，决赛 {finalFormat}。
              </p>
            </>
          ) : (
            <>
              <h2 className="font-semibold">当前配置已偏离标准 Major，将作为自定义赛制运行。</h2>
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
            <div><Label htmlFor="season-kind">类型</Label><Input id="season-kind" value={kind} onChange={(e) => setKind(e.target.value)} /></div>
            <div><Label>主题色</Label><ThemeColorPicker value={themeColor} onChange={setThemeColor} /></div>
            <div>
              <Label htmlFor="start-at">报名开始时间</Label>
              <Input id="start-at" type="datetime-local" value={startAt ?? ""} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="registration-deadline">报名截止时间</Label>
              <Input id="registration-deadline" type="datetime-local" value={registrationDeadline ?? ""} onChange={(e) => setRegistrationDeadline(e.target.value)} />
            </div>
            <div><Label htmlFor="end-at">赛季结束时间</Label><Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} /></div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold">Capability</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>报名模式</Label>
              <Select value={registrationMode} onValueChange={(v) => handleRegistrationModeChange(v as "solo" | "team")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solo">个人报名</SelectItem>
                  <SelectItem value="team">队伍报名</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="positions">位置列表</Label><Input id="positions" value={positionsText} onChange={(e) => setPositionsText(e.target.value)} /></div>
            <div><Label htmlFor="max-team-size">每队人数上限</Label><Input id="max-team-size" type="number" min={1} value={maxTeamSize} onChange={(e) => setMaxTeamSize(Number(e.target.value))} /></div>
            <div><Label htmlFor="min-team-size">每队人数下限</Label><Input id="min-team-size" type="number" min={1} value={minTeamSize} onChange={(e) => setMinTeamSize(Number(e.target.value))} /></div>
            <div><Label htmlFor="starter-count">首发人数</Label><Input id="starter-count" type="number" min={1} value={starterCount} onChange={(e) => setStarterCount(Number(e.target.value))} /></div>
          </div>
          {registrationMode === "solo" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={hasCaptainVoting} onChange={(e) => setHasCaptainVoting(e.target.checked)} />队长投票</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={hasDraft} onChange={(e) => setHasDraft(e.target.checked)} />蛇形选秀</label>
            </div>
          )}
        </section>

        {registrationMode === "solo" && (
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
              <div className="sm:col-span-2"><Label htmlFor="map-pool">比赛图池</Label><Input id="map-pool" value={mapPoolText} onChange={(e) => setMapPoolText(e.target.value)} placeholder="de_mirage,de_inferno,de_nuke..." /></div>
            </div>
          </section>
        )}

        {registrationMode === "team" && (
          <section className="space-y-4">
            <h2 className="font-semibold">队伍报名配置</h2>
            <TeamConfigForm value={teamConfig} maxTeamSize={maxTeamSize} onChange={setTeamConfig} />
          </section>
        )}

        <section className="space-y-4">
          <h2 className="font-semibold">赛制配置</h2>
          <StagePlanEditor value={stagePlan} onChange={setStagePlan} />
        </section>

        <div className="flex justify-end">
          <Button type="button" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "创建中…" : "创建赛季"}
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
          <div>
            <Label htmlFor="season-kind">类型</Label>
            <Input id="season-kind" value={kind} onChange={(e) => setKind(e.target.value)} />
          </div>
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
            <Label htmlFor="start-at">报名开始时间</Label>
            <Input id="start-at" type="datetime-local" value={startAt ?? ""} onChange={(e) => setStartAt(e.target.value)} />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">赛季发布后页面立即可见；到此时间前只能保存草稿。</p>
          </div>
          <div>
            <Label htmlFor="registration-deadline">报名截止时间</Label>
            <Input id="registration-deadline" type="datetime-local" value={registrationDeadline ?? ""} onChange={(e) => setRegistrationDeadline(e.target.value)} />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">截止后关闭草稿保存和正式提交。</p>
          </div>
          <div>
            <Label htmlFor="end-at">赛季结束时间</Label>
            <Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
        <SaveBtn />
      </Panel>

      {/* Panel 3: 能力开关 */}
      <Panel label="能力配置" pad={20}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>报名模式</Label>
            <Select value={registrationMode} disabled={coreLocked} onValueChange={(v) => handleRegistrationModeChange(v as "solo" | "team")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="solo">个人报名</SelectItem>
                <SelectItem value="team">队伍报名</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="positions">位置列表</Label>
            <Input id="positions" value={positionsText} disabled={coreLocked} onChange={(e) => setPositionsText(e.target.value)} />
          </div>
          <div><Label htmlFor="max-team-size">每队人数上限</Label><Input id="max-team-size" type="number" min={1} value={maxTeamSize} disabled={coreLocked} onChange={(e) => setMaxTeamSize(Number(e.target.value))} /></div>
          <div><Label htmlFor="min-team-size">每队人数下限</Label><Input id="min-team-size" type="number" min={1} value={minTeamSize} disabled={coreLocked} onChange={(e) => setMinTeamSize(Number(e.target.value))} /></div>
          <div><Label htmlFor="starter-count">首发人数</Label><Input id="starter-count" type="number" min={1} value={starterCount} disabled={coreLocked} onChange={(e) => setStarterCount(Number(e.target.value))} /></div>
        </div>
        {registrationMode === "solo" && (
          <div className="flex flex-wrap gap-4 text-sm mt-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasCaptainVoting} disabled={coreLocked} onChange={(e) => setHasCaptainVoting(e.target.checked)} />队长投票</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasDraft} disabled={coreLocked} onChange={(e) => setHasDraft(e.target.checked)} />蛇形选秀</label>
          </div>
        )}
        <SaveBtn />
      </Panel>

      {/* Panel 4: 报名规则 (solo) / 队伍报名配置 (team) */}
      {registrationMode === "solo" && (
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
            <div className="sm:col-span-2">
              <Label htmlFor="map-pool">比赛图池</Label>
              <Input id="map-pool" value={mapPoolText} onChange={(e) => setMapPoolText(e.target.value)} placeholder="de_mirage,de_inferno,de_nuke..." />
              <p className="text-xs text-[var(--color-fg-dim)] mt-1">逗号分隔，报名地图熟练度和比赛录入会使用同一组地图。</p>
            </div>
          </div>
          <SaveBtn />
        </Panel>
      )}
      {registrationMode === "team" && (
        <Panel label="队伍报名配置" pad={20}>
          <TeamConfigForm value={teamConfig} maxTeamSize={maxTeamSize} onChange={setTeamConfig} />
          <SaveBtn />
        </Panel>
      )}

      {/* Panel 5: 赛程阶段 */}
      <Panel label="赛程阶段" pad={20}>
        <StagePlanEditor value={stagePlan} onChange={setStagePlan} />
        <SaveBtn />
      </Panel>

      {/* 底部操作区（按赛季状态展示不同操作） */}
      {initial?.status === "draft" && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button type="button" variant="destructive" disabled={isPending} onClick={handleDelete}>
            删除赛季
          </Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={handlePublish}>
            发布赛季
          </Button>
        </div>
      )}
      {initial?.status === "registration" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={handleRevertToDraft}>
            撤回至草稿
          </Button>
        </div>
      )}
      {initial?.status === "voting" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={handleRevertToRegistration}>
            撤回至报名阶段
          </Button>
        </div>
      )}
      {initial?.status === "playing" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={handleForceFinish}>
            手动结束赛季
          </Button>
        </div>
      )}
      {initial?.status === "finished" && (
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={isPending} onClick={handleArchive}>
            归档赛季
          </Button>
        </div>
      )}
    </div>
  );
}
