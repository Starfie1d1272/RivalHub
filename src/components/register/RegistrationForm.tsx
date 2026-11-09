"use client";

import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useClientReady } from "@/components/rivalhub/useClientReady";
import { ContentReady } from "@/components/telemetry/ContentReady";
import { ErrorCode } from "@/lib/errors";
import type { ActionError } from "@/types/action";
import {
  buildRegistrationSchema,
  positionValues,
  POSITION_LABELS,
  rankValues,
  RANK_LABELS,
  type RegistrationFormData,
  type RegistrationInput,
} from "@/lib/validators/registration";
import { PLAYER_TYPE_LABELS } from "@/lib/seasons/presentation";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import type { RegistrationConfig, PlayerType } from "@/types/season";
import { type MapPreferenceLevel } from "@/types/season";

import {
  loadRegistrationDraft,
  saveRegistrationDraft as telemetry_saveRegistrationDraft,
  submitRegistration as telemetry_submitRegistration,
} from "@/actions/register";
import type { RegistrationWindowState } from "@/lib/registration/window";
import { normalizeEmail } from "@/lib/utils/email";
import { compactUndefined } from "@/lib/utils/object";
import { defaultMapPreferences, projectMapPreferences } from "@/lib/maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type RegistrationFieldFeedback,
} from "./registration-form-utils";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { observeAction } from "@/lib/telemetry/client";

const saveRegistrationDraft = observeAction(
  "register.saveRegistrationDraft",
  telemetry_saveRegistrationDraft,
);
const submitRegistration = observeAction(
  "register.submitRegistration",
  telemetry_submitRegistration,
);

interface RegistrationFormProps {
  seasonId: string;
  seasonSlug: string;
  seasonName: string;
  positionCounts: Record<string, number>;
  positions: string[];
  registrationConfig: RegistrationConfig;
  windowState: RegistrationWindowState;
  currentUserEmail: string;
  initialValues?: Partial<RegistrationInput>;
  submitLabel?: string;
}

type DraftRead =
  { key: string; state: "empty" | "restored" } | { key: string; state: "error"; message: string };

