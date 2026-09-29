"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { proposeMatchTime, respondToTimeProposal, forceSetMatchTime } from "@/actions/matches/scheduling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCST, parseCSTInput, toCSTDateTimeInput } from "@/lib/utils/date";
import type { MatchTimeProposalView } from "@/lib/matches/time-proposals";
import { TIME_RESOLUTION_LABELS } from "@/lib/matches/time-resolution-presentation";

const PROPOSAL_AUTO_ACCEPT_HOURS = 24;

interface MatchTimeNegotiationProps {
  matchId: string;
  isCaptainA: boolean;
  isCaptainB: boolean;
  isAdmin: boolean;
  currentScheduledAt: Date | null;
  currentCompletionDeadline: Date | null;
  initialProposals: MatchTimeProposalView[];
  /** 协商缓冲小时数，排位赛默认 24，正赛 0。决定 confirmationCutoff = completionDeadline - bufferHours。 */
  bufferHours?: number;
  coverageSlots?: { id: string; startsAt: Date; endsAt: Date; capacity: number; note: string | null }[];
}

export function MatchTimeNegotiation({
  matchId,
  isCaptainA,
  isCaptainB,
  isAdmin,
  currentScheduledAt,
  currentCompletionDeadline,
  initialProposals,
  bufferHours = 24,
  coverageSlots = [],
}: MatchTimeNegotiationProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [proposedTime, setProposedTime] = useState("");
  const [coverageSlotId, setCoverageSlotId] = useState("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const isCaptain = isCaptainA || isCaptainB;

  const pendingProposals = initialProposals.filter((p) => p.status === "pending");
  const completionDeadline = currentCompletionDeadline
    ? new Date(currentCompletionDeadline)
    : null;
  const confirmationCutoffTime = completionDeadline
    ? completionDeadline.getTime() - bufferHours * 60 * 60 * 1000
    : null;
  const confirmationCutoff = confirmationCutoffTime === null
    ? null
    : new Date(confirmationCutoffTime);
  const isNegotiationClosed =
    confirmationCutoffTime !== null && now >= confirmationCutoffTime;

  // 有 pending 提议时自动轮询，确保自动采纳后页面及时更新
  useEffect(() => {
    if (pendingProposals.length === 0 && confirmationCutoffTime === null) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (pendingProposals.length > 0) router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [confirmationCutoffTime, pendingProposals.length, router]);

  const acceptedProposal = initialProposals.find((proposal) => proposal.status === "accepted" && proposal.resolution);
  const selectedTime = parseCSTInput(proposedTime);
  const availableSlots = selectedTime ? coverageSlots.filter(slot => selectedTime >= new Date(slot.startsAt) && selectedTime < new Date(slot.endsAt)) : [];

  const handlePropose = () => {
    if (!proposedTime) return;
    startTransition(async () => {
      const parsed = parseCSTInput(proposedTime);
      if (!parsed) { toast.error("请输入有效的时间"); return; }
      const result = await proposeMatchTime(matchId, parsed, coverageSlotId || undefined);
      if (result.success) {
        toast.success("时间提议已发送");
        setProposedTime("");
        setCoverageSlotId("");
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
      {/* 当前确定的比赛时间 */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">比赛时间：</span>
        <span className="text-sm">
          {currentScheduledAt ? formatCST(currentScheduledAt) : "待协商"}
        </span>
      </div>

      {/* 系统自动采纳提示 */}
      {acceptedProposal && currentScheduledAt && (
        <div className="rounded border p-3 text-sm" style={{ borderColor: "var(--color-ok-edge)", background: "var(--color-ok-soft)" }}>
          <p className="font-medium text-[var(--color-fg)]">比赛时间已确定</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">
            {TIME_RESOLUTION_LABELS[acceptedProposal.resolution!]}：{formatCST(acceptedProposal.proposedTime)}。
          </p>
        </div>
      )}

      {/* 所有待回应的提议 */}
      {pendingProposals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--color-fg-mid)]">
            待处理提议（{pendingProposals.length}）
          </p>
          {pendingProposals.map((proposal) => {
            const isMyProposal = proposal.isMine;
            const autoAcceptAt = new Date(
              new Date(proposal.createdAt).getTime() + PROPOSAL_AUTO_ACCEPT_HOURS * 60 * 60 * 1000,
            );
            const hoursLeft = Math.max(
              0,
              Math.round((autoAcceptAt.getTime() - now) / (60 * 60 * 1000) * 10) / 10,
            );

            return (
              <div
                key={proposal.id}
                className="rounded border p-3"
              style={isMyProposal
                ? { borderColor: "var(--color-border)", background: "var(--color-panel)" }
                : { borderColor: "var(--color-warn-edge)", background: "var(--color-warn-soft)" }
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
              onChange={(e) => { setProposedTime(e.target.value); setCoverageSlotId(""); }}
              max={completionDeadline ? toCSTDateTimeInput(completionDeadline) ?? undefined : undefined}
            />
            <Button
              onClick={handlePropose}
              disabled={isPending || !proposedTime}
            >
              提议
            </Button>
          </div>
          {selectedTime && <label className="block text-xs">官方转播名额（可选）
            <select className="mt-1 min-h-10 w-full rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2" value={coverageSlotId} onChange={event => setCoverageSlotId(event.target.value)}>
              <option value="">自由约定，无官方转播占位</option>
              {availableSlots.map(slot => <option key={slot.id} value={slot.id}>{formatCST(slot.startsAt)} – {formatCST(slot.endsAt)} · 容量 {slot.capacity}{slot.note ? ` · ${slot.note}` : ""}</option>)}
            </select>
            <span className="mt-1 block text-[var(--color-fg-mid)]">转播名额临时保留 15 分钟；超时只释放名额，时间提议仍有效。</span>
          </label>}
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
        {isNegotiationClosed && (
          <div className="mt-1 text-[var(--color-danger)]">
            队长时间协商已截止，请联系管理员指定比赛时间。
          </div>
        )}
      </div>

      {/* 管理员强制指定 */}
      {isAdmin && (
        <div className="rounded border p-3" style={{ borderColor: "var(--color-danger-edge)", background: "var(--color-danger-soft)" }}>
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
