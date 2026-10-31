import { describe, expect, it } from "vitest";
import { serviceHealth } from "@/lib/service-health/contract";
import type { Analysis } from "@/lib/telemetry/analysis-model";
import type { SchedulerHealthView } from "@/lib/scheduler/admin";

const now = 1_800_000_000_000;
const analysis = (): Pick<Analysis, "meta" | "operations"> => ({
  meta: { capturedAt: now, from: now - 86400000, oldest: now, batches: 1, bytes: 1, truncated: false, validUntil: now + 1, totalReports: 1, uniqueEvents: 1, selected: 1, latest: now, partial: false },
  operations: [{ key: "auth.loginWithPassword", label: "login", start: 3, success: 1, rejected: 1, unknown: 1, pending: 0, completion: 100, n: 0, mean: null, p50: null, p75: null, p95: null, max: null }],
});
const job = { jobKey: "match-time-auto-award", label: "job", status: "normal", primaryTriggeredAt: new Date(now).toISOString(), dispatchRequestedAt: null, endpointSucceededAt: null, businessTransitionAt: null, watchdogSucceededAt: null, manualSucceededAt: null, failureAt: null } satisfies SchedulerHealthView;

describe("service health evidence", () => {
  it("distinguishes empty, closed, unknown and pending samples", () => {
    const data = analysis();
    const [unknown, empty] = serviceHealth({ status: "ready", data }, [job], now);
    expect(unknown.status).toBe("需要关注");
    expect(unknown.reason).toContain("结果待确认");
    expect(unknown.action).toContain("不要直接重放");
    expect(empty.status).toBe("暂无样本");
    Object.assign(data.operations[0], { unknown: 0, pending: 1 });
    expect(serviceHealth({ status: "ready", data }, [job], now)[0].status).toBe("待确认");
    Object.assign(data.operations[0], { pending: 0, success: 0, rejected: 3 });
    const closed = serviceHealth({ status: "ready", data }, [job], now)[0];
    expect(closed.status).toBe("正常");
    expect(closed.reason).toContain("不代表整体生产健康");
    Object.assign(data.operations[0], { success: 2, rejected: 1 });
    expect(serviceHealth({ status: "ready", data }, [job], now)[0].status).toBe("正常");
    expect(JSON.stringify(closed)).not.toMatch(/失败率|%|raw.?error|邮箱|电话/i);
  });
  it("marks incomplete, truncated, expired or unavailable evidence unverified", () => {
    for (const change of [{ partial: true }, { truncated: true }, { validUntil: now }]) {
      const data = analysis(); Object.assign(data.meta, change);
      expect(serviceHealth({ status: "ready", data }, [job], now)[0].status).toBe("未核验");
    }
    for (const status of ["unavailable", "unconfigured"] as const) expect(serviceHealth({ status }, null, now).every(item => item.status === "未核验")).toBe(true);
  });
  it("uses scheduler freshness and flags unconfirmed dispatch", () => {
    const telemetry = { status: "ready", data: analysis() } as const;
    expect(serviceHealth(telemetry, [job], now)[3].status).toBe("正常");
    expect(serviceHealth(telemetry, [{ ...job, status: "degraded" }], now)[3].status).toBe("需要关注");
    expect(serviceHealth(telemetry, [{ ...job, primaryTriggeredAt: null }], now)[3].status).toBe("未核验");
    expect(serviceHealth(telemetry, [{ ...job, dispatchRequestedAt: job.primaryTriggeredAt }], now)[3].status).toBe("需要关注");
  });
});
