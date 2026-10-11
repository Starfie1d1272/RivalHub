import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getIronSession, sealData } from "iron-session";

const mocks = vi.hoisted(() => ({ readSession: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/session-registry", () => ({
  readApplicationSession: mocks.readSession,
  SESSION_MAX_AGE_SECONDS: 2592000,
}));

// Exercise the installed Next runtime-shell contract and the real cookie
// crypto expiry clock. A cookies mock would miss the production regression.
Object.assign(globalThis, { AsyncLocalStorage });
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
const { io: trackClockRead } = await import("next/dist/server/node-environment-extensions/io-utils");
const { cookies } = await import("next/headers");
const { getUserSession } = await import("@/lib/auth/session");
const identity = { userId: "synthetic-user", email: "fixture@example.invalid" };
const payload = { ...identity, sessionId: "11111111-1111-4111-8111-111111111111" };
const password = "synthetic-local-session-password-with-no-production-access";
let sealed: string;
const originalNow = Date.now.bind(Date);

function scope(type: "prerender-runtime" | "request", cookie: string | undefined = sealed) {
  const controller = new AbortController();
  const render = new AbortController();
  const cookieStore = {
    get: vi.fn((name: string) => name === "rivalhub-session" && cookie ? { name, value: cookie } : undefined),
    getAll: () => cookie ? [{ name: "rivalhub-session", value: cookie }] : [],
    set: vi.fn(),
  };
  const work = { route: "/teams", isStaticGeneration: false } as unknown as Parameters<typeof workAsyncStorage.run>[0];
  const unit = { type, phase: "render", cookies: cookieStore, controller, renderSignal: render.signal,
    dynamicTracking: { dynamicAccesses: [], syncDynamicErrorWithStack: null } } as unknown as Parameters<typeof workUnitAsyncStorage.run>[0];
  return { controller, render, cookieStore, run: <T,>(fn: () => T): T => workAsyncStorage.run(work, () => workUnitAsyncStorage.run(unit, fn)) };
}

beforeAll(async () => { sealed = await sealData(payload, { password }); });
beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", password);
  mocks.readSession.mockReset().mockResolvedValue(identity);
  vi.spyOn(Date, "now").mockImplementation(() => {
    trackClockRead("`Date.now()`", "time");
    return originalNow();
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("session request-time boundary", () => {
  it("reproduces cookies resolving in a runtime prerender followed by an expiry clock abort", async () => {
    const s = scope("prerender-runtime");
    const result = await s.run(async () => getIronSession(await cookies(), { password, cookieName: "rivalhub-session" }));
    expect(result).toMatchObject(payload);
    expect(s.controller.signal.aborted).toBe(true);
    expect(Date.now).toHaveBeenCalled();
    expect(mocks.readSession).not.toHaveBeenCalled();
  });
  it("defers canonical session reads before crypto or registry access in a runtime prerender", async () => {
    const s = scope("prerender-runtime");
    let completed = false;
    const result = s.run(() => getUserSession());
    const captured = result.then(() => { completed = true; }, () => { completed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(completed).toBe(false);
    expect(s.controller.signal.aborted).toBe(false);
    expect(s.cookieStore.get).not.toHaveBeenCalled();
    expect(Date.now).not.toHaveBeenCalled();
    expect(mocks.readSession).not.toHaveBeenCalled();
    s.render.abort();
    await captured;
  });
  it("unseals and validates the same cookie against the registry during a real request", async () => {
    const s = scope("request");
    await expect(s.run(() => getUserSession())).resolves.toEqual(identity);
    expect(Date.now).toHaveBeenCalled();
    expect(mocks.readSession).toHaveBeenCalledWith({}, payload.sessionId, payload.userId);
    expect(s.controller.signal.aborted).toBe(false);
    expect(s.cookieStore.set).not.toHaveBeenCalled();
  });
  it("keeps anonymous requests anonymous without a registry lookup", async () => {
    const s = scope("request", "");
    await expect(s.run(() => getUserSession())).resolves.toBeNull();
    expect(mocks.readSession).not.toHaveBeenCalled();
  });
  it("still rejects an actually expired sealed cookie before the registry lookup", async () => {
    vi.mocked(Date.now).mockReturnValue(originalNow() - 3_600_000);
    const expired = await sealData(payload, { password, ttl: 1 });
    vi.mocked(Date.now).mockImplementation(() => {
      trackClockRead("`Date.now()`", "time");
      return originalNow();
    });
    await expect(scope("request", expired).run(() => getUserSession())).resolves.toBeNull();
    expect(mocks.readSession).not.toHaveBeenCalled();
  });
  it("keeps revocation effective after unsealing", async () => {
    mocks.readSession.mockResolvedValueOnce(null);
    await expect(scope("request").run(() => getUserSession())).resolves.toBeNull();
  });
});
