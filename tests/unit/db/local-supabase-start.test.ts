import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { runSupabaseStartup } from "../../../scripts/db/local-supabase-start";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const failed = (stderr: string) => ({ status: 1, signal: null, stderr });
const limited = "failed to pull docker image from all registries: ghcr.io/supabase/cli/auth@sha256:fixture attempt 3: toomanyrequests";
afterEach(() => { vi.restoreAllMocks(); vi.mocked(spawnSync).mockReset(); });

describe("local Supabase image recovery", () => {
  it("reuses the same command and environment after an explicit registry limit", () => {
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(spawnSync).mockReturnValueOnce(failed(limited) as never).mockReturnValueOnce({ status: 0, signal: null } as never);
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", CI: "true" };
    runSupabaseStartup("supabase", ["start", "--exclude", "studio"], environment);
    expect(spawnSync).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawnSync).mock.calls[1]).toEqual(vi.mocked(spawnSync).mock.calls[0]);
    expect(Atomics.wait).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated limits and preserves the final cause", () => {
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(spawnSync).mockReturnValue(failed(`${"progress".repeat(400)}\n${limited}`) as never);
    expect(() => runSupabaseStartup("supabase", ["start"], { NODE_ENV: "test" })).toThrow(limited);
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(vi.mocked(Atomics.wait).mock.calls.map(call => call[3])).toEqual([2000, 4000]);
  });

  it.each(["unhealthy auth container", `${limited}; unauthorized`, "network timeout", "manifest unknown"])("fails immediately for non-recoverable failures: %s", stderr => {
    const wait = vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
    vi.mocked(spawnSync).mockReturnValue(failed(stderr) as never);
    expect(() => runSupabaseStartup("supabase", ["start"], { NODE_ENV: "test" })).toThrow(stderr);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
