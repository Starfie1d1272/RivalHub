import type { matchTimeProposals } from "@/db/schema/match-time-proposals";
import { formatCST } from "@/lib/utils/date";

type Proposal = typeof matchTimeProposals.$inferSelect;

interface TimeProposalHistoryProps {
  proposals: Proposal[];
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待回应",
  accepted: "已接受",
  rejected: "已拒绝",
  expired: "已过期",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-600",
  accepted: "text-green-600",
  rejected: "text-red-600",
  expired: "text-gray-400",
};

export function TimeProposalHistory({ proposals }: TimeProposalHistoryProps) {
  if (proposals.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无时间协商记录</p>;
  }

  return (
    <div className="space-y-2">
      {proposals.map((p) => (
        <div key={p.id} className="rounded border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {formatCST(p.proposedTime)}
            </span>
            <span className={STATUS_COLORS[p.status] ?? "text-muted-foreground"}>
              {STATUS_LABELS[p.status] ?? p.status}
            </span>
          </div>
          {p.rejectReason && (
            <p className="mt-1 text-muted-foreground">
              拒绝原因：{p.rejectReason}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            提议时间：{formatCST(p.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}
