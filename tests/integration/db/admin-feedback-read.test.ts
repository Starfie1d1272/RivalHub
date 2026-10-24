import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";
import { getFeedbackAdminPage, getFeedbackForAdmin } from "@/lib/feedback/read-model";
import { readFeedbackDetail } from "@/actions/feedback";
import { AppError, ErrorCode } from "@/lib/errors";

const authorize = vi.hoisted(() => vi.fn().mockResolvedValue({ role: "super_admin" }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: authorize, getUserSession: vi.fn(), auditActorId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

it("pages safe summaries and reauthorizes full detail without a list scan", async () => {
  const pool = createLocalPool();
  const ids = Array.from({ length: 65 }, () => randomUUID());
  const body = "完整中文反馈".repeat(600).slice(0, 4000);
  const deletedUser = randomUUID();
  const fingerprint = `private-fingerprint-${randomUUID()}`;
  const filter = { category: "content_correction" as const };
  const baseline = await getFeedbackAdminPage(filter);
  try {
    for (const [i, id] of ids.entries()) await pool.query(`insert into feedback_reports (id,category,body,body_fingerprint,pathname,release_version,status,created_at)
      values ($1,'content_correction',$2,$3,'/rules','fixture',$4,'2051-01-01T00:00:00Z')`, [id, body, fingerprint, i % 2 === 0 ? "new" : "resolved"]);
    const first = await getFeedbackAdminPage(filter);
    expect(first.total).toBe(baseline.total + 65);
    expect(first.rows.map(row => row.id)).toEqual([...ids].sort((a, b) => b.localeCompare(a)).slice(0, 25));
    expect(first.rows).toHaveLength(25);
    for (const row of first.rows) {
      expect(row.bodySummary.length).toBeLessThanOrEqual(160);
      expect(row).not.toHaveProperty("body");
    }
    expect(JSON.stringify(first)).not.toContain(fingerprint);
    const resolved = await getFeedbackAdminPage({ ...filter, status: "resolved" });
    expect(resolved.rows.every(row => row.status === "resolved")).toBe(true);
    const clamped = await getFeedbackAdminPage({ ...filter, page: 999 });
    expect(clamped.page).toBe(clamped.totalPages);
    await pool.query("insert into users(id,email,display_name) values($1,$2,'安全显示名')", [deletedUser, `${deletedUser}@fixture.test`]);
    await pool.query("update feedback_reports set user_id=$1 where id=$2", [deletedUser, ids[0]]);
    expect(await getFeedbackForAdmin(ids[0]!)).toMatchObject({ userId: deletedUser, userLabel: "安全显示名" });
    await pool.query("delete from users where id=$1", [deletedUser]);
    expect(await getFeedbackForAdmin(ids[0]!)).toMatchObject({ userId: null, userLabel: null, body });
    const detail = await getFeedbackForAdmin(ids[0]!);
    expect(detail?.body).toBe(body);
    expect(detail).not.toHaveProperty("bodyFingerprint");
    expect(await getFeedbackForAdmin(randomUUID())).toBeNull();
    authorize.mockClear();
    expect(await readFeedbackDetail(ids[0]!)).toMatchObject({ success: true, data: { body } });
    expect(authorize).toHaveBeenCalledOnce();
    authorize.mockRejectedValueOnce(new AppError(ErrorCode.FORBIDDEN, "需要超级管理员"));
    expect(await readFeedbackDetail(ids[0]!)).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
  } finally {
    await pool.query("delete from feedback_reports where id=any($1::uuid[])", [ids]);
    await pool.query("delete from users where id=$1", [deletedUser]);
    await pool.end();
  }
});
