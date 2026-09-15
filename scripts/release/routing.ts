import { appendFileSync } from "node:fs";
import { assertReleaseIdentity, RELEASE_TAG_PATTERN, type ReleaseIdentity } from "../../src/lib/release/identity";
import {
  createRoutingHttpClient,
  createVercelRoutingClient,
  classifyHttpStatus as classifyVercelHttpStatus,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TRANSPORT_RETRY_ATTEMPTS,
  DEFAULT_TRANSPORT_RETRY_DELAY_MS,
  ReleaseRoutingError,
  routingError,
  type AliasState,
  type RequestMetadata,
  type RoutingFailureClassification,
  type RoutingFailureDetails,
  type RoutingHttpClient,
  type VercelRoutingClient,
} from "./vercel-routing";

export const DEFAULT_ROUTING_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_ROUTING_PROVIDER_TIMEOUT_MS = 180_000;
export const DEFAULT_ROUTING_SEMANTIC_TIMEOUT_MS = 120_000;
export const DEFAULT_ROUTING_AMBIGUOUS_RECONCILIATION_TIMEOUT_MS = 15_000;
export const classifyHttpStatus = classifyVercelHttpStatus;

export {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TRANSPORT_RETRY_ATTEMPTS,
  DEFAULT_TRANSPORT_RETRY_DELAY_MS,
  ReleaseRoutingError,
} from "./vercel-routing";
export type {
  RequestMetadata,
  RoutingFailureClassification,
  RoutingFailureDetails,
} from "./vercel-routing";

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
  /** @deprecated Use semanticConvergenceTimeoutMs. */
  pollTimeoutMs?: number;
  semanticConvergenceTimeoutMs?: number;
  providerRoutingTimeoutMs?: number;
  ambiguousReconciliationTimeoutMs?: number;
  requestTimeoutMs?: number;
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
  providerRoutingTimeoutMs: number;
  semanticConvergenceTimeoutMs: number;
  ambiguousReconciliationTimeoutMs: number;
  requestTimeoutMs: number;
  transportRetryAttempts: number;
  transportRetryDelayMs: number;
}

interface RoutingContext extends RoutingConfig {
  httpClient: RoutingHttpClient;
  vercelClient: VercelRoutingClient;
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
  let canonicalConvergenceStarted = false;

