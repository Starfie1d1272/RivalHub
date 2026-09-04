import { describe, expect, it, vi } from "vitest";
import { buildStructuredEvent } from "@/lib/observability/logger";

describe("structured observability events", () => {
  it("contains correlation and deployment fields while keeping context bounded", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef123456");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_424");
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const event = buildStructuredEvent({
      level: "error",
      event: "provider.failure",
      scope: "provider",
      operation: "ocr",
      errorClass: "dependency",
      errorCode: "UPSTREAM_TIMEOUT",
      retryable: true,
      route: "/admin/season?token_hash=private",
      requestId: "req-424",
      durationMs: 12.7,
      message: "upstream unavailable",
      exception: { name: "Error", message: "Bearer secret must not survive" },
      safeContext: { provider: "siliconflow", count: 2, password: "secret", raw: circular },
    }, new Date("2026-09-05T00:00:00.000Z"));

    expect(event).toMatchObject({
      timestamp: "2026-09-05T00:00:00.000Z",
      environment: "preview",
      route: "/admin/season",
      requestId: "req-424",
      release: "abcdef123456",
      deployment: "dpl_424",
      durationMs: 13,
      safeContext: { provider: "siliconflow", count: 2 },
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("password");
    vi.unstubAllEnvs();
  });
});
