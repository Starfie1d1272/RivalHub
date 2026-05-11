"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSeason, deleteSeason, publishSeason, updateSeason, type SeasonFormInput } from "@/actions/seasons";
import {
  CS2_POSITIONS,
  PLAYER_TYPE_LABELS,
  RIVALS_REGISTRATION_CONFIG,
  RIVALS_STAGE_PLAN,
  MAJOR_STAGE_PLAN,
  MAJOR_TEAM_CONFIG,
  type PlayerType,
  type RegistrationConfig,
  type TeamRegistrationConfig,
  type StagePlan,
} from "@/types/season";
import { rankValues, RANK_LABELS } from "@/lib/validators/registration";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

  const defaultConfig = initial?.registrationConfig ?? RIVALS_REGISTRATION_CONFIG;
  const defaultTeamConfig = initial?.teamRegistrationConfig ?? MAJOR_TEAM_CONFIG;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "Major");
  const [themeColor, setThemeColor] = useState(initial?.themeColor ?? "#f97316");
  const [startAt, setStartAt] = useState(initial?.startAt ?? "");
  const [endAt, setEndAt] = useState(initial?.endAt ?? "");
  const [registrationMode, setRegistrationMode] = useState<"solo" | "team">(
    initial?.registrationMode ?? "team",
  );
  const [hasCaptainVoting, setHasCaptainVoting] = useState(initial?.hasCaptainVoting ?? true);
  const [hasDraft, setHasDraft] = useState(initial?.hasDraft ?? true);
  const [maxTeamSize, setMaxTeamSize] = useState(initial?.maxTeamSize ?? 9);
  const [minTeamSize, setMinTeamSize] = useState(initial?.minTeamSize ?? 5);
  const [starterCount, setStarterCount] = useState(initial?.starterCount ?? 5);
  const [positionsText, setPositionsText] = useState(
    (initial?.positions ?? CS2_POSITIONS).join(","),
  );
  const [stagePlan, setStagePlan] = useState<StagePlan>(
    initial?.stagePlan ?? MAJOR_STAGE_PLAN,
  );
  const [allowedPlayerTypes, setAllowedPlayerTypes] = useState<PlayerType[]>(
    defaultConfig.allowedPlayerTypes,
  );
  const [currentMin, setCurrentMin] = useState(defaultConfig.rankThreshold.currentMin ?? NO_RANK);
  const [peakMin, setPeakMin] = useState(defaultConfig.rankThreshold.peakMin ?? NO_RANK);
  const [maxPerPosition, setMaxPerPosition] = useState(defaultConfig.maxPerPosition);
  const [screenshotCount, setScreenshotCount] = useState(defaultConfig.screenshotCount);
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
      handleRegistrationModeChange("team");
      setMaxTeamSize(9);
      setMinTeamSize(5);
      setStarterCount(5);
      setPositionsText("igl,awper,opener,closer,anchor");
      setStagePlan(structuredClone(MAJOR_STAGE_PLAN));
      setAllowedPlayerTypes(["enrolled", "graduated"]);
      setCurrentMin(NO_RANK);
      setPeakMin(NO_RANK);
      setMaxPerPosition(50);
      setScreenshotCount(1);
      setTeamConfig(MAJOR_TEAM_CONFIG);
    } else {
      setKind("选秀联赛");
      handleRegistrationModeChange("solo");
      setMaxTeamSize(7);
      setMinTeamSize(7);
      setStarterCount(5);
      setPositionsText("igl,awper,opener,closer,anchor");
      setStagePlan(structuredClone(RIVALS_STAGE_PLAN));
      setAllowedPlayerTypes(["enrolled"]);
      setCurrentMin("A");
      setPeakMin("A+");
      setMaxPerPosition(15);
      setScreenshotCount(1);
    }
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
    };

    return {
      id: initial?.id,
      name,
      slug: slug || slugFromName(name),
      kind,
      themeColor: emptyToNull(themeColor),
      startAt: emptyToNull(startAt),
      endAt: emptyToNull(endAt),
      registrationMode,
      hasCaptainVoting: registrationMode === "team" ? false : hasCaptainVoting,
      hasDraft: registrationMode === "team" ? false : hasDraft,
      minTeamSize,
      maxTeamSize,
      starterCount,
      positions: positionsText.split(",").map((item) => item.trim()).filter(Boolean),
      stagePlan,
      registrationConfig,
      teamRegistrationConfig: teamConfig,
    };
  }

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

  return (
    <Card className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {fieldHelp && <p className="text-sm text-yellow-600 mt-2">{fieldHelp}</p>}
      </div>

      {/* Preset selector */}
      {mode === "create" && (
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
      )}

      {/* Basic info */}
      <section className="space-y-4">
        <h2 className="font-semibold">基础信息</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="season-name">名称</Label>
            <Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="season-slug">Slug</Label>
            <Input
              id="season-slug"
              value={slug}
              disabled={mode === "edit"}
              onChange={(e) => setSlug(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              URL 路径标识，输入名称后自动生成，可手动修改
            </p>
          </div>
          <div>
            <Label htmlFor="season-kind">类型</Label>
            <Input id="season-kind" value={kind} onChange={(e) => setKind(e.target.value)} />
          </div>
          <div>
            <Label>主题色</Label>
            <ThemeColorPicker value={themeColor} onChange={setThemeColor} />
          </div>
          <div>
            <Label htmlFor="start-at">开始时间</Label>
            <Input id="start-at" type="datetime-local" value={startAt ?? ""} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="end-at">结束时间</Label>
            <Input id="end-at" type="datetime-local" value={endAt ?? ""} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Capability */}
      <section className="space-y-4">
        <h2 className="font-semibold">Capability</h2>
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
            {registrationMode === "team" && (
              <p className="text-xs text-muted-foreground mt-1">
                可选填，不填位置则不参与排行榜和最佳五人组评选
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="max-team-size">每队人数上限</Label>
            <Input id="max-team-size" type="number" min={1} value={maxTeamSize} disabled={coreLocked} onChange={(e) => setMaxTeamSize(Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="min-team-size">每队人数下限</Label>
            <Input id="min-team-size" type="number" min={1} value={minTeamSize} disabled={coreLocked} onChange={(e) => setMinTeamSize(Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="starter-count">首发人数</Label>
            <Input id="starter-count" type="number" min={1} value={starterCount} disabled={coreLocked} onChange={(e) => setStarterCount(Number(e.target.value))} />
          </div>
        </div>
        {registrationMode === "solo" && (
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasCaptainVoting} disabled={coreLocked} onChange={(e) => setHasCaptainVoting(e.target.checked)} />
              队长投票
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasDraft} disabled={coreLocked} onChange={(e) => setHasDraft(e.target.checked)} />
              蛇形选秀
            </label>
          </div>
        )}
      </section>

      {/* Registration config — solo mode only */}
      {registrationMode === "solo" && (
        <section className="space-y-4">
          <h2 className="font-semibold">报名配置</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {PLAYER_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowedPlayerTypes.includes(type)}
                  onChange={() => togglePlayerType(type)}
                />
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
                  {rankValues.map((rank) => (
                    <SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>历史段位门槛</Label>
              <Select value={peakMin} onValueChange={setPeakMin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RANK}>无门槛</SelectItem>
                  {rankValues.map((rank) => (
                    <SelectItem key={rank} value={rank}>{RANK_LABELS[rank]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="max-position">每位置上限</Label>
              <Input id="max-position" type="number" min={1} max={50} value={maxPerPosition} onChange={(e) => setMaxPerPosition(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="screenshot-count">截图链接数量</Label>
              <Input id="screenshot-count" type="number" min={1} max={5} value={screenshotCount} onChange={(e) => setScreenshotCount(Number(e.target.value))} />
            </div>
          </div>
        </section>
      )}

      {/* Team registration config — team mode only */}
      {registrationMode === "team" && (
        <section className="space-y-4">
          <h2 className="font-semibold">队伍报名配置</h2>
          <TeamConfigForm value={teamConfig} maxTeamSize={maxTeamSize} onChange={setTeamConfig} />
        </section>
      )}

      {/* Stage plan */}
      <section className="space-y-4">
        <h2 className="font-semibold">赛制配置</h2>
        <StagePlanEditor value={stagePlan} onChange={setStagePlan} />
      </section>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {mode === "edit" && initial?.status === "draft" && (
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleDelete}>
              删除赛季
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === "edit" && initial?.status === "draft" && (
            <Button type="button" variant="outline" disabled={isPending} onClick={handlePublish}>
              发布
            </Button>
          )}
          <Button type="button" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "保存中…" : mode === "create" ? "创建赛季" : "保存设置"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
