export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_TRANSPORT_RETRY_ATTEMPTS = 5;
export const DEFAULT_TRANSPORT_RETRY_DELAY_MS = 3_000;
const MAX_RETRY_AFTER_MS = 30_000;

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
  retryAfterMs?: number;
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

export interface RequestMetadata {
  stage: RoutingFailureDetails["stage"];
  operation: string;
  authenticated?: boolean;
  expectedDeploymentId?: string;
  expectedReleaseTag?: string;
  expectedReleaseCommit?: string;
  deadlineAtMs?: number;
}

export interface RoutingHttpClient {
  requestJson(url: string, metadata: RequestMetadata): Promise<unknown>;
  requestStatus(url: string, metadata: RequestMetadata): Promise<void>;
  requestMutation(url: string, metadata: RequestMetadata): Promise<void>;
}

export interface RoutingHttpClientOptions {
  token?: string;
  fetchFn?: typeof fetch;
  sleepFn?: (milliseconds: number) => Promise<void>;
  nowFn?: () => number;
  requestTimeoutMs: number;
  transportRetryAttempts: number;
  transportRetryDelayMs: number;
}

interface DeploymentInfo {
  id: string;
  projectId: string;
  url: string;
  target: string;
  readyState: string;
}

export interface AliasState {
  jobStatus: string | null;
  toDeploymentId: string | null;
}

