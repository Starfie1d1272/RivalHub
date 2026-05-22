"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { proposeMatchTime, respondToTimeProposal, forceSetMatchTime } from "@/actions/matches/scheduling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCST, parseCSTInput, toCSTDateTimeInput } from "@/lib/utils/date";
import type { matchTimeProposals } from "@/db/schema/match-time-proposals";

type Proposal = typeof matchTimeProposals.$inferSelect;

const PROPOSAL_AUTO_ACCEPT_HOURS = 24;

/** 推荐有解说覆盖的时间段（按 Asia/Shanghai 当地时间）。 */
const CASTER_SLOTS: readonly { start: number; end: number }[] = [
  { start: 14, end: 17 }, // 14:00 – 17:00
  { start: 19, end: 22 }, // 19:00 – 22:00
];

/** 判断给定时间（北京时间起点）是否落在推荐解说时段内。 */
function isWithinCasterSlot(date: Date | null): boolean {
  if (!date || Number.isNaN(date.getTime())) return false;
  // 用东八区小时数判断；Date 内部是 UTC，加偏移得到 CST 小时。
  const cstHour = (date.getUTCHours() + 8) % 24;
  return CASTER_SLOTS.some((slot) => cstHour >= slot.start && cstHour < slot.end);
}

interface MatchTimeNegotiationProps {
  matchId: string;
  isCaptainA: boolean;
  isCaptainB: boolean;
  isAdmin: boolean;
  currentUserId?: string;
  currentScheduledAt: Date | null;
  currentCompletionDeadline: Date | null;
  initialProposals: Proposal[];
  hasSubmittedRoster: boolean;
  /** 协商缓冲小时数，排位赛默认 24，正赛 0。决定 confirmationCutoff = completionDeadline - bufferHours。 */
  bufferHours?: number;
}

