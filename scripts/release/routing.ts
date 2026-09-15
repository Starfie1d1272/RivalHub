import { appendFileSync } from "node:fs";
import { assertReleaseIdentity, RELEASE_TAG_PATTERN, type ReleaseIdentity } from "../../src/lib/release/identity";

export const DEFAULT_ROUTING_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_ROUTING_POLL_TIMEOUT_MS = 120_000;
export const DEFAULT_TRANSPORT_RETRY_ATTEMPTS = 5;
export const DEFAULT_TRANSPORT_RETRY_DELAY_MS = 3_000;

export type RoutingFailureClassification =
  | "transport_transient"
  | "rate_limited"
  | "hard_auth"
  | "provider_contract"
  | "not_converged"
  | "convergence_timeout"
  | "ambiguous_side_effect"
  | "rollback_failed"
  | "configuration";

export interface RoutingFailureDetails {
  stage: "preflight" | "promotion" | "canonical_convergence" | "compensation";
  operation: string;
  classification: RoutingFailureClassification;
  reason?: string;
  httpStatus?: number;
  providerJobStatus?: string;
  expectedDeploymentId?: string;
  observedDeploymentId?: string;
  expectedReleaseTag?: string;
  expectedReleaseCommit?: string;
  observedReleaseTag?: string;
  observedReleaseCommit?: string;
  attempt?: number;
  elapsedMs?: number;
  sideEffectMayHaveOccurred?: boolean;
}

export class ReleaseRoutingError extends Error {
  readonly details: RoutingFailureDetails;

  constructor(details: RoutingFailureDetails, cause?: unknown) {
    super(formatRoutingFailure(details));
    this.name = "ReleaseRoutingError";
    this.details = details;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: false,
      });
    }
  }
}

export interface ReleaseRoutingOptions {
  candidateDeploymentUrl: string;
  releaseTag: string;
  releaseCommit: string;
  canonicalBaseUrl: string;
  vercelToken: string;
  vercelOrgId: string;
  vercelProjectId: string;
  fetchFn?: typeof fetch;
  sleepFn?: (milliseconds: number) => Promise<void>;
  nowFn?: () => number;
  logFn?: (message: string) => void;
  errorFn?: (message: string) => void;
  summaryFn?: (markdown: string) => void;
  summaryPath?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  transportRetryAttempts?: number;
  transportRetryDelayMs?: number;
}

export interface ReleaseRoutingSuccess {
  candidateDeploymentId: string;
  candidateDeploymentUrl: string;
  previousDeploymentId: string;
  previousIdentity: ReleaseIdentity;
  promotionOutcome: "accepted" | "reconciled" | "retried";
  aliasPolls: number;
  canonicalPolls: number;
  durationMs: number;
}

interface DeploymentInfo {
  id: string;
  projectId: string;
  url: string;
  target: string;
  readyState: string;
}

interface AliasState {
  jobStatus: string | null;
  toDeploymentId: string | null;
}

interface RoutingConfig {
  candidateDeploymentUrl: string;
  candidateDeploymentHost: string;
  releaseTag: string;
  releaseCommit: string;
  canonicalBaseUrl: string;
  canonicalHost: string;
  vercelToken: string;
  vercelOrgId: string;
  vercelProjectId: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  transportRetryAttempts: number;
  transportRetryDelayMs: number;
}

interface RoutingContext extends RoutingConfig {
  fetchFn: typeof fetch;
  sleepFn: (milliseconds: number) => Promise<void>;
  nowFn: () => number;
  logFn: (message: string) => void;
  errorFn: (message: string) => void;
  writeSummary: (markdown: string) => void;
}

interface RoutingSummaryState {
  candidateDeploymentId?: string;
  previousDeploymentId?: string;
  previousIdentity?: ReleaseIdentity;
  promotion: "not_attempted" | "accepted" | "reconciled" | "retried" | "failed";
  canonical: "not_attempted" | "converged" | "failed";
  rollback: "not_attempted" | "not_required" | "verified" | "failed";
  terminal?: RoutingFailureDetails;
}

interface AliasWaitResult {
  polls: number;
  durationMs: number;
}

interface CanonicalWaitResult {
  polls: number;
  durationMs: number;
}

interface RoutingMutationResult {
  outcome: "accepted" | "reconciled" | "retried";
}

interface RequestMetadata {
  stage: RoutingFailureDetails["stage"];
  operation: string;
  authenticated?: boolean;
  expectedDeploymentId?: string;
  expectedReleaseTag?: string;
  expectedReleaseCommit?: string;
}

export function classifyHttpStatus(
  status: number,
  mutation = false,
): RoutingFailureClassification {
  if (status === 401 || status === 403) return "hard_auth";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 425 || (status >= 500 && status <= 599)) {
    return mutation ? "ambiguous_side_effect" : "transport_transient";
  }
  return "provider_contract";
}

