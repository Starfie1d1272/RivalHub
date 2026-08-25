"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { reviewTeamApplication } from "@/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface TeamApplicationReviewRow {
  id: string;
  name: string;
  status: "draft" | "submitted" | "approved" | "waitlisted" | "rejected";
  captainEmail: string;
  members: Array<{ email: string; status: "invited" | "confirmed" }>;
  reviewReason: string | null;
}

const LABEL = { draft: "待完善", submitted: "待审核", approved: "已通过", waitlisted: "候补", rejected: "已拒绝" } as const;

export function TeamApplicationReviewList({ applications }: { applications: TeamApplicationReviewRow[] }) {
  const [isPending, startTransition] = useTransition();
  const review = (applicationId: string, status: "approved" | "waitlisted" | "rejected") => startTransition(async () => {
    const result = await reviewTeamApplication({ applicationId, status });
    if (!result.success) toast.error(result.error.message);
    else toast.success(status === "approved" ? "已通过并生成正式队伍" : `报名队伍已${LABEL[status]}`);
  });

  if (applications.length === 0) return <p className="py-8 text-center text-[var(--color-fg-mid)]">暂无队伍报名。</p>;
  return <div className="space-y-3">{applications.map((application) => {
    const confirmed = application.members.filter((member) => member.status === "confirmed").length;
    return <Card key={application.id} className="p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0 space-y-1"><div className="flex items-center gap-2"><h3 className="font-semibold">{application.name}</h3><Badge variant="outline">{LABEL[application.status]}</Badge></div><p className="text-sm text-[var(--color-fg-mid)]">队长：{application.captainEmail} · 已确认 {confirmed}/{application.members.length}</p><p className="text-xs text-[var(--color-fg-mid)]">{application.members.map((member) => `${member.email}${member.status === "confirmed" ? " ✓" : ""}`).join(" · ")}</p>{application.reviewReason && <p className="text-sm text-[var(--color-warn)]">审核说明：{application.reviewReason}</p>}</div>{(application.status === "submitted" || application.status === "waitlisted") && <div className="flex shrink-0 flex-col gap-1.5"><Button size="sm" disabled={isPending} onClick={() => review(application.id, "approved")}>通过</Button><Button size="sm" variant="outline" disabled={isPending} onClick={() => review(application.id, "waitlisted")}>候补</Button><Button size="sm" variant="ghost" disabled={isPending} onClick={() => review(application.id, "rejected")}>拒绝</Button></div>}</div></Card>;
  })}</div>;
}
