import { expect, it, vi } from "vitest";
import { logoutAndClearPreviousViews } from "./logout";
const mocks = vi.hoisted(() => ({ logout: vi.fn(), clear: vi.fn() }));
vi.mock("@/actions/auth", () => ({ logoutUser: mocks.logout }));
vi.mock("@/lib/mizar/live-viewer-cache-reset", () => ({ clearPreviousLiveViews: mocks.clear }));
it("clears the shared tab state only after canonical logout succeeds", async () => {
  mocks.logout.mockResolvedValueOnce({ success: false, error: { message: "unavailable" } });
  expect((await logoutAndClearPreviousViews()).success).toBe(false);
  expect(mocks.clear).not.toHaveBeenCalled();
  mocks.logout.mockResolvedValueOnce({ success: true });
  expect((await logoutAndClearPreviousViews()).success).toBe(true);
  expect(mocks.clear).toHaveBeenCalledTimes(1);
});
