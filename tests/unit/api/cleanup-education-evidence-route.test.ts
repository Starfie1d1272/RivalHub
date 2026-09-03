import { beforeEach, describe, expect, it, vi } from "vitest";

const purgeExpiredEducationEvidenceMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/education/retention", () => ({
  purgeExpiredEducationEvidence: purgeExpiredEducationEvidenceMock,
}));

import { GET } from "@/app/api/cron/cleanup-education-evidence/route";

describe("education evidence cleanup cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "secret";
  });

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(new Request("http://localhost/api/cron/cleanup-education-evidence"));

    expect(response.status).toBe(401);
    expect(purgeExpiredEducationEvidenceMock).not.toHaveBeenCalled();
  });

  it("returns only the cleared count when authorized", async () => {
    purgeExpiredEducationEvidenceMock.mockResolvedValue(3);

    const response = await GET(
      new Request("http://localhost/api/cron/cleanup-education-evidence", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, cleared: 3 });
    expect(JSON.stringify(body)).not.toContain("ABCD1234EFGH5678");
    expect(purgeExpiredEducationEvidenceMock).toHaveBeenCalledWith();
  });
});
