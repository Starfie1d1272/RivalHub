import { afterEach, describe, expect, it, vi } from "vitest";
import { promoteLinux, verifyCanonical, verifyIdentity } from "../../../scripts/release/linux-routing";

function harness() {
  return {
    assertCapabilities: vi.fn(), verifyPrevious: vi.fn(async () => {}),
    deploy: vi.fn(async () => {}), verifyCandidate: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}), verifyRollback: vi.fn(async () => {}),
  };
}

describe("Linux deployment recovery", () => {
  it("does not mutate when canonical previous identity has drifted", async () => {
    const deps = harness();
    deps.verifyPrevious.mockRejectedValue(new Error("drift"));
    await expect(promoteLinux(deps)).rejects.toThrow("drift");
    expect(deps.deploy).not.toHaveBeenCalled();
    expect(deps.rollback).not.toHaveBeenCalled();
  });
  it.each(["deploy", "verifyCandidate"] as const)("reconciles %s failure and verifies the old identity", async stage => {
    const deps = harness();
    deps[stage].mockRejectedValue(new Error("connection reset"));
    await expect(promoteLinux(deps)).rejects.toThrow("previous production identity restored");
    expect(deps.assertCapabilities).toHaveBeenCalledTimes(2);
    expect(deps.rollback).toHaveBeenCalledOnce();
    expect(deps.verifyRollback).toHaveBeenCalledOnce();
  });
  it("blocks compensation when capability evidence becomes unavailable", async () => {
    const deps = harness();
    deps.deploy.mockRejectedValue(new Error("lost SSH"));
    deps.assertCapabilities.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error("capability unavailable"); });
    await expect(promoteLinux(deps)).rejects.toThrow("capability unavailable");
    expect(deps.rollback).not.toHaveBeenCalled();
  });
  it("retains failed status if rollback cannot be verified", async () => {
    const deps = harness();
    deps.verifyCandidate.mockRejectedValue(new Error("wrong identity"));
    deps.verifyRollback.mockRejectedValue(new Error("unavailable"));
    await expect(promoteLinux(deps)).rejects.toThrow("rollback unverified");
  });
});


describe("canonical verification", () => {
  const identity = { releaseTag: "v2.24.12", releaseCommit: "a".repeat(40) };
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("verifies previous identity without requiring the homepage", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(identity)));
    vi.stubGlobal("fetch", fetch);
    await expect(verifyIdentity(identity)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toContain("/api/system/release");
  });

  it("rejects a different previous identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...identity, releaseTag: "v2.24.11" }))));
    await expect(verifyIdentity(identity)).rejects.toThrow("identity differs");
  });

  it("requires a healthy homepage after identity verification", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(120_000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(identity))).mockResolvedValueOnce(new Response(null, { status: 503 })));
    await expect(verifyCanonical(identity)).rejects.toThrow("Canonical homepage HTTP 503");
  });
});
