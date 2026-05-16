"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Team {
  id: string;
  name: string;
}

interface MatchTeamFilterProps {
  teams: Team[];
}

export function MatchTeamFilter({ teams }: MatchTeamFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTeam = searchParams.get("team") ?? "";

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("team");
    } else {
      params.set("team", value);
    }
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.push(url as never);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[var(--color-fg-mid)] shrink-0">按队伍筛选</span>
      <Select value={currentTeam || "all"} onValueChange={handleChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="全部队伍" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部队伍</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