export async function runReleaseRouting(
  options: ReleaseRoutingOptions,
): Promise<ReleaseRoutingSuccess> {
  const config = normalizeOptions(options);
  const context = createContext(config, options);
  const startedAt = context.nowFn();
  const summary: RoutingSummaryState = {
    promotion: "not_attempted",
    canonical: "not_attempted",
    rollback: "not_attempted",
  };

  let previousState:
    | {
        deploymentId: string;
        identity: ReleaseIdentity;
      }
    | undefined;
  let promotionMayHaveOccurred = false;
  let aliasPolls = 0;
  let canonicalPolls = 0;

  try {
    const previousIdentity = await readCanonicalIdentity(context, "preflight");
    const previousDeployment = await resolveDeployment(
      context,
      context.canonicalHost,
      "previous",
      "preflight",
    );
    const candidateDeployment = await resolveDeployment(
      context,
      context.candidateDeploymentHost,
      "candidate",
      "preflight",
    );

    if (previousDeployment.id === candidateDeployment.id) {
      throw routingError({
        stage: "preflight",
        operation: "freeze_routing_state",
        classification: "configuration",
        reason: "candidate 与 previous deployment 相同，无法安全建立 compensation 目标。",
        expectedDeploymentId: candidateDeployment.id,
        observedDeploymentId: previousDeployment.id,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
      });
    }

    previousState = Object.freeze({
      deploymentId: previousDeployment.id,
      identity: Object.freeze({ ...previousIdentity }),
    });
    summary.previousDeploymentId = previousDeployment.id;
    summary.previousIdentity = previousIdentity;
    summary.candidateDeploymentId = candidateDeployment.id;

    context.logFn(
      "[Release Routing] 已冻结 routing state: candidate=" +
        candidateDeployment.id +
        ", previous=" +
        previousDeployment.id +
        ", previousTag=" +
        previousIdentity.releaseTag +
        ", previousCommit=" +
        previousIdentity.releaseCommit,
    );

    let promotion: RoutingMutationResult;
    try {
      promotion = await mutateRouting(
        context,
        "promote",
        candidateDeployment.id,
        previousDeployment.id,
      );
      promotionMayHaveOccurred = true;
      summary.promotion = promotion.outcome;

      aliasPolls = (await waitForAliasOperation(
        context,
        candidateDeployment.id,
        "promotion",
      )).polls;
      canonicalPolls = (await waitForCanonicalIdentity(context, {
        releaseTag: context.releaseTag,
        releaseCommit: context.releaseCommit,
      }, "promotion")).polls;
      summary.canonical = "converged";
    } catch (error) {
      if (mayHaveSideEffect(error)) promotionMayHaveOccurred = true;
      summary.promotion = "failed";
      summary.canonical = "failed";
      throw error;
    }

    summary.rollback = "not_required";
    const result: ReleaseRoutingSuccess = {
      candidateDeploymentId: candidateDeployment.id,
      candidateDeploymentUrl: context.candidateDeploymentUrl,
      previousDeploymentId: previousDeployment.id,
      previousIdentity: previousIdentity,
      promotionOutcome: promotion.outcome,
      aliasPolls,
      canonicalPolls,
      durationMs: Math.max(0, context.nowFn() - startedAt),
    };
    context.writeSummary(renderSummary(context, summary, result.durationMs));
    return result;
  } catch (error) {
    const originalFailure = asRoutingError(error, {
      stage: "preflight",
      operation: "release_routing",
      classification: "provider_contract",
      expectedReleaseTag: context.releaseTag,
      expectedReleaseCommit: context.releaseCommit,
    });
    let terminalFailure = originalFailure;

    if (promotionMayHaveOccurred && previousState) {
      summary.rollback = "failed";
      try {
        await mutateRouting(
          context,
          "rollback",
          previousState.deploymentId,
          summary.candidateDeploymentId,
        );
        await waitForAliasOperation(context, previousState.deploymentId, "compensation");
        await waitForCanonicalIdentity(context, previousState.identity, "compensation");
        summary.rollback = "verified";
      } catch (rollbackError) {
        const rollbackFailure = asRoutingError(rollbackError, {
          stage: "compensation",
          operation: "rollback",
          classification: "rollback_failed",
          expectedDeploymentId: previousState.deploymentId,
          expectedReleaseTag: previousState.identity.releaseTag,
          expectedReleaseCommit: previousState.identity.releaseCommit,
        });
        terminalFailure = routingError({
          stage: "compensation",
          operation: "rollback",
          classification: "rollback_failed",
          reason: "rollback 未能确认 provider routing 与 canonical previous identity 同时恢复；需要人工介入。",
          httpStatus: rollbackFailure.details.httpStatus,
          providerJobStatus: rollbackFailure.details.providerJobStatus,
          expectedDeploymentId: previousState.deploymentId,
          observedDeploymentId: rollbackFailure.details.observedDeploymentId,
          expectedReleaseTag: previousState.identity.releaseTag,
          expectedReleaseCommit: previousState.identity.releaseCommit,
          observedReleaseTag: rollbackFailure.details.observedReleaseTag,
          observedReleaseCommit: rollbackFailure.details.observedReleaseCommit,
          elapsedMs: rollbackFailure.details.elapsedMs,
          sideEffectMayHaveOccurred: true,
        }, rollbackError);
      }
    }

    summary.terminal = terminalFailure.details;
    context.errorFn(terminalFailure.message);
    context.writeSummary(renderSummary(context, summary, Math.max(0, context.nowFn() - startedAt)));
    throw terminalFailure;
  }
}