export function RegistrationForm({
  seasonId,
  seasonSlug,
  seasonName,
  positionCounts,
  positions,
  registrationConfig: inputRegistrationConfig,
  windowState,
  currentUserEmail,
  initialValues,
  submitLabel,
}: RegistrationFormProps) {
  const { canSaveDraft, canSubmit } = windowState;
  const task = useTelemetryTask("registration", seasonId, canSubmit);
  const interactive = useClientReady();
  const receiptToken = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [closedWindow, setClosedWindow] = useState<RegistrationWindowState | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; checkProgress?: boolean } | null>(
    null,
  );
  const [draftAttempt, setDraftAttempt] = useState(0);
  const [draftRead, setDraftRead] = useState<DraftRead | null>(null);
  const email = normalizeEmail(currentUserEmail);
  const draftKey = `${seasonId}:${email}:${draftAttempt}`;
  const draft = draftRead?.key === draftKey ? draftRead : null;
  const statusHref = `/${seasonSlug}/register#registration-status` as Route;
  const canEdit = canSubmit && closedWindow !== windowState;
  const draftLoading = canEdit && canSaveDraft && draft === null;
  const draftError = canEdit && canSaveDraft && draft?.state === "error" ? draft.message : null;
  const ready = interactive && canEdit && !draftLoading && !draftError;
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
    getFieldState,
    reset,
    setError,
    setValue,
    watch,
    formState,
  } = useForm<RegistrationInput, unknown, RegistrationFormData>({
    resolver: zodResolver(schema),
    shouldFocusError: false,
    defaultValues: {
      ...initialValues,
      seasonId,
      email,
      willingToBeCaptain: initialValues?.willingToBeCaptain ?? false,
      playerType: initialValues?.playerType ?? registrationConfig.allowedPlayerTypes[0],
      screenshotUrls:
        initialValues?.screenshotUrls ??
        Array.from({ length: registrationConfig.screenshotCount }, () => ""),
      mapPreferences: projectMapPreferences(
        initialValues?.mapPreferences,
        registrationConfig.mapPool,
      ),
    },
  });
  const { isSubmitting } = formState;

  const acceptDraft = useEffectEvent(
    (key: string, result: Awaited<ReturnType<typeof loadRegistrationDraft>>) => {
      if (key !== draftKey || !canEdit || !canSaveDraft) return;
      if (!result.success) {
        if (result.error.code === ErrorCode.REGISTRATION_CLOSED) showFailure(result.error);
        else setDraftRead({ key, state: "error", message: result.error.message });
        return;
      }
      if (result.data.payload) {
        const draftValues = result.data.payload as Partial<RegistrationInput>;
        const values = { ...getValues(), ...draftValues };
        reset({
          ...values,
          seasonId,
          email,
          antiCheatPledge: values.antiCheatPledge === true ? true : undefined,
          mapPreferences: projectMapPreferences(values.mapPreferences, registrationConfig.mapPool),
        });
      }
      setDraftRead({ key, state: result.data.payload ? "restored" : "empty" });
    },
  );

  useEffect(() => {
    if (!interactive || !canEdit || !canSaveDraft || draftRead?.key === draftKey) return;
    let active = true;
    async function readDraft() {
      try {
        const result = await loadRegistrationDraft(seasonId, email);
        if (active) acceptDraft(draftKey, result);
      } catch {
        if (active)
          setDraftRead({ key: draftKey, state: "error", message: "暂时无法读取报名草稿。" });
      }
    }
    void readDraft();
    return () => {
      active = false;
    };
  }, [canEdit, canSaveDraft, draftKey, draftRead?.key, email, interactive, seasonId]);

  useEffect(() => {
    if (!feedback) return;
    const firstInvalid = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not([type="hidden"]):not(:disabled)',
    );
    (firstInvalid ?? feedbackRef.current)?.focus();
  }, [feedback]);

  function showFailure(error: ActionError) {
    if (error.code === ErrorCode.REGISTRATION_CLOSED) setClosedWindow(windowState);
    setFeedback({ message: error.message });
  }

  const onSubmit = async (data: RegistrationFormData) => {
    const taskToken = task.begin("submit");
    task.step("submit", taskToken);
    setFeedback(null);
    try {
      const result = await submitRegistration(data);
      if (result.success) {
        task.complete(taskToken);
        receiptToken.current = taskToken;
        setSubmitted(true);
        return;
      }
      if (result.error.fieldErrors) {
        task.validation("server_validation", taskToken);
        for (const [name, message] of Object.entries(result.error.fieldErrors)) {
          setError(name as keyof RegistrationInput, { type: "server", message });
        }
      }
      showFailure(result.error);
    } catch {
      setFeedback({
        message: "提交结果暂未确认。请先查看本届报名进度，再决定是否重试。",
        checkProgress: true,
      });
    }
  };

  const handleSaveDraft = async () => {
    if (!ready || !canSaveDraft || isSubmitting || savingDraft) return;
    setSavingDraft(true);
    setFeedback(null);
    try {
      const result = await saveRegistrationDraft({
        seasonId,
        email,
        payload: compactUndefined({ ...getValues(), seasonId, email }) as Record<string, unknown>,
      });
      if (result.success) toast.success("草稿已保存");
      else showFailure(result.error);
    } catch {
      setFeedback({ message: "草稿保存结果暂未确认。当前填写内容仍在此页，可以再保存一次。" });
    } finally {
      setSavingDraft(false);
    }
  };

  const presentResult = task.step;
  useEffect(() => {
    if (submitted) presentResult("result", receiptToken.current);
  }, [submitted, presentResult]);

  if (submitted) return <RegistrationSuccess seasonName={seasonName} statusHref={statusHref} />;

  // ── 工具函数 ──
  const renderError: RegistrationFieldFeedback["renderError"] = (name) => {
    const message = getFieldState(name, formState).error?.message;
    return message ? (
      <p id={`${name}-error`} className="mt-1 text-sm text-[var(--color-danger)]">
        {message}
      </p>
    ) : null;
  };
  const errorAttributes: RegistrationFieldFeedback["errorAttributes"] = (name) =>
    getFieldState(name, formState).error?.message
      ? { "aria-invalid": true, "aria-describedby": `${name}-error` }
      : {};

  const positionFull = (pos: string) =>
    isPositionFull(pos, positionCounts, registrationConfig.maxPerPosition);

  const positionLabel = (pos: string) =>
    buildPositionLabel(pos, positionCounts, registrationConfig.maxPerPosition);

  const Required = () => <span className="text-[var(--color-danger)]">*</span>;

  const inputCls = "bg-[var(--color-panel-hi)] border-[var(--color-border)]";

  const numRegister = (name: keyof RegistrationInput) =>
    register(name, {
      setValueAs: (v: string) =>
        v === "" || v === undefined || v === null ? undefined : parseFloat(String(v)),
    });

  const setMapLevel = (map: string, level: MapPreferenceLevel | null) => {
    // React Hook Form's watch callback is intentionally read at the event boundary.
    // eslint-disable-next-line react-hooks/incompatible-library
    const current = watch("mapPreferences") ?? defaultMapPreferences(registrationConfig.mapPool);
    const next = registrationConfig.mapPool.map((item) => ({
      map: item,
      level:
        item === map
          ? level
          : (current.find((preference) => preference.map === item)?.level ?? null),
    }));
    setValue("mapPreferences", next, { shouldValidate: true });
  };

  const mapPreferences =
    watch("mapPreferences") ?? defaultMapPreferences(registrationConfig.mapPool);
  const { playableCount, strongCount } = countMapPreferenceLevels(mapPreferences);

  return (
    <form
      ref={formRef}
      noValidate
      onInputCapture={() => task.begin()}
      onPointerDownCapture={task.activity}
      onKeyDownCapture={task.activity}
      onSubmit={(event) => {
        if (!ready || savingDraft || isSubmitting) {
          event.preventDefault();
          return;
        }
        void handleSubmit(onSubmit, () => {
          task.begin();
          task.validation("form_invalid");
          setFeedback({ message: "请修正标出的报名资料。" });
        })(event);
      }}
      className="space-y-8"
    >
      <input type="hidden" {...register("seasonId")} />
      {feedback && (
        <div className="space-y-2">
          <p
            ref={feedbackRef}
            role="alert"
            tabIndex={-1}
            className="text-sm text-[var(--color-danger)]"
          >
            {feedback.message}
          </p>
          {feedback.checkProgress && (
            <Button asChild variant="outline">
              <Link href={statusHref} target="_blank" rel="noopener" prefetch={false}>
                在新标签页查看报名进度
              </Link>
            </Button>
          )}
        </div>
      )}
      {canEdit && (!interactive || draftLoading || draft?.state === "restored") && (
        <p role="status" className="text-sm text-[var(--color-fg-secondary)]">
          {!interactive || draftLoading
            ? "正在读取报名草稿…"
            : "草稿已恢复。提交前请核对资料和反作弊承诺。"}
        </p>
      )}
      {draftError && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {draftError}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraftAttempt((attempt) => attempt + 1)}
            >
              重新读取草稿
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDraftRead({ key: draftKey, state: "empty" })}
            >
              使用当前资料
            </Button>
          </div>
        </div>
      )}
      {ready && <ContentReady module="account" phase="form" />}
      <fieldset disabled={!ready} className="min-w-0 space-y-8">
        <legend className="sr-only">{canEdit ? "报名资料" : "报名资料（只读）"}</legend>
        {/* ═══════════════════════════════════════ 基础信息 ═══ */}
        <section>
          <RegistrationSectionTitle>基础信息</RegistrationSectionTitle>
          <div className="space-y-4">
            {/* 邮箱 */}
            <div>
              <Label htmlFor="email" className="text-[var(--color-fg-mid)] mb-1.5 block">
                电子邮件 <Required />
              </Label>
              <Input
                id="email"
                type="email"
                className={inputCls}
                readOnly
                {...register("email")}
                {...errorAttributes("email")}
              />
              {renderError("email")}
            </div>

            {/* 学号 + QQ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="studentId" className="text-[var(--color-fg-mid)] mb-1.5 block">
                  学号 <Required />
                </Label>
                <Input
                  id="studentId"
                  placeholder="毕业生填「毕业年份+学院」"
                  className={inputCls}
                  {...register("studentId")}
                  {...errorAttributes("studentId")}
                />
                {renderError("studentId")}
              </div>
              <div>
                <Label htmlFor="playerType" className="text-[var(--color-fg-mid)] mb-1.5 block">
                  身份类型 <Required />
                </Label>
                <Select
                  disabled={!ready}
                  value={watch("playerType") ?? registrationConfig.allowedPlayerTypes[0]}
                  onValueChange={(v) =>
                    setValue("playerType", v as PlayerType, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger
                    id="playerType"
                    className={inputCls}
                    {...errorAttributes("playerType")}
                  >
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
                {renderError("playerType")}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="qq" className="text-[var(--color-fg-mid)] mb-1.5 block">
                  QQ 号 <Required />
                </Label>
                <Input
                  id="qq"
                  placeholder="123456789"
                  className={inputCls}
                  {...register("qq")}
                  {...errorAttributes("qq")}
                />
                {renderError("qq")}
              </div>
            </div>

            {/* 完美昵称 */}
            <div>
              <Label htmlFor="perfectName" className="text-[var(--color-fg-mid)] mb-1.5 block">
                完美平台昵称 <Required />
              </Label>
              <Input
                id="perfectName"
                placeholder="完美对战平台昵称"
                className={inputCls}
                {...register("perfectName")}
                {...errorAttributes("perfectName")}
              />
              {renderError("perfectName")}
            </div>

            {/* Steam 官方资料只接受 Steam64 */}
            <div>
              <Label htmlFor="steam64" className="text-[var(--color-fg-mid)] mb-1.5 block">
                Steam 64 位 ID <Required />
              </Label>
              <Input
                id="steam64"
                placeholder="76561198XXXXXXXXX"
                className={`${inputCls} font-mono text-sm`}
                {...register("steam64")}
                {...errorAttributes("steam64")}
              />
              {renderError("steam64")}
              <p className="text-xs text-[var(--color-fg-dim)] mt-1">
                昵称、头像和个人资料链接将在 Steam 官方资料可用时自动展示。
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════ 位置选择 ═══ */}
        <section>
          <RegistrationSectionTitle>位置选择</RegistrationSectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="primaryPosition" className="text-[var(--color-fg-mid)] mb-1.5 block">
                主选位置 <Required />
              </Label>
              <Select
                disabled={!ready}
                value={watch("primaryPosition") ?? ""}
                onValueChange={(v) =>
                  setValue("primaryPosition", v as RegistrationFormData["primaryPosition"], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger
                  id="primaryPosition"
                  className={inputCls}
                  {...errorAttributes("primaryPosition")}
                >
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
              {renderError("primaryPosition")}
              <p className="text-xs text-[var(--color-fg-dim)] mt-1">
                每个位置最多 {registrationConfig.maxPerPosition} 人，满员后自动关闭
              </p>
            </div>

            <div>
              <Label
                htmlFor="secondaryPosition"
                className="text-[var(--color-fg-mid)] mb-1.5 block"
              >
                次选位置 <Required />
              </Label>
              <Select
                disabled={!ready}
                value={watch("secondaryPosition") ?? ""}
                onValueChange={(v) =>
                  setValue("secondaryPosition", v as RegistrationFormData["primaryPosition"], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger
                  id="secondaryPosition"
                  className={inputCls}
                  {...errorAttributes("secondaryPosition")}
                >
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
              {renderError("secondaryPosition")}
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
                <Label htmlFor="peakRank" className="text-[var(--color-fg-mid)] mb-1.5 block">
                  历史最高段位 <Required />
                </Label>
                <Select
                  disabled={!ready}
                  value={watch("peakRank") ?? ""}
                  onValueChange={(v) =>
                    setValue("peakRank", v as RegistrationFormData["peakRank"], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger
                    id="peakRank"
                    className={inputCls}
                    {...errorAttributes("peakRank")}
                  >
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
                {renderError("peakRank")}
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
                  {...errorAttributes("peakRankSeason")}
                />
                {renderError("peakRankSeason")}
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
                  max={3.0}
                  step={0.01}
                  className={inputCls}
                  {...numRegister("peakRating")}
                  {...errorAttributes("peakRating")}
                />
                {renderError("peakRating")}
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
                  {...errorAttributes("peakWe")}
                />
                {renderError("peakWe")}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════ 段位 · 当前赛季最高 ═══ */}
        <section>
          <RegistrationSectionTitle>段位信息 · 当前赛季最高</RegistrationSectionTitle>
          <div className="space-y-4">
            <div>
              <Label
                htmlFor="currentSeasonPeakRank"
                className="text-[var(--color-fg-mid)] mb-1.5 block"
              >
                当前赛季最高段位 <Required />
              </Label>
              <Select
                disabled={!ready}
                value={watch("currentSeasonPeakRank") ?? ""}
                onValueChange={(v) =>
                  setValue(
                    "currentSeasonPeakRank",
                    v as RegistrationFormData["currentSeasonPeakRank"],
                    {
                      shouldValidate: true,
                    },
                  )
                }
              >
                <SelectTrigger
                  id="currentSeasonPeakRank"
                  className={inputCls}
                  {...errorAttributes("currentSeasonPeakRank")}
                >
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
              {renderError("currentSeasonPeakRank")}
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
                  max={3.0}
                  step={0.01}
                  className={inputCls}
                  {...numRegister("currentRating")}
                  {...errorAttributes("currentRating")}
                />
                {renderError("currentRating")}
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
                  {...errorAttributes("currentWe")}
                />
                {renderError("currentWe")}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════ 地图熟练度 ═══ */}
        <div
          role="group"
          aria-label="地图熟练度"
          tabIndex={-1}
          {...errorAttributes("mapPreferences")}
        >
          <MapPreferenceSection
            mapPool={registrationConfig.mapPool}
            mapPreferences={mapPreferences}
            playableCount={playableCount}
            strongCount={strongCount}
            error={renderError("mapPreferences")}
            onSetMapLevel={setMapLevel}
          />
        </div>

        {/* ═══════════════════════════════════════ 天梯截图 ═══ */}
        <ScreenshotLinksSection
          screenshotCount={registrationConfig.screenshotCount}
          inputClassName={inputCls}
          register={register}
          renderError={renderError}
          errorAttributes={errorAttributes}
        />

        <RegistrationExperienceSection
          inputClassName={inputCls}
          register={register}
          watch={watch}
          renderError={renderError}
          errorAttributes={errorAttributes}
        />

        <RegistrationOtherSection
          inputClassName={inputCls}
          register={register}
          watch={watch}
          renderError={renderError}
          errorAttributes={errorAttributes}
        />

        <AntiCheatPledgeSection
          registration={register("antiCheatPledge")}
          renderError={renderError}
          errorAttributes={errorAttributes}
        />
      </fieldset>

      {canEdit && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-fg-secondary)]">提交即视为同意参赛规则。</p>
          <RegistrationSubmitBar
            canSaveDraft={ready && canSaveDraft && !isSubmitting}
            canSubmit={ready && !savingDraft}
            isSubmitting={isSubmitting}
            savingDraft={savingDraft}
            submitText={submitLabel ?? "提交报名"}
            onSaveDraft={handleSaveDraft}
          />
        </div>
      )}
    </form>
  );
}
