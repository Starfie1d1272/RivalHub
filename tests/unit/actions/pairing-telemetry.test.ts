import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), mizar: vi.fn(), dak: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/mizar/installation", () => ({ authorizeMizarPairing: mocks.mizar }));
vi.mock("@/lib/demo-integration/pairing", () => ({ authorizeDakPairing: mocks.dak }));
vi.mock("@/lib/action-utils", () => ({
  failValidation: () => ({ success: false, error: { code: "VALIDATION_FAILED", message: "invalid" } }),
  actionError: () => ({ success: false, error: { code: "INTERNAL_ERROR", message: "unknown" } }),
}));
import { authorizeMizarPairingAction } from "@/app/integrations/mizar/connect/actions";
import { authorizeDakPairingAction } from "@/app/integrations/dak/connect/actions";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ userId: "fixture", role: "super_admin", seasonIds: [] }); });
it("returns confirmed pairing success only after the authorized owner completes", async () => {
  const form = new FormData(); form.set("pairingId", crypto.randomUUID()); form.set("competitionId", crypto.randomUUID());
  expect(await authorizeMizarPairingAction(form)).toMatchObject({ success: true });
  expect(mocks.mizar).toHaveBeenCalledWith(form.get("pairingId"), form.get("competitionId"), expect.objectContaining({ role: "super_admin" }));
  mocks.dak.mockRejectedValue(new Error("fixture provider failure"));
  expect(await authorizeDakPairingAction(form)).toMatchObject({ success: false });
});
it("does not reach a pairing owner when authorization is rejected", async () => {
  mocks.auth.mockRejectedValue(new Error("unauthorized"));
  const form = new FormData(); form.set("pairingId", crypto.randomUUID()); form.set("competitionId", crypto.randomUUID());
  expect(await authorizeMizarPairingAction(form)).toMatchObject({ success: false });
  expect(await authorizeDakPairingAction(form)).toMatchObject({ success: false });
  expect(mocks.mizar).not.toHaveBeenCalled(); expect(mocks.dak).not.toHaveBeenCalled();
});
