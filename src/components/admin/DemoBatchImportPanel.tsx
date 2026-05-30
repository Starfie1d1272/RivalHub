"use client";

import { useState, useRef } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { importDemoPackage } from "@/actions/demo-import";
import {
  matchZipsToMaps,
  type ZipManifestInfo,
  type MatchResult,
} from "@/actions/demo-batch-import";

interface Props {
  seasonId: string;
  availableMaps: { mapId: string; label: string }[];
}

interface RowState {
  fileName: string;
  mapId: string | null;
  confidence: MatchResult["confidence"];
  matchLabel: string;
  candidates: { mapId: string; label: string }[];
  zipBuffer: ArrayBuffer;
  importStatus: "pending" | "importing" | "success" | "error";
  errorMessage?: string;
}

export function DemoBatchImportPanel({ seasonId, availableMaps }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [matching, setMatching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleMatch() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      toast.error("请先选择 .zip 文件");
      return;
    }

    setMatching(true);
    setRows([]);
    setProgress(null);

    try {
      const infos: ZipManifestInfo[] = [];
      const buffers: ArrayBuffer[] = [];

      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        buffers.push(buf);

        let mapName = "";
        let demoHash = "";
        let teamAName: string | undefined;
        let teamBName: string | undefined;
        let zipDate: string | undefined;
        let steamId64s: string[] = [];

        try {
          const zip = await JSZip.loadAsync(buf);

          const manifestFile = zip.file("manifest.json");
          if (manifestFile) {
            const text = await manifestFile.async("string");
            const manifest = JSON.parse(text) as Record<string, unknown>;
            mapName = (manifest.mapName as string | undefined) ?? "";
            demoHash =
              ((manifest.demo as Record<string, unknown> | undefined)
                ?.hash as string | undefined) ?? "";
          }

          const matchFile = zip.file("match.json");
          if (matchFile) {
            const text = await matchFile.async("string");
            const matchJson = JSON.parse(text) as Record<string, unknown>;
            // cs2-demo-format v1.0: teamA.name / teamB.name（都是 "Team A"/"Team B"）
            const teamA = matchJson.teamA as { name?: string } | undefined;
            const teamB = matchJson.teamB as { name?: string } | undefined;
            teamAName = teamA?.name;
            teamBName = teamB?.name;
          }

          // 从文件名提取比赛日期：rivalhub-{map}-{YYYY-MM-DD}.zip
          const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) zipDate = dateMatch[1];

          // 读取玩家信息用于模糊匹配
          const playersFile = zip.file("players.json");
          if (playersFile) {
            const text = await playersFile.async("string");
            const players = JSON.parse(text) as { steamId64: string }[];
            steamId64s = players.map((p) => p.steamId64).filter(Boolean);
          }
        } catch {
          // zip 解析失败，继续（mapName 为空会得到 none 匹配）
        }

        infos.push({ fileName: file.name, mapName, demoHash, teamAName, teamBName, zipDate, steamId64s });
      }

      const result = await matchZipsToMaps(seasonId, infos);

      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      const newRows: RowState[] = result.data.map((r, i) => ({
        fileName: r.fileName,
        mapId: r.mapId,
        confidence: r.confidence,
        matchLabel: r.matchLabel,
        candidates: r.candidates,
        zipBuffer: buffers[i],
        importStatus: "pending",
      }));

      setRows(newRows);
    } catch {
      toast.error("解析文件失败，请检查文件格式");
    } finally {
      setMatching(false);
    }
  }

  function handleSelectMap(rowIndex: number, mapId: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex) return r;
        const candidate =
          r.candidates.find((c) => c.mapId === mapId) ??
          availableMaps.find((c) => c.mapId === mapId);
        return {
          ...r,
          mapId,
          matchLabel: candidate?.label ?? mapId,
        };
      }),
    );
  }

  async function handleImportAll() {
    const toImport = rows.filter((r) => r.mapId !== null);
    if (toImport.length === 0) {
      toast.error("没有可导入的条目（请先为未匹配项手动指定地图）");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: toImport.length });

    let done = 0;
    for (const row of toImport) {
      if (!row.mapId) continue;

      // 标记为 importing
      setRows((prev) =>
        prev.map((r) =>
          r.fileName === row.fileName ? { ...r, importStatus: "importing" } : r,
        ),
      );

      const result = await importDemoPackage(row.mapId, row.zipBuffer, { confirmOverwriteOcr: true });

      if (!result.success) {
        console.error(`[batch-import] ${row.fileName}:`, result.error.message);
        setRows((prev) =>
          prev.map((r) =>
            r.fileName === row.fileName
              ? { ...r, importStatus: "error", errorMessage: result.error.message }
              : r,
          ),
        );
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.fileName === row.fileName ? { ...r, importStatus: "success" } : r,
          ),
        );
      }

      done += 1;
      setProgress({ done, total: toImport.length });
    }

    setImporting(false);
    toast.success(`批量导入完成：${done} / ${toImport.length} 个文件已处理`);
  }

  const hasRows = rows.length > 0;
  const canImport =
    !importing && hasRows && rows.some((r) => r.mapId !== null && r.importStatus === "pending");

  return (
    <div className="space-y-4">
      {/* 文件选择 + 匹配 */}
      <div className="flex gap-2 items-center flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          multiple
          className="text-sm"
          disabled={matching || importing}
        />
        <Button size="sm" onClick={handleMatch} disabled={matching || importing}>
          {matching ? "匹配中…" : "开始匹配"}
        </Button>
      </div>

      {/* 匹配结果表格 */}
      {hasRows && (
        <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-raised)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-fg-mid)]">
                  zip 文件名
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-fg-mid)]">
                  匹配到
                </th>
                <th className="px-3 py-2 text-left font-medium text-[var(--color-fg-mid)]">
                  状态
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row, i) => (
                <tr key={row.fileName} className="hover:bg-[var(--color-surface-raised)]/50">
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-fg)]">
                    {row.fileName}
                  </td>
                  <td className="px-3 py-2">
                    {row.confidence === "exact" && row.mapId ? (
                      <span className="text-[var(--color-fg)]">{row.matchLabel}</span>
                    ) : row.confidence === "none" && row.candidates.length === 0 ? (
                      <select
                        className="text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
                        value={row.mapId ?? ""}
                        onChange={(e) => handleSelectMap(i, e.target.value)}
                        disabled={importing}
                      >
                        <option value="">— 手动选择 —</option>
                        {availableMaps.map((m) => (
                          <option key={m.mapId} value={m.mapId}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    ) : row.candidates.length > 0 ? (
                      <select
                        className="text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
                        value={row.mapId ?? ""}
                        onChange={(e) => handleSelectMap(i, e.target.value)}
                        disabled={importing}
                      >
                        <option value="">— 选择候选 —</option>
                        {row.candidates.map((c) => (
                          <option key={c.mapId} value={c.mapId}>
                            {c.label}
                          </option>
                        ))}
                        <optgroup label="全部可用">
                          {availableMaps
                            .filter((m) => !row.candidates.some((c) => c.mapId === m.mapId))
                            .map((m) => (
                              <option key={m.mapId} value={m.mapId}>
                                {m.label}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    ) : (
                      <span className="text-[var(--color-fg-dim)]">{row.matchLabel}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ImportStatusBadge row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 进度 + 全部导入按钮 */}
      {hasRows && (
        <div className="flex items-center gap-4">
          <Button size="sm" onClick={handleImportAll} disabled={!canImport}>
            {importing
              ? `导入中… ${progress?.done ?? 0} / ${progress?.total ?? 0}`
              : "全部导入"}
          </Button>
          {progress && (
            <div className="flex-1 max-w-xs">
              <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-accent)] transition-all duration-300"
                  style={{
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-[var(--color-fg-dim)] mt-1">
                已完成 {progress.done} / {progress.total}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportStatusBadge({ row }: { row: RowState }) {
  if (row.importStatus === "success") {
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-ok) 12%, transparent)] text-[var(--color-ok)]">
        ✓ 成功
      </span>
    );
  }
  if (row.importStatus === "error") {
    return (
      <div>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-danger) 12%, transparent)] text-[var(--color-error)]">
          ✗ 失败
        </span>
        {row.errorMessage && (
          <p className="text-[10px] text-[var(--color-error)] mt-0.5 max-w-[200px] truncate" title={row.errorMessage}>
            {row.errorMessage}
          </p>
        )}
      </div>
    );
  }
  if (row.importStatus === "importing") {
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-warn) 12%, transparent)] text-[var(--color-warn)]">
        导入中…
      </span>
    );
  }
  // pending
  if (row.confidence === "exact") {
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-ok) 8%, transparent)] text-[var(--color-ok)]">
        ✅ 自动匹配
      </span>
    );
  }
  if (row.confidence === "fuzzy" && row.mapId) {
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-warn) 12%, transparent)] text-[var(--color-warn)]">
        ⚠ 模糊匹配
      </span>
    );
  }
  if (row.mapId) {
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-warn) 12%, transparent)] text-[var(--color-warn)]">
        ⚠ 手动
      </span>
    );
  }
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-danger) 8%, transparent)] text-[var(--color-fg-dim)]">
      ❌ 未匹配
    </span>
  );
}
