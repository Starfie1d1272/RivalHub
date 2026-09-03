import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());
const getCurrentUserAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ db: { select: selectMock } }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUserAuthorization: getCurrentUserAuthorizationMock,
}));
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import {
  getPublicOrAuthorizedDraftSeason,
  getPublicSeasonBySlug,
} from "@/lib/data/public-seasons";

function query(value: unknown) {
  const result = {
    from: vi.fn(() => result),
    where: vi.fn(() => result),
    orderBy: vi.fn(() => result),
    limit: vi.fn(() => result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

const publicSeason = {
  id: "season-1",
  slug: "major",
  status: "playing",
};

const draftSeason = {
  id: "season-1",
  slug: "major",
  status: "draft",
};

describe("public season cache owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserAuthorizationMock.mockResolvedValue(null);
  });

  it("uses an explicit public by-slug lookup and tags it", async () => {
    selectMock.mockImplementationOnce(() => query([publicSeason]));

    await expect(getPublicSeasonBySlug("major")).resolves.toEqual(publicSeason);

    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("does not look up or expose a draft to anonymous viewers", async () => {
    selectMock.mockImplementationOnce(() => query([]));

    await expect(getPublicOrAuthorizedDraftSeason("major")).resolves.toBeNull();

    expect(getCurrentUserAuthorizationMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a draft for an authenticated non-admin", async () => {
    selectMock
      .mockImplementationOnce(() => query([]))
      .mockImplementationOnce(() => query([draftSeason]));
    getCurrentUserAuthorizationMock.mockResolvedValue({
      userId: "user-1",
      email: "user@example.com",
      role: "user",
      seasonIds: [],
    });

    await expect(getPublicOrAuthorizedDraftSeason("major")).resolves.toBeNull();
  });

  it("allows only a season admin or super admin to preview a draft", async () => {
    selectMock
      .mockImplementationOnce(() => query([]))
      .mockImplementationOnce(() => query([draftSeason]));
    getCurrentUserAuthorizationMock.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
      role: "user",
      seasonIds: ["season-1"],
    });

    await expect(getPublicOrAuthorizedDraftSeason("major")).resolves.toEqual(draftSeason);

    selectMock
      .mockImplementationOnce(() => query([]))
      .mockImplementationOnce(() => query([draftSeason]));
    getCurrentUserAuthorizationMock.mockResolvedValue({
      userId: "super-1",
      email: "super@example.com",
      role: "super_admin",
      seasonIds: [],
    });

    await expect(getPublicOrAuthorizedDraftSeason("major")).resolves.toEqual(draftSeason);
  });
});
