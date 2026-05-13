import { beforeEach, describe, expect, it, vi } from "vitest";

const runMatchTimeAutoAwardCronMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/matches", () => ({
  runMatchTimeAutoAwardCron: runMatchTimeAutoAwardCronMock,
}));

import { GET } from "@/app/api/cron/match-time-auto-award/route";

describe("match time auto-award cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "secret";
  });

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(new Request("http://localhost/api/cron/match-time-auto-award"));

    expect(response.status).toBe(401);
    expect(runMatchTimeAutoAwardCronMock).not.toHaveBeenCalled();
  });

  it("runs match time auto-award when authorized", async () => {
    runMatchTimeAutoAwardCronMock.mockResolvedValue({ processed: 1, awarded: 1, skipped: 0 });

    const response = await GET(
      new Request("http://localhost/api/cron/match-time-auto-award", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, processed: 1, awarded: 1, skipped: 0 });
    expect(runMatchTimeAutoAwardCronMock).toHaveBeenCalledWith();
  });
});
