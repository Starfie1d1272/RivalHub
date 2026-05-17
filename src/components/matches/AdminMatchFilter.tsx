"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StageOption {
  key: string;
  name: string;
}

interface TeamOption {
  id: string;
  name: string;
}

interface AdminMatchFilterProps {
  stages: StageOption[];
  teams?: TeamOption[];
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "scheduled", label: "已排期" },
  { value: "in_progress", label: "进行中" },
  { value: "finished", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

export function AdminMatchFilter({ stages, teams }: AdminMatchFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentStage = searchParams.get("stage") ?? "all";
  const currentStatus = searchParams.get("status") ?? "all";
  const currentTeam = searchParams.get("team") ?? "all";

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    router.push((qs ? `${pathname}?${qs}` : pathname) as never);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select value={currentStage} onValueChange={(v) => updateFilter("stage", v)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="阶段筛选" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部阶段</SelectItem>
          {stages.map((s) => (
            <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentStatus} onValueChange={(v) => updateFilter("status", v)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="状态筛选" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {teams && teams.length > 0 && (
        <Select value={currentTeam} onValueChange={(v) => updateFilter("team", v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="队伍筛选" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部队伍</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
