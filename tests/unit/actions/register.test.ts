import { beforeEach, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { createFakeSeason, mockUserSession } from "tests/helpers";

const mocks = vi.hoisted(() => ({ season: vi.fn(), draft: vi.fn(), session: vi.fn(), window: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { seasons: { findFirst: mocks.season }, registrationDrafts: { findFirst: mocks.draft } } } }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: mocks.session }));
vi.mock("@/lib/registration/window", () => ({ getRegistrationWindowState: mocks.window }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { loadRegistrationDraft, submitRegistration } from "@/actions/register";

const SEASON_ID = "11111111-1111-1111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";


beforeEach(() => { vi.clearAllMocks(); });

it("未登录不能提交报名", async () => {
  mocks.season.mockResolvedValue(createFakeSeason({ id: SEASON_ID, registrationMode: "solo" }));
  mocks.window.mockReturnValue({ canSubmit: true });
  mocks.session.mockResolvedValue(null);
  const result = await submitRegistration({ seasonId: SEASON_ID } as never);
  expect(result).toMatchObject({ success: false, error: { code: ErrorCode.UNAUTHORIZED } });
});

it("只允许读取当前登录账号的报名草稿", async () => {
  mocks.session.mockResolvedValue(mockUserSession({ userId: USER_ID, email: "player@example.test" }));
  const result = await loadRegistrationDraft(SEASON_ID, "other@example.test");
  expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
  expect(mocks.season).not.toHaveBeenCalled();
  expect(mocks.draft).not.toHaveBeenCalled();
});
