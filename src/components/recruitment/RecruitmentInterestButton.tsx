"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { expressRecruitmentInterest, withdrawRecruitmentInterest } from "@/actions/recruitment";
import { Button } from "@/components/ui/button";

export function RecruitmentInterestButton({ recruitmentIntentId, interested, loggedIn }: { recruitmentIntentId: string; interested: boolean; loggedIn: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!loggedIn) return <Button size="sm" variant="outline" asChild><Link href="/login?next=/teams/recruitment">登录后表达加入意向</Link></Button>;
  return <Button size="sm" variant={interested ? "outline" : "default"} disabled={pending} onClick={() => startTransition(async () => {
    const result = interested ? await withdrawRecruitmentInterest({ recruitmentIntentId }) : await expressRecruitmentInterest({ recruitmentIntentId });
    if (result.success) { toast.success(interested ? "已撤回加入意向" : "已向队长表达加入意向"); router.refresh(); }
    else toast.error(result.error.message);
  })}>{pending ? "处理中…" : interested ? "撤回加入意向" : "表达加入意向"}</Button>;
}
