import { describe, expect, it, vi } from "vitest";
import { submitSnapshot } from "../../../scripts/dependencies/submit.mjs";

const sha = "a".repeat(40);
const ref = "refs/heads/main";
const repository = "Starfie1d1272/RivalHub";
const eventName = "push";
function snapshot() {
  return {
    version: 0, sha, ref,
    job: { correlator: "rivalhub-pnpm-lockfile" },
    detector: { name: "rivalhub-pnpm-lockfile" },
    manifests: { "pnpm-lock.yaml": {
      file: { source_location: "pnpm-lock.yaml" },
      resolved: { "pkg:npm/react@19.3.0": { package_url: "pkg:npm/react@19.3.0" } },
    } },
  };
}

describe("main dependency submission boundary", () => {
  it("submits the exact snapshot only after checking current main and retains the receipt", async () => {
    const source = snapshot();
    const request = vi.fn().mockResolvedValueOnce({ object: { sha } }).mockResolvedValueOnce({ id: 42, result: "SUCCESS" });
    await expect(submitSnapshot({ snapshot: source, sha, ref, eventName, repository, request }))
      .resolves.toEqual({ sourceSha: sha, sourceRef: ref, submissionId: 42, result: "SUCCESS" });
    expect(request.mock.calls).toEqual([
      ["GET", `/repos/${repository}/git/ref/heads/main`],
      ["POST", `/repos/${repository}/dependency-graph/snapshots`, source],
    ]);
  });

  it("never writes a snapshot when main has advanced or the ref lookup fails", async () => {
    for (const request of [
      vi.fn().mockResolvedValue({ object: { sha: "b".repeat(40) } }),
      vi.fn().mockRejectedValue(new Error("HTTP 403")),
    ]) {
      await expect(submitSnapshot({ snapshot: snapshot(), sha, ref, eventName, repository, request })).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][0]).toBe("GET");
    }
  });

  it("rejects PR identity, a mismatched source and incomplete artifacts before any API access", async () => {
    const invalid = [
      { eventName: "pull_request_target" },
      { eventName: "pull_request" },
      { ref: "refs/pull/493/head", snapshot: { ...snapshot(), ref: "refs/pull/493/head" } },
      { snapshot: { ...snapshot(), sha: "b".repeat(40) } },
      { snapshot: { ...snapshot(), job: { correlator: "other-detector" } } },
      { snapshot: { ...snapshot(), manifests: {} } },
      { snapshot: { ...snapshot(), manifests: { "pnpm-lock.yaml": { resolved: {} } } } },
    ];
    for (const overrides of invalid) {
      const request = vi.fn();
      await expect(submitSnapshot({ snapshot: snapshot(), sha, ref, eventName, repository, request, ...overrides })).rejects.toThrow(/exact main source/);
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("requires SUCCESS because ACCEPTED does not update the repository graph", async () => {
    for (const receipt of [{ id: 42, result: "ACCEPTED" }, { id: 42, result: "INVALID" }, { result: "SUCCESS" }]) {
      const request = vi.fn().mockResolvedValueOnce({ object: { sha } }).mockResolvedValueOnce(receipt);
      await expect(submitSnapshot({ snapshot: snapshot(), sha, ref, eventName, repository, request })).rejects.toThrow(/did not confirm/);
    }
  });
});