function normalizeOptions(options: ReleaseRoutingOptions): RoutingConfig {
  const releaseTag = options.releaseTag?.trim() ?? "";
  const releaseCommit = options.releaseCommit?.trim().toLowerCase() ?? "";
  if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw routingError({
      stage: "preflight",
      operation: "validate_configuration",
      classification: "configuration",
      reason: "release tag 无效。",
      expectedReleaseTag: releaseTag,
      expectedReleaseCommit: releaseCommit,
    });
  }
  if (!/^[0-9a-f]{40}$/.test(releaseCommit)) {
    throw routingError({
      stage: "preflight",
      operation: "validate_configuration",
      classification: "configuration",
      reason: "release commit SHA 无效。",
      expectedReleaseTag: releaseTag,
      expectedReleaseCommit: releaseCommit,
    });
  }

  const candidate = parseCandidateUrl(options.candidateDeploymentUrl);
  const canonical = parseCanonicalUrl(options.canonicalBaseUrl);
  const vercelToken = options.vercelToken?.trim() ?? "";
  const vercelOrgId = options.vercelOrgId?.trim() ?? "";
  const vercelProjectId = options.vercelProjectId?.trim() ?? "";
  if (!vercelToken || !vercelOrgId || !vercelProjectId) {
    throw routingError({
      stage: "preflight",
      operation: "validate_configuration",
      classification: "configuration",
      reason: "Vercel project-scoped routing configuration 缺失。",
      expectedReleaseTag: releaseTag,
      expectedReleaseCommit: releaseCommit,
    });
  }

  return {
    candidateDeploymentUrl: candidate.url,
    candidateDeploymentHost: candidate.host,
    releaseTag,
    releaseCommit,
    canonicalBaseUrl: canonical.url,
    canonicalHost: canonical.host,
    vercelToken,
    vercelOrgId,
    vercelProjectId,
    pollIntervalMs: positiveNumber(
      options.pollIntervalMs,
      DEFAULT_ROUTING_POLL_INTERVAL_MS,
      "poll interval",
    ),
    pollTimeoutMs: positiveNumber(
      options.pollTimeoutMs,
      DEFAULT_ROUTING_POLL_TIMEOUT_MS,
      "poll timeout",
    ),
    transportRetryAttempts: positiveInteger(
      options.transportRetryAttempts,
      DEFAULT_TRANSPORT_RETRY_ATTEMPTS,
      "transport retry attempts",
    ),
    transportRetryDelayMs: positiveNumber(
      options.transportRetryDelayMs,
      DEFAULT_TRANSPORT_RETRY_DELAY_MS,
      "transport retry delay",
    ),
  };
}

function positiveNumber(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw routingError({
      stage: "preflight",
      operation: "validate_configuration",
      classification: "configuration",
      reason: label + " 必须是正数。",
    });
  }
  return resolved;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw routingError({
      stage: "preflight",
      operation: "validate_configuration",
      classification: "configuration",
      reason: label + " 必须是正整数。",
    });
  }
  return resolved;
}

function parseCandidateUrl(raw: string): { url: string; host: string } {
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      !/^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid candidate");
    }
    return { url: "https://" + parsed.hostname, host: parsed.hostname };
  } catch {
    throw routingError({
      stage: "preflight",
      operation: "validate_candidate_url",
      classification: "configuration",
      reason: "candidate deployment URL 必须是精确的 HTTPS *.vercel.app hostname。",
    });
  }
}

function parseCanonicalUrl(raw: string): { url: string; host: string } {
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid canonical");
    }
    return { url: "https://" + parsed.hostname, host: parsed.hostname };
  } catch {
    throw routingError({
      stage: "preflight",
      operation: "validate_canonical_url",
      classification: "configuration",
      reason: "canonical production base URL 必须是无 path/query 的 HTTPS URL。",
    });
  }
}

