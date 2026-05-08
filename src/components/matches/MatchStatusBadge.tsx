import { Badge } from "@/components/ui/badge";

type MatchStatus = "scheduled" | "in_progress" | "finished" | "cancelled";

const STATUS_STYLES: Record<MatchStatus, string> = {
  scheduled:   "bg-gray-500/10 text-gray-500 border-gray-500/20",
  in_progress: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  finished:    "bg-green-500/10 text-green-600 border-green-500/20",
  cancelled:   "bg-red-500/10 text-red-500 border-red-500/20",
};

const STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled:   "待开始",
  in_progress: "进行中",
  finished:    "已结束",
  cancelled:   "已取消",
};

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
