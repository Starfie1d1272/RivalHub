import { formatCST } from "@/lib/utils/date";
import type { PublicMatchTimeProposal } from "@/lib/matches/time-proposals";

interface TimeProposalHistoryProps {
  proposals: PublicMatchTimeProposal[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待回应",
  accepted: "已接受",
  rejected: "已拒绝",
  expired: "已过期",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--color-warn)",
  accepted: "var(--color-ok)",
  rejected: "var(--color-danger)",
  expired: "var(--color-fg-dim)",
};

export function TimeProposalHistory({ proposals }: TimeProposalHistoryProps) {
  if (proposals.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-fg-dim)" }}>暂无时间协商记录</p>;
  }

  return (
    <div className="space-y-2">
      {proposals.map((p) => (
        <div
          key={p.id}
          className="rounded border p-3 text-sm"
          style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium" style={{ color: "var(--color-fg)" }}>
              {formatCST(p.proposedTime)}
            </span>
            <span
              className="text-xs font-semibold"
              style={{
                fontFamily: "var(--font-mono)",
                color: STATUS_COLORS[p.status] ?? "var(--color-fg-dim)",
              }}
            >
              {STATUS_LABELS[p.status] ?? p.status}
            </span>
          </div>
          {p.rejectReason && (
            <p className="mt-1 text-xs" style={{ color: "var(--color-fg-mid)" }}>
              拒绝原因：{p.rejectReason}
            </p>
          )}
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-fg-dim)" }}>
            提议时间：{formatCST(p.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}