function createContext(config: RoutingConfig, options: ReleaseRoutingOptions): RoutingContext {
  const summaryPath = options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
  const writeSummary = options.summaryFn
    ? options.summaryFn
    : (markdown: string) => {
        if (!summaryPath) return;
        try {
          appendFileSync(summaryPath, markdown + "\n", "utf8");
        } catch (error) {
          (options.errorFn ?? console.error)(
            "[Release Routing] 无法写入 GitHub Step Summary；routing result 不受影响。",
          );
          void error;
        }
      };

  return {
    ...config,
    fetchFn: options.fetchFn ?? fetch,
    sleepFn: options.sleepFn ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    nowFn: options.nowFn ?? (() => Date.now()),
    logFn: options.logFn ?? console.log,
    errorFn: options.errorFn ?? console.error,
    writeSummary,
  };
}

async function resolveDeployment(
  context: RoutingContext,
  host: string,
  role: "previous" | "candidate",
  stage: RoutingFailureDetails["stage"],
): Promise<DeploymentInfo> {
  const url =
    "https://api.vercel.com/v13/deployments/" +
    encodeURIComponent(host) +
    "?teamId=" +
    encodeURIComponent(context.vercelOrgId);
  const raw = await requestJson(context, url, {
    stage,
    operation: "resolve_" + role + "_deployment",
    authenticated: true,
    expectedReleaseTag: context.releaseTag,
    expectedReleaseCommit: context.releaseCommit,
  });
  const record = asRecord(raw);
  const id = record?.id;
  const projectId = record?.projectId;
  const deploymentUrl = record?.url;
  const target = record?.target;
  const readyState = record?.readyState;
  if (
    typeof id !== "string" ||
    !id.startsWith("dpl_") ||
    typeof projectId !== "string" ||
    typeof deploymentUrl !== "string" ||
    typeof target !== "string" ||
    typeof readyState !== "string" ||
    projectId !== context.vercelProjectId ||
    deploymentUrl !== host ||
    target !== "production" ||
    readyState !== "READY"
  ) {
    throw routingError({
      stage,
      operation: "resolve_" + role + "_deployment",
      classification: "provider_contract",
      reason: role + " deployment 不属于当前 Vercel project、production target 或 READY state。",
      observedDeploymentId: idString(id),
      expectedReleaseTag: context.releaseTag,
      expectedReleaseCommit: context.releaseCommit,
    });
  }
  return { id, projectId, url: deploymentUrl, target, readyState };
}

async function readCanonicalIdentity(
  context: RoutingContext,
  stage: RoutingFailureDetails["stage"],
): Promise<ReleaseIdentity> {
  const raw = await requestJson(context, context.canonicalBaseUrl + "/api/system/release", {
    stage,
    operation: "read_canonical_release_identity",
    authenticated: false,
    expectedReleaseTag: context.releaseTag,
    expectedReleaseCommit: context.releaseCommit,
  });
  try {
    return assertReleaseIdentity(raw, "canonical production release identity");
  } catch (error) {
    throw routingError({
      stage,
      operation: "read_canonical_release_identity",
      classification: "provider_contract",
      reason: "canonical /api/system/release payload 不符合 release identity contract。",
      expectedReleaseTag: context.releaseTag,
      expectedReleaseCommit: context.releaseCommit,
    }, error);
  }
}

async function readAliasState(
  context: RoutingContext,
  stage: RoutingFailureDetails["stage"],
  operation: string,
): Promise<AliasState> {
  const url =
    "https://api.vercel.com/v9/projects/" +
    encodeURIComponent(context.vercelProjectId) +
    "?rollbackInfo=true&teamId=" +
    encodeURIComponent(context.vercelOrgId);
  const raw = await requestJson(context, url, {
    stage,
    operation,
    authenticated: true,
    expectedReleaseTag: context.releaseTag,
    expectedReleaseCommit: context.releaseCommit,
  });
  const record = asRecord(raw);
  if (!record || !Object.prototype.hasOwnProperty.call(record, "lastAliasRequest")) {
    return { jobStatus: null, toDeploymentId: null };
  }
  const alias = record.lastAliasRequest;
  if (alias === null || alias === undefined) {
    return { jobStatus: null, toDeploymentId: null };
  }
  const aliasRecord = asRecord(alias);
  if (!aliasRecord) {
    throw routingError({
      stage,
      operation,
      classification: "provider_contract",
      reason: "Vercel lastAliasRequest payload 无效。",
      expectedReleaseTag: context.releaseTag,
      expectedReleaseCommit: context.releaseCommit,
    });
  }
  const jobStatus = aliasRecord.jobStatus;
  const toDeploymentId = aliasRecord.toDeploymentId;
  if (
    (jobStatus !== undefined && typeof jobStatus !== "string") ||
    (toDeploymentId !== undefined && typeof toDeploymentId !== "string")
  ) {
    throw routingError({
      stage,
      operation,
      classification: "provider_contract",
      reason: "Vercel alias operation status/target payload 无效。",
      expectedReleaseTag: context.releaseTag,
      expectedReleaseCommit: context.releaseCommit,
    });
  }
  return {
    jobStatus: typeof jobStatus === "string" ? jobStatus : null,
    toDeploymentId: typeof toDeploymentId === "string" ? toDeploymentId : null,
  };
}

