"use client";

import { useState, useRef, useMemo } from "react";
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
  extractStatsFromScreenshot,
  savePlayerStats,
  type PlayerStatsDraft,
  type PlayerOption,
} from "@/actions/player-stats";

interface Props {
  mapId: string;
  mapName: string;
}

type DraftRow = PlayerStatsDraft;

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

export function StatsOCRPanel({ mapId, mapName }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [playerOptions, setPlayerOptions] = useState<PlayerOption[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleExtract() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("请先选择截图文件");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("文件大小不超过 10MB");
      return;
    }

    setError(null);
    setExtracting(true);
    setSaved(false);

    try {
      const base64 = await fileToBase64(file);
      const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
      const result = await extractStatsFromScreenshot({ mapId, base64Image: base64, mimeType });

      if (!result.success) {
        setError(result.error.message);
        return;
      }

      setDrafts(result.data.drafts);
      setPlayerOptions(result.data.playerOptions);
    } finally {
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

  function handleNameChange(idx: number, value: string) {
    setDrafts((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, perfectName: value } : row))
    );
  }

  function handleUserChange(idx: number, userId: string) {
    setDrafts((prev) =>
      prev.map((row, i) =>
        i === idx ? { ...row, userId: userId === "__none__" ? null : userId } : row
      )
    );
  }

  function handleDeleteRow(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleAddRow() {
    setDrafts((prev) => [
      ...prev,
      { perfectName: "", userId: null, kills: null, deaths: null, assists: null, hsPercent: null, firstKills: null, multiKills: null, clutches: null, adr: null, rws: null, ratingPro: null, we: null },
    ]);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await savePlayerStats(mapId, { rows: drafts });
    setSaving(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setSaved(true);
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

  return (
    <div className="mt-4 space-y-4">
      <h4 className="font-semibold text-sm">
        {mapName} — 玩家数据录入（OCR 识别）
      </h4>

      <div className="flex gap-2 items-center flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={handleExtract}
          disabled={extracting}
        >
          {extracting ? "识别中…" : "OCR 识别截图"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleAddRow}>
          添加行
        </Button>
        {saved && <span className="text-xs text-green-500">已保存</span>}
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {drafts.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">昵称</TableHead>
                  <TableHead className="w-40">匹配用户</TableHead>
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
                      <Input
                        className="h-7 text-xs"
                        value={row.perfectName as string}
                        onChange={(e) => handleNameChange(idx, e.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.userId ?? "__none__"}
                        onValueChange={(v) => handleUserChange(idx, v)}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="未匹配" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— 未匹配 —</SelectItem>
                          {playerOptions
                            .filter((p) => !assignedUserIdsByRow[idx].has(p.userId))
                            .map((p) => (
                              <SelectItem key={p.userId} value={p.userId}>
                                {p.perfectName}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    {NUM_FIELDS.map((f) => (
                      <TableCell key={f.key} className="text-center p-1">
                        <Input
                          className="h-7 text-xs text-center w-14"
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
                        className="h-7 w-7 p-0 text-red-400"
                        onClick={() => handleDeleteRow(idx)}
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

          <div className="flex gap-2 items-center">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "保存中…" : "确认保存"}
            </Button>
            {saved && (
              <span className="text-sm text-green-600">已保存 {drafts.length} 条数据</span>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--color-fg-mid)] py-4">
          暂无数据。点击「OCR 识别截图」自动提取，或点击「添加行」手动录入。
        </p>
      )}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 data:image/xxx;base64, 前缀
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
