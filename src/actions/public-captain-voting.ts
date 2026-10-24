"use server";

import { z } from "zod";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getUserSession } from "@/lib/auth/session";
import { getCaptainVotingViewer, getPublicCaptainVotingData, type PublicCaptainCandidate, type PublicCaptainVoter, type CaptainVoteRecord } from "@/lib/captains/data";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok, type ActionResult } from "@/types/action";

export type CaptainVotingSnapshot = {
  candidates: PublicCaptainCandidate[]; currentVoter: PublicCaptainVoter | null;
  votes: CaptainVoteRecord[]; seasonStatus: string;
};

export async function readPublicCaptainVoting(input: unknown): Promise<ActionResult<CaptainVotingSnapshot>> {
  const parsed = z.string().min(1).max(160).safeParse(input);
  if (!parsed.success) return failValidation("赛事无效。");
  try {
    const season = await getPublicOrAuthorizedDraftSeason(parsed.data);
    if (!season?.hasCaptainVoting) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
    const [data, session] = await Promise.all([getPublicCaptainVotingData(season.id), getUserSession()]);
    const viewer = await getCaptainVotingViewer(data, session?.userId ?? null);
    return ok({ candidates: data.candidates, seasonStatus: season.status, ...viewer });
  } catch (error) {
    return actionError("readPublicCaptainVoting", error);
  }
}