async function mutateRouting(
  context: RoutingContext,
  kind: "promote" | "rollback",
  targetDeploymentId: string,
  unchangedDeploymentId: string | undefined,
): Promise<RoutingMutationResult> {
  const stage: RoutingFailureDetails["stage"] = kind === "promote" ? "promotion" : "compensation";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await postRouting(context, kind, targetDeploymentId, stage);
      return { outcome: attempt === 1 ? "accepted" : "retried" };
    } catch (error) {
      const failure = asRoutingError(error, {
        stage,
        operation: kind,
        classification: "ambiguous_side_effect",
        expectedDeploymentId: targetDeploymentId,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
        sideEffectMayHaveOccurred: true,
      });
      if (failure.details.classification !== "ambiguous_side_effect") throw failure;

      let aliasState: AliasState;
      try {
        aliasState = await readAliasState(
          context,
          stage,
          "reconcile_" + kind + "_outcome",
        );
      } catch (reconciliationError) {
        throw routingError({
          ...failure.details,
          reason: "mutation outcome ambiguous，provider reconciliation 也未完成。",
          expectedDeploymentId: targetDeploymentId,
          sideEffectMayHaveOccurred: true,
        }, reconciliationError);
      }

      if (aliasState.toDeploymentId === targetDeploymentId) {
        if (aliasState.jobStatus === "failed") {
          throw routingError({
            stage,
            operation: kind,
            classification: "provider_contract",
            reason: "provider alias job 明确失败。",
            providerJobStatus: aliasState.jobStatus,
            expectedDeploymentId: targetDeploymentId,
            observedDeploymentId: aliasState.toDeploymentId,
            expectedReleaseTag: context.releaseTag,
            expectedReleaseCommit: context.releaseCommit,
            sideEffectMayHaveOccurred: true,
          }, error);
        }
        context.logFn(
          "[Release Routing] " +
            kind +
            " outcome ambiguous，但 provider 已观察到 target=" +
            targetDeploymentId +
            "；不重复 side-effect POST。",
        );
        return { outcome: "reconciled" };
      }

      const safeToRetry =
        attempt === 1 &&
        unchangedDeploymentId !== undefined &&
        aliasState.toDeploymentId === unchangedDeploymentId &&
        aliasState.jobStatus === "succeeded";
      if (safeToRetry) {
        context.logFn(
          "[Release Routing] " +
            kind +
            " 明确仍保持 previous routing；执行一次 bounded retry。",
        );
        continue;
      }

      throw routingError({
        ...failure.details,
        reason: "mutation outcome 在 provider reconciliation 后仍不明确；拒绝盲目重复 side-effect POST。",
        expectedDeploymentId: targetDeploymentId,
        observedDeploymentId: aliasState.toDeploymentId ?? undefined,
        sideEffectMayHaveOccurred: true,
      }, error);
    }
  }
  throw new Error("unreachable");
}

async function postRouting(
  context: RoutingContext,
  kind: "promote" | "rollback",
  deploymentId: string,
  stage: RoutingFailureDetails["stage"],
): Promise<void> {
  const endpoint =
    kind === "promote"
      ? "https://api.vercel.com/v10/projects/" +
        encodeURIComponent(context.vercelProjectId) +
        "/promote/" +
        encodeURIComponent(deploymentId) +
        "?teamId=" +
        encodeURIComponent(context.vercelOrgId)
      : "https://api.vercel.com/v1/projects/" +
        encodeURIComponent(context.vercelProjectId) +
        "/rollback/" +
        encodeURIComponent(deploymentId) +
        "?teamId=" +
        encodeURIComponent(context.vercelOrgId);
  let response: Response;
  try {
    response = await context.fetchFn(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + context.vercelToken,
        "Content-Type": "application/json",
        "User-Agent": "RivalHub-Release-Routing",
      },
      body: "{}",
    });
  } catch (error) {
    throw routingError({
      stage,
      operation: kind,
      classification: "ambiguous_side_effect",
      reason: "routing mutation transport failure，side effect outcome 未知。",
      expectedDeploymentId: deploymentId,
      expectedReleaseTag: context.releaseTag,
      expectedReleaseCommit: context.releaseCommit,
      sideEffectMayHaveOccurred: true,
    }, error);
  }

  if (response.status === 201 || response.status === 202) return;
  const classification = classifyHttpStatus(response.status, true);
  throw routingError({
    stage,
    operation: kind,
    classification,
    reason:
      classification === "ambiguous_side_effect"
        ? "routing mutation 返回 transient provider status，side effect outcome 未知。"
        : "routing mutation 返回非 accepted status。",
    httpStatus: response.status,
    expectedDeploymentId: deploymentId,
    expectedReleaseTag: context.releaseTag,
    expectedReleaseCommit: context.releaseCommit,
    sideEffectMayHaveOccurred: classification === "ambiguous_side_effect",
  });
}

