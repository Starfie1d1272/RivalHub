"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmMajorTournamentSeeds, saveMajorTournamentSeeds } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Marker, Panel } from "@/components/rivalhub";

export interface MajorTournamentSeedsManagementData {
  seasonId: string;
  entrantsLocked: boolean;
  entrants: Array<{ teamId: string; teamName: string }>;
  seeds: Array<{ teamId: string; tournamentSeed: number }>;
  seedRevision: number;
  confirmedSeedRevision: number | null;
  firstRound: Array<{ higherSeed: number; lowerSeed: number; format: "bo1" | "bo3" }> | null;
}

export function MajorTournamentSeedsManagement({ data }: { data: MajorTournamentSeedsManagementData }) {
  const [isPending, startTransition] = useTransition();
  const saved = [...data.seeds].sort((a, b) => a.tournamentSeed - b.tournamentSeed).map((seed) => seed.teamId);
  const initialOrderKey = (saved.length === 32 ? saved : [...data.entrants]
    .sort((a, b) => a.teamName.localeCompare(b.teamName))
    .map((entrant) => entrant.teamId)).join(",");
  const [order, setOrder] = useState(() => initialOrderKey ? initialOrderKey.split(",") : []);
  useEffect(() => setOrder(initialOrderKey ? initialOrderKey.split(",") : []), [initialOrderKey]);
  const teamById = new Map(data.entrants.map((entrant) => [entrant.teamId, entrant]));
  const confirmed = data.seedRevision > 0 && data.seedRevision === data.confirmedSeedRevision;
  const move = (index: number, offset: -1 | 1) => setOrder((current) => {
    const next = index + offset;
    if (next < 0 || next >= current.length) return current;
    const copy = [...current];
    [copy[index], copy[next]] = [copy[next]!, copy[index]!];
    return copy;
  });

  return <Panel label="赛事 1–32 种子">
    {!data.entrantsLocked ? <p className="text-sm text-[var(--color-fg-mid)]">请先锁定正式参赛队和最终赛事名单，种子才能保存。</p> : <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Marker sub={confirmed ? "当前排序已确认" : data.seedRevision > 0 ? "排序已变更，需要重新确认" : "尚未保存排序"}>{confirmed ? "种子已确认" : "种子待确认"}</Marker>
          <p className="mt-1 text-sm text-[var(--color-fg-mid)]">赛事种子独立于选秀排序。保存新的排序后，需要重新确认。</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={isPending || order.length !== 32} onClick={() => startTransition(async () => {
          const result = await saveMajorTournamentSeeds({ seasonId: data.seasonId, entryIds: order });
          if (!result.success) toast.error(result.error.message); else toast.success("1–32 种子已保存，需重新确认");
        })}>保存排序</Button><Button disabled={isPending || confirmed || data.seedRevision < 1} onClick={() => startTransition(async () => {
          const result = await confirmMajorTournamentSeeds({ seasonId: data.seasonId });
          if (!result.success) toast.error(result.error.message); else toast.success("赛事种子已确认");
        })}>确认种子</Button></div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{order.map((teamId, index) => <li key={teamId} className="flex items-center gap-2 border border-[var(--color-border)] px-2 py-1.5 text-sm"><span className="w-8 font-mono text-[var(--color-fg-mid)]">#{index + 1}</span><span className="min-w-0 flex-1 truncate">{teamById.get(teamId)?.teamName ?? teamId}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={isPending || index === 0} onClick={() => move(index, -1)}>↑</Button><Button size="sm" variant="ghost" disabled={isPending || index === order.length - 1} onClick={() => move(index, 1)}>↓</Button></div></li>)}</ol>

      {data.seeds.length === 32 ? <div className="grid gap-3 lg:grid-cols-3">
        <SeedCohort label="Stage 3 · #1–8" seeds={data.seeds.filter((seed) => seed.tournamentSeed <= 8)} teams={teamById} />
        <SeedCohort label="Stage 2 · #9–16" seeds={data.seeds.filter((seed) => seed.tournamentSeed >= 9 && seed.tournamentSeed <= 16)} teams={teamById} />
        <SeedCohort label="Stage 1 · #17–32" seeds={data.seeds.filter((seed) => seed.tournamentSeed >= 17)} teams={teamById} />
      </div> : <p className="text-sm text-[var(--color-fg-mid)]">保存后将按 Stage 3 #1–8、Stage 2 #9–16、Stage 1 #17–32 展示入场批次。</p>}

      <section><h3 className="font-medium text-[var(--color-fg)]">第一轮预览</h3>{data.firstRound ? <ol className="mt-2 grid gap-2 text-sm md:grid-cols-2">{data.firstRound.map((pairing) => <li key={`${pairing.higherSeed}-${pairing.lowerSeed}`} className="border border-[var(--color-border)] px-3 py-2">#{pairing.higherSeed} {teamById.get(data.seeds.find((seed) => seed.tournamentSeed === pairing.higherSeed)?.teamId ?? "")?.teamName} vs #{pairing.lowerSeed} {teamById.get(data.seeds.find((seed) => seed.tournamentSeed === pairing.lowerSeed)?.teamId ?? "")?.teamName} · {pairing.format.toUpperCase()}</li>)}</ol> : <p className="mt-1 text-sm text-[var(--color-fg-mid)]">需先保存完整种子才能构造预览。</p>}<p className="mt-2 text-sm text-[var(--color-fg-mid)]">这是保存前的对阵预览；保存种子前不会创建比赛。</p></section>
    </div>}
  </Panel>;
}

function SeedCohort({ label, seeds, teams }: { label: string; seeds: MajorTournamentSeedsManagementData["seeds"]; teams: Map<string, { teamId: string; teamName: string }> }) {
  return <section className="border border-[var(--color-border)] p-3"><h3 className="font-medium text-[var(--color-fg)]">{label}</h3><ol className="mt-2 space-y-1 text-sm text-[var(--color-fg-mid)]">{[...seeds].sort((a, b) => a.tournamentSeed - b.tournamentSeed).map((seed) => <li key={seed.teamId}>#{seed.tournamentSeed} {teams.get(seed.teamId)?.teamName}</li>)}</ol></section>;
}
