import { beforeEach, describe, expect, it, vi } from "vitest";

const runDraftTimeoutCronMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/draft", () => ({
  runDraftTimeoutCron: runDraftTimeoutCronMock,
}));

import { GET } from "@/app/api/cron/draft-timeout/route";

describe("draft timeout cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "secret";
  });

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(new Request("http://localhost/api/cron/draft-timeout"));

    expect(response.status).toBe(401);
    expect(runDraftTimeoutCronMock).not.toHaveBeenCalled();
  });

  it("runs auto pick when authorized", async () => {
    runDraftTimeoutCronMock.mockResolvedValue({ processed: 1, picked: 1, skipped: 0 });

    const response = await GET(
      new Request("http://localhost/api/cron/draft-timeout", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, processed: 1, picked: 1, skipped: 0 });
    expect(runDraftTimeoutCronMock).toHaveBeenCalledWith();
  });
});