async function waitForAliasOperation(
  context: RoutingContext,
  expectedDeploymentId: string,
  stage: "promotion" | "compensation",
): Promise<AliasWaitResult> {
  const startedAt = context.nowFn();
  let polls = 0;
  let lastState: AliasState = { jobStatus: null, toDeploymentId: null };

  while (true) {
    polls += 1;
    try {
      lastState = await readAliasState(context, stage, "wait_" + stage + "_alias_operation");
      if (
        lastState.jobStatus === "succeeded" &&
        lastState.toDeploymentId === expectedDeploymentId
      ) {
        return { polls, durationMs: Math.max(0, context.nowFn() - startedAt) };
      }
      if (
        lastState.jobStatus === "failed" &&
        lastState.toDeploymentId === expectedDeploymentId
      ) {
        throw routingError({
          stage,
          operation: "wait_" + stage + "_alias_operation",
          classification: "provider_contract",
          reason: "provider alias job 明确失败。",
          providerJobStatus: lastState.jobStatus,
          expectedDeploymentId: expectedDeploymentId,
          observedDeploymentId: lastState.toDeploymentId,
          expectedReleaseTag: context.releaseTag,
          expectedReleaseCommit: context.releaseCommit,
          sideEffectMayHaveOccurred: stage === "promotion",
        });
      }
      context.logFn(
        "[Release Routing] alias operation 尚未收敛: expected=" +
          expectedDeploymentId +
          ", observed=" +
          (lastState.toDeploymentId ?? "none") +
          ", status=" +
          (lastState.jobStatus ?? "none"),
      );
    } catch (error) {
      const failure = asRoutingError(error, {
        stage,
        operation: "wait_" + stage + "_alias_operation",
        classification: "provider_contract",
        expectedDeploymentId: expectedDeploymentId,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
      });
      if (!isPollTransient(failure)) throw failure;
      context.logFn(
        "[Release Routing] alias state read transient failure，继续 bounded poll: classification=" +
          failure.details.classification,
      );
      if (pollExpired(context, startedAt, polls)) {
        throw timeoutError(context, stage, "wait_" + stage + "_alias_operation", {
          expectedDeploymentId,
          observedDeploymentId: lastState.toDeploymentId ?? undefined,
          providerJobStatus: lastState.jobStatus ?? undefined,
          elapsedMs: Math.max(0, context.nowFn() - startedAt),
        });
      }
    }

    if (pollExpired(context, startedAt, polls)) {
      throw timeoutError(context, stage, "wait_" + stage + "_alias_operation", {
        expectedDeploymentId,
        observedDeploymentId: lastState.toDeploymentId ?? undefined,
        providerJobStatus: lastState.jobStatus ?? undefined,
        elapsedMs: Math.max(0, context.nowFn() - startedAt),
      });
    }
    await context.sleepFn(context.pollIntervalMs);
  }
}

async function waitForCanonicalIdentity(
  context: RoutingContext,
  expectedIdentity: ReleaseIdentity,
  stage: "promotion" | "compensation",
): Promise<CanonicalWaitResult> {
  const startedAt = context.nowFn();
  let polls = 0;
  let observedIdentity: ReleaseIdentity | undefined;

  while (true) {
    polls += 1;
    try {
      await requestStatus(context, context.canonicalBaseUrl + "/", {
        stage,
        operation: "read_canonical_root",
        expectedReleaseTag: expectedIdentity.releaseTag,
        expectedReleaseCommit: expectedIdentity.releaseCommit,
      });
      observedIdentity = await readCanonicalIdentity(context, stage);
      if (
        observedIdentity.releaseTag === expectedIdentity.releaseTag &&
        observedIdentity.releaseCommit === expectedIdentity.releaseCommit.toLowerCase()
      ) {
        return { polls, durationMs: Math.max(0, context.nowFn() - startedAt) };
      }
      context.logFn(
        "[Release Routing] canonical identity not_converged: expected=" +
          expectedIdentity.releaseTag +
          "/" +
          expectedIdentity.releaseCommit.toLowerCase() +
          ", observed=" +
          observedIdentity.releaseTag +
          "/" +
          observedIdentity.releaseCommit,
      );
    } catch (error) {
      const failure = asRoutingError(error, {
        stage,
        operation: "wait_canonical_release_identity",
        classification: "provider_contract",
        expectedReleaseTag: expectedIdentity.releaseTag,
        expectedReleaseCommit: expectedIdentity.releaseCommit,
      });
      if (!isPollTransient(failure)) throw failure;
      context.logFn(
        "[Release Routing] canonical read transient failure，继续 semantic poll: classification=" +
          failure.details.classification,
      );
    }

    if (pollExpired(context, startedAt, polls)) {
      throw timeoutError(context, stage, "wait_canonical_release_identity", {
        expectedReleaseTag: expectedIdentity.releaseTag,
        expectedReleaseCommit: expectedIdentity.releaseCommit.toLowerCase(),
        observedReleaseTag: observedIdentity?.releaseTag,
        observedReleaseCommit: observedIdentity?.releaseCommit,
        elapsedMs: Math.max(0, context.nowFn() - startedAt),
      });
    }
    await context.sleepFn(context.pollIntervalMs);
  }
}

