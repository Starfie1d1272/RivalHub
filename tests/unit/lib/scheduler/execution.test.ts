import { beforeEach, describe, expect, it, vi } from "vitest";

const healthMocks = vi.hoisted(() => ({
  markBusinessTransition: vi.fn(),
  markEndpointStarted: vi.fn(),
  markJobFailed: vi.fn(),
  markJobSucceeded: vi.fn(),
  isPrimaryHealthy: vi.fn(),
  readSchedulerHealth: vi.fn(),
}));

vi.mock("@/lib/scheduler/health", () => healthMocks);
vi.mock("@/lib/observability/server", () => ({
  captureException: vi.fn(),
  logEvent: vi.fn(),
}));

import { executeScheduledJob } from "@/lib/scheduler/execution";

describe("scheduler execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    healthMocks.markBusinessTransition.mockResolvedValue(undefined);
    healthMocks.markEndpointStarted.mockResolvedValue(undefined);
    healthMocks.markJobFailed.mockResolvedValue(undefined);
    healthMocks.markJobSucceeded.mockResolvedValue(undefined);
    healthMocks.isPrimaryHealthy.mockReturnValue(false);
    healthMocks.readSchedulerHealth.mockResolvedValue(null);
  });

  it("runs a legacy request and records only positive business progress", async () => {
    const runner = vi.fn().mockResolvedValue({ result: { processed: 0 }, businessTransitions: 0 });

    const result = await executeScheduledJob(
      new Request("https://example.test/api/cron/draft-timeout"),
      "draft-timeout",
      runner,
    );

    expect(result).toMatchObject({ source: "legacy", skipped: false, businessTransitions: 0 });
    expect(runner).toHaveBeenCalledOnce();
    expect(healthMocks.markEndpointStarted).toHaveBeenCalledWith("draft-timeout", "legacy", expect.any(Date));
    expect(healthMocks.markJobSucceeded).toHaveBeenCalledWith("draft-timeout", "legacy", expect.any(Date));
    expect(healthMocks.markBusinessTransition).toHaveBeenCalledWith("draft-timeout", 0, expect.any(Date));
  });

  it("lets a watchdog no-op while the primary heartbeat is fresh", async () => {
    healthMocks.isPrimaryHealthy.mockReturnValue(true);
    healthMocks.readSchedulerHealth.mockResolvedValue({
      lastPrimaryTriggeredAt: new Date(),
      lastPrimaryEndpointSucceededAt: new Date(),
    });
    const runner = vi.fn();

    const result = await executeScheduledJob(
      new Request("https://example.test/api/cron/draft-timeout", {
        headers: { "x-rivalhub-cron-source": "github-watchdog" },
      }),
      "draft-timeout",
      runner,
    );

    expect(result).toEqual({
      source: "github-watchdog",
      skipped: true,
      skipReason: "primary_fresh",
      businessTransitions: 0,
    });
    expect(runner).not.toHaveBeenCalled();
    expect(healthMocks.markJobSucceeded).not.toHaveBeenCalled();
    expect(healthMocks.markEndpointStarted).not.toHaveBeenCalled();
  });

  it("reconciles when the primary trigger is fresh but endpoint success is stale", async () => {
    healthMocks.readSchedulerHealth.mockResolvedValue({
      lastPrimaryTriggeredAt: new Date(),
      lastPrimaryEndpointSucceededAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const runner = vi.fn().mockResolvedValue({ result: { picked: 1 }, businessTransitions: 1 });

    const result = await executeScheduledJob(
      new Request("https://example.test/api/cron/draft-timeout", {
        headers: { "x-rivalhub-cron-source": "github-watchdog" },
      }),
      "draft-timeout",
      runner,
    );

    expect(result).toMatchObject({ source: "github-watchdog", skipped: false, businessTransitions: 1 });
    expect(runner).toHaveBeenCalledOnce();
  });

  it("reconciles when the primary heartbeat is stale", async () => {
    healthMocks.readSchedulerHealth.mockResolvedValue({
      lastPrimaryTriggeredAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const runner = vi.fn().mockResolvedValue({ result: { picked: 1 }, businessTransitions: 1 });

    const result = await executeScheduledJob(
      new Request("https://example.test/api/cron/draft-timeout", {
        headers: { "x-rivalhub-cron-source": "github-watchdog" },
      }),
      "draft-timeout",
      runner,
    );

    expect(result).toMatchObject({ source: "github-watchdog", skipped: false, businessTransitions: 1 });
    expect(runner).toHaveBeenCalledOnce();
    expect(healthMocks.markEndpointStarted).toHaveBeenCalledWith("draft-timeout", "github-watchdog", expect.any(Date));
  });

  it("always runs an explicit GitHub manual dispatch even when primary is fresh", async () => {
    healthMocks.readSchedulerHealth.mockResolvedValue({
      lastPrimaryTriggeredAt: new Date(),
      lastPrimaryEndpointSucceededAt: new Date(),
    });
    const runner = vi.fn().mockResolvedValue({ result: { picked: 0 }, businessTransitions: 0 });

    const result = await executeScheduledJob(
      new Request("https://example.test/api/cron/draft-timeout", {
        headers: { "x-rivalhub-cron-source": "github-manual" },
      }),
      "draft-timeout",
      runner,
    );

    expect(result).toMatchObject({ source: "github-manual", skipped: false });
    expect(runner).toHaveBeenCalledOnce();
  });

  it("rejects an unknown source without invoking the runner", async () => {
    const runner = vi.fn();
    const result = await executeScheduledJob(
      new Request("https://example.test/api/cron/draft-timeout", {
        headers: { "x-rivalhub-cron-source": "browser" },
      }),
      "draft-timeout",
      runner,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(runner).not.toHaveBeenCalled();
  });
});
