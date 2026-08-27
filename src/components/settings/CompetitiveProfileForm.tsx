"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, StatusBanner } from "@/components/rivalhub";
import type { CompetitiveProfileConfig } from "@/types/season";

type Fact = { rank: string; rating: string };
export function CompetitiveProfileForm({ config, initial }: { config: CompetitiveProfileConfig | null; initial: { historical: Fact; previous: Fact; current: Fact } }) {
  const [pending, startTransition] = useTransition();
  const [historical, setHistorical] = useState(initial.historical);
  const [previous, setPrevious] = useState(initial.previous);
  const [current, setCurrent] = useState(initial.current);
  if (!config || !config.currentSeasonKey || !config.previousSeasonKey || config.rankOrder.length === 0) return <StatusBanner tone="warn" title="竞技档案配置尚未公布" sub="赛委会尚未公布当前/上赛季或段位映射；此时不能提交会被赛事用于实力比较的资料。" />;
  const field = (title: string, fact: Fact, setFact: (fact: Fact) => void, season?: string) => <div className="space-y-2"><Label>{title}{season ? ` · ${season}` : ""}</Label><div className="grid grid-cols-2 gap-2"><Input value={fact.rank} onChange={(event) => setFact({ ...fact, rank: event.target.value })} placeholder={`段位：${config.rankOrder.join(" / ")}`} /><Input value={fact.rating} onChange={(event) => setFact({ ...fact, rating: event.target.value })} inputMode="decimal" placeholder="对应 Rating" /></div></div>;
  return <Panel label="竞技档案" pad={20}><div className="space-y-4"><p className="text-sm text-[var(--color-fg-mid)]">按规则自行申报。系统将以历史最高 50%、上赛季 20%、当前赛季 30% 比较段位；Rating 仅用于规则指定的同分比较。</p>{field("历史最高", historical, setHistorical)}{field("上赛季最高", previous, setPrevious, config.previousSeasonKey)}{field("当前赛季最高", current, setCurrent, config.currentSeasonKey)}<Button disabled={pending} onClick={() => startTransition(async () => { const result = await saveCompetitiveProfile({ platform: config.platform, currentSeasonKey: config.currentSeasonKey, previousSeasonKey: config.previousSeasonKey, historicalPeak: historical, previousSeasonPeak: previous, currentSeasonPeak: current }); if (result.success) toast.success("竞技档案已保存"); else toast.error(result.error.message); })}>{pending ? "保存中…" : "保存竞技档案"}</Button></div></Panel>;
}
