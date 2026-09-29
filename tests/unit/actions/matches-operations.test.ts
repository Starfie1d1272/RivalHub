import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const revokeMizarInstallationMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
}));

vi.mock("@/lib/mizar/installation", () => ({
  revokeMizarInstallation: revokeMizarInstallationMock,
}));

import { disconnectMizar } from "@/actions/matches/operations";

const seasonId = "10000000-0000-4000-8000-000000000001";
const installationId = "20000000-0000-4000-8000-000000000002";

describe("disconnectMizar action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes mizar installation and revalidates matches admin page when caller is season admin", async () => {
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-user-1" });
    revokeMizarInstallationMock.mockResolvedValue(undefined);
    selectMock.mockReturnValue({
      from: () => ({
        where: async () => [{ slug: "major-2026" }],
      }),
    });

    const result = await disconnectMizar(seasonId, installationId);

    expect(result.success).toBe(true);
    expect(revokeMizarInstallationMock).toHaveBeenCalledWith(
      installationId,
      seasonId,
      "admin-user-1",
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/major-2026/matches");
  });

  it("fails with validation error on malformed uuid", async () => {
    const result = await disconnectMizar("invalid-uuid", installationId);
    expect(result.success).toBe(false);
    expect(revokeMizarInstallationMock).not.toHaveBeenCalled();
  });
});