  try {
    const previousIdentity = await readCanonicalIdentity(context, "preflight");
    const previousDeployment = await context.vercelClient.resolveDeployment(
      context.canonicalHost,
      {
        stage: "preflight",
        operation: "resolve_previous_deployment",
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
      },
    );
    const candidateDeployment = await context.vercelClient.resolveDeployment(
      context.candidateDeploymentHost,
      {
        stage: "preflight",
        operation: "resolve_candidate_deployment",
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
      },
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
      canonicalConvergenceStarted = true;
      canonicalPolls = (await waitForCanonicalIdentity(context, {
        releaseTag: context.releaseTag,
        releaseCommit: context.releaseCommit,
      }, "promotion")).polls;
      summary.canonical = "converged";
    } catch (error) {
      if (mayHaveSideEffect(error)) promotionMayHaveOccurred = true;
      if (summary.promotion === "not_attempted") summary.promotion = "failed";
      if (canonicalConvergenceStarted && summary.canonical === "not_attempted") {
        summary.canonical = "failed";
      }
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
    providerRoutingTimeoutMs: positiveNumber(
      options.providerRoutingTimeoutMs,
      DEFAULT_ROUTING_PROVIDER_TIMEOUT_MS,
      "provider routing timeout",
    ),
    semanticConvergenceTimeoutMs: positiveNumber(
      options.semanticConvergenceTimeoutMs ?? options.pollTimeoutMs,
      DEFAULT_ROUTING_SEMANTIC_TIMEOUT_MS,
      "semantic convergence timeout",
    ),
    ambiguousReconciliationTimeoutMs: positiveNumber(
      options.ambiguousReconciliationTimeoutMs,
      DEFAULT_ROUTING_AMBIGUOUS_RECONCILIATION_TIMEOUT_MS,
      "ambiguous reconciliation timeout",
    ),
    requestTimeoutMs: positiveNumber(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      "request timeout",
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

  const httpClient = createRoutingHttpClient({
    token: config.vercelToken,
    fetchFn: options.fetchFn,
    sleepFn: options.sleepFn,
    nowFn: options.nowFn,
    requestTimeoutMs: config.requestTimeoutMs,
    transportRetryAttempts: config.transportRetryAttempts,
    transportRetryDelayMs: config.transportRetryDelayMs,
  });

  return {
    ...config,
    httpClient,
    vercelClient: createVercelRoutingClient({
      orgId: config.vercelOrgId,
      projectId: config.vercelProjectId,
      httpClient,
    }),
    sleepFn: options.sleepFn ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    nowFn: options.nowFn ?? (() => Date.now()),
    logFn: options.logFn ?? console.log,
    errorFn: options.errorFn ?? console.error,
    writeSummary,
  };
}

async function readCanonicalIdentity(
  context: RoutingContext,
  stage: RoutingFailureDetails["stage"],
  deadlineAtMs?: number,
  expectedIdentity: ReleaseIdentity = {
    releaseTag: context.releaseTag,
    releaseCommit: context.releaseCommit,
  },
): Promise<ReleaseIdentity> {
  const raw = await context.httpClient.requestJson(
    context.canonicalBaseUrl + "/api/system/release",
    {
      stage,
      operation: "read_canonical_release_identity",
      authenticated: false,
      expectedReleaseTag: expectedIdentity.releaseTag,
      expectedReleaseCommit: expectedIdentity.releaseCommit,
      deadlineAtMs,
    },
  );
  try {
    return assertReleaseIdentity(raw, "canonical production release identity");
  } catch (error) {
    throw routingError({
      stage,
      operation: "read_canonical_release_identity",
      classification: "provider_contract",
      reason: "canonical /api/system/release payload 不符合 release identity contract。",
      expectedReleaseTag: expectedIdentity.releaseTag,
      expectedReleaseCommit: expectedIdentity.releaseCommit,
    }, error);
  }
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
      const metadata: RequestMetadata = {
        stage,
        operation: kind,
        expectedDeploymentId: targetDeploymentId,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
      };
      if (kind === "promote") {
        await context.vercelClient.promote(targetDeploymentId, metadata);
      } else {
        await context.vercelClient.rollback(targetDeploymentId, metadata);
      }
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
      if (failure.details.classification === "rate_limited") {
        if (attempt === 2) {
          throw routingError({
            ...failure.details,
            attempt,
          }, error);
        }
        const delayMs = failure.details.retryAfterMs ?? retryDelay(context, attempt);
        context.logFn(
          "[Release Routing] " +
            kind +
            " 被 rate limited；按 bounded Retry-After/backoff 重试一次。",
        );
        await context.sleepFn(delayMs);
        continue;
      }
      if (failure.details.classification !== "ambiguous_side_effect") throw failure;

      const reconciliation = await reconcileAmbiguousMutation(
        context,
        kind,
        targetDeploymentId,
        unchangedDeploymentId,
        attempt,
        error,
      );
      if (reconciliation.outcome === "reconciled") {
        context.logFn(
          "[Release Routing] " +
            kind +
            " outcome ambiguous，但 provider 已观察到 target=" +
            targetDeploymentId +
            "；不重复 side-effect POST。",
        );
        return { outcome: "reconciled" };
      }
      if (attempt === 1) {
        context.logFn(
          "[Release Routing] " +
            kind +
            " 在稳定 observation window 内确认 previous routing 未变更；执行一次 bounded retry。",
        );
        continue;
      }
      throw routingError({
        ...failure.details,
        reason: "mutation outcome 已稳定显示 previous，但 retry budget 已耗尽；拒绝继续重复 side-effect POST。",
        expectedDeploymentId: targetDeploymentId,
        observedDeploymentId: reconciliation.lastState.toDeploymentId ?? undefined,
        providerJobStatus: reconciliation.lastState.jobStatus ?? undefined,
        sideEffectMayHaveOccurred: true,
      }, error);
    }
  }
  throw new Error("unreachable");
}

interface MutationReconciliationResult {
  outcome: "reconciled" | "safe_to_retry";
  lastState: AliasState;
}

async function reconcileAmbiguousMutation(
  context: RoutingContext,
  kind: "promote" | "rollback",
  targetDeploymentId: string,
  unchangedDeploymentId: string | undefined,
  attempt: number,
  ambiguousError: unknown,
): Promise<MutationReconciliationResult> {
  const stage: RoutingFailureDetails["stage"] = kind === "promote" ? "promotion" : "compensation";
  const startedAt = context.nowFn();
  const timeoutMs = context.ambiguousReconciliationTimeoutMs;
  let stablePreviousObservations = 0;
  let reconciliationWindowSafeToRetry = unchangedDeploymentId !== undefined;
  let lastState: AliasState = { jobStatus: null, toDeploymentId: null };

  while (true) {
    try {
      lastState = await context.vercelClient.readAliasState({
        stage,
        operation: "reconcile_" + kind + "_outcome",
        expectedDeploymentId: targetDeploymentId,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
        deadlineAtMs: startedAt + timeoutMs,
      });

      if (lastState.toDeploymentId === targetDeploymentId) {
        if (isTerminalAliasFailure(lastState.jobStatus)) {
          throw routingError({
            stage,
            operation: "reconcile_" + kind + "_outcome",
            classification: "provider_contract",
            reason: "provider alias job 明确失败或被拒绝。",
            providerJobStatus: lastState.jobStatus ?? undefined,
            expectedDeploymentId: targetDeploymentId,
            observedDeploymentId: lastState.toDeploymentId,
            expectedReleaseTag: context.releaseTag,
            expectedReleaseCommit: context.releaseCommit,
            sideEffectMayHaveOccurred: true,
          });
        }
        return { outcome: "reconciled", lastState };
      }

      if (
        unchangedDeploymentId !== undefined &&
        lastState.toDeploymentId === unchangedDeploymentId &&
        lastState.jobStatus === "succeeded"
      ) {
        stablePreviousObservations += 1;
      } else {
        stablePreviousObservations = 0;
        reconciliationWindowSafeToRetry = false;
      }

      context.logFn(
        "[Release Routing] ambiguous " +
          kind +
          " reconciliation poll: observed=" +
          (lastState.toDeploymentId ?? "none") +
          ", status=" +
          (lastState.jobStatus ?? "none") +
          ", stablePreviousObservations=" +
          stablePreviousObservations,
      );
    } catch (error) {
      const failure = asRoutingError(error, {
        stage,
        operation: "reconcile_" + kind + "_outcome",
        classification: "ambiguous_side_effect",
        expectedDeploymentId: targetDeploymentId,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
        sideEffectMayHaveOccurred: true,
      });
      if (!isPollTransient(failure)) {
        throw routingError({
          ...failure.details,
          expectedDeploymentId: targetDeploymentId,
          sideEffectMayHaveOccurred: true,
        }, error);
      }
      stablePreviousObservations = 0;
      reconciliationWindowSafeToRetry = false;
      context.logFn(
        "[Release Routing] ambiguous " +
          kind +
          " reconciliation read transient failure，继续 observation window: classification=" +
          failure.details.classification,
      );
    }

    const elapsedMs = Math.max(0, context.nowFn() - startedAt);
    if (elapsedMs >= timeoutMs) {
      if (reconciliationWindowSafeToRetry && stablePreviousObservations >= 2) {
        context.logFn(
          "[Release Routing] ambiguous " +
            kind +
            " reconciliation window 完整结束，previous routing 全程稳定；允许一次 bounded retry。",
        );
        return { outcome: "safe_to_retry", lastState };
      }
      throw routingError({
        stage,
        operation: "reconcile_" + kind + "_outcome",
        classification: "ambiguous_side_effect",
        reason: "mutation outcome 在 bounded observation window 后仍不明确；拒绝重复 side-effect POST。",
        expectedDeploymentId: targetDeploymentId,
        observedDeploymentId: lastState.toDeploymentId ?? undefined,
        providerJobStatus: lastState.jobStatus ?? undefined,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
        attempt,
        elapsedMs,
        sideEffectMayHaveOccurred: true,
      }, ambiguousError);
    }
    await context.sleepFn(Math.min(context.pollIntervalMs, timeoutMs - elapsedMs));
  }
}

async function waitForAliasOperation(
  context: RoutingContext,
  expectedDeploymentId: string,
  stage: "promotion" | "compensation",
): Promise<AliasWaitResult> {
  const startedAt = context.nowFn();
  const timeoutMs = context.providerRoutingTimeoutMs;
  const deadlineAtMs = startedAt + timeoutMs;
  let polls = 0;
  let lastState: AliasState = { jobStatus: null, toDeploymentId: null };

  while (true) {
    polls += 1;
    try {
      lastState = await context.vercelClient.readAliasState({
        stage,
        operation: "wait_" + stage + "_alias_operation",
        expectedDeploymentId,
        expectedReleaseTag: context.releaseTag,
        expectedReleaseCommit: context.releaseCommit,
        deadlineAtMs,
      });
      if (
        lastState.jobStatus === "succeeded" &&
        lastState.toDeploymentId === expectedDeploymentId
      ) {
        return { polls, durationMs: Math.max(0, context.nowFn() - startedAt) };
      }
      if (lastState.toDeploymentId === expectedDeploymentId && isTerminalAliasFailure(lastState.jobStatus)) {
        throw routingError({
          stage,
          operation: "wait_" + stage + "_alias_operation",
          classification: "provider_contract",
          reason: "provider alias job 明确失败或被拒绝。",
          providerJobStatus: lastState.jobStatus ?? undefined,
          expectedDeploymentId,
          observedDeploymentId: lastState.toDeploymentId,
          expectedReleaseTag: context.releaseTag,
          expectedReleaseCommit: context.releaseCommit,
          sideEffectMayHaveOccurred: true,
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
    }

    if (pollExpired(context, startedAt, polls, timeoutMs)) {
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
  const timeoutMs = context.semanticConvergenceTimeoutMs;
  const deadlineAtMs = startedAt + timeoutMs;
  let polls = 0;
  let observedIdentity: ReleaseIdentity | undefined;

  while (true) {
    polls += 1;
    try {
      await context.httpClient.requestStatus(context.canonicalBaseUrl + "/", {
        stage,
        operation: "read_canonical_root",
        expectedReleaseTag: expectedIdentity.releaseTag,
        expectedReleaseCommit: expectedIdentity.releaseCommit,
        deadlineAtMs,
      });
      observedIdentity = await readCanonicalIdentity(
        context,
        stage,
        deadlineAtMs,
        expectedIdentity,
      );
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

    if (pollExpired(context, startedAt, polls, timeoutMs)) {
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

function retryDelay(context: RoutingContext, attempt: number): number {
  return Math.min(
    30_000,
    context.transportRetryDelayMs * 2 ** Math.max(0, attempt - 1),
  );
}

function isTerminalAliasFailure(jobStatus: string | null): boolean {
  return jobStatus !== null &&
    ["failed", "rejected", "error", "canceled", "cancelled"].includes(jobStatus.toLowerCase());
}

function pollExpired(
  context: RoutingContext,
  startedAt: number,
  polls: number,
  timeoutMs: number,
): boolean {
  return (
    context.nowFn() - startedAt >= timeoutMs ||
    polls * context.pollIntervalMs >= timeoutMs
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
      providerRoutingTimeoutMs: parseOptionalNumber(process.env.RELEASE_ROUTING_PROVIDER_TIMEOUT_MS),
      semanticConvergenceTimeoutMs: parseOptionalNumber(process.env.RELEASE_ROUTING_SEMANTIC_TIMEOUT_MS),
      ambiguousReconciliationTimeoutMs: parseOptionalNumber(process.env.RELEASE_ROUTING_RECONCILIATION_TIMEOUT_MS),
      requestTimeoutMs: parseOptionalNumber(process.env.RELEASE_ROUTING_REQUEST_TIMEOUT_MS),
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
