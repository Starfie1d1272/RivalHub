"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  buildRegistrationSchema,
  positionValues,
  POSITION_LABELS,
  rankValues,
  RANK_LABELS,
  PLAYER_TYPE_LABELS,
  type RegistrationFormData,
  type RegistrationInput,
} from "@/lib/validators/registration";
import { normalizeRegistrationConfig, type RegistrationConfig, type PlayerType } from "@/types/season";

import { loadRegistrationDraft, saveRegistrationDraft, submitRegistration } from "@/actions/register";
import type { RegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { compactUndefined } from "@/lib/utils/object";
import { Button } from "@/components/ui/button";
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

interface RegistrationFormProps {
  seasonId: string;
  seasonName: string;
  positionCounts: Record<string, number>;
  positions: string[];
  registrationConfig: RegistrationConfig;
  windowState: RegistrationWindowState;
}

export function RegistrationForm({
  seasonId,
  seasonName,
  positionCounts,
  positions,
  registrationConfig: inputRegistrationConfig,
  windowState,
}: RegistrationFormProps) {
  const { canSaveDraft, canSubmit, message: windowMessage } = windowState;
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraftEmail, setLoadingDraftEmail] = useState<string | null>(null);
  const [lastBlurredEmail, setLastBlurredEmail] = useState<string | null>(null);
  const [loadedDraftEmail, setLoadedDraftEmail] = useState<string | null>(null);
  const registrationConfig = useMemo(
    () => normalizeRegistrationConfig(inputRegistrationConfig),
    [inputRegistrationConfig],
  );
  const schema = useMemo(
    () => buildRegistrationSchema(registrationConfig, positions),
    [registrationConfig, positions],
  );
  const activePositions = positions.length > 0 ? positions : [...positionValues];

  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationInput, unknown, RegistrationFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      seasonId,
      willingToBeCaptain: false,
      playerType: registrationConfig.allowedPlayerTypes[0],
      screenshotUrls: Array.from({ length: registrationConfig.screenshotCount }, () => ""),
    },
  });

  const onSubmit = async (data: RegistrationFormData) => {
    if (!canSubmit) {
      toast.error(windowMessage ?? "报名提交暂未开放");
      return;
    }

    const result = await submitRegistration(data);
    if (result.success) {
      setSubmittedEmail(data.email);
      setSubmitted(true);
    } else {
      if (result.error.fieldErrors) {
        toast.error("请检查表单填写");
      } else {
        toast.error(result.error.message);
      }
    }
  };

  const handleSaveDraft = async () => {
    const values = getValues();
    const email = typeof values.email === "string" ? normalizeEmail(values.email) : "";
    if (!email) {
      toast.error("请先填写邮箱，再保存草稿");
      return;
    }
    if (!canSaveDraft) {
      toast.error(windowMessage ?? "草稿保存已关闭");
      return;
    }

    setSavingDraft(true);
    try {
      const result = await saveRegistrationDraft({
        seasonId,
        email,
        payload: compactUndefined({ ...values, seasonId, email }) as Record<string, unknown>,
      });
      if (result.success) {
        toast.success("草稿已保存");
        setLoadedDraftEmail(email);
      } else {
        toast.error(result.error.message);
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const emailField = register("email", {
    onBlur: async (event) => {
      const email = normalizeEmail(event.target.value);
      if (!email || email === lastBlurredEmail) return;
      setLastBlurredEmail(email);
      setLoadingDraftEmail(email);
      try {
        const result = await loadRegistrationDraft(seasonId, email);
        if (result.success && result.data.payload) {
          const draftValues = result.data.payload as Partial<RegistrationInput>;
          reset({
            ...getValues(),
            ...draftValues,
            seasonId,
            email,
          } as RegistrationInput);
          setLoadedDraftEmail(email);
          toast.success("已加载保存的报名草稿");
        }
      } finally {
        setLoadingDraftEmail(null);
      }
    },
  });

  // ── 提交成功页 ──
  if (submitted) {
    return (
      <div className="flex flex-col items-center text-center py-16 gap-4">
        <CheckCircle2 size={48} className="text-emerald-400" />
        <h2 className="text-2xl font-bold text-[var(--color-fg)]">报名成功！</h2>
        <p className="text-[var(--color-fg-mid)] max-w-sm">
          已收到你的 <span className="font-medium text-[var(--color-fg)]">{seasonName}</span> 报名。
          报名邮箱：
        </p>
        <p className="font-mono text-sm px-3 py-1.5 rounded-md bg-[var(--color-panel-hi)] text-[var(--color-fg)]">
          {submittedEmail}
        </p>
        <p className="text-sm text-[var(--color-fg-dim)] max-w-xs">
          管理员审核通过后会另行通知，届时可使用邮箱和密码登录查看进度。
        </p>
      </div>
    );
  }

  // ── 工具函数 ──
  const FieldError = ({ name }: { name: string }) => {
    const err = name.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, errors);
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message)
        : "";
    return message ? (
      <p className="text-xs text-red-400 mt-1">{message}</p>
    ) : null;
  };

  const positionFull = (pos: string) =>
    (positionCounts[pos] ?? 0) >= registrationConfig.maxPerPosition;

  const positionLabel = (pos: string) => {
    const p = POSITION_LABELS[pos as keyof typeof POSITION_LABELS];
    const cnt = positionCounts[pos] ?? 0;
    const label = p?.full ?? pos;
    const full = cnt >= registrationConfig.maxPerPosition;
    return `${label}  ${full ? "已满" : `${cnt}/${registrationConfig.maxPerPosition}`}`;
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-lg font-semibold text-[var(--color-fg)] mb-4 pb-2 border-b border-[var(--color-border)]">
      {children}
    </h2>
  );

  const Required = () => <span className="text-red-400">*</span>;

  const inputCls = "bg-[var(--color-panel-hi)] border-[var(--color-border)]";

  const numRegister = (name: keyof RegistrationInput) =>
    register(name, {
      setValueAs: (v: string) =>
        v === "" || v === undefined || v === null
          ? undefined
          : parseFloat(String(v)),
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <input type="hidden" {...register("seasonId")} />

      {/* ═══════════════════════════════════════ 基础信息 ═══ */}
      <section>
        <SectionTitle>基础信息</SectionTitle>
        <div className="space-y-4">
          {/* 邮箱 */}
          <div>
            <Label htmlFor="email" className="text-[var(--color-fg-mid)] mb-1.5 block">
              电子邮件 <Required />
            </Label>
            <Input id="email" type="email" placeholder="your@email.com" className={inputCls} {...emailField} />
            <FieldError name="email" />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">
              用于接收登录链接、审核通知和草稿找回
              {loadingDraftEmail && " · 正在查询草稿…"}
            </p>
          </div>

          {/* 学号 + QQ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="studentId" className="text-[var(--color-fg-mid)] mb-1.5 block">
                学号 <Required />
              </Label>
              <Input id="studentId" placeholder="毕业生填「毕业年份+学院」" className={inputCls} {...register("studentId")} />
              <FieldError name="studentId" />
            </div>
            <div>
              <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
                身份类型 <Required />
              </Label>
              <Select
                defaultValue={registrationConfig.allowedPlayerTypes[0]}
                onValueChange={(v) =>
                  setValue("playerType", v as PlayerType, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="选择身份类型" />
                </SelectTrigger>
                <SelectContent>
                  {registrationConfig.allowedPlayerTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {PLAYER_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError name="playerType" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="qq" className="text-[var(--color-fg-mid)] mb-1.5 block">
                QQ 号 <Required />
              </Label>
              <Input id="qq" placeholder="123456789" className={inputCls} {...register("qq")} />
              <FieldError name="qq" />
            </div>
          </div>

          {/* 完美昵称 */}
          <div>
            <Label htmlFor="perfectName" className="text-[var(--color-fg-mid)] mb-1.5 block">
              完美平台昵称 <Required />
            </Label>
            <Input id="perfectName" placeholder="完美对战平台昵称" className={inputCls} {...register("perfectName")} />
            <FieldError name="perfectName" />
          </div>

          {/* Steam 昵称 + Steam64 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="steamName" className="text-[var(--color-fg-mid)] mb-1.5 block">
                Steam 昵称 <Required />
              </Label>
              <Input id="steamName" placeholder="Steam 显示名称" className={inputCls} {...register("steamName")} />
              <FieldError name="steamName" />
            </div>
            <div>
              <Label htmlFor="steam64" className="text-[var(--color-fg-mid)] mb-1.5 block">
                Steam 64 位 ID <Required />
              </Label>
              <Input
                id="steam64"
                placeholder="76561198XXXXXXXXX"
                className={`${inputCls} font-mono text-sm`}
                {...register("steam64")}
              />
              <FieldError name="steam64" />
            </div>
          </div>

          {/* Steam 个人资料链接 */}
          <div>
            <Label htmlFor="steamProfileUrl" className="text-[var(--color-fg-mid)] mb-1.5 block">
              Steam 个人资料链接 <Required />
            </Label>
            <Input
              id="steamProfileUrl"
              type="url"
              placeholder="https://steamcommunity.com/profiles/..."
              className={inputCls}
              {...register("steamProfileUrl")}
            />
            <FieldError name="steamProfileUrl" />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">请确保个人资料设置为公开</p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ 位置选择 ═══ */}
      <section>
        <SectionTitle>位置选择</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
              主选位置 <Required />
            </Label>
            <Select
              onValueChange={(v) =>
                setValue("primaryPosition", v as RegistrationFormData["primaryPosition"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className={inputCls}>
                <SelectValue placeholder="选择主选位置" />
              </SelectTrigger>
              <SelectContent>
                {activePositions.map((pos) => (
                  <SelectItem key={pos} value={pos} disabled={positionFull(pos)}>
                    {positionLabel(pos)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError name="primaryPosition" />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">
              每个位置最多 {registrationConfig.maxPerPosition} 人，满员后自动关闭
            </p>
          </div>

          <div>
            <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
              次选位置 <Required />
            </Label>
            <Select
              onValueChange={(v) =>
                setValue("secondaryPosition", v as RegistrationFormData["primaryPosition"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className={inputCls}>
                <SelectValue placeholder="选择次选位置" />
              </SelectTrigger>
              <SelectContent>
                {activePositions.map((pos) => (
                  <SelectItem key={pos} value={pos}>
                    {POSITION_LABELS[pos as keyof typeof POSITION_LABELS]?.full ?? pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError name="secondaryPosition" />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">不能与主选位置相同</p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ 段位 · 历史最高 ═══ */}
      <section>
        <SectionTitle>段位信息 · 历史最高</SectionTitle>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
                历史最高段位 <Required />
              </Label>
              <Select
                onValueChange={(v) =>
                  setValue("peakRank", v as RegistrationFormData["peakRank"], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder="选择段位" />
                </SelectTrigger>
                <SelectContent>
                  {rankValues.map((rank) => (
                    <SelectItem key={rank} value={rank}>
                      {RANK_LABELS[rank]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError name="peakRank" />
            </div>
            <div>
              <Label htmlFor="peakRankSeason" className="text-[var(--color-fg-mid)] mb-1.5 block">
                对应赛季 <Required />
              </Label>
              <Input
                id="peakRankSeason"
                placeholder="如 S1 2026"
                className={inputCls}
                {...register("peakRankSeason")}
              />
              <FieldError name="peakRankSeason" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="peakRating" className="text-[var(--color-fg-mid)] mb-1.5 block">
                Rating <Required />
              </Label>
              <Input
                id="peakRating"
                type="number"
                placeholder="如 1.48"
                min={0.01}
                max={3.00}
                step={0.01}
                className={inputCls}
                {...numRegister("peakRating")}
              />
              <FieldError name="peakRating" />
            </div>
            <div>
              <Label htmlFor="peakWe" className="text-[var(--color-fg-mid)] mb-1.5 block">
                WE（选填）
              </Label>
              <Input
                id="peakWe"
                type="number"
                placeholder="如 8.5"
                min={0}
                max={16.0}
                step={0.1}
                className={inputCls}
                {...numRegister("peakWe")}
              />
              <FieldError name="peakWe" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ 段位 · 当前赛季最高 ═══ */}
      <section>
        <SectionTitle>段位信息 · 当前赛季最高</SectionTitle>
        <div className="space-y-4">
          <div>
            <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
              当前赛季最高段位 <Required />
            </Label>
            <Select
              onValueChange={(v) =>
                setValue("currentSeasonPeakRank", v as RegistrationFormData["currentSeasonPeakRank"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger className={inputCls}>
                <SelectValue placeholder="选择段位" />
              </SelectTrigger>
              <SelectContent>
                {rankValues.map((rank) => (
                  <SelectItem key={rank} value={rank}>
                    {RANK_LABELS[rank]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError name="currentSeasonPeakRank" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="currentRating" className="text-[var(--color-fg-mid)] mb-1.5 block">
                Rating <Required />
              </Label>
              <Input
                id="currentRating"
                type="number"
                placeholder="如 1.35"
                min={0.01}
                max={3.00}
                step={0.01}
                className={inputCls}
                {...numRegister("currentRating")}
              />
              <FieldError name="currentRating" />
            </div>
            <div>
              <Label htmlFor="currentWe" className="text-[var(--color-fg-mid)] mb-1.5 block">
                WE（选填）
              </Label>
              <Input
                id="currentWe"
                type="number"
                placeholder="如 7.5"
                min={0}
                max={16.0}
                step={0.1}
                className={inputCls}
                {...numRegister("currentWe")}
              />
              <FieldError name="currentWe" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ 天梯截图 ═══ */}
      <section>
        <SectionTitle>近两周天梯截图</SectionTitle>
        <p className="text-sm text-[var(--color-fg-mid)] mb-4">
          请将近两周天梯对局截图上传至
          <a
            href="https://box.nju.edu.cn"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] hover:underline mx-1"
          >
            NJUBox
          </a>
          并获取分享链接，粘贴到下方。
        </p>
        <div className="space-y-3">
          {Array.from({ length: registrationConfig.screenshotCount }, (_, index) => (
            <div key={index}>
              <Label htmlFor={`screenshotUrls.${index}`} className="text-[var(--color-fg-mid)] mb-1.5 block">
                NJUBox 分享链接 {registrationConfig.screenshotCount > 1 ? index + 1 : ""} <Required />
              </Label>
              <Input
                id={`screenshotUrls.${index}`}
                type="url"
                placeholder="https://box.nju.edu.cn/d/..."
                className={inputCls}
                {...register(`screenshotUrls.${index}`)}
              />
              <FieldError name={`screenshotUrls.${index}`} />
            </div>
          ))}
          <FieldError name="screenshotUrls" />
        </div>
      </section>

      {/* ═══════════════════════════════════════ 风格与经历 ═══ */}
      <section>
        <SectionTitle>风格与经历</SectionTitle>
        <div className="space-y-4">
          <div>
            <Label htmlFor="gameplayStyle" className="text-[var(--color-fg-mid)] mb-1.5 block">
              游戏风格自述 <Required />
            </Label>
            <Textarea
              id="gameplayStyle"
              rows={3}
              placeholder="简要描述你的游戏风格、擅长打法等（100 字以内）"
              className={`${inputCls} resize-none`}
              {...register("gameplayStyle")}
            />
            <div className="flex justify-between mt-1">
              <FieldError name="gameplayStyle" />
              <span className="text-xs text-[var(--color-fg-dim)] ml-auto">
                {watch("gameplayStyle")?.length ?? 0}/100
              </span>
            </div>
          </div>

          <div>
            <Label htmlFor="competitionHistory" className="text-[var(--color-fg-mid)] mb-1.5 block">
              历史比赛经历（选填）
            </Label>
            <Textarea
              id="competitionHistory"
              rows={3}
              placeholder="参加过的比赛、成绩等…"
              className={`${inputCls} resize-none`}
              {...register("competitionHistory")}
            />
            <div className="flex justify-between mt-1">
              <FieldError name="competitionHistory" />
              <span className="text-xs text-[var(--color-fg-dim)] ml-auto">
                {watch("competitionHistory")?.length ?? 0}/500
              </span>
            </div>
          </div>

          <div>
            <Label htmlFor="highlightVideoUrl" className="text-[var(--color-fg-mid)] mb-1.5 block">
              高光视频链接（选填）
            </Label>
            <Input
              id="highlightVideoUrl"
              type="url"
              placeholder="njubox 或其他链接，命名格式：完美ID_主选位置.mp4（≤3 分钟）"
              className={inputCls}
              {...register("highlightVideoUrl")}
            />
            <FieldError name="highlightVideoUrl" />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ 其他 ═══ */}
      <section>
        <SectionTitle>其他</SectionTitle>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <input
              id="willingToBeCaptain"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              {...register("willingToBeCaptain")}
            />
            <div>
              <Label htmlFor="willingToBeCaptain" className="text-[var(--color-fg)] cursor-pointer">
                我愿意参与队长竞选
              </Label>
              <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">
                勾选后将出现在队长投票候选人列表中
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="notes" className="text-[var(--color-fg-mid)] mb-1.5 block">
              备注（选填）
            </Label>
            <Textarea
              id="notes"
              rows={3}
              placeholder="时间冲突、特殊情况等可在此说明…"
              className={`${inputCls} resize-none`}
              {...register("notes")}
            />
            <div className="flex justify-between mt-1">
              <FieldError name="notes" />
              <span className="text-xs text-[var(--color-fg-dim)] ml-auto">
                {watch("notes")?.length ?? 0}/500
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ 反作弊承诺 ═══ */}
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <input
            id="antiCheatPledge"
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-amber-400"
            onChange={(e) =>
              setValue("antiCheatPledge", e.target.checked as true, {
                shouldValidate: true,
              })
            }
          />
          <div>
            <Label htmlFor="antiCheatPledge" className="text-[var(--color-fg)] cursor-pointer font-medium">
              反作弊承诺 <Required />
            </Label>
            <p className="text-sm text-[var(--color-fg-mid)] mt-1">
              我承诺在参赛期间不使用任何作弊软件或外挂。一经发现，接受取消资格处理。
            </p>
          </div>
        </div>
        <FieldError name="antiCheatPledge" />
      </section>

      {/* ═══════════════════════════════════════ 草稿 / 提交 ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={!canSaveDraft || savingDraft}
          className="h-11 text-base font-semibold"
          onClick={handleSaveDraft}
        >
          {savingDraft ? (
            <>
              <Loader2 size={16} className="animate-spin mr-2" />
              保存中…
            </>
          ) : (
            "保存草稿"
          )}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          className="h-11 text-base font-semibold"
          style={{ backgroundColor: canSubmit ? "var(--color-accent)" : "var(--color-panel-hi)", color: "#fff" }}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin mr-2" />
              提交中…
            </>
          ) : (
            canSubmit ? "提交报名" : windowMessage ?? "报名提交暂未开放"
          )}
        </Button>
      </div>
    </form>
  );
}
