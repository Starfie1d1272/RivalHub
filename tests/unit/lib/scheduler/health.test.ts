import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock, captureExceptionMock, logEventMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  logEventMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert: insertMock },
}));
vi.mock("@/db/schema", () => ({
  scheduledJobHealth: { jobKey: "job_key" },
}));
vi.mock("@/lib/observability/server", () => ({
  captureException: captureExceptionMock,
  logEvent: logEventMock,
}));

import { isPrimaryHealthy, markBusinessTransition, markJobFailed } from "@/lib/scheduler/health";

describe("scheduler health projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgres://unit.test");
    insertMock.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("requires both a fresh primary trigger and a fresh endpoint success", () => {
    const definition = { staleAfterMs: 3 * 60 * 1000 };
    const now = new Date("2026-09-09T06:00:00.000Z");
    expect(isPrimaryHealthy({
      lastPrimaryTriggeredAt: new Date("2026-09-09T05:59:00.000Z"),
      lastPrimaryEndpointSucceededAt: new Date("2026-09-09T05:59:30.000Z"),
    }, definition, now)).toBe(true);
    expect(isPrimaryHealthy({
      lastPrimaryTriggeredAt: new Date("2026-09-09T05:59:00.000Z"),
      lastPrimaryEndpointSucceededAt: new Date("2026-09-09T05:55:00.000Z"),
    }, definition, now)).toBe(false);
  });

  it("does not create a fake business transition for zero work", async () => {
    await markBusinessTransition("draft-timeout", 0, new Date());

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("stores only a bounded failure classification, never raw exception text", async () => {
    await markJobFailed(
      "cleanup-education-evidence",
      "supabase-primary",
      new Error("Authorization: Bearer super-secret-token"),
      new Date("2026-09-09T06:00:00.000Z"),
    );

    const values = insertMock.mock.results[0]?.value.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.lastFailureSource).toBe("supabase-primary");
    expect(values.lastFailureCode).toBe("application");
    expect(JSON.stringify(values)).not.toContain("super-secret-token");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
