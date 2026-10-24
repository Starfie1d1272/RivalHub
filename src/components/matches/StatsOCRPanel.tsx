"use client";
import Link from "next/link";

import React, { useState, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { mapLabel } from "@/lib/maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  extractStatsFromScreenshot as telemetry_extractStatsFromScreenshot,
  savePlayerStats as telemetry_savePlayerStats,
  getOperatorScoreboardSnapshot,
  getScoreboardEditorState,
  getScoreboardOperationReceipt,
  retryPlayerStatsRefresh,
  deletePlayerStatsByMap as telemetry_deletePlayerStatsByMap,
  type PlayerOption,
} from "@/actions/player-stats";
import type { AuthorizedScoreboardSnapshot, ScoreboardCommand } from "@/lib/ocr/scoreboard-contract";
import type { OperatorScoreboardRow } from "@/lib/matches/operator-scoreboard";
import { forgetScoreboardOperation, readPendingScoreboardOperation, rememberScoreboardOperation } from "@/lib/ocr/scoreboard-recovery";
import { OCR_MAX_IMAGE_BYTES, OCR_IMAGE_SIZE_MESSAGE, isOCRImageMimeType } from "@/lib/ocr/input-contract";
import { isStatOutOfRange } from "@/lib/config/stat-ranges";
import { InlineConfirm } from "@/components/rivalhub";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { assignScreenshotPlayer, mergeScreenshotDrafts, type ScoreboardDraft } from "./stats-ocr-drafts";
import { observeAction } from "@/lib/telemetry/client";

const extractStatsFromScreenshot = observeAction("player-stats.extractStatsFromScreenshot", telemetry_extractStatsFromScreenshot);
const savePlayerStats = observeAction("player-stats.savePlayerStats", telemetry_savePlayerStats);
const deletePlayerStatsByMap = observeAction("player-stats.deletePlayerStatsByMap", telemetry_deletePlayerStatsByMap);

interface Props {
  mapId: string;
  mapName: string;
  /** Already-authorized editor DTO from the workbench; no mount action when supplied. */
  initialRows?: OperatorScoreboardRow[];
  initialVersion?: string;
}

type DraftRow = ScoreboardDraft;
const OPERATOR_FIELDS = new Set<string>(["ratingPro", "rws", "we"]);
function savedDrafts(rows: OperatorScoreboardRow[]): DraftRow[] {
  return rows.map(row => ({
    perfectName: row.perfectName,
    userId: row.userId,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    hsPercent: row.hsPercent,
    firstKills: row.firstKills,
    multiKills: row.multiKills,
    clutches: row.clutches,
    adr: row.adr,
    rws: row.rws,
    ratingPro: row.ratingPro,
    we: row.we,
    gameplayLocked: row.gameplayLocked,
  }));
}

const NUM_FIELDS = [
  { key: "kills",      label: "K"   },
  { key: "deaths",     label: "D"   },
  { key: "assists",    label: "A"   },
  { key: "hsPercent",  label: "HS%" },
  { key: "firstKills", label: "FK"  },
  { key: "multiKills", label: "MK"  },
  { key: "clutches",   label: "残局" },
  { key: "adr",        label: "ADR" },
  { key: "rws",        label: "RWS" },
  { key: "ratingPro",  label: "Rating" },
  { key: "we",         label: "WE"  },
] as const;

type NumFieldKey = typeof NUM_FIELDS[number]["key"];

