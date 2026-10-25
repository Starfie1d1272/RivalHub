import { afterEach, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { isDeploymentUpdateRequired, preserveLoginUpdateEmail, takeLoginUpdateEmail } from "@/lib/auth/login-update-draft";

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

it("uses Next's official identity and leaves transport or unknown errors unclassified", () => {
  expect(isDeploymentUpdateRequired(new UnrecognizedActionError("fixture"))).toBe(true);
  expect(isDeploymentUpdateRequired(new Error("Server Action was not found"))).toBe(false);
  expect(isDeploymentUpdateRequired({ name: "UnrecognizedActionError" })).toBe(false);
  expect(isDeploymentUpdateRequired(new TypeError("Failed to fetch"))).toBe(false);
});

it("stores only an email and expiry, consumes once, and rejects stale drafts", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  expect(preserveLoginUpdateEmail("local@example.test")).toBe(true);
  const raw = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
  expect(Object.keys(raw).sort()).toEqual(["email", "expiresAt"]);
  expect(takeLoginUpdateEmail()).toBe("local@example.test");
  expect(takeLoginUpdateEmail()).toBeNull();
  preserveLoginUpdateEmail("local@example.test");
  vi.mocked(Date.now).mockReturnValue(1000 + 15 * 60_000);
  expect(takeLoginUpdateEmail()).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it("fails closed for corrupt or unavailable storage", () => {
  const key = "rivalhub:login-update-email";
  sessionStorage.setItem(key, "not-json");
  expect(takeLoginUpdateEmail()).toBeNull();
  expect(sessionStorage.getItem(key)).toBeNull();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("fixture unavailable"); });
  expect(preserveLoginUpdateEmail("local@example.test")).toBe(false);
});
