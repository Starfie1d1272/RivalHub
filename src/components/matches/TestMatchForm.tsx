"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createTestMatch, searchTestMatchOperators } from "@/actions/test-matches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; name: string }[] }) {
  return <div className="min-w-0 space-y-1.5"><span className="text-sm">{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select></div>;
}

export function TestMatchForm({ seasonId, entries }: { seasonId: string; entries: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [entryAId, setA] = useState(""); const [entryBId, setB] = useState("");
  const [operatorAId, setOperatorA] = useState("captain"); const [operatorBId, setOperatorB] = useState("captain");
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("bo3"); const [privilegedSide, setPrivilege] = useState("a");
  const operatorOptions = [{ id: "captain", name: "所选队伍的队长" }, ...operators];
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createTestMatch({ seasonId, entryAId, entryBId, format, privilegedSide, scheduledAt: null,
        ...(operatorAId === "captain" ? {} : { operatorAId }), ...(operatorBId === "captain" ? {} : { operatorBId }) });
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success("测试赛已创建");
      router.push(`/admin/${result.data.seasonSlug}/matches/${result.data.matchId}`);
      router.refresh();
    });
  }}>
    <p className="text-sm text-[var(--color-fg-mid)]">可选择本届所有已批准队伍，包括直通正赛队伍；无需参加 Play-in。</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Choice label="队伍 A" value={entryAId} onChange={setA} options={entries} />
      <Choice label="队伍 B" value={entryBId} onChange={setB} options={entries.filter(entry => entry.id !== entryAId)} />
      <Choice label="A 方 BP 操作人" value={operatorAId} onChange={setOperatorA} options={operatorOptions} />
      <Choice label="B 方 BP 操作人" value={operatorBId} onChange={setOperatorB} options={operatorOptions} />
      <Choice label="赛制" value={format} onChange={setFormat} options={[{ id: "bo1", name: "BO1" }, { id: "bo3", name: "BO3" }, { id: "bo5", name: "BO5" }]} />
      <Choice label="由哪方选择先禁图方" value={privilegedSide} onChange={setPrivilege} options={[{ id: "a", name: "队伍 A" }, { id: "b", name: "队伍 B" }]} />
    </div>
    <details><summary className="cursor-pointer text-sm">指定其他 BP 操作账号</summary><div className="mt-3 flex flex-wrap gap-2">
      <Input aria-label="搜索 BP 操作账号" placeholder="输入昵称查找账号" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 sm:max-w-xs" />
      <Button type="button" variant="outline" disabled={pending || search.trim().length < 2} onClick={() => startTransition(async () => {
        const result = await searchTestMatchOperators(seasonId, search);
        if (!result.success) { toast.error(result.error.message); return; }
        setOperators(previous => [...new Map([...previous, ...result.data].map(row => [row.id, row])).values()]);
        toast.info(result.data.length ? "可在上方选择查找到的账号" : "未找到匹配账号");
      })}>查找账号</Button></div></details>
    <p className="text-sm text-[var(--color-fg-mid)]">沿用本届图池。双方队长提交首发后，由 BP 操作人准备并开始。创建后也可在工作台安排时间。</p>
    <Button type="submit" disabled={pending || !entryAId || !entryBId || entryAId === entryBId}>{pending ? "处理中…" : "创建测试赛"}</Button>
  </form>;
}
