import { describe, expect, it } from "vitest";
import { serviceHealth } from "@/lib/service-health/contract";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import type { SchedulerHealthView } from "@/lib/scheduler/admin";

const now = 1_800_000_000_000;
const analysis = (partial = false, validUntil = now + 1): Pick<Analysis, "meta" | "operations"> => ({
  meta: { capturedAt: now, from: now - 86400000, oldest: now, batches: 1, bytes: 1, truncated: false, validUntil, totalReports: 1, uniqueEvents: 1, selected: 1, latest: now, partial },
  operations: [{ key: "auth.loginWithPassword", label: "login", start: 3, success: 1, rejected: 1, unknown: 1, pending: 0, completion: 100, n: 0, mean: null, p50: null, p75: null, p95: null, max: null }],
});
const job = { jobKey: "match-time-auto-award", label: "job", status: "normal", primaryTriggeredAt: new Date(now).toISOString(), dispatchRequestedAt: null, endpointSucceededAt: null, businessTransitionAt: null, watchdogSucceededAt: null, manualSucceededAt: null, failureAt: null } satisfies SchedulerHealthView;

describe("service health evidence", () => {
  it("keeps expected rejection and unknown separate without inferring failure or health", () => {
    const [auth, registration] = serviceHealth({ status: "ready", data: analysis() }, [job], now);
    expect(auth.status).toBe("未核验");
    expect(auth.coverage).toContain("拒绝 1；未知 1");
    expect(auth.action).toContain("不要直接重放");
    expect(registration.reason).toContain("无样本");
  });
  it("marks partial, expired, unavailable and missing scheduler evidence unverified", () => {
    for (const data of [analysis(true), analysis(false, now)]) expect(serviceHealth({ status: "ready", data }, [job], now)[0].reason).toContain("不完整或已过期");
    const items = serviceHealth({ status: "unavailable" }, null, now);
    expect(items.every(item => item.status === "未核验")).toBe(true);
    expect(serviceHealth({ status: "ready", data: analysis() }, [{ ...job, status: "degraded" }], now)[3].status).toBe("未核验");
    expect(serviceHealth({ status: "ready", data: analysis() }, [job], now)[3].status).toBe("正常");
    expect(serviceHealth({ status: "ready", data: analysis() }, [{ ...job, status: "degraded", dispatchRequestedAt: job.primaryTriggeredAt }], now)[3].status).toBe("需要关注");
  });
});
