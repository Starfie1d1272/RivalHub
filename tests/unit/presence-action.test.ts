import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), heartbeat: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: mocks.session }));
vi.mock("@/lib/presence/server", () => ({ heartbeatPresence: mocks.heartbeat }));
import { heartbeatOnline } from "@/actions/online";

beforeEach(() => { vi.clearAllMocks(); });
it("uses only the server-validated identity", async () => {
  mocks.session.mockResolvedValue({ userId: "verified-account" });
  mocks.heartbeat.mockResolvedValue({ count: 1, windowSeconds: 120, intervalMs: 60000 });
  expect(await heartbeatOnline()).toEqual({ count: 1, windowSeconds: 120, intervalMs: 60000 });
  expect(mocks.heartbeat).toHaveBeenCalledWith("verified-account");
});
it("anonymous requests cannot register an account", async () => {
  mocks.session.mockResolvedValue(null);
  await heartbeatOnline();
  expect(mocks.heartbeat).toHaveBeenCalledWith(null);
});
