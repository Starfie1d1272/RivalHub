"use server";
import { z } from "zod";
import { actionError } from "@/lib/action-utils";
import { ok } from "@/types/action";
import { readAdminCommunityAward, readAdminCommunityAwardOptions } from "@/lib/admin/community-awards-read";

export async function readCommunityAwardDetail(input: unknown) {
  try { return ok(await readAdminCommunityAward(z.object({ seasonId: z.uuid(), awardId: z.uuid() }).parse(input))); }
  catch (error) { return actionError("readCommunityAwardDetail", error); }
}
export async function readCommunityAwardOptions(seasonId: unknown) {
  try { return ok(await readAdminCommunityAwardOptions(z.uuid().parse(seasonId))); }
  catch (error) { return actionError("readCommunityAwardOptions", error); }
}
