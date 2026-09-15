import { describe, expect, it, vi } from "vitest";
import {
  runReleaseRouting,
  type ReleaseRoutingOptions,
} from "../../../scripts/release/routing";

const CANONICAL_HOST = "match.starfie1d.top";
const CANDIDATE_HOST = "rivalhub-release.vercel.app";
const PROJECT_ID = "prj_test";
const ORG_ID = "team_test";
const TOKEN = "project-scoped-test-token";
const PREVIOUS_DEPLOYMENT_ID = "dpl_previous";
const CANDIDATE_DEPLOYMENT_ID = "dpl_candidate";
const PREVIOUS_COMMIT = "a".repeat(40);
const CANDIDATE_COMMIT = "b".repeat(40);

type SequenceValue = unknown | Response | Error;

interface Scenario {
  canonical:
    | SequenceValue[]
    | ((readIndex: number, rollbackStarted: boolean) => SequenceValue);
  alias?: SequenceValue[];
  promote?: SequenceValue[];
  rollback?: SequenceValue[];
  deployments?: Record<string, SequenceValue>;
}

interface RequestRecord {
  url: string;
  method: string;
  headers: Headers;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function aliasState(deploymentId: string, jobStatus: string): Record<string, unknown> {
  return { lastAliasRequest: { jobStatus, toDeploymentId: deploymentId } };
}

function identity(releaseTag: string, releaseCommit: string): Record<string, string> {
  return { releaseTag, releaseCommit };
}

function deployment(host: string, id: string): Record<string, string> {
  return {
    id,
    projectId: PROJECT_ID,
    // Vercel resolves a custom domain to the deployment, while `url` remains
    // the deployment's generated hostname.
    url: host === CANONICAL_HOST ? "rivalhub-previous.vercel.app" : host,
    target: "production",
    readyState: "READY",
  };
}

function materialize(value: SequenceValue): Response {
  if (value instanceof Error) throw value;
  if (value instanceof Response) return value.clone();
  return jsonResponse(value);
}

function createHarness(scenario: Scenario) {
  const calls: RequestRecord[] = [];
  const summaries: string[] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const canonicalValues = Array.isArray(scenario.canonical) ? scenario.canonical : undefined;
  const aliasValues = scenario.alias ?? [aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded")];
  const promoteValues = scenario.promote ?? [jsonResponse({}, 202)];
  const rollbackValues = scenario.rollback ?? [jsonResponse({}, 202)];
  let canonicalIndex = 0;
  let aliasIndex = 0;
  let promoteIndex = 0;
  let rollbackIndex = 0;
  let rollbackStarted = false;
  let clock = 0;

  const nextValue = (values: SequenceValue[], index: number): SequenceValue =>
    values[index] ?? values[values.length - 1];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init?.headers) });
    const parsed = new URL(url);

    if (method === "POST" && parsed.pathname.includes("/rollback/")) {
      rollbackStarted = true;
      const value = nextValue(rollbackValues, rollbackIndex);
      rollbackIndex += 1;
      return materialize(value);
    }
    if (method === "POST" && parsed.pathname.includes("/promote/")) {
      const value = nextValue(promoteValues, promoteIndex);
      promoteIndex += 1;
      return materialize(value);
    }
    if (parsed.hostname === "api.vercel.com" && parsed.pathname.startsWith("/v13/deployments/")) {
      const host = decodeURIComponent(parsed.pathname.slice("/v13/deployments/".length));
      const value =
        scenario.deployments?.[host] ??
        (host === CANONICAL_HOST
          ? deployment(CANONICAL_HOST, PREVIOUS_DEPLOYMENT_ID)
          : deployment(CANDIDATE_HOST, CANDIDATE_DEPLOYMENT_ID));
      return materialize(value);
    }
    if (parsed.hostname === "api.vercel.com" && parsed.pathname.startsWith("/v9/projects/")) {
      const value = nextValue(aliasValues, aliasIndex);
      aliasIndex += 1;
      return materialize(value);
    }
    if (parsed.hostname === CANONICAL_HOST && parsed.pathname === "/") {
      return jsonResponse({});
    }
    if (parsed.hostname === CANONICAL_HOST && parsed.pathname === "/api/system/release") {
      const value = Array.isArray(scenario.canonical)
        ? nextValue(canonicalValues ?? [], canonicalIndex)
        : scenario.canonical(canonicalIndex, rollbackStarted);
      canonicalIndex += 1;
      return materialize(value);
    }
    throw new Error("unexpected request: " + url);
  });

  const options: ReleaseRoutingOptions = {
    candidateDeploymentUrl: "https://" + CANDIDATE_HOST,
    releaseTag: "v2.9.5",
    releaseCommit: CANDIDATE_COMMIT,
    canonicalBaseUrl: "https://" + CANONICAL_HOST,
    vercelToken: TOKEN,
    vercelOrgId: ORG_ID,
    vercelProjectId: PROJECT_ID,
    fetchFn,
    sleepFn: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += Math.max(1, milliseconds);
    },
    nowFn: () => clock,
    logFn: (message) => logs.push(message),
    errorFn: (message) => logs.push("error: " + message),
    summaryFn: (markdown) => summaries.push(markdown),
    pollIntervalMs: 10,
    providerRoutingTimeoutMs: 30,
    semanticConvergenceTimeoutMs: 30,
    ambiguousReconciliationTimeoutMs: 30,
    requestTimeoutMs: 1_000,
    transportRetryAttempts: 3,
    transportRetryDelayMs: 1,
  };

  return { calls, fetchFn, logs, options, sleeps, summaries };
}

