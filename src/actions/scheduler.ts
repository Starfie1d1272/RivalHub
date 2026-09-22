"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireSuperAdmin } from "@/lib/auth/session";
import { executeScheduledJobManually } from "@/lib/scheduler/execution";
import { getSchedulerJobDefinition, SCHEDULER_JOB_KEYS, type SchedulerJobKey } from "@/lib/scheduler/definitions";
import { runSchedulerJobByKey } from "@/lib/scheduler/runners";
import { ok, type ActionResult } from "@/types/action";

const jobKeySchema = z.enum(SCHEDULER_JOB_KEYS);

export async function runSchedulerJobManually(input: unknown): Promise<ActionResult<{ jobKey: SchedulerJobKey; businessTransitions: number }>> {
  const parsed = z.object({ jobKey: jobKeySchema }).safeParse(input);
  if (!parsed.success) return failValidation("定时任务标识无效。");

  try {
    const admin = await requireSuperAdmin();
    const jobKey = parsed.data.jobKey;
    const definition = getSchedulerJobDefinition(jobKey);
    if (!definition) return failValidation("定时任务标识无效。");

    await writeAuditInTx(db, {
      seasonId: null,
      action: "scheduler.manual_trigger",
      actorId: auditActorId(admin),
      targetId: jobKey,meta: { jobKey, force: true, source: "super-admin-manual" },
    });

    const result = await executeScheduledJobManually(jobKey, () => runSchedulerJobByKey(jobKey));
    revalidatePath("/admin/settings");
    return ok({ jobKey, businessTransitions: result.businessTransitions });
  } catch (error) {
    return actionError("runSchedulerJobManually", error);
  }
}
