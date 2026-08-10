import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const dbInsertMock = vi.hoisted(() => vi.fn());
const insertValuesMock = vi.hoisted(() => vi.fn());
const onConflictDoNothingMock = vi.hoisted(() => vi.fn());
const returningMock = vi.hoisted(() => vi.fn());
const hashPasswordMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({
  db: { insert: dbInsertMock },
}));

vi.mock("@/lib/utils/password", () => ({
  hashPassword: hashPasswordMock,
}));

// ── import after mocks ─────────────────────────────────────────────────────────
import { seed } from "@/db/seed";

// ── helpers ─────────────────────────────────────────────────────────────────────
function clearRootEnv() {
  delete process.env.RIVALHUB_ROOT_USERNAME;
  delete process.env.RIVALHUB_ROOT_PASSWORD;
}

function setupInsertChain(returningResult: unknown[] = [{ id: "root-1" }]) {
  dbInsertMock.mockReturnValue({ values: insertValuesMock });
  insertValuesMock.mockReturnValue({ onConflictDoNothing: onConflictDoNothingMock });
  onConflictDoNothingMock.mockReturnValue({ returning: returningMock });
  returningMock.mockResolvedValue(returningResult);
}

function captureLogs() {
  return vi.spyOn(console, "log").mockImplementation(() => {});
}

describe("seed root admin (RIVALHUB_ROOT_*)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRootEnv();
    hashPasswordMock.mockImplementation((p: string) => `hash:${p}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("production + both env missing → reject, no insert", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setupInsertChain();

    await expect(seed()).rejects.toThrow(
      /RIVALHUB_ROOT_USERNAME and RIVALHUB_ROOT_PASSWORD/,
    );
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("production + one env missing → reject, no insert", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RIVALHUB_ROOT_USERNAME = "root";
    setupInsertChain();

    await expect(seed()).rejects.toThrow(
      /RIVALHUB_ROOT_USERNAME and RIVALHUB_ROOT_PASSWORD must both be set/,
    );
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("production + one env missing (password side) → reject, no insert", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RIVALHUB_ROOT_PASSWORD = "s3cret";
    setupInsertChain();

    await expect(seed()).rejects.toThrow(/must both be set/);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("development + both env missing → skip insert with message", async () => {
    vi.stubEnv("NODE_ENV", "development");
    setupInsertChain();
    const logSpy = captureLogs();

    await expect(seed()).resolves.toBeUndefined();
    expect(dbInsertMock).not.toHaveBeenCalled();

    const logs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logs).toContain("Root admin seed skipped:");
    expect(logs).toContain("RIVALHUB_ROOT_USERNAME");
    expect(logs).toContain("RIVALHUB_ROOT_PASSWORD");
  });

  it("development + one env set → reject as config error", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.RIVALHUB_ROOT_USERNAME = "root";
    setupInsertChain();

    await expect(seed()).rejects.toThrow(/must both be set/);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("both env present → insert with explicit username + hashed password", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.RIVALHUB_ROOT_USERNAME = "custom_root";
    process.env.RIVALHUB_ROOT_PASSWORD = "hunter2-secret";
    setupInsertChain();
    captureLogs();

    await expect(seed()).resolves.toBeUndefined();

    expect(dbInsertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith({
      username: "custom_root",
      passwordHash: "hash:hunter2-secret",
      role: "super_admin",
    });
    expect(hashPasswordMock).toHaveBeenCalledWith("hunter2-secret");
  });

  it("root already exists → skip (idempotent), no overwrite", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.RIVALHUB_ROOT_USERNAME = "custom_root";
    process.env.RIVALHUB_ROOT_PASSWORD = "hunter2-secret";
    setupInsertChain([]); // onConflictDoNothing → no row returned
    captureLogs();

    await expect(seed()).resolves.toBeUndefined();
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
  });

  it("success logs never contain plaintext password", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RIVALHUB_ROOT_USERNAME = "custom_root";
    process.env.RIVALHUB_ROOT_PASSWORD = "hunter2-secret";
    setupInsertChain();
    const logSpy = captureLogs();

    await expect(seed()).resolves.toBeUndefined();

    const logs = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logs).toContain("Created root admin: custom_root");
    expect(logs).not.toContain("hunter2-secret");
    expect(logs).not.toContain("RivalHub_password");
  });

  it("empty password string counts as missing → production reject", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.RIVALHUB_ROOT_USERNAME = "root";
    process.env.RIVALHUB_ROOT_PASSWORD = "";
    setupInsertChain();

    await expect(seed()).rejects.toThrow(/must both be set/);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });
});