export interface VercelRoutingClient {
  resolveDeployment(host: string, metadata: RequestMetadata): Promise<DeploymentInfo>;
  readAliasState(metadata: RequestMetadata): Promise<AliasState>;
  promote(deploymentId: string, metadata: RequestMetadata): Promise<void>;
  rollback(deploymentId: string, metadata: RequestMetadata): Promise<void>;
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

export function routingError(
  details: RoutingFailureDetails,
  cause?: unknown,
): ReleaseRoutingError {
  return new ReleaseRoutingError(details, cause);
}

export function createRoutingHttpClient(
  options: RoutingHttpClientOptions,
): RoutingHttpClient {
  const transport: NormalizedTransport = {
    fetchFn: options.fetchFn ?? fetch,
    sleepFn: options.sleepFn ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    nowFn: options.nowFn ?? (() => Date.now()),
    requestTimeoutMs: options.requestTimeoutMs,
    transportRetryAttempts: options.transportRetryAttempts,
    transportRetryDelayMs: options.transportRetryDelayMs,
  };
  const token = options.token?.trim();

  return {
    requestJson: (url, metadata) =>
      requestWithRetries(transport, token, url, metadata, "json"),
    requestStatus: async (url, metadata) => {
      await requestWithRetries(transport, token, url, metadata, "status");
    },
    requestMutation: (url, metadata) =>
      requestMutation(transport, token, url, metadata),
  };
}

export function createVercelRoutingClient(options: {
  orgId: string;
  projectId: string;
  httpClient: RoutingHttpClient;
}): VercelRoutingClient {
  return {
    resolveDeployment: async (host, metadata) => {
      const operation = metadata.operation;
      const url =
        "https://api.vercel.com/v13/deployments/" +
        encodeURIComponent(host) +
        "?teamId=" +
        encodeURIComponent(options.orgId);
      const raw = await options.httpClient.requestJson(url, {
        ...metadata,
        operation,
        authenticated: true,
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
        projectId !== options.projectId ||
        deploymentUrl !== host ||
        target !== "production" ||
        readyState !== "READY"
      ) {
        throw routingError({
          ...metadata,
          operation,
          classification: "provider_contract",
          reason: "deployment 不属于当前 Vercel project、production target 或 READY state。",
          observedDeploymentId: idString(id),
        });
      }
      return { id, projectId, url: deploymentUrl, target, readyState };
    },

    readAliasState: async (metadata) => {
      const url =
        "https://api.vercel.com/v9/projects/" +
        encodeURIComponent(options.projectId) +
        "?rollbackInfo=true&teamId=" +
        encodeURIComponent(options.orgId);
      const raw = await options.httpClient.requestJson(url, {
        ...metadata,
        authenticated: true,
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
          ...metadata,
          classification: "provider_contract",
          reason: "Vercel lastAliasRequest payload 无效。",
        });
      }
      const jobStatus = aliasRecord.jobStatus;
      const toDeploymentId = aliasRecord.toDeploymentId;
      if (
        (jobStatus !== undefined && typeof jobStatus !== "string") ||
        (toDeploymentId !== undefined && typeof toDeploymentId !== "string")
      ) {
        throw routingError({
          ...metadata,
          classification: "provider_contract",
          reason: "Vercel alias operation status/target payload 无效。",
        });
      }
      return {
        jobStatus: typeof jobStatus === "string" ? jobStatus : null,
        toDeploymentId: typeof toDeploymentId === "string" ? toDeploymentId : null,
      };
    },

    promote: (deploymentId, metadata) =>
      postRouting(options.httpClient, "promote", deploymentId, {
        ...metadata,
        operation: "promote",
        authenticated: true,
        expectedDeploymentId: deploymentId,
      }),

    rollback: (deploymentId, metadata) =>
      postRouting(options.httpClient, "rollback", deploymentId, {
        ...metadata,
        operation: "rollback",
        authenticated: true,
        expectedDeploymentId: deploymentId,
      }),
  };

  async function postRouting(
    httpClient: RoutingHttpClient,
    kind: "promote" | "rollback",
    deploymentId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    const endpoint =
      kind === "promote"
        ? "https://api.vercel.com/v10/projects/" +
          encodeURIComponent(options.projectId) +
          "/promote/" +
          encodeURIComponent(deploymentId) +
          "?teamId=" +
          encodeURIComponent(options.orgId)
        : "https://api.vercel.com/v1/projects/" +
          encodeURIComponent(options.projectId) +
          "/rollback/" +
          encodeURIComponent(deploymentId) +
          "?teamId=" +
          encodeURIComponent(options.orgId);
    await httpClient.requestMutation(endpoint, metadata);
  }
}

interface NormalizedTransport {
  fetchFn: typeof fetch;
  sleepFn: (milliseconds: number) => Promise<void>;
  nowFn: () => number;
  requestTimeoutMs: number;
  transportRetryAttempts: number;
  transportRetryDelayMs: number;
}

async function requestWithRetries(
  transport: NormalizedTransport,
  token: string | undefined,
  url: string,
  metadata: RequestMetadata,
  responseKind: "json" | "status",
): Promise<unknown> {
  for (let attempt = 1; attempt <= transport.transportRetryAttempts; attempt += 1) {
    if (deadlineReached(transport, metadata.deadlineAtMs)) {
      throw routingError({
        ...metadata,
        classification: "transport_transient",
        reason: "request deadline exceeded before bounded retry。",
        attempt,
        sideEffectMayHaveOccurred: false,
      });
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        transport,
        token,
        url,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "RivalHub-Release-Routing",
          },
        },
        metadata,
        false,
      );
    } catch (error) {
      const failure = asRoutingError(error, {
        ...metadata,
        classification: "transport_transient",
        sideEffectMayHaveOccurred: false,
      });
      if (isReadTransientClassification(failure.details.classification) && canRetry(transport, metadata, attempt)) {
        await sleepBeforeRetry(transport, metadata, attempt);
        continue;
      }
      throw routingError({
        ...failure.details,
        attempt,
      }, error);
    }

    if (response.status < 200 || response.status >= 300) {
      const classification = classifyHttpStatus(response.status);
      if (isReadTransientClassification(classification) && canRetry(transport, metadata, attempt)) {
        await sleepBeforeRetry(transport, metadata, attempt);
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

    if (responseKind === "status") return undefined;
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

async function requestMutation(
  transport: NormalizedTransport,
  token: string | undefined,
  url: string,
  metadata: RequestMetadata,
): Promise<void> {
  const response = await fetchWithTimeout(
    transport,
    token,
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "RivalHub-Release-Routing",
      },
      body: "{}",
    },
    metadata,
    true,
  );
  if (response.status === 201 || response.status === 202) return;

  const classification = classifyHttpStatus(response.status, true);
  throw routingError({
    ...metadata,
    classification,
    reason:
      classification === "ambiguous_side_effect"
        ? "routing mutation 返回 transient provider status，side effect outcome 未知。"
        : classification === "rate_limited"
          ? "routing mutation 被 provider rate limited；请求未被视为 accepted。"
          : "routing mutation 返回非 accepted status。",
    httpStatus: response.status,
    retryAfterMs: classification === "rate_limited"
      ? parseRetryAfter(response.headers.get("retry-after"), transport.nowFn())
      : undefined,
    sideEffectMayHaveOccurred: classification === "ambiguous_side_effect",
  });
}

