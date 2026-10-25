"use client";

import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import React, { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { getMatchRosterReadback, retryMatchRosterRefresh, submitMatchRoster as telemetry_submitMatchRoster } from "@/actions/matches/roster";
import { Button } from "@/components/ui/button";
import { PosChip } from "@/components/rivalhub";

import { rosterReadbackVersion, type RosterReadback } from "@/lib/matches/operation-readback";
import { OperationReadbackNotice } from "./OperationReadbackNotice";
import { positionLabel } from "@/lib/validators/registration";
import { getDisplayName } from "@/lib/identity/display-name";
import { observeAction } from "@/lib/telemetry/client";

const submitMatchRoster = observeAction("matches.roster.submitMatchRoster", telemetry_submitMatchRoster);

interface TeamMember {
  userId: string;
  id: string;
  personaName: string | null;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
}

interface MatchRosterFormProps {
  matchId: string;
  teamMembers: TeamMember[];
  hasExistingRoster: boolean;
  matchStatus: "scheduled" | "in_progress" | "finished" | "cancelled";
  rosterStatus: string | null;
  initialStarterIds?: string[];
  initialSubstituteIds?: string[];
  initialVetoRepresentativeEventRosterMemberId?: string | null;
  allowSubstitutes?: boolean;
}

export function MatchRosterForm({
  matchId,
  teamMembers,
  hasExistingRoster,
  matchStatus,
  rosterStatus,
  initialStarterIds = [],
  initialSubstituteIds = [],
  initialVetoRepresentativeEventRosterMemberId = null,
  allowSubstitutes = true,
}: MatchRosterFormProps) {
  const task = useTelemetryTask("roster", matchId);
  const isMatchStarted = matchStatus !== "scheduled";
  const rosterLocked = rosterStatus === "confirmed";
  const [isPending, startTransition] = useTransition();
  const expectedVersion = useRef<string | null>(null);
  const [readback, setReadback] = useState<(RosterReadback & { matches: boolean }) | null>(null);
  const [recovery, setRecovery] = useState<"unknown" | "refresh_pending" | null>(null);

  function playerBtnClass(isSelected: boolean, isDisabled = false) {
    const base = "flex flex-col items-start gap-1 rounded border p-2 text-left transition-colors";
    if (isDisabled) return `${base} cursor-not-allowed border-[var(--color-border)] opacity-40`;
    return isSelected
      ? `${base} border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-fg)]`
      : `${base} border-[var(--color-border)] text-[var(--color-fg)] hover:border-[var(--color-accent)]/50`;
  }
  const [selectedStarterIds, setSelectedStarterIds] = useState<string[]>(initialStarterIds);
  const [selectedSubstituteIds, setSelectedSubstituteIds] = useState<string[]>(initialSubstituteIds);
  const [vetoRepresentativeId, setVetoRepresentativeId] = useState<string | null>(initialVetoRepresentativeEventRosterMemberId);

  const toggleStarter = (id: string) => {
    task.begin();
    const removing = selectedStarterIds.includes(id);
    setSelectedStarterIds((prev) =>
      removing
        ? prev.filter((x) => x !== id)
        : prev.length < 5
          ? [...prev, id]
          : prev,
    );
    setSelectedSubstituteIds((prev) => prev.filter((x) => x !== id));
    if (removing && vetoRepresentativeId === id) setVetoRepresentativeId(null);
  };

  const toggleSubstitute = (id: string) => {
    task.begin();
    if (selectedStarterIds.includes(id)) return;
    setSelectedSubstituteIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 2
          ? [...prev, id]
          : prev,
    );
  };

  const handleSubmit = () => {
    const taskToken = task.begin("submit");
    task.step("submit", taskToken);
    if (selectedStarterIds.length !== 5) {
      task.validation("required", taskToken);
      toast.error("请选择 5 名首发");
      return;
    }
    if (!vetoRepresentativeId || !selectedStarterIds.includes(vetoRepresentativeId)) {
      task.validation("required", taskToken);
      toast.error("请选择一名首发担任本场 BP 负责人");
      return;
    }
    if (recovery) return;
    startTransition(async () => {
      try {
      expectedVersion.current = await rosterReadbackVersion(matchId, { status: "submitted", starterIds: selectedStarterIds,
        substituteIds: allowSubstitutes ? selectedSubstituteIds : [], vetoRepresentativeEventRosterMemberId: vetoRepresentativeId });
      setReadback(null);
      const result = await submitMatchRoster(matchId, {
        starterIds: selectedStarterIds,
        substituteIds: allowSubstitutes ? selectedSubstituteIds : [],
        vetoRepresentativeEventRosterMemberId: vetoRepresentativeId,
      });
      if (result.success) {
        if (result.data.refreshPending) setRecovery("refresh_pending");
        toast.success("名单提交成功");
        task.complete(taskToken);
      } else {
        if (result.error.code === "INTERNAL_ERROR") setRecovery("unknown");
        toast.error(result.error.message ?? "提交失败");
      }
      } catch { setRecovery("unknown"); }
    });
  };

  return (
    <div className="space-y-4" onInputCapture={() => task.begin()} onPointerDownCapture={task.activity} onKeyDownCapture={task.activity}>
      {recovery && <div role="alert" className="space-y-2 text-sm">
        <p>{recovery === "unknown" ? "名单操作结果尚未确认，请读取当前名单核对，不要重复提交。" : "名单已提交，页面刷新待完成。"}</p>
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => {
          if (recovery === "unknown") {
            startTransition(async () => {
              try {
                const result = await getMatchRosterReadback(matchId);
                if (!result.success) { toast.error(result.error.message); return; }
                setReadback({ ...result.data, matches: result.data.version === expectedVersion.current });
              } catch { toast.error("当前名单暂时无法核对，草稿已保留。"); }
            });
            return;
          }
          startTransition(async () => {
            try {
              const result = await retryMatchRosterRefresh(matchId);
              if (!result.success) { toast.error(result.error.message); return; }
              setRecovery(null);
              window.location.reload();
            } catch { toast.error("刷新仍未完成，请稍后重试刷新。"); }
          });
        }}>{recovery === "unknown" ? "读取当前名单核对" : "重试刷新（不重复提交）"}</Button>
      </div>}
      {readback && <OperationReadbackNotice matches={readback.matches} version={readback.version}>
        <p>首发：{readback.value.starterIds.map(id => getDisplayName(teamMembers.find(member => member.id === id) ?? {})).join("、") || "无"}</p>
        <p>替补：{readback.value.substituteIds.map(id => getDisplayName(teamMembers.find(member => member.id === id) ?? {})).join("、") || "无"}；BP 负责人：{getDisplayName(teamMembers.find(member => member.id === readback.value.vetoRepresentativeEventRosterMemberId) ?? {})}</p>
      </OperationReadbackNotice>}
      {isMatchStarted ? (
        <div className="rounded border p-3" style={{ borderColor: "var(--color-danger-edge)", background: "var(--color-danger-soft)" }}>
          <p className="text-sm text-[var(--color-fg)]">{matchStatus === "cancelled" ? "比赛已取消，名单不可修改" : matchStatus === "finished" ? "比赛已结束，名单不可修改" : "比赛已开始，名单不可修改"}</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            如需调整请联系管理员
          </p>
        </div>
      ) : rosterLocked ? (
        <div className="rounded border p-3" style={{ borderColor: "var(--color-warn-edge)", background: "var(--color-warn-soft)" }}>
          <p className="text-sm text-[var(--color-fg)]">名单已确认并冻结</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            如需特殊调整请联系管理员处理。
          </p>
        </div>
      ) : (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-2">
          <p className="text-xs text-[var(--color-fg-dim)]">
            请尽量在开赛两小时前提交首发及 BP 负责人；正常提交无需管理员逐场确认，开赛时会重新校验并冻结。未提交时系统尝试采用合法预定主力；排期确认后两小时内的临时换人须联系管理员。
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-fg)]">提交赛前名单</span>
        {hasExistingRoster && <span className="text-xs text-[var(--color-fg-dim)]">已提交</span>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--color-fg)]">首发</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <div key={m.id} className="flex items-center"><button
              type="button"
              onClick={() => toggleStarter(m.id)}
              disabled={rosterLocked || isMatchStarted}
              className={playerBtnClass(selectedStarterIds.includes(m.id), rosterLocked || isMatchStarted)}
            >
              <span className="text-sm font-medium">{getDisplayName(m)}</span>
              {m.primaryPosition && <PosChip pos={positionLabel(m.primaryPosition)} />}
            </button><PlayerProfileLink userId={m.userId} variant="dense" aria-label={`查看 ${getDisplayName(m)} 选手资料`}>↗</PlayerProfileLink></div>
          ))}
        </div>
        <p className="text-sm text-[var(--color-fg-dim)]">
          已选 {selectedStarterIds.length}/5 名首发
        </p>
      </div>

      <fieldset className="space-y-2" disabled={rosterLocked || isMatchStarted}>
        <legend className="text-sm font-medium text-[var(--color-fg)]">本场 BP 负责人</legend>
        <p className="text-xs text-[var(--color-fg-dim)]">从已选首发中指定一人负责 BAN、PICK 和选边。</p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {teamMembers.filter((member) => selectedStarterIds.includes(member.id)).map((member) => (
            <div key={member.id} className="flex items-center"><label className="flex min-h-10 items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
              <input
                type="radio"
                name={`veto-representative-${matchId}`}
                value={member.id}
                checked={vetoRepresentativeId === member.id}
                onChange={() => setVetoRepresentativeId(member.id)}
              />
              <span>{getDisplayName(member)}</span>
            </label><PlayerProfileLink userId={member.userId} variant="dense" aria-label={`查看 ${getDisplayName(member)} 选手资料`}>↗</PlayerProfileLink></div>
          ))}
        </div>
      </fieldset>

      {allowSubstitutes && <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--color-fg)]">替补</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <div key={m.id} className="flex items-center"><button
              type="button"
              onClick={() => toggleSubstitute(m.id)}
              disabled={selectedStarterIds.includes(m.id) || rosterLocked || isMatchStarted}
              className={playerBtnClass(
                selectedSubstituteIds.includes(m.id),
                selectedStarterIds.includes(m.id) || rosterLocked || isMatchStarted,
              )}
            >
              <span className="text-sm font-medium">{getDisplayName(m)}</span>
              {m.primaryPosition && <PosChip pos={positionLabel(m.primaryPosition)} />}
            </button><PlayerProfileLink userId={m.userId} variant="dense" aria-label={`查看 ${getDisplayName(m)} 选手资料`}>↗</PlayerProfileLink></div>
          ))}
        </div>
        <p className="text-sm text-[var(--color-fg-dim)]">
          已选 {selectedSubstituteIds.length}/2 名替补（可不选）
        </p>
      </div>}

      {!rosterLocked && !isMatchStarted && (
        <Button
          onClick={handleSubmit}
          disabled={Boolean(recovery) || isPending || selectedStarterIds.length !== 5}
          size="sm"
        >
          提交名单
        </Button>
      )}
      {rosterLocked && hasExistingRoster && (
        <p className="text-xs text-[var(--color-fg-dim)]">
          名单已确认，等待比赛开始
        </p>
      )}
    </div>
  );
}