export function StatsOCRPanel({ mapId, mapName, initialRows, initialVersion }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>(() => savedDrafts(initialRows ?? []));
  const [canonicalDrafts, setCanonicalDrafts] = useState<DraftRow[]>(() => savedDrafts(initialRows ?? []));
  const [playerOptions, setPlayerOptions] = useState<PlayerOption[]>([]);
  const optionsLoaded = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setErrorMessage] = useState<string | null>(null);
  const [ocrDetails, setOCRDetails] = useState<{ requestId?: string; configurationRequired: boolean } | null>(null);
  function setError(message: string | null) {
    setErrorMessage(message);
    setOCRDetails(null);
  }
  // viewMode=true：只读展示；false：编辑录入
  const [viewMode, setViewMode] = useState(Boolean(initialRows?.length));
  const [initialLoading, setInitialLoading] = useState(initialRows === undefined);
  const [recovery, setRecovery] = useState<"unknown" | "refresh_pending" | "conflict" | null>(null);
  const [restoredOperation, setRestoredOperation] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const initialReadComplete = useRef(initialRows !== undefined);
  const readGeneration = useRef(0);
  const activeOperation = useRef<"extract" | "save" | "clear" | null>(null);
  const editEpoch = useRef(0);
  const reloadBusyOwner = useRef(0);
  const [baseVersion, setBaseVersion] = useState<string | null>(initialVersion ?? null);
  const actorScope = useRef<string | null>(null);
  const pendingOperation = useRef<(ScoreboardCommand & { operation: "save" | "clear"; rows?: DraftRow[] }) | null>(null);
  function clearPendingOperation() {
    if (actorScope.current && pendingOperation.current) forgetScoreboardOperation(mapId, actorScope.current, pendingOperation.current.operationId);
    pendingOperation.current = null;
    setRestoredOperation(false);
  }
  function persistOperation(command: ScoreboardCommand & { operation: "save" | "clear" }): boolean {
    if (!actorScope.current) { setError("请先读取当前计分板再提交。"); return false; }
    try {
      const existing = readPendingScoreboardOperation(mapId, actorScope.current);
      if (existing) {
        pendingOperation.current = existing;
        setRestoredOperation(true);
        setRecovery("unknown");
        setError("此地图还有未核对的原操作，请先核对提交凭据。");
        return false;
      }
      rememberScoreboardOperation({ ...command, mapId, actorScope: actorScope.current });
      return true;
    }
    catch { setError("操作恢复编号无法保存，请恢复此站点的本地存储后再提交。"); return false; }
  }
  function adoptSnapshot(snapshot: AuthorizedScoreboardSnapshot) {
    actorScope.current = snapshot.actorScope;
    initialReadComplete.current = true;
    const saved = savedDrafts(snapshot.rows);
    setBaseVersion(snapshot.version);
    setDrafts(saved);
    setCanonicalDrafts(saved);
    setViewMode(saved.length > 0);
    setReadFailed(false);
    setInitialLoading(false);
  }

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Each mounted map owns its state; the workbench keys panels by map ID.
  useEffect(() => {
    if (initialRows !== undefined && initialReadComplete.current) return;
    const generation = ++readGeneration.current;
    let cancelled = false;
    if (initialRows !== undefined) {
      // A prefetched snapshot may arrive while the mount read is in flight.
      // Adopt it once; later RSC refresh props must not overwrite an edited draft.
      if (!initialReadComplete.current) {
        queueMicrotask(() => {
          if (cancelled || generation !== readGeneration.current) return;
          const saved = savedDrafts(initialRows);
          initialReadComplete.current = true;
          setBaseVersion(initialVersion ?? null);
          setDrafts(saved);
          setCanonicalDrafts(saved);
          setViewMode(saved.length > 0);
          setReadFailed(false);
          setInitialLoading(false);
          setError(null);
        });
      }
      return () => { cancelled = true; };
    }
    getOperatorScoreboardSnapshot(mapId).then(result => {
      if (cancelled || generation !== readGeneration.current) return;
      if (!result.success) {
        setError(result.error.message);
        setReadFailed(true);
        return;
      }
      initialReadComplete.current = true;
      actorScope.current = result.data.actorScope;
      setBaseVersion(result.data.version);
      const saved = savedDrafts(result.data.rows);
      setDrafts(saved);
      setCanonicalDrafts(saved);
      setViewMode(saved.length > 0);
    }).catch(() => {
      if (!cancelled && generation === readGeneration.current) { setReadFailed(true); setError("已保存数据暂时无法读取，请重试读取。"); }
    }).finally(() => { if (!cancelled && generation === readGeneration.current) setInitialLoading(false); });
    return () => { cancelled = true; };
  }, [mapId, initialRows, initialVersion]);

  useEffect(() => {
    if (!readPendingScoreboardOperation(mapId)) return;
    const generation = ++readGeneration.current;
    let cancelled = false;
    getOperatorScoreboardSnapshot(mapId).then(result => {
      if (cancelled || generation !== readGeneration.current) return;
      if (!result.success) { setReadFailed(true); setError(result.error.message); return; }
      adoptSnapshot(result.data);
      const original = readPendingScoreboardOperation(mapId, result.data.actorScope);
      if (original) {
        pendingOperation.current = original;
        setRestoredOperation(true);
        setRecovery("unknown");
        setError("已恢复原操作编号。请核对持久提交凭据，当前读取的数据不能单独证明原操作结果。");
      }
    }).catch(() => {
      if (!cancelled && generation === readGeneration.current) { setReadFailed(true); setError("原操作恢复上下文暂时无法核对，请重试读取。"); }
    }).finally(() => { if (!cancelled && generation === readGeneration.current) setInitialLoading(false); });
    return () => { cancelled = true; };
    // map owns the mounted editor; props changes cannot restart recovery.
  }, [mapId]);

  async function enterEditMode() {
    if (activeOperation.current) return;
    setSaving(true);
    const generation = ++readGeneration.current;
    try {
      const result = await getScoreboardEditorState(mapId);
      if (generation !== readGeneration.current) return;
      if (!result.success) { setError(result.error.message); return; }
      adoptSnapshot(result.data.snapshot);
      optionsLoaded.current = true;
      setPlayerOptions(result.data.playerOptions);
      setViewMode(false);
    } catch { setError("选手及已保存数据暂时无法读取，请重试。"); }
    finally { setSaving(false); }
  }

  async function reloadSavedData() {
    const owner = ++reloadBusyOwner.current;
    const generation = ++readGeneration.current;
    setSaving(true);
    try {
      if (recovery === "unknown") {
        const original = pendingOperation.current;
        if (!original) { setError("原操作上下文缺失，请联系管理员核对，不要重复提交。"); return; }
        const status = await getScoreboardOperationReceipt(mapId, original);
        if (generation !== readGeneration.current) return;
        if (!status.success) { setError(status.error.message); return; }
        if (status.data.status === "unconfirmed") {
          setError("尚未找到原请求的提交凭据；请求可能仍在处理中。草稿和原编号已保留，请稍后再次核对，不要重新提交。");
          return;
        }
        adoptSnapshot(status.data.snapshot);
        setRecovery("refresh_pending");
        const refresh = await retryPlayerStatsRefresh(mapId);
        if (!refresh.success) { setError("原提交已确认，缓存刷新仍未完成，请重试刷新。"); return; }
        clearPendingOperation();
        setRecovery(null);
        setError(status.data.superseded ? "原提交已确认，但已有后续更改；已载入当前数据，请核对后再编辑。" : null);
        return;
      }
      if (recovery === "refresh_pending") {
        const refresh = await retryPlayerStatsRefresh(mapId);
        if (!refresh.success) { setError("写入已确认，缓存刷新仍未完成，请稍后重试读取。"); return; }
      }
      const result = await getOperatorScoreboardSnapshot(mapId);
      if (generation !== readGeneration.current) return;
      if (!result.success) { setError(result.error.message); return; }
      adoptSnapshot(result.data);
      const stored = !pendingOperation.current && readPendingScoreboardOperation(mapId, result.data.actorScope);
      if (stored) {
        pendingOperation.current = stored;
        setRestoredOperation(true);
        setRecovery("unknown");
        setError("已恢复原操作编号，请核对提交凭据。");
        return;
      }
      clearPendingOperation();
      setRecovery(null);
      setError(null);
    } catch { if (generation === readGeneration.current) setError("提交状态暂时无法核对，原草稿和操作编号已保留。"); }
    finally { if (owner === reloadBusyOwner.current) setSaving(false); }
  }

  async function handleExtract() {
    if (activeOperation.current || saving || recovery || readFailed) return;
    const file = selectedFile;
    if (!file) {
      setError("请先选择截图文件");
      return;
    }
    if (file.size > OCR_MAX_IMAGE_BYTES) {
      setError(OCR_IMAGE_SIZE_MESSAGE);
      return;
    }

    if (!isOCRImageMimeType(file.type)) { setError("请选择 JPEG、PNG 或 WebP 图片。"); return; }
    activeOperation.current = "extract";
    const epoch = ++editEpoch.current;
    setError(null);
    setExtracting(true);
    ++readGeneration.current;
    let imageRead = false;

    try {
      const base64 = await fileToBase64(file);
      if (epoch !== editEpoch.current || activeOperation.current !== "extract" || pendingOperation.current) return;
      imageRead = true;
      const mimeType = file.type;
      const result = await extractStatsFromScreenshot({ mapId, base64Image: base64, mimeType });
      if (epoch !== editEpoch.current || activeOperation.current !== "extract" || pendingOperation.current) return;

      if (!result.success) {
        setError(result.error.message);
        const requestId = result.error.meta?.requestId;
        setOCRDetails({
          requestId: typeof requestId === "string" && /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : undefined,
          configurationRequired: result.error.meta?.configurationRequired === true,
        });
        return;
      }

      const saved = savedDrafts(result.data.snapshot.rows);
      initialReadComplete.current = true;
      actorScope.current = result.data.snapshot.actorScope;
      setBaseVersion(result.data.snapshot.version);
      setCanonicalDrafts(saved);
      setDrafts(mergeScreenshotDrafts(result.data.drafts, saved));
      setViewMode(false);
      optionsLoaded.current = true;
      setPlayerOptions(result.data.playerOptions);
    } catch {
      if (epoch === editEpoch.current && activeOperation.current === "extract") setError(imageRead ? "OCR 请求未完成，请检查网络连接后重试。" : "截图文件读取失败，请重新选择图片后重试。");
    } finally {
      if (activeOperation.current === "extract") activeOperation.current = null;
      setExtracting(false);
    }
  }

  function handleNumChange(idx: number, field: NumFieldKey, raw: string) {
    const val = raw === "" ? null : Number(raw);
    setDrafts((prev) =>
      prev.map((row, i) =>
        i === idx ? { ...row, [field]: isNaN(val as number) ? null : val } : row
      )
    );
  }

  function handleUserChange(idx: number, userId: string) {
    const selectedPlayer = userId !== "__none__"
      ? playerOptions.find((p) => p.userId === userId)
      : null;
    setDrafts(prev => assignScreenshotPlayer(prev, idx, selectedPlayer ?? null));
  }

  function handleDeleteRow(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleAddRow() {
    if (activeOperation.current || saving || recovery || readFailed) return;
    setSaving(true);
    const generation = ++readGeneration.current;
    try {
      let current = drafts;
      if (!baseVersion || !optionsLoaded.current) {
        const result = await getScoreboardEditorState(mapId);
        if (generation !== readGeneration.current) return;
        if (!result.success) { setError(result.error.message); return; }
        adoptSnapshot(result.data.snapshot);
        optionsLoaded.current = true;
        setPlayerOptions(result.data.playerOptions);
        current = savedDrafts(result.data.snapshot.rows);
      }
      setViewMode(false);
      setDrafts([...current,
        { perfectName: "", userId: null, kills: null, deaths: null, assists: null, hsPercent: null, firstKills: null, multiKills: null, clutches: null, adr: null, rws: null, ratingPro: null, we: null },
      ]);
    } catch { setError("请先读取当前计分板和阵容，再添加选手。"); }
    finally { setSaving(false); }
  }

  async function handleSave() {
    if (activeOperation.current || recovery || readFailed || !baseVersion || !actorScope.current) return;
    const command = { operationId: crypto.randomUUID(), expectedActor: actorScope.current, expectedVersion: baseVersion, operation: "save" as const, rows: drafts };
    if (!persistOperation(command)) return;
    pendingOperation.current = command;
    setRestoredOperation(false);
    activeOperation.current = command.operation;
    ++editEpoch.current;
    setSaving(true);
    setError(null);
    let committed = false;
    try {
      const result = await savePlayerStats(mapId, command);
      if (!result.success) {
        setError(result.error.message);
        if (result.error.code === "INTERNAL_ERROR") setRecovery("unknown");
        else { clearPendingOperation(); if (result.error.meta?.outcome === "conflict") setRecovery("conflict"); }
        return;
      }
      committed = true;
      setRecovery("refresh_pending");
      const read = await getOperatorScoreboardSnapshot(mapId);
      if (!read.success) { setError("已保存，读取最新数据失败。当前草稿已保留，请勿重复保存。"); return; }
      initialReadComplete.current = true;
      setBaseVersion(read.data.version);
      const saved = savedDrafts(read.data.rows);
      setCanonicalDrafts(saved);
      setDrafts(saved);
      setViewMode(true);
      if (!result.data.refreshPending) { setRecovery(null); clearPendingOperation(); }
      router.refresh();
    } catch {
      setRecovery(committed ? "refresh_pending" : "unknown");
      setError(committed ? "已保存，刷新尚未完成。请读取最新数据核对。" : "提交结果尚未确认，草稿已保留。请先读取当前已保存数据核对，不要重复提交。");
    } finally { if (activeOperation.current === "save") activeOperation.current = null; setSaving(false); }
  }

  const assignedUserIdsByRow = useMemo(
    () =>
      drafts.map((_, excludeIdx) =>
        new Set(
          drafts
            .filter((_, di) => di !== excludeIdx)
            .map((d) => d.userId)
            .filter(Boolean),
        ),
      ),
    [drafts],
  );

  const missingOperatorFields = canonicalDrafts.some(row => row.ratingPro === null || row.rws === null || row.we === null);

  const errorCount = useMemo(() => {
    let count = 0;
    for (const row of drafts) {
      for (const f of NUM_FIELDS) {
        const val = row[f.key] as number | null;
        if (val !== null && isStatOutOfRange(f.key, val)) count++;
      }
    }
    return count;
  }, [drafts]);

  const unmatchedCount = useMemo(
    () => drafts.filter((row) => row.userId === null).length,
    [drafts],
  );

  async function handleClear() {
    if (activeOperation.current || recovery || readFailed) return;
    if (!baseVersion || !actorScope.current) {
      setSaving(true);
      try {
        const read = await getOperatorScoreboardSnapshot(mapId);
        if (!read.success) { setError(read.error.message); return; }
        adoptSnapshot(read.data);
        setShowClearConfirm(false);
        setError("已载入当前数据，请核对后再次确认清除。");
      } catch { setError("当前数据暂时无法读取，尚未清除。"); }
      finally { setSaving(false); }
      return;
    }
    const command = { operationId: crypto.randomUUID(), expectedActor: actorScope.current, expectedVersion: baseVersion, operation: "clear" as const };
    if (!persistOperation(command)) return;
    pendingOperation.current = command;
    setRestoredOperation(false);
    activeOperation.current = command.operation;
    ++editEpoch.current;
    setSaving(true);
    let committed = false;
    try {
      const result = await deletePlayerStatsByMap(mapId, command);
      if (!result.success) {
        setError(result.error.message);
        if (result.error.code === "INTERNAL_ERROR") setRecovery("unknown");
        else { clearPendingOperation(); if (result.error.meta?.outcome === "conflict") setRecovery("conflict"); }
        return;
      }
      committed = true;
      setRecovery("refresh_pending");
      setShowClearConfirm(false);
      const read = await getOperatorScoreboardSnapshot(mapId);
      if (!read.success) { setError("清除已提交，读取最新数据失败。请勿重复清除。"); return; }
      initialReadComplete.current = true;
      setBaseVersion(read.data.version);
      const saved = savedDrafts(read.data.rows);
      setCanonicalDrafts(saved);
      setDrafts(saved);
      setViewMode(saved.length > 0);
      if (!result.data.refreshPending) { setRecovery(null); clearPendingOperation(); }
      toast.success("计分板输入已清除");
      router.refresh();
    } catch {
      setRecovery(committed ? "refresh_pending" : "unknown");
      setError(committed ? "清除已提交，刷新尚未完成。" : "清除结果尚未确认，请读取当前已保存数据核对，不要重复清除。");
    } finally { if (activeOperation.current === "clear") activeOperation.current = null; setSaving(false); }
  }

  if (initialLoading) {
    return (
      <div className="mt-4">
        <p className="text-sm text-[var(--color-fg-mid)]">加载中…</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {(recovery || readFailed) && <div role="status" className="space-y-2 text-sm">
        <p>{recovery === "unknown" ? (restoredOperation ? "原操作编号已恢复；关闭前的草稿未持久保存。" : "提交结果待核对；当前草稿和操作编号已保留。") : recovery === "conflict" ? "计分板存在后续更改，请读取当前数据核对。" : recovery === "refresh_pending" ? "写入已确认，刷新待完成。" : "无法读取已保存数据。"}</p>
        <Button size="sm" variant="outline" disabled={saving} onClick={reloadSavedData}>{recovery === "unknown" ? "核对原操作提交凭据" : "载入当前已保存数据（替换草稿）"}</Button>
      </div>}
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-sm">
          {mapLabel(mapName)} — 玩家数据
        </h4>
        {viewMode && drafts.length > 0 && (
          <div className="flex gap-2 items-center">
            {showClearConfirm ? (
              <InlineConfirm
                title="确认清除计分板输入？"
                sub="已确认 Demo 的比赛数据保留，Rating / RWS / WE 将清空"
                onConfirm={handleClear}
                onCancel={() => setShowClearConfirm(false)}
              />
            ) : (
              <Button size="sm" variant="outline" onClick={enterEditMode} disabled={extracting || saving || Boolean(recovery) || readFailed}>重新录入</Button>
            )}
            {!showClearConfirm && (
              <Button
                size="sm"
                variant="ghost"
                className="text-[var(--color-danger)]"
                disabled={extracting || saving || Boolean(recovery) || readFailed}
                onClick={() => setShowClearConfirm(true)}
              >
                清除计分板输入
              </Button>
            )}
          </div>
        )}
      </div>

      {(!viewMode || missingOperatorFields) && (
        <div className="flex gap-2 items-center flex-wrap">
          <input
            ref={fileRef}
            type="file"
            aria-label="记分板截图"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) { setSelectedFile(file); setError(null); }
              // Cancellation preserves the selected File; clearing the control permits same-file retry.
              event.currentTarget.value = "";
            }}
          />
          <Button type="button" size="sm" variant={selectedFile ? "outline" : "default"}
            disabled={extracting || saving || Boolean(recovery)} onClick={() => fileRef.current?.click()}>
            {selectedFile ? "更换截图" : viewMode ? "补传计分板截图" : "选择截图"}
          </Button>
          {selectedFile && <span className="max-w-48 truncate text-sm text-[var(--color-fg-mid)]" title={selectedFile.name}>{selectedFile.name}</span>}
          <Button
            size="sm"
            variant={selectedFile ? "default" : "outline"}
            onClick={handleExtract}
            disabled={extracting || saving || Boolean(recovery) || readFailed || !selectedFile}
          >
            {extracting ? "识别中…" : "OCR 识别截图"}
          </Button>
          {drafts.some(row => row.gameplayLocked) && <p className="text-xs text-[var(--color-fg-mid)]">Demo 已确认的选手只能修正 Rating / RWS / WE。</p>}
          {!viewMode && <Button size="sm" variant="outline" disabled={extracting || saving || Boolean(recovery) || readFailed} onClick={handleAddRow}>
            添加行
          </Button>}
        </div>
      )}

      {error && (
        <div role="alert" className="space-y-1 text-sm text-[var(--color-danger)]">
          <p>{error}</p>
          {ocrDetails?.requestId && <p className="text-xs">排查编号：{ocrDetails.requestId}</p>}
          {ocrDetails?.configurationRequired && <Link href="/admin/settings#ocr-configuration" className="underline underline-offset-4">查看 OCR 配置检查指引（超级管理员）</Link>}
        </div>
      )}

      {/* ── 只读视图 ── */}
      {viewMode && drafts.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-36 min-w-36">昵称</TableHead>
                {NUM_FIELDS.map((f) => (
                  <TableHead key={f.key} className="w-16 text-center">
                    {f.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((row, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium"><span className="block max-w-36 truncate" title={row.perfectName}>{row.perfectName}</span></TableCell>
                  {NUM_FIELDS.map((f) => (
                    <TableCell key={f.key} className="text-center tabular-nums">
                      {(row[f.key] as number | null) ?? "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── 编辑视图 ── */}
      {!viewMode && (
        <>


          {drafts.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36 min-w-36">昵称</TableHead>
                      <TableHead className="w-56 min-w-56">匹配用户</TableHead>
                      {NUM_FIELDS.map((f) => (
                        <TableHead key={f.key} className="w-16 text-center">
                          {f.label}
                        </TableHead>
                      ))}
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <span className={cn(
                            "block text-xs px-2 py-1 truncate max-w-[9rem]",
                            !(row.perfectName as string) && "text-[var(--color-fg-dim)] italic",
                          )} title={row.perfectName}>
                            {(row.perfectName as string) || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-56">
                          <Select
                            disabled={extracting || saving || Boolean(recovery) || row.gameplayLocked}
                            value={row.userId ?? "__none__"}
                            onValueChange={(v) => handleUserChange(idx, v)}
                          >
                            <SelectTrigger className={cn(
                              "h-7 text-xs",
                              row.userId === null && "border-[var(--color-danger)] text-[var(--color-danger)]",
                            )} title={row.perfectName}>
                              <SelectValue placeholder="未匹配" />
                            </SelectTrigger>
                            <SelectContent className="max-w-[calc(100vw-2rem)]">
                              <SelectItem value="__none__">— 未匹配 —</SelectItem>
                              {playerOptions
                                .filter((p) => !assignedUserIdsByRow[idx].has(p.userId) || (row.userId === null && drafts.some(target => target.userId === p.userId && target.gameplayLocked)))
                                .map((p) => (
                                  <SelectItem key={p.userId} value={p.userId} className="whitespace-normal break-words">
                                    {p.perfectName}{assignedUserIdsByRow[idx].has(p.userId) ? "（合并截图指标）" : ""}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          {row.userId === null && <p className="mt-1 text-xs text-[var(--color-fg-mid)]">选已有选手会合并截图指标，保留比赛数据。</p>}
                        </TableCell>
                        {NUM_FIELDS.map((f) => (
                          <TableCell key={f.key} className="text-center p-1">
                            <Input
                              className={cn(
                                "h-7 text-xs text-center w-20 min-w-20 px-2",
                                (row[f.key] as number | null) !== null &&
                                  isStatOutOfRange(f.key, row[f.key] as number) &&
                                  "border-[var(--color-danger)] text-[var(--color-danger)]",
                              )}
                              aria-label={`${row.perfectName} ${f.label}`}
                              disabled={extracting || saving || Boolean(recovery) || (row.gameplayLocked && !OPERATOR_FIELDS.has(f.key))}
                              type="number"
                              value={(row[f.key] as number | null) ?? ""}
                              onChange={(e) =>
                                handleNumChange(idx, f.key, e.target.value)
                              }
                            />
                          </TableCell>
                        ))}
                        <TableCell className="p-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-[var(--color-danger)]"
                            onClick={() => handleDeleteRow(idx)}
                            disabled={extracting || saving || Boolean(recovery) || row.gameplayLocked}
                            title="删除此行"
                          >
                            ×
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2 items-center flex-wrap">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={extracting || saving || Boolean(recovery) || readFailed || !baseVersion || errorCount > 0 || unmatchedCount > 0}
                >
                  {saving ? "保存中…" : "确认保存"}
                </Button>
                {unmatchedCount > 0 && (
                  <p className="text-xs text-[var(--color-danger)]">
                    ⚠ {unmatchedCount} 行未匹配用户，请在下拉框中选择对应选手后再保存
                  </p>
                )}
                {errorCount > 0 && (
                  <p className="text-xs text-[var(--color-danger)]">
                    ⚠ {errorCount} 处数据超出合法范围，请修正后再保存
                  </p>
                )}
                {drafts.length > 0 && !viewMode && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setDrafts(canonicalDrafts); setSelectedFile(null); setError(null); setViewMode(canonicalDrafts.length > 0); }}
                    disabled={extracting || saving || Boolean(recovery)}
                  >
                    取消
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--color-fg-mid)] py-4">
              暂无数据。选择截图并识别，或添加行手动录入。
            </p>
          )}
        </>
      )}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
