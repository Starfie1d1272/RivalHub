import "server-only";
import { db } from "@/db/client";
import { beginPasswordMutationInTx, finishPasswordMutationInTx } from "./session-registry";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";

/** Provider and DB cannot commit atomically: persist a deny fence before the remote call. */
export async function mutatePassword(
  userId: string,
  startedAt: string,
  action: "user.change_password" | "user.reset_password",
  update: () => Promise<{ error: unknown }>,
): Promise<void> {
  const mutationId = await db.transaction((tx) => beginPasswordMutationInTx(tx, userId, startedAt));
  // Thrown/unknown provider outcomes deliberately retain the block for operator reconciliation.
  const result = await update();
  if (result.error) {
    const status = typeof result.error === "object" && "status" in result.error ? Number(result.error.status) : 0;
    if (status < 400 || status >= 500 || status === 408) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "密码更新结果暂时无法确认，登录已暂停，请联系管理员核实。 ");
    }
  }
  await db.transaction(async (tx) => {
    await finishPasswordMutationInTx(tx, userId, mutationId);
    await writeAuditInTx(tx, {
      seasonId: null, action: result.error ? "user.password_update_failed" : action,
      actorId: userId, targetId: userId,
    });
  });
  if (result.error) throw new AppError(ErrorCode.INTERNAL_ERROR, "密码更新失败，旧登录已退出，请重新登录后重试。");
}
