"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveFormation, saveManualFormation, startFormedSeason, withdrawFormation, requestFormationChange } from "@/actions/draft/formation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineConfirm } from "@/components/rivalhub";
import type { getManualFormationData } from "@/lib/draft/manual-data";

type FormationData = Awaited<ReturnType<typeof getManualFormationData>>;
type Team = FormationData["teams"][number];

function TeamEditor({ seasonId, players, team, occupied, maxTeamSize, starterCount, captainsOnly }: { seasonId: string; players: FormationData["players"]; team?: Team; occupied: Set<string>; maxTeamSize: number; starterCount: number; captainsOnly: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmAction, setConfirmAction] = useState<"withdraw" | "change" | null>(null);
  const [captainId, setCaptainId] = useState(team?.captainId ?? "");
  const [members, setMembers] = useState<string[]>(team?.members.map(member => member.id) ?? []);
  const [starters, setStarters] = useState<string[]>(team?.members.filter(member => member.starter).map(member => member.id) ?? []);
  function toggle(id: string, checked: boolean) {
    if (checked && members.filter(value => value !== captainId).length + 1 >= maxTeamSize) { toast.error(`每队最多 ${maxTeamSize} 人`); return; }
    setMembers(old => checked ? [...old, id] : old.filter(value => value !== id));
    if (!checked) setStarters(old => old.filter(value => value !== id));
  }
  function save() {
    startTransition(async () => {
      const result = await saveManualFormation({ seasonId, entryId: team?.id ?? null, captainId, memberIds: captainsOnly ? [] : members, starterIds: captainsOnly ? [captainId] : starters });
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success("编队草稿已保存，仍需审核名单");
      if (!team) { setCaptainId(""); setMembers([]); setStarters([]); }
      router.refresh();
    });
  }
  function approve() {
    if (!team) return;
    startTransition(async () => {
      const result = await approveFormation({ seasonId, entryId: team.id, expectedRevisionId: team.revisionId });
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success("名单已审核并采用");
      router.refresh();
    });
  }
  return <Card className="space-y-4 p-5">
    <h2 className="text-lg font-semibold">{team?.name ?? "新建队伍"}</h2>
    <label className="block text-sm">队长
      <select className="ml-3 rounded border p-2" value={captainId} disabled={Boolean(team) || team?.approved} onChange={event => { setCaptainId(event.target.value); setMembers([]); setStarters([]); }}>
        <option value="">选择队长</option>{players.map(player => <option key={player.id} value={player.id} disabled={occupied.has(player.id) && player.id !== team?.captainId}>{player.name}{occupied.has(player.id) && player.id !== team?.captainId ? "（已编队）" : ""}</option>)}
      </select>
    </label>
    {captainId && !captainsOnly && <div className="space-y-2"><p className="text-sm">选择队员和首发；不完整的名单也可保存。</p>
      {players.map(player => {
        const selected = player.id === captainId || members.includes(player.id);
        return <div className="flex items-center gap-4 text-sm" key={player.id}>
          <label><input type="checkbox" checked={selected} disabled={player.id === captainId || team?.approved || (occupied.has(player.id) && !selected)} onChange={event => toggle(player.id, event.target.checked)} /> {player.name}{occupied.has(player.id) && !selected ? "（已编队）" : ""}</label>
          <label><input type="checkbox" checked={starters.includes(player.id)} disabled={!selected || team?.approved || (!starters.includes(player.id) && starters.length >= starterCount)} onChange={event => setStarters(old => event.target.checked ? [...old, player.id] : old.filter(id => id !== player.id))} /> 首发</label>
        </div>;
      })}</div>}
    <Button type="button" onClick={save} disabled={!captainId || pending || team?.approved || (captainsOnly && Boolean(team))}>{captainsOnly ? "创建队长队伍" : "保存编队草稿"}</Button>
    {team && !captainsOnly && !team.approved && <Button type="button" variant="outline" onClick={approve} disabled={pending}>审核并采用名单</Button>}
    {team && !team.approved && !captainsOnly && !team.approvedId && <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmAction("withdraw")}>撤销编队</Button>}
    {team?.approved && team.approvedId && <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmAction("change")}>发起名单补正</Button>}
    {team && confirmAction && <InlineConfirm title={confirmAction === "withdraw" ? "撤销此编队？" : "发起名单补正？"} sub={confirmAction === "withdraw" ? "撤销后会释放成员的参赛确认。" : "已批准版本将保留，新名单须重新确认和审核。"} confirmLabel={confirmAction === "withdraw" ? "确认撤销" : "确认补正"} onCancel={() => setConfirmAction(null)} onConfirm={() => { const action = confirmAction; setConfirmAction(null); startTransition(async () => { const result = action === "withdraw" ? await withdrawFormation({ seasonId, entryId: team.id }) : await requestFormationChange({ seasonId, entryId: team.id }); if (!result.success) { toast.error(result.error.message); return; } toast.success(action === "withdraw" ? "编队已撤销" : "已创建名单补正草稿"); router.refresh(); }); }} />}
    {team?.approved && <p className="text-sm">名单已批准或存在不可用成员，请通过名单管理流程处理。</p>}
  </Card>;
}
export function ManualFormationPanel({ seasonId, data, maxTeamSize, starterCount, captainsOnly = false, allowCreate = true }: { seasonId: string; data: FormationData; maxTeamSize: number; starterCount: number; captainsOnly?: boolean; allowCreate?: boolean }) {
  const occupied = new Set(data.teams.flatMap(team => team.members.map(member => member.id)));
  return <div className="space-y-4"><p className="text-sm">{captainsOnly ? "选择队长创建选秀队伍；队长需要确认参赛。" : `按报名选手创建队伍。每队最多 ${maxTeamSize} 人、${starterCount} 名首发。保存草稿不会批准名单或开始比赛；成员须确认，名单还需审核并采用。`}</p>{data.teams.map(team => <TeamEditor key={team.id} seasonId={seasonId} players={data.players} team={team} occupied={occupied} maxTeamSize={maxTeamSize} starterCount={starterCount} captainsOnly={captainsOnly} />)}{allowCreate && <TeamEditor seasonId={seasonId} players={data.players} occupied={occupied} maxTeamSize={maxTeamSize} starterCount={starterCount} captainsOnly={captainsOnly} />}</div>;
}

