"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
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
import { type MapPreferenceLevel } from "@/types/season";

import { loadRegistrationDraft, saveRegistrationDraft, submitRegistration } from "@/actions/register";
import type { RegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { compactUndefined } from "@/lib/utils/object";
import { defaultMapPreferences, normalizeMapPreferences } from "@/lib/maps";
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
import { AntiCheatPledgeSection } from "./AntiCheatPledgeSection";
import { RegistrationExperienceSection } from "./RegistrationExperienceSection";
import { MapPreferenceSection } from "./MapPreferenceSection";
import { RegistrationOtherSection } from "./RegistrationOtherSection";
import { RegistrationSectionTitle } from "./RegistrationSectionTitle";
import { RegistrationSubmitBar } from "./RegistrationSubmitBar";
import { RegistrationSuccess } from "./RegistrationSuccess";
import { ScreenshotLinksSection } from "./ScreenshotLinksSection";
import {
  buildPositionLabel,
  countMapPreferenceLevels,
  isPositionFull,
} from "./registration-form-utils";

interface RegistrationFormProps {
  seasonId: string;
  seasonName: string;
  positionCounts: Record<string, number>;
  positions: string[];
  registrationConfig: RegistrationConfig;
  windowState: RegistrationWindowState;
  currentUserEmail?: string | null;
  initialValues?: Partial<RegistrationInput>;
  submitLabel?: string;
}

export function RegistrationForm({
  seasonId,
  seasonName,
  positionCounts,
  positions,
  registrationConfig: inputRegistrationConfig,
  windowState,
  currentUserEmail,
  initialValues,
  submitLabel,
}: RegistrationFormProps) {
  const { canSaveDraft, canSubmit, message: windowMessage } = windowState;
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraftEmail, setLoadingDraftEmail] = useState<string | null>(null);
  const lastBlurredEmailRef = useRef<string | null>(null);
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
      ...initialValues,
      seasonId,
      email: initialValues?.email ?? currentUserEmail ?? "",
      willingToBeCaptain: initialValues?.willingToBeCaptain ?? false,
      playerType: initialValues?.playerType ?? registrationConfig.allowedPlayerTypes[0],
      screenshotUrls: initialValues?.screenshotUrls ?? Array.from({ length: registrationConfig.screenshotCount }, () => ""),
      mapPreferences: normalizeMapPreferences(
        initialValues?.mapPreferences,
        registrationConfig.mapPool,
      ),
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
        toast.success("草稿已保存", {
          description: "下次输入邮箱即可自动恢复",
        });
      } else {
        toast.error(result.error.message);
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const loadDraftForEmail = useCallback(
    async (email: string, options: { silent?: boolean } = {}) => {
      const normalized = normalizeEmail(email);
      if (!normalized) return;

      setLoadingDraftEmail(normalized);
      try {
        const result = await loadRegistrationDraft(seasonId, normalized);
        if (result.success && result.data.payload) {
          const draftValues = result.data.payload as Partial<RegistrationInput>;
          reset({
            ...getValues(),
            ...draftValues,
            seasonId,
            email: normalized,
            mapPreferences: normalizeMapPreferences(
              draftValues.mapPreferences,
              registrationConfig.mapPool,
            ),
          } as RegistrationInput);
          setLoadedDraftEmail(normalized);
          if (!options.silent) {
            toast.success("已加载保存的报名草稿");
          }
        }
      } finally {
        setLoadingDraftEmail(null);
      }
    },
    [getValues, registrationConfig.mapPool, reset, seasonId],
  );

  useEffect(() => {
    if (!currentUserEmail || loadedDraftEmail === currentUserEmail) return;
    lastBlurredEmailRef.current = currentUserEmail;
    void loadDraftForEmail(currentUserEmail);
  }, [currentUserEmail, loadedDraftEmail, loadDraftForEmail]);

  const emailField = register("email", {
    onBlur: async (event) => {
      if (currentUserEmail) return;
      const email = normalizeEmail(event.target.value);
      if (!email || email === lastBlurredEmailRef.current) return;
      lastBlurredEmailRef.current = email;
      await loadDraftForEmail(email);
    },
  });

  // ── 提交成功页 ──
  if (submitted) {
    return <RegistrationSuccess seasonName={seasonName} submittedEmail={submittedEmail} />;
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
      <p className="text-xs text-[var(--color-danger)] mt-1">{message}</p>
    ) : null;
  };

  const positionFull = (pos: string) => isPositionFull(pos, positionCounts, registrationConfig.maxPerPosition);

  const positionLabel = (pos: string) =>
    buildPositionLabel(pos, positionCounts, registrationConfig.maxPerPosition);

  const Required = () => <span className="text-[var(--color-danger)]">*</span>;

  const inputCls = "bg-[var(--color-panel-hi)] border-[var(--color-border)]";

  const numRegister = (name: keyof RegistrationInput) =>
    register(name, {
      setValueAs: (v: string) =>
        v === "" || v === undefined || v === null
          ? undefined
          : parseFloat(String(v)),
        });

  const setMapLevel = (map: string, level: MapPreferenceLevel) => {
    const current = watch("mapPreferences") ?? defaultMapPreferences(registrationConfig.mapPool);
    const next = registrationConfig.mapPool.map((item) => ({
      map: item,
      level: item === map
        ? level
        : current.find((preference) => preference.map === item)?.level ?? "basic",
    }));
    setValue("mapPreferences", next, { shouldValidate: true });
  };

  const mapPreferences = watch("mapPreferences") ?? defaultMapPreferences(registrationConfig.mapPool);
  const { playableCount, strongCount } = countMapPreferenceLevels(mapPreferences);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <input type="hidden" {...register("seasonId")} />

      {/* ═══════════════════════════════════════ 基础信息 ═══ */}
      <section>
        <RegistrationSectionTitle>基础信息</RegistrationSectionTitle>
        <div className="space-y-4">
          {/* 邮箱 */}
          <div>
            <Label htmlFor="email" className="text-[var(--color-fg-mid)] mb-1.5 block">
              电子邮件 <Required />
            </Label>
            <div className="relative">
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                className={inputCls}
                readOnly={!!currentUserEmail}
                {...emailField}
              />
              {loadedDraftEmail && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--color-ok)22", color: "var(--color-ok)" }}>
                  草稿已恢复
                </span>
              )}
            </div>
            <FieldError name="email" />
            <p className="text-xs text-[var(--color-fg-dim)] mt-1">
              {currentUserEmail
                ? `已登录为 ${currentUserEmail}，已自动检查草稿。`
                : "已自动检查草稿，提交后可直接用该账号查看审核进度。"}
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
                value={watch("playerType") ?? registrationConfig.allowedPlayerTypes[0]}
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
        <RegistrationSectionTitle>位置选择</RegistrationSectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
              主选位置 <Required />
            </Label>
            <Select
              value={watch("primaryPosition") ?? ""}
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
              value={watch("secondaryPosition") ?? ""}
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
        <RegistrationSectionTitle>段位信息 · 历史最高</RegistrationSectionTitle>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
                历史最高段位 <Required />
              </Label>
              <Select
                value={watch("peakRank") ?? ""}
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
        <RegistrationSectionTitle>段位信息 · 当前赛季最高</RegistrationSectionTitle>
        <div className="space-y-4">
          <div>
            <Label className="text-[var(--color-fg-mid)] mb-1.5 block">
              当前赛季最高段位 <Required />
            </Label>
            <Select
              value={watch("currentSeasonPeakRank") ?? ""}
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

      {/* ═══════════════════════════════════════ 地图熟练度 ═══ */}
      <MapPreferenceSection
        mapPool={registrationConfig.mapPool}
        mapPreferences={mapPreferences}
        playableCount={playableCount}
        strongCount={strongCount}
        error={<FieldError name="mapPreferences" />}
        onSetMapLevel={setMapLevel}
      />

      {/* ═══════════════════════════════════════ 天梯截图 ═══ */}
      <ScreenshotLinksSection
        screenshotCount={registrationConfig.screenshotCount}
        inputClassName={inputCls}
        register={register}
        renderError={(name) => <FieldError name={name} />}
      />

      <RegistrationExperienceSection
        inputClassName={inputCls}
        register={register}
        watch={watch}
        renderError={(name) => <FieldError name={name} />}
      />

      <RegistrationOtherSection
        inputClassName={inputCls}
        register={register}
        watch={watch}
        renderError={(name) => <FieldError name={name} />}
      />

      <AntiCheatPledgeSection
        defaultChecked={!!initialValues?.antiCheatPledge}
        error={<FieldError name="antiCheatPledge" />}
        onCheckedChange={(checked) =>
          setValue("antiCheatPledge", checked as true, {
            shouldValidate: true,
          })
        }
      />

      <RegistrationSubmitBar
        canSaveDraft={canSaveDraft}
        canSubmit={canSubmit}
        isSubmitting={isSubmitting}
        savingDraft={savingDraft}
        submitText={canSubmit ? submitLabel ?? "提交报名" : windowMessage ?? "报名提交暂未开放"}
        onSaveDraft={handleSaveDraft}
      />
    </form>
  );
}
