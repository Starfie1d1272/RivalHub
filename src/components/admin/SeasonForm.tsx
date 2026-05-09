"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSeason, deleteSeason, updateSeason, type SeasonFormInput } from "@/actions/seasons";
import {
  PLAYER_TYPE_LABELS,
  RIVALS_REGISTRATION_CONFIG,
  RIVALS_STAGE_PLAN,
  SEASON_STATUS_LABELS,
  type PlayerType,
  type RegistrationConfig,
  type SeasonStatus,
  type StagePlan,
} from "@/types/season";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PLAYER_TYPES: PlayerType[] = ["enrolled", "graduated", "external"];
const STATUSES: SeasonStatus[] = [
  "draft",
  "registration",
  "voting",
  "drafting",
  "playing",
  "finished",
  "archived",
];

interface SeasonFormProps {
  mode: "create" | "edit";
  initial?: SeasonFormInput;
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function parseJson<T>(value: string, fallback: T): T {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed) as T;
}

export function SeasonForm({ mode, initial }: SeasonFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const defaultConfig = initial?.registrationConfig ?? RIVALS_REGISTRATION_CONFIG;
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "选秀联赛");
  const [status, setStatus] = useState<SeasonStatus>(initial?.status ?? "draft");
  const [themeColor, setThemeColor] = useState(initial?.themeColor ?? "#f97316");
  const [startAt, setStartAt] = useState(initial?.startAt ?? "");
  const [endAt, setEndAt] = useState(initial?.endAt ?? "");
  const [registrationMode, setRegistrationMode] = useState<"solo" | "team">(
    initial?.registrationMode ?? "solo",
  );
  const [hasCaptainVoting, setHasCaptainVoting] = useState(initial?.hasCaptainVoting ?? true);
  const [hasDraft, setHasDraft] = useState(initial?.hasDraft ?? true);
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 7);
  const [starterCount, setStarterCount] = useState(initial?.starterCount ?? 5);
  const [positionsText, setPositionsText] = useState((initial?.positions ?? ["igl", "awper", "opener", "closer", "anchor"]).join(","));
  const [stagePlanText, setStagePlanText] = useState(JSON.stringify(initial?.stagePlan ?? RIVALS_STAGE_PLAN, null, 2));
  const [allowedPlayerTypes, setAllowedPlayerTypes] = useState<PlayerType[]>(
    defaultConfig.allowedPlayerTypes,
  );
  const [currentMin, setCurrentMin] = useState(defaultConfig.rankThreshold.currentMin ?? "");
  const [peakMin, setPeakMin] = useState(defaultConfig.rankThreshold.peakMin ?? "");
  const [maxPerPosition, setMaxPerPosition] = useState(defaultConfig.maxPerPosition);
  const [screenshotCount, setScreenshotCount] = useState(defaultConfig.screenshotCount);

  const coreLocked = mode === "edit" && initial?.status !== "draft";
  const title = mode === "create" ? "新建赛季" : "赛季设置";

  const fieldHelp = useMemo(() => {
    if (!coreLocked) return null;
    return "当前赛季不在 draft 状态，slug、赛制、队伍规模等核心配置不可修改。";
  }, [coreLocked]);

  function togglePlayerType(type: PlayerType) {
    setAllowedPlayerTypes((current) => {
      if (current.includes(type)) {
        return current.length === 1 ? current : current.filter((item) => item !== type);
      }
      return [...current, type];
    });
  }

  function buildPayload(): SeasonFormInput {
    const stagePlan = parseJson<StagePlan>(stagePlanText, RIVALS_STAGE_PLAN);
    const registrationConfig: RegistrationConfig = {
      allowedPlayerTypes,
      rankThreshold: {
        currentMin: emptyToNull(currentMin),
        peakMin: emptyToNull(peakMin),
      },
      maxPerPosition,
      screenshotCount,
    };

    return {
      id: initial?.id,
      name,
      slug,
      kind,
      status,
      themeColor: emptyToNull(themeColor),
      startAt: emptyToNull(startAt),
      endAt: emptyToNull(endAt),
      registrationMode,
      hasCaptainVoting,
      hasDraft,
      teamSize,
      starterCount,
      positions: positionsText.split(",").map((item) => item.trim()).filter(Boolean),
      stagePlan,
      registrationConfig,
    };
  }

  function handleSubmit() {
    let payload: SeasonFormInput;
    try {
      payload = buildPayload();
    } catch {
      toast.error("stagePlan JSON 格式不正确");
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

      <section className="space-y-4">
        <h2 className="font-semibold">基础信息</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="season-name">名称</Label>
            <Input id="season-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="season-slug">Slug</Label>
            <Input id="season-slug" value={slug} disabled={coreLocked} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="season-kind">类型</Label>
            <Input id="season-kind" value={kind} onChange={(e) => setKind(e.target.value)} />
          </div>
          <div>
            <Label>状态</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as SeasonStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((item) => (
                  <SelectItem key={item} value={item}>{SEASON_STATUS_LABELS[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="theme-color">主题色</Label>
            <Input id="theme-color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} />
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

      <section className="space-y-4">
        <h2 className="font-semibold">Capability</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>报名模式</Label>
            <Select value={registrationMode} disabled={coreLocked} onValueChange={(value) => setRegistrationMode(value as "solo" | "team")}>
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
          <div>
            <Label htmlFor="team-size">每队人数</Label>
            <Input id="team-size" type="number" min={1} value={teamSize} disabled={coreLocked} onChange={(e) => setTeamSize(Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="starter-count">首发人数</Label>
            <Input id="starter-count" type="number" min={1} value={starterCount} disabled={coreLocked} onChange={(e) => setStarterCount(Number(e.target.value))} />
          </div>
        </div>
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
      </section>

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
            <Label htmlFor="current-min">当前段位门槛</Label>
            <Input id="current-min" value={currentMin} onChange={(e) => setCurrentMin(e.target.value)} placeholder="A，留空表示无门槛" />
          </div>
          <div>
            <Label htmlFor="peak-min">历史段位门槛</Label>
            <Input id="peak-min" value={peakMin} onChange={(e) => setPeakMin(e.target.value)} placeholder="A+，留空表示无门槛" />
          </div>
          <div>
            <Label htmlFor="max-position">每位置上限</Label>
            <Input id="max-position" type="number" min={1} value={maxPerPosition} onChange={(e) => setMaxPerPosition(Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="screenshot-count">截图链接数量</Label>
            <Input id="screenshot-count" type="number" min={1} value={screenshotCount} onChange={(e) => setScreenshotCount(Number(e.target.value))} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-semibold">Stage Plan JSON</h2>
        <Textarea
          value={stagePlanText}
          disabled={coreLocked}
          onChange={(e) => setStagePlanText(e.target.value)}
          rows={12}
          className="font-mono text-xs"
        />
      </section>

      <div className="flex items-center justify-between gap-3">
        <div>
          {mode === "edit" && initial?.status === "draft" && (
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleDelete}>
              删除赛季
            </Button>
          )}
        </div>
        <Button type="button" disabled={isPending} onClick={handleSubmit}>
          {isPending ? "保存中…" : mode === "create" ? "创建赛季" : "保存设置"}
        </Button>
      </div>
    </Card>
  );
}