async function requestJson(
  context: RoutingContext,
  url: string,
  metadata: RequestMetadata,
): Promise<unknown> {
  for (let attempt = 1; attempt <= context.transportRetryAttempts; attempt += 1) {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "RivalHub-Release-Routing",
      };
      if (metadata.authenticated) {
        headers.Authorization = "Bearer " + context.vercelToken;
      }
      response = await context.fetchFn(url, {
        headers,
      });
    } catch (error) {
      if (attempt < context.transportRetryAttempts) {
        await context.sleepFn(retryDelay(context, attempt));
        continue;
      }
      throw routingError({
        ...metadata,
        classification: "transport_transient",
        reason: "provider GET transport failure after bounded retries。",
        attempt,
        sideEffectMayHaveOccurred: false,
      }, error);
    }

    if (response.status < 200 || response.status >= 300) {
      const classification = classifyHttpStatus(response.status);
      if (isReadTransientClassification(classification) && attempt < context.transportRetryAttempts) {
        await context.sleepFn(retryDelay(context, attempt));
        continue;
      }
      throw routingError({
        ...metadata,
        classification,
        reason: "provider GET returned non-success status。",
        httpStatus: response.status,
        attempt,
        sideEffectMayHaveOccurred: false,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw routingError({
        ...metadata,
        classification: "provider_contract",
        reason: "provider JSON payload 无法解析。",
        attempt,
        sideEffectMayHaveOccurred: false,
      }, error);
    }
  }
  throw new Error("unreachable");
}

async function requestStatus(
  context: RoutingContext,
  url: string,
  metadata: RequestMetadata,
): Promise<void> {
  for (let attempt = 1; attempt <= context.transportRetryAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await context.fetchFn(url, {
        headers: { "User-Agent": "RivalHub-Release-Routing" },
      });
    } catch (error) {
      if (attempt < context.transportRetryAttempts) {
        await context.sleepFn(retryDelay(context, attempt));
        continue;
      }
      throw routingError({
        ...metadata,
        classification: "transport_transient",
        reason: "canonical root transport failure after bounded retries。",
        attempt,
        sideEffectMayHaveOccurred: false,
      }, error);
    }
    if (response.status >= 200 && response.status < 300) return;
    const classification = classifyHttpStatus(response.status);
    if (isReadTransientClassification(classification) && attempt < context.transportRetryAttempts) {
      await context.sleepFn(retryDelay(context, attempt));
      continue;
    }
    throw routingError({
      ...metadata,
      classification,
      reason: "canonical root returned non-success status。",
      httpStatus: response.status,
      attempt,
      sideEffectMayHaveOccurred: false,
    });
  }
  throw new Error("unreachable");
}

function retryDelay(context: RoutingContext, attempt: number): number {
  return Math.min(
    30_000,
    context.transportRetryDelayMs * 2 ** Math.max(0, attempt - 1),
  );
}

function pollExpired(context: RoutingContext, startedAt: number, polls: number): boolean {
  return (
    context.nowFn() - startedAt >= context.pollTimeoutMs ||
    polls * context.pollIntervalMs >= context.pollTimeoutMs
  );
}

function timeoutError(
  context: RoutingContext,
  stage: RoutingFailureDetails["stage"],
  operation: string,
  details: Partial<RoutingFailureDetails>,
): ReleaseRoutingError {
  return routingError({
    stage,
    operation,
    classification: "convergence_timeout",
    reason: "bounded convergence deadline exceeded。",
    expectedReleaseTag: context.releaseTag,
    expectedReleaseCommit: context.releaseCommit,
    ...details,
  });
}

function isReadTransientClassification(
  classification: RoutingFailureClassification,
): boolean {
  return classification === "transport_transient" || classification === "rate_limited";
}

function isPollTransient(error: ReleaseRoutingError): boolean {
  return isReadTransientClassification(error.details.classification);
}

function mayHaveSideEffect(error: unknown): boolean {
  return (
    error instanceof ReleaseRoutingError &&
    error.details.sideEffectMayHaveOccurred === true
  );
}

