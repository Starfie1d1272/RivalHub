"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSuperAdmin } from "@/lib/auth/session";
import {
  approveConversionPolicy,
  createConversionPolicyDraft,
  retireConversionPolicy,
  setCurrentConversionPolicy,
  updateConversionPolicyDraft,
} from "@/lib/competitive/conversion-policy-admin";
import { fail, ok, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import type { ConversionPolicyMapping } from "@/lib/competitive/conversion-policy";

const idSchema = z.guid();
const versionSchema = z.string().trim().min(1, "请填写新的策略版本。 ").max(128, "策略版本不能超过 128 个字符。 ");
const noteSchema = z.string().trim().max(4000, "说明不能超过 4000 个字符。 ").nullable().optional();

function revalidateConversionPolicies(): void {
  revalidatePath("/admin/competitive-seasons/conversion-policies");
  revalidatePath("/admin/competitive-seasons");
  revalidatePath("/settings");
}

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

export async function createConversionPolicyDraftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({
    basePolicyId: idSchema,
    version: versionSchema,
    sourceNote: noteSchema,
    rationale: noteSchema,
    changeSummary: noteSchema,
    internalNote: noteSchema,
  }).safeParse(input);
  if (!parsed.success) return invalid("请填写有效的基准策略和新版本号。 ");
  try {
    const session = await requireSuperAdmin();
    const result = await createConversionPolicyDraft(parsed.data, auditActorId(session));
    revalidateConversionPolicies();
    return ok(result);
  } catch (error) {
    return actionError("createConversionPolicyDraft", error);
  }
}

export async function updateConversionPolicyDraftAction(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({
    id: idSchema,
    mapping: z.unknown(),
    sourceNote: noteSchema,
    rationale: noteSchema,
    changeSummary: noteSchema,
    internalNote: noteSchema,
  }).safeParse(input);
  if (!parsed.success) return invalid("请填写有效的换算策略草稿。 ");
  try {
    const session = await requireSuperAdmin();
    await updateConversionPolicyDraft({ ...parsed.data, mapping: parsed.data.mapping as ConversionPolicyMapping }, auditActorId(session));
    revalidateConversionPolicies();
    return ok(undefined);
  } catch (error) {
    return actionError("updateConversionPolicyDraft", error);
  }
}

export async function approveConversionPolicyAction(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return invalid("换算策略标识无效。 ");
  try {
    const session = await requireSuperAdmin();
    await approveConversionPolicy(parsed.data.id, auditActorId(session));
    revalidateConversionPolicies();
    return ok(undefined);
  } catch (error) {
    return actionError("approveConversionPolicy", error);
  }
}

export async function setCurrentConversionPolicyAction(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return invalid("换算策略标识无效。 ");
  try {
    const session = await requireSuperAdmin();
    await setCurrentConversionPolicy(parsed.data.id, auditActorId(session));
    revalidateConversionPolicies();
    return ok(undefined);
  } catch (error) {
    return actionError("setCurrentConversionPolicy", error);
  }
}

export async function retireConversionPolicyAction(input: unknown): Promise<ActionResult<void>> {
  const parsed = z.object({ id: idSchema }).safeParse(input);
  if (!parsed.success) return invalid("换算策略标识无效。 ");
  try {
    const session = await requireSuperAdmin();
    await retireConversionPolicy(parsed.data.id, auditActorId(session));
    revalidateConversionPolicies();
    return ok(undefined);
  } catch (error) {
    return actionError("retireConversionPolicy", error);
  }
}
