"use client";
import React, { useState } from "react";
import {
  PLAYOFF_PICK_KEYS,
  playoffDescendants,
} from "@/lib/major/playoff-dependencies";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import type { PredictionBoardData } from "@/lib/predictions/data";
import { samePick, type Pick } from "@/lib/predictions/types";
import { SWISS_PICK_GROUPS } from "@/lib/predictions/presentation";
type Contest = PredictionBoardData["contests"][number];
type Group = "perfect" | "advance" | "eliminated";
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
  const [slot, setSlot] = useState<{ group: Group; index: number } | null>(
    null,
  );
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const locked = contest.locked || !!contest.voidReason || data.paused || busy;
  const teamIds = contest.entrants.map((e) => e.teamId);
  const team = (id: string) => data.base.teams.find((t) => t.teamId === id);
  const name = (id: string) => team(id)?.name ?? "待选择";
  const chosen =
    "bracket" in pick
      ? pick.bracket
      : [...pick.perfect, ...pick.advance, ...pick.eliminated];
  const total =
    contest.kind === "swiss"
      ? data.rules.perfect + data.rules.advance + data.rules.eliminated
      : 7;
  const dirty = !!contest.submitted && !samePick(contest.submitted.pick, pick);
  function assign(id: string, target: { group: Group; index: number }) {
    if (locked || !("perfect" in pick) || (id && !teamIds.includes(id))) return;
    const next = {
      perfect: [...pick.perfect],
      advance: [...pick.advance],
      eliminated: [...pick.eliminated],
    };
    for (const group of SWISS_PICK_GROUPS)
      next[group.key] = Array.from({ length: data.rules[group.key] }, (_, i) =>
        next[group.key][i] === id ? "" : (next[group.key][i] ?? ""),
      );
    next[target.group][target.index] = id;
    onChange(next);
    setSlot(null);
    setSelectedTeam(null);
    setMessage(
      id
        ? `${name(id)} 已放入${SWISS_PICK_GROUPS.find((g) => g.key === target.group)!.label}`
        : "已清空槽位",
    );
  }
  function chooseBracket(index: number, id: string) {
    if (locked || !("bracket" in pick)) return;
    const next = Array.from({ length: 7 }, (_, i) => pick.bracket[i] ?? "");
    if (next[index] === id) return;
    next[index] = id;
    const descendants = playoffDescendants(PLAYOFF_PICK_KEYS[index]!);
    PLAYOFF_PICK_KEYS.forEach((key, i) => {
      if (descendants.has(key)) next[i] = "";
    });
    onChange({ bracket: next });
    setMessage(`${name(id)} 晋级；受影响的下游选择已清空`);
  }
  const logo = (id: string, size = "h-10 w-10") => (
    <TeamLogo
      teamName={name(id)}
      logoUrl={team(id)?.logoUrl ?? null}
      className={size}
    />
  );
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
        {"perfect" in pick ? (
          <>
            <p className="text-xs text-[var(--color-fg-mid)]">
              拖动队伍到槽位，或点选槽位后选择队伍。已选队伍可移动，普通晋级不含
              3胜0负。
            </p>
            {SWISS_PICK_GROUPS.map((group) => (
              <fieldset
                key={group.key}
                className="border-t border-[var(--color-border)] pt-3"
              >
                <legend className="pr-2 text-xs">
                  <strong className="mr-2 font-mono text-lg">
                    {group.record}
                  </strong>
                  {group.key === "eliminated" ? "淘汰" : "晋级"}
                </legend>
                <div
                  className={`grid gap-2 ${group.key === "advance" ? "grid-cols-3" : "grid-cols-2"}`}
                >
                  {Array.from({ length: data.rules[group.key] }, (_, index) => {
                    const id = pick[group.key][index] ?? "";
                    const target = { group: group.key, index };
                    const active =
                      slot?.group === group.key && slot.index === index;
                    return (
                      <div key={index} className="relative min-w-0">
                        <button
                          type="button"
                          disabled={locked}
                          aria-label={`${group.label} ${index + 1}：${name(id)}`}
                          aria-pressed={active}
                          onClick={() =>
                            selectedTeam
                              ? assign(selectedTeam, target)
                              : setSlot(target)
                          }
                          onDragOver={(e) => {
                            if (!locked) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            assign(
                              e.dataTransfer.getData("text/plain"),
                              target,
                            );
                          }}
                          draggable={!!id && !locked}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          className={`flex min-h-24 w-full flex-col items-center justify-center gap-1 border p-2 text-xs transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${active ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10" : id ? "border-[var(--color-border)] bg-[var(--color-panel-hi)]" : "border-dashed border-[var(--color-border)]"}`}
                        >
                          {id ? (
                            logo(id)
                          ) : (
                            <span className="flex h-10 w-10 items-center justify-center text-xl text-[var(--color-fg-mid)]">
                              ＋
                            </span>
                          )}
                          <span className="line-clamp-2 break-words">
                            {name(id)}
                          </span>
                        </button>
                        {id && !locked && (
                          <button
                            type="button"
                            className="absolute right-0 top-0 min-h-7 min-w-7 bg-[var(--color-panel)] text-sm focus-visible:outline-2"
                            aria-label={`清空 ${group.label} ${index + 1}`}
                            onClick={() => assign("", target)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {!locked && (
              <fieldset className="border-t border-[var(--color-border)] pt-3">
                <legend className="pr-2 text-xs">
                  {slot ? "选择队伍填入高亮槽位" : "可选队伍"}
                </legend>
                <div className="grid grid-cols-4 gap-1" aria-label="可选队伍">
                  {teamIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      draggable
                      aria-label={`选择 ${name(id)}`}
                      aria-pressed={selectedTeam === id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() =>
                        slot
                          ? assign(id, slot)
                          : setSelectedTeam(selectedTeam === id ? null : id)
                      }
                      className={`flex min-h-20 min-w-0 flex-col items-center gap-1 border p-1 text-[11px] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${selectedTeam === id ? "border-[var(--color-accent)]" : "border-transparent"}`}
                    >
                      {logo(id, "h-9 w-9")}
                      <span className="line-clamp-2">{name(id)}</span>
                      <span className="text-[10px] text-[var(--color-fg-mid)]">
                        {chosen.includes(id) ? "已选 · 可移动" : "可选"}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        ) : (
          <div
            className="overflow-x-auto pb-2"
            tabIndex={0}
            role="region"
            aria-label="淘汰赛预测连线"
          >
            <div className="grid min-w-[540px] grid-cols-3 gap-6">
              {[[0, 1, 2, 3], [4, 5], [6]].map((indexes, column) => (
                <section key={column}>
                  <h3 className="mb-3 text-xs font-medium">
                    {["八强", "半决赛", "冠军"][column]}
                  </h3>
                  <div
                    className="grid h-[640px]"
                    style={{
                      gridTemplateRows: `repeat(${indexes.length}, minmax(0,1fr))`,
                    }}
                  >
                    {indexes.map((index, row) => {
                      const options =
                        index < 4
                          ? (contest.quarterfinals[index] ?? [])
                          : index < 6
                            ? pick.bracket.slice(
                                (index - 4) * 2,
                                (index - 4) * 2 + 2,
                              )
                            : pick.bracket.slice(4, 6);
                      return (
                        <div key={index} className="relative flex items-center">
                          {column > 0 && (
                            <span
                              aria-hidden
                              className="absolute -left-3 top-1/2 w-3 border-t border-[var(--color-border)]"
                            />
                          )}
                          <div className="w-full border border-[var(--color-border)]">
                            {[0, 1].map((side) => {
                              const id = options[side] ?? "";
                              return (
                                <button
                                  key={side}
                                  type="button"
                                  disabled={locked || !id}
                                  aria-pressed={
                                    !!id && pick.bracket[index] === id
                                  }
                                  aria-label={`${index < 4 ? `八强 ${index + 1}` : index < 6 ? `半决赛 ${index - 3}` : "冠军"}：${name(id)}`}
                                  onClick={() => chooseBracket(index, id)}
                                  className={`flex min-h-14 w-full items-center gap-1 border-b border-[var(--color-border)] px-1 py-2 text-xs focus-visible:outline-2 ${id && pick.bracket[index] === id ? "bg-[var(--color-accent)]/20" : "bg-[var(--color-panel-hi)]"}`}
                                >
                                  {id ? (
                                    logo(id, "h-8 w-8")
                                  ) : (
                                    <span className="w-8 text-center">—</span>
                                  )}
                                  <span className="min-w-0 break-words">
                                    {id ? name(id) : "上游胜者"}
                                  </span>
                                  {id && pick.bracket[index] === id && " ✓"}
                                </button>
                              );
                            })}
                          </div>
                          {column < 2 && (
                            <span
                              aria-hidden
                              className={`absolute -right-3 w-3 border-r border-[var(--color-border)] ${row % 2 === 0 ? "top-1/2 h-1/2 border-t" : "bottom-1/2 h-1/2 border-b"}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
        <p
          aria-live="polite"
          className="min-h-5 text-xs text-[var(--color-fg-mid)]"
        >
          {message ||
            (selectedTeam ? `${name(selectedTeam)}：请选择目标槽位` : "")}
        </p>
        <p className="text-sm">
          已填写 {chosen.filter(Boolean).length}/{total}
        </p>
        <Button
          className="w-full"
          disabled={
            locked || !data.joined || chosen.filter(Boolean).length !== total
          }
          onClick={() => onSave(true)}
        >
          提交预测
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={locked || !data.joined}
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
    </Panel>
  );
}
