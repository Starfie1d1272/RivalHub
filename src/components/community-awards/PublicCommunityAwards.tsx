"use client";
import React from "react";

import Link from "next/link";
import type { Route } from "next";
import { Panel, StatusPill } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogDescription } from "@/components/ui/dialog";
import { CommunityAwardsBoard } from "./CommunityAwardsBoard";
import { CommunityAwardEvidenceForm } from "./CommunityAwardEvidenceForm";
import { CommunityAwardSubmissionForm } from "./CommunityAwardSubmissionForm";
import type { CommunityAwardModel } from "@/lib/community-awards/data";

export function PublicCommunityAwards({ seasonId, awards, currentUserId, candidates, matches }: {
  seasonId: string; awards: CommunityAwardModel[]; currentUserId: string | null;
  candidates: { id: string; name: string }[]; matches: { id: string; label: string }[];
}) {
  const shared = { seasonId, currentUserId, candidates, matches, isAdmin: false };
  const groups = [
    { title: "进行中", statuses: ["approved"] },
    { title: "已结奖", statuses: ["awarded"] },
    { title: "未颁 / 取消", statuses: ["not_awarded", "cancelled", "withdrawn"] },
  ];
  const own = awards.filter((award) => award.submittedByUserId === currentUserId && ["pending_review", "rejected"].includes(award.status));
  return <div className="space-y-8">
    {currentUserId ? <Dialog><DialogTrigger asChild><Button>提出社区奖</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>提出社区奖</DialogTitle><DialogDescription>说明奖项条件与奖品，提交给赛事方审核。</DialogDescription></DialogHeader><DialogBody><CommunityAwardSubmissionForm seasonId={seasonId} /></DialogBody></DialogContent></Dialog> : <Button asChild><Link href="/login">登录后提出社区奖</Link></Button>}
    {groups.map((group) => {
      const items = awards.filter((award) => group.statuses.includes(award.status));
      if (!items.length) return null;
      return <section key={group.title} className="space-y-4"><h2 className="text-xl font-semibold">{group.title}</h2><div className="grid gap-4 md:grid-cols-2">{items.map((award) => <Panel key={award.id} contentClassName="space-y-3 p-5">
        <h3 className="text-lg font-bold">{award.name}</h3>
        {award.status === "awarded" && (award.recipientTarget ? <Link className="block text-xl font-bold text-[var(--color-accent)]" href={award.recipientTarget as Route}>{award.recipientName}</Link> : award.recipientName ? <p className="text-xl font-bold">{award.recipientName}</p> : null)}
        <StatusPill label={award.status === "approved" ? "征集候选证据" : award.status === "awarded" ? "已结奖" : award.status === "not_awarded" ? "本届不颁" : award.status === "withdrawn" ? "已撤回" : "已取消"} tone="neutral" />
        <p className="text-sm">{award.condition}</p><p className="text-sm text-[var(--color-fg-mid)]">奖品 · {award.prize}</p>
        {award.outcomeNote && <p className="text-sm">{award.outcomeNote}</p>}
        <details className="text-sm"><summary className="cursor-pointer text-[var(--color-fg-mid)]">奖项说明</summary><p className="mt-2">发起人 · {award.submitterName}</p>{award.supplementaryNote && <p>{award.supplementaryNote}</p>}{award.publicNote && <p>{award.publicNote}</p>}</details>
        {award.status === "approved" && currentUserId && <Dialog><DialogTrigger asChild><Button size="sm" variant="outline">提交候选证据</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{award.name} · 候选证据</DialogTitle><DialogDescription>候选人可为本届赛事相关人员。</DialogDescription></DialogHeader><DialogBody><CommunityAwardEvidenceForm awardId={award.id} candidates={candidates} matches={matches} /></DialogBody></DialogContent></Dialog>}
      </Panel>)}</div></section>;
    })}
    {awards.length === 0 && <Panel><p className="text-sm text-[var(--color-fg-mid)]">社区奖公布后会在这里展示。</p></Panel>}
    {own.length > 0 && <section className="space-y-4"><h2 className="text-xl font-semibold">我的提交</h2><CommunityAwardsBoard {...shared} awards={own} allowSubmission={false} /></section>}
  </div>;
}
