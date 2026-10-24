"use client";

import { useEffect, useState } from "react";
import { loadCommunityAwardOptions } from "@/actions/community-award-options";
import { Button } from "@/components/ui/button";
import { CommunityAwardEvidenceForm } from "./CommunityAwardEvidenceForm";
import type { SeasonAwardCandidate } from "@/lib/community-awards/read-model";

type Options = { candidates: SeasonAwardCandidate[]; matches: { id: string; label: string }[] };

/** Mounted by DialogContent only while the evidence dialog is open. */
export function CommunityAwardEvidenceOptions({ awardId, seasonSlug }: { awardId: string; seasonSlug: string }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void loadCommunityAwardOptions(seasonSlug).then(result => {
      if (!active) return;
      if (result.success) setOptions(result.data);
      else setError(result.error.message);
    }).catch(() => { if (active) setError("选项暂时无法加载，请重试。"); });
    return () => { active = false; };
  }, [seasonSlug, attempt]);
  if (error) return <div role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => { setError(null); setAttempt(value => value + 1); }}>重新加载</Button></div>;
  if (!options) return <div role="status" className="min-h-64">正在加载候选人与比赛选项…</div>;
  return <CommunityAwardEvidenceForm awardId={awardId} {...options} />;
}