async function fetchWithTimeout(
  transport: NormalizedTransport,
  token: string | undefined,
  url: string,
  init: RequestInit,
  metadata: RequestMetadata,
  mutation: boolean,
): Promise<Response> {
  const remainingMs =
    metadata.deadlineAtMs === undefined
      ? transport.requestTimeoutMs
      : Math.min(
          transport.requestTimeoutMs,
          Math.max(0, metadata.deadlineAtMs - transport.nowFn()),
        );
  const timeoutMs = Math.max(1, remainingMs);
  const controller = new AbortController();
  const headers = new Headers(init.headers);
  if (metadata.authenticated && token) {
    headers.set("Authorization", "Bearer " + token);
  }
  const requestInit: RequestInit = {
    ...init,
    headers,
    signal: controller.signal,
  };
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new Error("request timeout");
  const requestPromise = Promise.resolve().then(() =>
    transport.fetchFn(url, requestInit),
  );
  const timeoutPromise = new Promise<Response>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (error) {
    throw routingError({
      ...metadata,
      classification: mutation ? "ambiguous_side_effect" : "transport_transient",
      reason: timedOut
        ? mutation
          ? "routing mutation request timeout，side effect outcome 未知。"
          : "provider request timeout after request-level deadline。"
        : mutation
          ? "routing mutation transport failure，side effect outcome 未知。"
          : "provider GET transport failure。",
      sideEffectMayHaveOccurred: mutation,
    }, error);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function canRetry(
  transport: NormalizedTransport,
  metadata: RequestMetadata,
  attempt: number,
): boolean {
  return (
    attempt < transport.transportRetryAttempts &&
    !deadlineReached(transport, metadata.deadlineAtMs)
  );
}

async function sleepBeforeRetry(
  transport: NormalizedTransport,
  metadata: RequestMetadata,
  attempt: number,
  requestedDelayMs = retryDelay(transport, attempt),
): Promise<void> {
  const remainingMs =
    metadata.deadlineAtMs === undefined
      ? requestedDelayMs
      : Math.max(0, metadata.deadlineAtMs - transport.nowFn());
  await transport.sleepFn(Math.min(requestedDelayMs, remainingMs));
}

function retryDelay(transport: NormalizedTransport, attempt: number): number {
  return Math.min(
    MAX_RETRY_AFTER_MS,
    transport.transportRetryDelayMs * 2 ** Math.max(0, attempt - 1),
  );
}

function deadlineReached(
  transport: NormalizedTransport,
  deadlineAtMs: number | undefined,
): boolean {
  return deadlineAtMs !== undefined && transport.nowFn() >= deadlineAtMs;
}

function parseRetryAfter(raw: string | null, nowMs: number): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000);
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - nowMs));
}

function isReadTransientClassification(
  classification: RoutingFailureClassification,
): boolean {
  return classification === "transport_transient" || classification === "rate_limited";
}

function asRoutingError(
  error: unknown,
  fallback: RoutingFailureDetails,
): ReleaseRoutingError {
  if (error instanceof ReleaseRoutingError) return error;
  return routingError(fallback, error);
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