export function MatchTimeNegotiation({
  matchId,
  isCaptainA,
  isCaptainB,
  isAdmin,
  currentUserId,
  currentScheduledAt,
  currentCompletionDeadline,
  initialProposals,
  hasSubmittedRoster = false,
  bufferHours = 24,
}: MatchTimeNegotiationProps) {
  // 0 缓冲（=与最晚完成时间一致）目前仅正赛使用，沿用作为是否显示解说时段提示的判据。
  const isPlayoff = bufferHours === 0;
  const [isPending, startTransition] = useTransition();
  const [proposedTime, setProposedTime] = useState("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const isCaptain = isCaptainA || isCaptainB;

  const pendingProposals = initialProposals.filter((p) => p.status === "pending");
  const completionDeadline = currentCompletionDeadline
    ? new Date(currentCompletionDeadline)
    : null;
  const confirmationCutoff = completionDeadline
    ? new Date(completionDeadline.getTime() - bufferHours * 60 * 60 * 1000)
    : null;
  const isNegotiationClosed =
    confirmationCutoff !== null && Date.now() >= confirmationCutoff.getTime();

  const handlePropose = () => {
    if (!proposedTime) return;
    startTransition(async () => {
      const parsed = parseCSTInput(proposedTime);
      if (!parsed) { toast.error("请输入有效的时间"); return; }
      const result = await proposeMatchTime(matchId, parsed);
      if (result.success) {
        toast.success("时间提议已发送");
        setProposedTime("");
      } else {
        toast.error(result.error.message ?? "提议失败");
      }
    });
  };

  const handleRespond = (proposalId: string, action: "accept" | "reject") => {
    startTransition(async () => {
      const reason = action === "reject" ? rejectReasons[proposalId] : undefined;
      const result = await respondToTimeProposal(proposalId, action, reason);
      if (result.success) {
        toast.success(action === "accept" ? "已接受提议" : "已拒绝提议");
        setRejectReasons((prev) => ({ ...prev, [proposalId]: "" }));
        setRejectingId(null);
      } else {
        toast.error(result.error.message ?? "操作失败");
      }
    });
  };

  const handleForceSet = () => {
    if (!proposedTime) return;
    startTransition(async () => {
      const parsed = parseCSTInput(proposedTime);
      if (!parsed) { toast.error("请输入有效的时间"); return; }
      const result = await forceSetMatchTime(matchId, parsed);
      if (result.success) {
        toast.success("比赛时间已设定");
        setProposedTime("");
      } else {
        toast.error(result.error.message ?? "设定失败");
      }
    });
  };

  return (
    <div className="space-y-4">
      {isCaptain && !hasSubmittedRoster && (
        <div className="rounded border p-3" style={{ borderColor: "rgba(255,196,77,0.4)", background: "rgba(255,196,77,0.06)" }}>
          <p className="text-sm text-[var(--color-fg)]">请先提交赛前名单</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            在确认比赛时间之前，请先在「提交名单」中选择 5 名首发队员。裁判在正式开赛时会检查队员信息，队员不正确将无法进行比赛。
          </p>
        </div>
      )}

      {/* 当前确定的比赛时间 */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">比赛时间：</span>
        <span className="text-sm">
          {currentScheduledAt ? formatCST(currentScheduledAt) : "待协商"}
        </span>
      </div>

      {/* 所有待回应的提议 */}
      {pendingProposals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-fg-mid)]">
            待处理提议（{pendingProposals.length}）
          </p>
          {pendingProposals.map((proposal) => {
            const isMyProposal = currentUserId === proposal.proposedBy;
            const autoAcceptAt = new Date(
              new Date(proposal.createdAt).getTime() + PROPOSAL_AUTO_ACCEPT_HOURS * 60 * 60 * 1000,
            );
            const hoursLeft = Math.max(
              0,
              Math.round((autoAcceptAt.getTime() - Date.now()) / (60 * 60 * 1000) * 10) / 10,
            );

            return (
              <div
                key={proposal.id}
                className="rounded border p-3"
              style={isMyProposal
                ? { borderColor: "var(--color-border)", background: "var(--color-panel)" }
                : { borderColor: "rgba(255,196,77,0.4)", background: "rgba(255,196,77,0.06)" }
              }
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {isMyProposal ? "你的提议" : "对方提议"}：{formatCST(proposal.proposedTime)}
                    </p>
                    <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">
                      提议于 {formatCST(proposal.createdAt)}
                      {hoursLeft > 0
                        ? ` · ${hoursLeft}h 后自动采纳`
                        : " · 即将自动采纳"}
                    </p>
                  </div>
                </div>

                {/* 对方的提议才能接受/拒绝 */}
                {!isMyProposal && isCaptain && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => handleRespond(proposal.id, "accept")}
                      disabled={isPending || isNegotiationClosed}
                    >
                      接受
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectingId(rejectingId === proposal.id ? null : proposal.id)}
                      disabled={isPending || isNegotiationClosed}
                    >
                      拒绝
                    </Button>
                    {rejectingId === proposal.id && (
                      <div className="w-full mt-2 space-y-2">
                        <Input
                          value={rejectReasons[proposal.id] ?? ""}
                          onChange={(e) =>
                            setRejectReasons((prev) => ({ ...prev, [proposal.id]: e.target.value }))
                          }
                          placeholder="请填写拒绝原因"
                          maxLength={200}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRespond(proposal.id, "reject")}
                          disabled={isPending || isNegotiationClosed || !(rejectReasons[proposal.id] ?? "").trim()}
                        >
                          确认拒绝
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 队长提议表单 — 不再限制对方有 pending 时隐藏 */}
      {isCaptain && !isNegotiationClosed && (
        <div className="space-y-2">
          <Label htmlFor="propose-time">提议新时间</Label>
          <div className="flex gap-2">
            <Input
              id="propose-time"
              type="datetime-local"
              value={proposedTime}
              onChange={(e) => setProposedTime(e.target.value)}
              max={completionDeadline ? toCSTDateTimeInput(completionDeadline) ?? undefined : undefined}
            />
            <Button
              onClick={handlePropose}
              disabled={isPending || !proposedTime}
            >
              提议
            </Button>
          </div>
          {isPlayoff &&
            proposedTime &&
            !isWithinCasterSlot(parseCSTInput(proposedTime)) && (
              <p className="text-xs text-[var(--color-warn,#f59e0b)]">
                所选时间在推荐解说时段外，比赛可正常进行，但不保证有官方解说。
              </p>
            )}
        </div>
      )}

      {/* 时间信息摘要 */}
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-xs text-[var(--color-fg-mid)] space-y-0.5">
        <div>
          最晚完成时间：{completionDeadline ? formatCST(completionDeadline) : "管理员暂未设置"}
        </div>
        <div>
          协商截止时间：
          {confirmationCutoff
            ? `${formatCST(confirmationCutoff)}${bufferHours > 0 ? `（最晚完成时间前 ${bufferHours} 小时）` : "（与最晚完成时间一致）"}`
            : "设置最晚完成时间后自动生成"}
        </div>
        <div>
          单条提议超时：对方 24 小时未回应将自动采纳
        </div>
        {isPlayoff && (
          <div className="mt-1 text-[var(--color-fg)]">
            推荐解说时段：每天 14:00–17:00 / 19:00–22:00（有官方解说覆盖）；可在此之外协商时间，但不保证解说。
          </div>
        )}
        {isNegotiationClosed && (
          <div className="mt-1 text-[var(--color-danger)]">
            队长时间协商已截止，请联系管理员指定比赛时间。
          </div>
        )}
      </div>

      {/* 管理员强制指定 */}
      {isAdmin && (
        <div className="rounded border p-3" style={{ borderColor: "rgba(255,84,112,0.35)", background: "rgba(255,84,112,0.06)" }}>
          <p className="text-sm font-medium text-[var(--color-danger)]">
            管理员强制指定
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              type="datetime-local"
              value={proposedTime}
              onChange={(e) => setProposedTime(e.target.value)}
              max={completionDeadline ? toCSTDateTimeInput(completionDeadline) ?? undefined : undefined}
            />
            <Button
              variant="destructive"
              onClick={handleForceSet}
              disabled={isPending || !proposedTime}
            >
              强制设定
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
