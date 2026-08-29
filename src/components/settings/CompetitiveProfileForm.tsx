"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, StatusBanner } from "@/components/rivalhub";

type Fact = { rank: string; rating: string };

export type CompetitiveProfileContext = { platform: string; currentSeasonKey: string; currentLabel: string; previousSeasonKey: string; previousLabel: string; rankOrder: string[] };
export type CompetitiveProfileFact = { platform: string; kind: "historical_peak" | "season_peak"; platformSeasonKey: string | null; rank: string; rating: string };

export function CompetitiveProfileForm({ contexts, facts }: { contexts: CompetitiveProfileContext[]; facts: CompetitiveProfileFact[] }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [platform, setPlatform] = useState(contexts[0]?.platform ?? "");
  const config = contexts.find((item) => item.platform === platform) ?? null;
  const findFact = (kind: CompetitiveProfileFact["kind"], seasonKey: string | null): Fact => {
    const fact = facts.find((item) => item.platform === platform && item.kind === kind && item.platformSeasonKey === seasonKey);
    return fact ? { rank: fact.rank, rating: fact.rating } : { rank: "", rating: "" };
  };
  const [historical, setHistorical] = useState<Fact>(() => findFact("historical_peak", null));
  const [previous, setPrevious] = useState<Fact>(() => config ? findFact("season_peak", config.previousSeasonKey) : { rank: "", rating: "" });
  const [current, setCurrent] = useState<Fact>(() => config ? findFact("season_peak", config.currentSeasonKey) : { rank: "", rating: "" });

  function choosePlatform(nextPlatform: string) {
    const next = contexts.find((item) => item.platform === nextPlatform);
    setPlatform(nextPlatform); setSaved(false);
    setHistorical((facts.find((item) => item.platform === nextPlatform && item.kind === "historical_peak" && item.platformSeasonKey === null) ?? { rank: "", rating: "" }));
    setPrevious(next ? (facts.find((item) => item.platform === nextPlatform && item.kind === "season_peak" && item.platformSeasonKey === next.previousSeasonKey) ?? { rank: "", rating: "" }) : { rank: "", rating: "" });
    setCurrent(next ? (facts.find((item) => item.platform === nextPlatform && item.kind === "season_peak" && item.platformSeasonKey === next.currentSeasonKey) ?? { rank: "", rating: "" }) : { rank: "", rating: "" });
  }

  if (!config || config.rankOrder.length === 0) {
    return <StatusBanner tone="warn" title="竞技平台赛季尚未完善" sub="管理员需要在平台赛季目录中标记当前赛季并维护上一赛季后，才可提交用于资格审核的竞技资料。" />;
  }

  const field = (title: string, fact: Fact, setFact: (fact: Fact) => void, hint: string) => (
    <section className="space-y-3 border-l-2 border-[var(--color-border-hi)] pl-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
        <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-mid)]">{hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>段位</Label>
          <Select value={fact.rank || undefined} onValueChange={(rank) => { setSaved(false); setFact({ ...fact, rank }); }}>
            <SelectTrigger><SelectValue placeholder="选择最高段位" /></SelectTrigger>
            <SelectContent>{config.rankOrder.map((rank) => <SelectItem key={rank} value={rank}>{rank}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>对应 Rating</Label>
          <Input value={fact.rating} onChange={(event) => { setSaved(false); setFact({ ...fact, rating: event.target.value }); }} inputMode="decimal" placeholder="可填写对应 Rating" />
        </div>
      </div>
    </section>
  );

  return <Panel label="竞技档案" pad={20}>
    <div className="space-y-5">
      {contexts.length > 1 && <div className="space-y-1.5"><Label>竞技平台</Label><Select value={platform} onValueChange={choosePlatform}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{contexts.map((item) => <SelectItem key={item.platform} value={item.platform}>{item.platform}</SelectItem>)}</SelectContent></Select></div>}
      <StatusBanner tone="info" title={`${config.platform} · 赛季资料`} sub={`当前赛季：${config.currentLabel}；上一赛季：${config.previousLabel}。请如实自行申报。`} />
      <p className="text-sm leading-6 text-[var(--color-fg-mid)]">系统依照赛事已公布的段位顺序比较资料；Rating 仅在规则指定的同分比较中使用。未公布的跨平台换算不会由此页面推断。</p>
      {field("历史最高", historical, setHistorical, "不限定平台赛季，填写个人历史最高纪录")}
      {field("上赛季最高", previous, setPrevious, `平台赛季 ${config.previousLabel}`)}
      {field("当前赛季最高", current, setCurrent, `平台赛季 ${config.currentLabel}`)}
      {saved && <StatusBanner tone="success" title="竞技档案已保存" sub="报名和赛务审核会使用你最新保存的资料。" />}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={() => startTransition(async () => {
          const result = await saveCompetitiveProfile({ platform: config.platform, currentSeasonKey: config.currentSeasonKey, previousSeasonKey: config.previousSeasonKey, historicalPeak: historical, previousSeasonPeak: previous, currentSeasonPeak: current });
          if (result.success) { setSaved(true); toast.success("竞技档案已保存"); } else toast.error(result.error.message);
        })}>{pending ? "保存中…" : "保存竞技档案"}</Button>
        <span className="font-mono text-[11px] text-[var(--color-fg-mid)]">段位与 Rating 可稍后补充；报名时将说明缺失项。</span>
      </div>
    </div>
  </Panel>;
}