export function FormationApprovalPanel({ seasonId, teams }: { seasonId: string; teams: FormationData["teams"] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function approve(team: Team) {
    startTransition(async () => {
      const result = await approveFormation({ seasonId, entryId: team.id, expectedRevisionId: team.revisionId });
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success(`${team.name}的名单已审核并采用`);
      router.refresh();
    });
  }
  return <Card className="space-y-4 p-5"><h2 className="text-lg font-semibold">审核选秀名单</h2><p className="text-sm">成员确认并满足本届名单规则后，审核并采用各队名单。</p>{teams.map(team => <div key={team.id} className="flex items-center justify-between gap-4"><span>{team.name}</span><Button type="button" variant="outline" disabled={pending} onClick={() => approve(team)}>审核并采用名单</Button></div>)}</Card>;
}

export function FormationStartPanel({ seasonId, seasonSlug, major }: { seasonId: string; seasonSlug: string; major: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Card className="space-y-3 p-5"><h2 className="text-lg font-semibold">赛事开赛</h2><p className="text-sm">完成编队、成员确认和全部名单审核后，管理员可以冻结名单并开始赛事。</p>{major ? <Button asChild><Link href={`/admin/${seasonSlug}/prestart`}>前往 Major 赛前筹备</Link></Button> : <Button type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await startFormedSeason({ seasonId }); if (!result.success) { toast.error(result.error.message); return; } toast.success("名单已冻结，赛事已开始；可前往赛程管理生成赛程。"); router.refresh(); })}>冻结名单并开始赛事</Button>}</Card>;
}
