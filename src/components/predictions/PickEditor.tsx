"use client";
import {
  PLAYOFF_PICK_KEYS,
  playoffDescendants,
} from "@/lib/major/playoff-dependencies";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Panel } from "@/components/rivalhub";
import type { PredictionBoardData } from "@/lib/predictions/data";
import { samePick, type Pick } from "@/lib/predictions/types";
type Contest = PredictionBoardData["contests"][number];
export function emptyPick(kind: string): Pick {
  return kind === "swiss"
    ? { perfect: [], advance: [], eliminated: [] }
    : { bracket: [] };
}
export function PickEditor({
  data,
  contest,
  pick,
  onChange,
  onSave,
  onExport,
  busy,
}: {
  data: PredictionBoardData;
  contest: Contest;
  pick: Pick;
  onChange: (pick: Pick) => void;
  onSave: (submitted: boolean) => void;
  onExport: () => void;
  busy: boolean;
}) {
  const [slot, setSlot] = useState<{
    group: "perfect" | "advance" | "eliminated" | "bracket";
    index: number;
    label: string;
    options: string[];
  } | null>(null);
  const locked = contest.locked || !!contest.voidReason || data.paused;
  const name = (id: string) =>
    data.base.teams.find((t) => t.teamId === id)?.name ?? "待选择";
  const teamIds = contest.entrants.map((e) => e.teamId);
  const chosen =
    "bracket" in pick
      ? pick.bracket
      : [...pick.perfect, ...pick.advance, ...pick.eliminated];
  const total =
    contest.kind === "swiss"
      ? data.rules.perfect + data.rules.advance + data.rules.eliminated
      : 7;
  const optionsFor = (i: number) => {
    if (!("bracket" in pick)) return teamIds;
    if (i < 4) return contest.quarterfinals[i] ?? [];
    // Presentation dependencies only; the server validates the canonical bracket on submission.
    return (
      i < 6
        ? pick.bracket.slice((i - 4) * 2, (i - 4) * 2 + 2)
        : pick.bracket.slice(4, 6)
    ).filter(Boolean);
  };
  function select(id: string) {
    if (!slot) return;
    if (slot.group === "bracket" && "bracket" in pick) {
      const next = Array.from({ length: 7 }, (_, i) => pick.bracket[i] ?? "");
      next[slot.index] = id;
      if (pick.bracket[slot.index] !== id) {
        const downstream = playoffDescendants(PLAYOFF_PICK_KEYS[slot.index]!);
        PLAYOFF_PICK_KEYS.forEach((key, i) => {
          if (downstream.has(key)) next[i] = "";
        });
      }
      onChange({ bracket: next });
    } else if ("perfect" in pick && slot.group !== "bracket") {
      const group = slot.group;
      const next = {
        ...pick,
        [group]: Array.from(
          { length: Math.max(pick[group].length, slot.index + 1) },
          (_, i) => pick[group][i] ?? "",
        ),
      };
      next[group][slot.index] = id;
      onChange(next);
    }
    setSlot(null);
  }
  const groups =
    "bracket" in pick
      ? [
          {
            key: "bracket" as const,
            label: "淘汰赛胜者",
            count: 7,
            values: pick.bracket,
          },
        ]
      : [
          {
            key: "perfect" as const,
            label: "恰好 3胜0负",
            count: data.rules.perfect,
            values: pick.perfect,
          },
          {
            key: "advance" as const,
            label: "3胜1负 / 3胜2负",
            count: data.rules.advance,
            values: pick.advance,
          },
          {
            key: "eliminated" as const,
            label: "恰好 0胜3负",
            count: data.rules.eliminated,
            values: pick.eliminated,
          },
        ];
  const dirty = !!contest.submitted && !samePick(contest.submitted.pick, pick);
  return (
    <Panel label="我的阶段预测单" className="h-fit">
      <div className="space-y-4">
        <p className="text-sm" role="status">
          {contest.voidReason
            ? `已作废：${contest.voidReason}`
            : contest.locked
              ? "已锁定"
              : contest.submitted
                ? `已提交 · 版本 ${contest.submitted.version}`
                : "尚未提交"}
          {dirty && " · 有未提交修改"}
        </p>
        <p className="text-xs text-[var(--color-fg-mid)]">
          截止：{new Date(contest.deadline).toLocaleString("zh-CN")}
          ；提前开赛也会锁定。
        </p>
        {contest.kind === "swiss" && (
          <p className="text-xs text-[var(--color-fg-mid)]">
            普通晋级不含 3胜0负。同一队不能重复选择。
          </p>
        )}
        {groups.map((g) => (
          <fieldset key={g.key} className="space-y-2">
            <legend className="text-sm font-medium">{g.label}</legend>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: g.count }, (_, i) => {
                const label =
                  g.key === "bracket"
                    ? i < 4
                      ? `八强 ${i + 1}`
                      : i < 6
                        ? `半决赛 ${i - 3}`
                        : "冠军"
                    : `${g.label} ${i + 1}`;
                return (
                  <Button
                    key={i}
                    variant="outline"
                    className="min-h-12 h-auto whitespace-normal px-2 text-xs"
                    aria-label={`${label}：${name(g.values[i] ?? "")}`}
                    disabled={locked || busy}
                    onClick={() =>
                      setSlot({
                        group: g.key,
                        index: i,
                        label,
                        options: g.key === "bracket" ? optionsFor(i) : teamIds,
                      })
                    }
                  >
                    <span>
                      {g.key === "bracket" && (
                        <span className="block opacity-60">{label}</span>
                      )}
                      {g.values[i] ? name(g.values[i]!) : "＋ 选择队伍"}
                    </span>
                  </Button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <p className="text-sm">
          已填写 {chosen.filter(Boolean).length}/{total}
        </p>
        <Button
          className="w-full"
          disabled={
            locked ||
            busy ||
            !data.joined ||
            chosen.filter(Boolean).length !== total
          }
          onClick={() => onSave(true)}
        >
          提交预测
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={locked || busy || !data.joined}
            onClick={() => onSave(false)}
          >
            保存草稿
          </Button>
          <Button variant="outline" disabled={busy} onClick={onExport}>
            导出图片
          </Button>
        </div>
        {contest.submitted && (
          <p className="text-xs text-[var(--color-fg-mid)]">
            最近有效提交：
            {new Date(contest.submitted.at).toLocaleString("zh-CN")}
            。保存草稿或导出图片不更新正式提交。
          </p>
        )}
      </div>
      <Dialog
        open={!!slot}
        onOpenChange={(open) => {
          if (!open) setSlot(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{slot?.label}</DialogTitle>
            <DialogDescription>
              点选队伍填入此槽位。淘汰赛请先填上游胜者。
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-auto">
            {slot?.options.map((id) => (
              <Button
                key={id}
                variant="outline"
                className="h-auto min-h-12 whitespace-normal"
                disabled={
                  slot.group !== "bracket" &&
                  chosen.includes(id) &&
                  !("perfect" in pick && pick[slot.group][slot.index] === id)
                }
                onClick={() => select(id)}
              >
                {name(id)}
              </Button>
            ))}
            {!slot?.options.length && <p>请先完成对应的上游选择。</p>}
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
