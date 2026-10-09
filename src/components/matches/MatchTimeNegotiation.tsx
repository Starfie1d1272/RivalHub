"use client";

import { useState, useTransition, useEffect } from "react";
import { useRoutePolling } from "@/components/use-visible-polling";
import { toast } from "sonner";
import { proposeMatchTime, respondToTimeProposal, forceSetMatchTime } from "@/actions/matches/scheduling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCST, parseCSTInput, toCSTDateTimeInput } from "@/lib/utils/date";
import type { MatchTimeProposalView } from "@/lib/matches/time-proposals";

import { projectMatchScheduling } from "@/lib/matches/time-rules";
interface MatchTimeNegotiationProps {
  matchId: string;
  isCaptainA: boolean;
  isCaptainB: boolean;
  isAdmin: boolean;
  currentScheduledAt: Date | null;
  currentCompletionDeadline: Date | null;
  initialProposals: MatchTimeProposalView[];
  hasSubmittedRoster: boolean;
}

export function MatchTimeNegotiation({
  matchId,
  isCaptainA,
  isCaptainB,
  isAdmin,
  currentScheduledAt,
  currentCompletionDeadline,
  initialProposals,
  hasSubmittedRoster = false,
}: MatchTimeNegotiationProps) {
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [proposedTime, setProposedTime] = useState("");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const isCaptain = isCaptainA || isCaptainB;

  const pendingProposals = initialProposals.filter((p) => p.status === "pending");
  const completionDeadline = currentCompletionDeadline
    ? new Date(currentCompletionDeadline)
    : null;
  const confirmationCutoffTime = completionDeadline
    ? completionDeadline.getTime()
    : null;
  const confirmationCutoff = confirmationCutoffTime === null
    ? null
    : new Date(confirmationCutoffTime);
  const isNegotiationClosed =
    confirmationCutoffTime !== null && now >= confirmationCutoffTime;

  useRoutePolling(pendingProposals.length > 0 ? 30_000 : null, isPending);

  // Deadline display is local; it must recover after a suspended browser tab.
  useEffect(() => {
    if (pendingProposals.length === 0 && confirmationCutoffTime === null) return;
    const tick = () => {
      if (document.visibilityState !== "hidden") setNow(Date.now());
    };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [confirmationCutoffTime, pendingProposals.length]);

  const autoAcceptedProposal = initialProposals.find(p =>
    p.status === "accepted" && (p.resolution === "auto_timeout" || p.resolution === "auto_cutoff") &&
    currentScheduledAt && new Date(p.proposedTime).getTime() === new Date(currentScheduledAt).getTime());
  const selectedTime = proposedTime ? parseCSTInput(proposedTime) : null;
  const shortNotice = (time: Date | null) => time && time.getTime() > now && time.getTime() < now + 2 * 60 * 60_000;
  const shortNoticeHint = "若需使用非预定主力，请先提交双方本场首发和 BP 负责人再确认时间；如未提交，系统将尝试采用已审核的预定主力。排期确认后临时换人须联系管理员。";

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
        <div className="rounded border p-3" style={{ borderColor: "var(--color-warn-edge)", background: "var(--color-warn-soft)" }}>
          <p className="text-sm text-[var(--color-fg)]">请尽早提交本场首发及 BP 负责人</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-1">
            可先协商比赛时间；请尽量在开赛两小时前提交首发及 BP 负责人，否则系统将尝试从本届合法的预定主力自动生成。名单不符合资格时需联系管理员处理。
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

      {/* 系统自动采纳提示 */}
      {autoAcceptedProposal && currentScheduledAt && (
        <div className="rounded border p-3 text-sm" style={{ borderColor: "var(--color-ok-edge)", background: "var(--color-ok-soft)" }}>
          <p className="font-medium text-[var(--color-fg)]">比赛时间已自动设定</p>
          <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">
            {autoAcceptedProposal.resolution === "auto_timeout" ? "对方完整 24 小时未回应，系统自动采纳" : "按当时的截止政策自动确定"}为 {formatCST(autoAcceptedProposal.proposedTime)}。
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
            const scheduling = projectMatchScheduling({
              status: "scheduled", scheduledAt: currentScheduledAt ? new Date(currentScheduledAt) : null, completionDeadline,
            }, { createdAt: new Date(proposal.createdAt), proposedTime: new Date(proposal.proposedTime) }, new Date(now));
            const autoAcceptAt = scheduling.autoAcceptAt;
            const canStillAutoAccept = autoAcceptAt && new Date(proposal.proposedTime).getTime() >= now + 2 * 60 * 60_000;
            const hoursLeft = autoAcceptAt ? Math.max(0, Math.round((autoAcceptAt.getTime() - now) / 3_600_000 * 10) / 10) : 0;

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
                      {currentScheduledAt ? " · 改期须对方明确接受，原定时间继续有效" :
                        canStillAutoAccept ? (hoursLeft > 0 ? ` · ${hoursLeft}h 后具备自动采纳资格` : " · 等待系统安全校验后自动采纳") :
                        scheduling.pending ? " · 需双方明确确认或联系管理员" : " · 提议时间已失效，请重新提议"}
                    </p>
                  </div>
                </div>

                {!proposal.isMine && shortNotice(new Date(proposal.proposedTime)) && <p className="mt-2 text-xs text-[var(--color-warn)]">{shortNoticeHint}</p>}
                {/* 对方的提议才能接受/拒绝 */}
                {!isMyProposal && isCaptain && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => handleRespond(proposal.id, "accept")}
                      disabled={isPending || isNegotiationClosed || !scheduling.pending}
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
          {shortNotice(selectedTime) && <p className="text-xs text-[var(--color-warn)]">{shortNoticeHint}</p>}
        </div>
      )}

      {/* 时间信息摘要 */}
      <div className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-xs text-[var(--color-fg-mid)] space-y-0.5">
        <div>
          最晚完成时间：{completionDeadline ? formatCST(completionDeadline) : "管理员暂未设置"}
        </div>
        <div>
          协商截止时间：
          {confirmationCutoff ? formatCST(confirmationCutoff) : "未设置；计划开赛须为未来时间"}
        </div>
        <div>首次排期：完整 24 小时未回应，且自动采纳时距开赛至少 2 小时，才可自动采纳。</div>
        <div>双方可随时确认合法的未来时间；改期须明确接受，原定时间继续有效。</div>
        <div>解说安排请查看本场已登记解说；排期不保证官方解说覆盖。</div>
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
