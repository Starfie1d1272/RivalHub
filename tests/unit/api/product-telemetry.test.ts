import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorization: vi.fn(), bootstrap: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserAuthorization: mocks.authorization }));
vi.mock("@/lib/telemetry/server", () => ({ telemetryBootstrap: mocks.bootstrap }));
import { POST } from "@/app/api/product-telemetry/route";
const request = () => new Request("https://app.invalid/api/product-telemetry", { method: "POST", headers: { origin: "https://app.invalid" } });
beforeEach(() => { vi.stubEnv("PRODUCT_TELEMETRY_ORIGIN", "https://app.invalid"); });

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("does no auth work while telemetry is disabled", async () => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "0");
  const response = await POST(request());
  expect(await response.json()).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.authorization).not.toHaveBeenCalled();
});
it("derives renewal identity and role from current server authorization, never a client claim", async () => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "1");
  mocks.authorization.mockResolvedValue({ userId: "current-user", role: "user", seasonIds: ["season"] });
  mocks.bootstrap.mockResolvedValue({ ticket: "ingest-only" });
  expect(await (await POST(request())).json()).toEqual({ ticket: "ingest-only" });
  expect(mocks.bootstrap).toHaveBeenCalledWith({ userId: "current-user", isAdmin: true, isSuperAdmin: false });
  mocks.authorization.mockResolvedValue(null);
  await POST(request()); expect(mocks.bootstrap).toHaveBeenLastCalledWith(null);
});
it("allows bounded client retry after transient authorization failure without exposing its message", async () => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "1");
  mocks.authorization.mockRejectedValue(new Error("private failure"));
  const response = await POST(request());
  expect(response.status).toBe(503); expect(await response.text()).toBe("");
  expect(mocks.bootstrap).not.toHaveBeenCalled();
});

it("rejects cross-origin renewal before reading any authorization", async () => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "1");
  const response = await POST(new Request("https://app.invalid/api/product-telemetry", { method: "POST", headers: { origin: "https://foreign.invalid" } }));
  expect(response.status).toBe(403); expect(mocks.authorization).not.toHaveBeenCalled();
});

it("renews behind a loopback proxy using the configured public origin", async () => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "1");
  mocks.authorization.mockResolvedValue(null); mocks.bootstrap.mockResolvedValue({ ticket: "ingest-only" });
  const response = await POST(new Request("http://127.0.0.1:3032/api/product-telemetry", { method: "POST", headers: { origin: "https://app.invalid" } }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ticket: "ingest-only" });
});

it("rejects internal and forged forwarded origins before reading authorization", async () => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "1");
  for (const origin of ["http://127.0.0.1:3032", "https://foreign.invalid", "null", ""]) {
    const response = await POST(new Request("http://127.0.0.1:3032/api/product-telemetry", { method: "POST", headers: { origin, "x-forwarded-host": "foreign.invalid", "x-forwarded-proto": "https" } }));
    expect(response.status).toBe(403);
  }
  expect(mocks.authorization).not.toHaveBeenCalled();
});

it.each(["", "invalid", "http://app.invalid", "https://app.invalid/path", "https://app.invalid?private=1", "https://user:secret@app.invalid"])("fails closed for invalid origin configuration %s", async value => {
  vi.stubEnv("PRODUCT_TELEMETRY_ENABLED", "1"); vi.stubEnv("PRODUCT_TELEMETRY_ORIGIN", value);
  expect((await POST(request())).status).toBe(403); expect(mocks.authorization).not.toHaveBeenCalled();
});
