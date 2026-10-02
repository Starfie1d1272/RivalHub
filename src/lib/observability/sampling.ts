import { SpanKind, type Attributes } from "@opentelemetry/api";
import { AlwaysOnSampler, ParentBasedSampler, TraceIdRatioBasedSampler, type Sampler } from "@opentelemetry/sdk-trace-base";

/** Next BaseServer.handleRequest supplies http.target before route matching. */
function isCronRequest(kind: SpanKind, attributes: Attributes): boolean {
  if (kind !== SpanKind.SERVER) return false;
  // Only inspect routing attributes; never request headers, bodies or span names.
  for (const key of ["http.target", "url.path", "http.route", "next.route"]) {
    const value = attributes[key];
    if (typeof value === "string" && value.startsWith("/")) {
      return value.split(/[?#]/, 1)[0].startsWith("/api/cron/");
    }
  }
  return false;
}

export function createTraceSampler(environment: string): Sampler {
  const always = new AlwaysOnSampler();
  const cron = new TraceIdRatioBasedSampler(0.05);
  const requestSampler: Sampler = {
    shouldSample(...args) {
      try {
        return environment === "production" && isCronRequest(args[3], args[4])
          ? cron.shouldSample(args[0], args[1])
          : always.shouldSample();
      } catch {
        // A malformed instrumentation attribute must not break the request.
        return always.shouldSample();
      }
    },
    toString: () => "RivalHubRequestSampler(cron=0.05,other=1)",
  };
  return new ParentBasedSampler({
    root: requestSampler,
    // Incoming platform/remote trace flags cannot override this service's policy.
    // Once the local request is decided, every local child follows its parent.
    remoteParentSampled: requestSampler,
    remoteParentNotSampled: requestSampler,
  });
}
