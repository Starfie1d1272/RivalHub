import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  runReleaseRouting,
  assertRoutingCapabilities,
  type ReleaseRoutingOptions,
} from "../../../scripts/release/routing";

const CANONICAL_HOST = "match.starfie1d.top";
const CANDIDATE_HOST = "rivalhub-release.vercel.app";
const PROJECT_ID = "prj_test";
const ORG_ID = "team_test";
const TOKEN = "project-scoped-test-token";
const PREVIOUS_DEPLOYMENT_ID = "dpl_previous";
const CANDIDATE_DEPLOYMENT_ID = "dpl_candidate";
let PREVIOUS_COMMIT: string;
let CANDIDATE_COMMIT: string;
let sourceRoot: string;
const git = (args: string[]) => execFileSync("git", args, { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = () => { git(["add", "."]); git(["commit", "--quiet", "-m", "routing capability fixture"]); return git(["rev-parse", "HEAD"]); };
const lifecycleCommit = (readerVersion: number, publisherVersion: number) => {
  mkdirSync(join(sourceRoot, "src/lib/matches/veto-room"), { recursive: true });
  writeFileSync(join(sourceRoot, "src/lib/matches/veto-room/lifecycle-contract.json"), JSON.stringify({ readerVersion, publisherVersion }));
  return commit();
};
beforeAll(() => {
  sourceRoot = mkdtempSync(join(tmpdir(), "rivalhub-routing-contract-"));
  git(["init", "--quiet"]); git(["config", "user.email", "routing@example.invalid"]); git(["config", "user.name", "Routing Contract Test"]);
  writeFileSync(join(sourceRoot, "package.json"), '{}'); PREVIOUS_COMMIT = commit();
  writeFileSync(join(sourceRoot, "package.json"), '{"version":"2"}'); CANDIDATE_COMMIT = commit();
});
afterAll(() => rmSync(sourceRoot, { recursive: true, force: true }));

// Real Git contract reads guard mutations; provider responses only model routing.
it("rejects a lifecycle publisher before any provider request and rejects the same unsafe compensation target", async () => {
  const reader = lifecycleCommit(1, 0);
  const publisher = lifecycleCommit(1, 1);
  const harness = createHarness({ canonical: [identity("v2.9.4", PREVIOUS_COMMIT)] });
  harness.options.releaseCommit = publisher;
  await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
    details: { stage: "preflight", classification: "capability_incompatible" },
  });
  expect(harness.calls).toEqual([]);
  expect(() => assertRoutingCapabilities(sourceRoot, PREVIOUS_COMMIT, publisher, "compensation")).toThrow(/Veto lifecycle compatibility gate/);
  expect(() => assertRoutingCapabilities(sourceRoot, reader, publisher, "compensation")).not.toThrow();
});

it("blocks failed-promotion compensation if the immutable rollback contract cannot be verified, retaining diagnostics", async () => {
  const reader = lifecycleCommit(2, 0);
  const publisher = lifecycleCommit(2, 1);
  const objectPath = join(sourceRoot, ".git/objects", reader.slice(0, 2), reader.slice(2));
  const unavailablePath = `${objectPath}.unavailable`;
  let removed = false;
  const harness = createHarness({
    canonical: (index) => {
      if (index === 0) return identity("v2.9.4", reader);
      renameSync(objectPath, unavailablePath); removed = true;
      return jsonResponse({}, 401);
    },
  });
  harness.options.previousReleaseCommit = reader;
  harness.options.releaseCommit = publisher;
  try {
    await expect(runReleaseRouting(harness.options)).rejects.toMatchObject({
      details: { stage: "compensation", classification: "capability_incompatible", sideEffectMayHaveOccurred: true, expectedReleaseCommit: reader },
    });
    expect(harness.calls.filter(c => c.method === "POST" && c.url.includes("/promote/"))).toHaveLength(1);
    expect(harness.calls.filter(c => c.method === "POST" && c.url.includes("/rollback/"))).toHaveLength(0);
    expect(harness.summaries.at(-1)).toContain("已阻止");
    expect(harness.summaries.at(-1)).toContain("需要人工介入");
    expect(harness.summaries.at(-1)).toContain(reader);
  } finally { if (removed) renameSync(unavailablePath, objectPath); }
});

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
    sourceRoot,
    candidateDeploymentUrl: "https://" + CANDIDATE_HOST,
    releaseTag: "v2.9.5",
    releaseCommit: CANDIDATE_COMMIT,
    previousReleaseTag: "v2.9.4",
    previousReleaseCommit: PREVIOUS_COMMIT,
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

describe("release routing controller", () => {

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

});
