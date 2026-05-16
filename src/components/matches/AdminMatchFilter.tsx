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

interface AdminMatchFilterProps {
  stages: StageOption[];
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "scheduled", label: "已排期" },
  { value: "in_progress", label: "进行中" },
  { value: "finished", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

export function AdminMatchFilter({ stages }: AdminMatchFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentStage = searchParams.get("stage") ?? "all";
  const currentStatus = searchParams.get("status") ?? "all";

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
    </div>
  );
}