function asRoutingError(
  error: unknown,
  fallback: RoutingFailureDetails,
): ReleaseRoutingError {
  if (error instanceof ReleaseRoutingError) return error;
  return routingError(fallback, error);
}

function routingError(details: RoutingFailureDetails, cause?: unknown): ReleaseRoutingError {
  return new ReleaseRoutingError(details, cause);
}

function renderSummary(
  context: RoutingContext,
  summary: RoutingSummaryState,
  durationMs: number,
): string {
  const lines = [
    "## Release routing controller",
    "",
    "- candidate deployment: " + summaryValue(context.candidateDeploymentUrl),
    "- candidate deployment id: " + summaryValue(summary.candidateDeploymentId),
    "- previous deployment: " + summaryValue(summary.previousDeploymentId),
    "- previous release identity: " +
      summaryValue(
        summary.previousIdentity
          ? summary.previousIdentity.releaseTag + "/" + summary.previousIdentity.releaseCommit
          : undefined,
      ),
    "- expected release identity: " +
      summaryValue(context.releaseTag + "/" + context.releaseCommit),
    "- promotion outcome: " + summaryValue(summary.promotion),
    "- canonical convergence: " + summaryValue(summary.canonical),
    "- rollback compensation: " + summaryValue(summary.rollback),
    "- terminal classification: " + summaryValue(summary.terminal?.classification ?? "none"),
    "- elapsed: " + Math.round(durationMs) + "ms",
  ];
  if (summary.terminal?.reason) {
    lines.push("- diagnostic: " + summaryValue(summary.terminal.reason));
  }
  if (summary.rollback === "failed") {
    lines.push("- manual intervention: required");
  }
  return lines.join("\n");
}

function summaryValue(value: string | number | undefined): string {
  const codeMark = String.fromCharCode(96);
  if (value === undefined) return codeMark + "unavailable" + codeMark;
  return codeMark + String(value).replaceAll(codeMark, "'").replaceAll("\n", " ") + codeMark;
}

function formatRoutingFailure(details: RoutingFailureDetails): string {
  const parts = [
    "[Release Routing] " + details.classification,
    "stage=" + details.stage,
    "operation=" + details.operation,
  ];
  if (details.reason) parts.push(details.reason);
  if (details.httpStatus !== undefined) parts.push("httpStatus=" + details.httpStatus);
  if (details.providerJobStatus) parts.push("providerJobStatus=" + details.providerJobStatus);
  if (details.expectedDeploymentId) parts.push("expectedDeploymentId=" + details.expectedDeploymentId);
  if (details.observedDeploymentId) parts.push("observedDeploymentId=" + details.observedDeploymentId);
  if (details.expectedReleaseTag) parts.push("expectedReleaseTag=" + details.expectedReleaseTag);
  if (details.expectedReleaseCommit) parts.push("expectedReleaseCommit=" + details.expectedReleaseCommit);
  if (details.observedReleaseTag) parts.push("observedReleaseTag=" + details.observedReleaseTag);
  if (details.observedReleaseCommit) parts.push("observedReleaseCommit=" + details.observedReleaseCommit);
  if (details.attempt !== undefined) parts.push("attempt=" + details.attempt);
  if (details.elapsedMs !== undefined) parts.push("elapsedMs=" + Math.round(details.elapsedMs));
  return parts.join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function idString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function cliMain(): Promise<void> {
  try {
    const result = await runReleaseRouting({
      candidateDeploymentUrl: process.env.DEPLOYMENT_URL ?? "",
      releaseTag: process.env.RELEASE_TAG ?? "",
      releaseCommit: process.env.RELEASE_SHA ?? "",
      canonicalBaseUrl: process.env.RIVALHUB_PRODUCTION_BASE_URL ?? "",
      vercelToken: process.env.VERCEL_TOKEN ?? "",
      vercelOrgId: process.env.VERCEL_ORG_ID ?? "",
      vercelProjectId: process.env.VERCEL_PROJECT_ID ?? "",
      pollIntervalMs: parseOptionalNumber(process.env.RELEASE_ROUTING_POLL_INTERVAL_MS),
      pollTimeoutMs: parseOptionalNumber(process.env.RELEASE_ROUTING_POLL_TIMEOUT_MS),
      transportRetryAttempts: parseOptionalNumber(process.env.RELEASE_ROUTING_TRANSPORT_RETRY_ATTEMPTS),
      transportRetryDelayMs: parseOptionalNumber(process.env.RELEASE_ROUTING_TRANSPORT_RETRY_DELAY_MS),
    });
    console.log(
      "[Release Routing] canonical production converged: candidate=" +
        result.candidateDeploymentId +
        ", previous=" +
        result.previousDeploymentId,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  void cliMain();
}
