"use server";

import { z } from "zod";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getPublicDraftData, publicDraftAccessMode, type PublicDraftData } from "@/lib/draft/data";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { ok, type ActionResult } from "@/types/action";

export async function readPublicDraft(input: unknown): Promise<ActionResult<{ data: PublicDraftData; mode: "preview" | "live" | "archive" }>> {
  const parsed = z.string().min(1).max(160).safeParse(input);
  if (!parsed.success) return failValidation("赛事无效。");
  try {
    const season = await getPublicOrAuthorizedDraftSeason(parsed.data);
    const access = season ? publicDraftAccessMode(season) : null;
    if (!season || !access) throw new AppError(ErrorCode.NOT_FOUND, "选秀尚未开放。");
    const data = await getPublicDraftData(season.id, access === "archive");
    return ok({ data, mode: access === "archive" ? "archive" : data.state ? "live" : "preview" });
  } catch (error) {
    return actionError("readPublicDraft", error);
  }
}