function requestCount(harness: ReturnType<typeof createHarness>, fragment: string): number {
  return harness.calls.filter((call) => call.url.includes(fragment)).length;
}

describe("release routing controller", () => {
  it("promotes and waits for canonical semantic convergence without rollback", async () => {
    const harness = createHarness({
      canonical: [
        identity("v2.9.4", PREVIOUS_COMMIT),
        identity("v2.9.5", CANDIDATE_COMMIT),
      ],
    });

    await expect(runReleaseRouting(harness.options)).resolves.toMatchObject({
      candidateDeploymentId: CANDIDATE_DEPLOYMENT_ID,
      previousDeploymentId: PREVIOUS_DEPLOYMENT_ID,
      promotionOutcome: "accepted",
      aliasPolls: 1,
      canonicalPolls: 1,
    });
    expect(requestCount(harness, "/promote/")).toBe(1);
    expect(requestCount(harness, "/rollback/")).toBe(0);
    expect(harness.summaries[0]).toContain("rollback compensation:");
  });

  it("separates bounded transport retry from canonical semantic polling", async () => {
    const harness = createHarness({
      canonical: (readIndex) => {
        if (readIndex === 0) return identity("v2.9.4", PREVIOUS_COMMIT);
        if (readIndex === 1) return new Error("socket reset");
        if (readIndex === 2) return jsonResponse({ secret: "must-not-be-logged" }, 503);
        return identity("v2.9.5", CANDIDATE_COMMIT);
      },
    });

    await expect(runReleaseRouting(harness.options)).resolves.toMatchObject({
      promotionOutcome: "accepted",
    });
    expect(requestCount(harness, "/api/system/release")).toBe(4);
    expect(requestCount(harness, "/rollback/")).toBe(0);
    expect(harness.summaries[0]).not.toContain("must-not-be-logged");
  });

  it("treats a valid old identity as not_converged and compensates after deadline", async () => {
    const harness = createHarness({
      canonical: () => identity("v2.9.4", PREVIOUS_COMMIT),
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "convergence_timeout" },
    });
    expect(requestCount(harness, "/promote/")).toBe(1);
    expect(requestCount(harness, "/rollback/")).toBe(1);
    expect(harness.summaries[0]).toContain("rollback compensation:");
    expect(harness.summaries[0]).toContain("verified");
  });

  it("fails hard on canonical auth errors without retrying the read", async () => {
    const harness = createHarness({
      canonical: (readIndex, rollbackStarted) => {
        if (rollbackStarted) return identity("v2.9.4", PREVIOUS_COMMIT);
        if (readIndex === 0) return identity("v2.9.4", PREVIOUS_COMMIT);
        return jsonResponse({}, 401);
      },
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "hard_auth" },
    });
    expect(requestCount(harness, "/api/system/release")).toBe(3);
    expect(requestCount(harness, "/rollback/")).toBe(1);
  });

  it("reconciles an ambiguous promote outcome and does not repeat the POST", async () => {
    const harness = createHarness({
      canonical: [
        identity("v2.9.4", PREVIOUS_COMMIT),
        identity("v2.9.5", CANDIDATE_COMMIT),
      ],
      promote: [new Error("request timed out")],
      alias: [aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded")],
    });

    await expect(runReleaseRouting(harness.options)).resolves.toMatchObject({
      promotionOutcome: "reconciled",
    });
    expect(requestCount(harness, "/promote/")).toBe(1);
    expect(requestCount(harness, "/rollback/")).toBe(0);
    expect(harness.logs.some((line) => line.includes("不重复 side-effect POST"))).toBe(true);
  });

  it("keeps an ambiguous promote to one POST when stale previous becomes candidate", async () => {
    const harness = createHarness({
      canonical: [
        identity("v2.9.4", PREVIOUS_COMMIT),
        identity("v2.9.5", CANDIDATE_COMMIT),
      ],
      promote: [new Error("request timed out")],
      alias: [
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).resolves.toMatchObject({
      promotionOutcome: "reconciled",
    });
    expect(requestCount(harness, "/promote/")).toBe(1);
  });

  it("keeps an ambiguous promote to one POST when previous repeats before candidate appears", async () => {
    const harness = createHarness({
      canonical: [
        identity("v2.9.4", PREVIOUS_COMMIT),
        identity("v2.9.5", CANDIDATE_COMMIT),
      ],
      promote: [new Error("request timed out")],
      alias: [
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).resolves.toMatchObject({
      promotionOutcome: "reconciled",
    });
    expect(requestCount(harness, "/promote/")).toBe(1);
    expect(requestCount(harness, "/rollback/")).toBe(0);
  });

  it("retries a rate-limited mutation with bounded backoff", async () => {
    const harness = createHarness({
      canonical: [
        identity("v2.9.4", PREVIOUS_COMMIT),
        identity("v2.9.5", CANDIDATE_COMMIT),
      ],
      promote: [
        jsonResponse({}, 429, { "retry-after": "0" }),
        jsonResponse({}, 202),
      ],
    });

    await expect(runReleaseRouting(harness.options)).resolves.toMatchObject({
      promotionOutcome: "retried",
    });
    expect(requestCount(harness, "/promote/")).toBe(2);
    expect(harness.sleeps).toContain(0);
  });

  it("compensates when the provider alias job explicitly fails", async () => {
    const harness = createHarness({
      canonical: [identity("v2.9.4", PREVIOUS_COMMIT)],
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "failed"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "provider_contract" },
    });
    expect(requestCount(harness, "/promote/")).toBe(1);
    expect(requestCount(harness, "/rollback/")).toBe(1);
    expect(harness.summaries[0]).toContain("verified");
  });

  it("fails closed before promote when previous deployment identity is missing", async () => {
    const harness = createHarness({
      canonical: [identity("v2.9.4", PREVIOUS_COMMIT)],
      deployments: {
        [CANONICAL_HOST]: {
          projectId: PROJECT_ID,
          url: CANONICAL_HOST,
          target: "production",
          readyState: "READY",
        },
      },
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "provider_contract" },
    });
    expect(requestCount(harness, "/promote/")).toBe(0);
    expect(requestCount(harness, "/rollback/")).toBe(0);
  });

  it("waits for previous identity to return after accepted rollback", async () => {
    let rollbackReads = 0;
    const harness = createHarness({
      canonical: (_readIndex, rollbackStarted) => {
        if (!rollbackStarted) return identity("v2.9.4", PREVIOUS_COMMIT);
        rollbackReads += 1;
        return rollbackReads === 1
          ? identity("v2.9.5", CANDIDATE_COMMIT)
          : identity("v2.9.4", PREVIOUS_COMMIT);
      },
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "convergence_timeout" },
    });
    expect(harness.summaries[0]).toContain("verified");
    expect(rollbackReads).toBe(2);
  });

  it("reports rollback_failed when routing succeeds but previous identity never returns", async () => {
    const harness = createHarness({
      canonical: (_readIndex, rollbackStarted) =>
        rollbackStarted
          ? identity("v2.9.5", CANDIDATE_COMMIT)
          : identity("v2.9.4", PREVIOUS_COMMIT),
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "rollback_failed" },
    });
    expect(harness.summaries[0]).toContain("rollback compensation:");
    expect(harness.summaries[0]).toContain("manual intervention: required");
  });

  it("keeps accepted promotion outcome when semantic convergence fails", async () => {
    const harness = createHarness({
      canonical: () => identity("v2.9.4", PREVIOUS_COMMIT),
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "convergence_timeout" },
    });
    expect(harness.summaries[0]).toContain("promotion outcome: " + "\u0060accepted\u0060");
    expect(harness.summaries[0]).not.toContain("promotion outcome: " + "\u0060failed\u0060");
  });

  it("treats a malformed release identity payload as deterministic contract failure", async () => {
    const harness = createHarness({
      canonical: (readIndex, rollbackStarted) => {
        if (rollbackStarted) return identity("v2.9.4", PREVIOUS_COMMIT);
        if (readIndex === 0) return identity("v2.9.4", PREVIOUS_COMMIT);
        return { releaseTag: "v2.9.5" };
      },
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "provider_contract" },
    });
    expect(requestCount(harness, "/rollback/")).toBe(1);
    expect(harness.summaries[0]).toContain("verified");
  });

  it("sends the Vercel token only to provider API requests", async () => {
    const harness = createHarness({
      canonical: [
        identity("v2.9.4", PREVIOUS_COMMIT),
        identity("v2.9.5", CANDIDATE_COMMIT),
      ],
    });

    await runReleaseRouting(harness.options);
    const canonicalRequest = harness.calls.find((call) =>
      call.url.includes("/api/system/release"),
    );
    const providerRequest = harness.calls.find((call) =>
      call.url.includes("/v13/deployments/"),
    );
    expect(canonicalRequest?.headers.has("authorization")).toBe(false);
    expect(providerRequest?.headers.get("authorization")).toBe("Bearer " + TOKEN);
  });

  it("aborts a never-resolving canonical request at the request-level timeout", async () => {
    const harness = createHarness({
      canonical: [identity("v2.9.4", PREVIOUS_COMMIT)],
      alias: [
        aliasState(CANDIDATE_DEPLOYMENT_ID, "succeeded"),
        aliasState(PREVIOUS_DEPLOYMENT_ID, "succeeded"),
      ],
    });
    const delegate = harness.options.fetchFn as typeof fetch;
    let releaseReadCount = 0;
    let abortedRequests = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("/api/system/release")) {
        if (releaseReadCount === 0 || harness.calls.some((call) => call.url.includes("/rollback/"))) {
          releaseReadCount += 1;
          return delegate(input, init);
        }
        releaseReadCount += 1;
        return new Promise<Response>((_, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("request signal missing"));
            return;
          }
          const onAbort = () => {
            abortedRequests += 1;
            reject(new Error("aborted"));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        });
      }
      return delegate(input, init);
    });
    harness.options.fetchFn = fetchFn;
    harness.options.requestTimeoutMs = 5;

    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { classification: "convergence_timeout" },
    });
    expect(abortedRequests).toBeGreaterThan(0);
    expect(requestCount(harness, "/rollback/")).toBe(1);
    expect(harness.summaries[0]).toContain("verified");
  });
});
