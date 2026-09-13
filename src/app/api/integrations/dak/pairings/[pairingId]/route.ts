import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { dakPairings } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { integrationError, integrationJson, integrationOptions } from "@/lib/demo-integration/http";
import { revokeDakPairing } from "@/lib/demo-integration/pairing";
import { AppError, ErrorCode } from "@/lib/errors";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function DELETE(request: Request, context: { params: Promise<{ pairingId: string }> }): Promise<Response> {
  try {
    const authorization = await requireAdmin();
    const { pairingId } = await context.params;
    const [pairing] = await db.select({ userId: dakPairings.userId }).from(dakPairings).where(eq(dakPairings.id, pairingId));
    if (!pairing) throw new AppError(ErrorCode.NOT_FOUND, "DAK 连接不存在。");
    if (authorization.role !== "super_admin" && pairing.userId !== authorization.userId) throw new AppError(ErrorCode.FORBIDDEN, "只能撤销自己的 DAK 连接。");
    const revoked = await revokeDakPairing(pairingId, authorization.userId);
    return integrationJson(request, { revoked });
  } catch (error) {
    return integrationError(request, error);
  }
}
