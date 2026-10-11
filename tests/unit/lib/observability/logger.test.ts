import { describe, expect, it, vi } from "vitest";
import { captureException, logEvent } from "@/lib/observability/logger";
import { AppError, ErrorCode } from "@/lib/errors";

describe("structured observability events", () => {
  it("keeps the safe cause chain in the emitted event and sanitizes direct log input", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const event = captureException("action.unexpected_error", new Error("outer", { cause: Object.assign(new Error("network unavailable https://private.test/secret"), { code: "ECONNRESET" }) }), { scope: "action", operation: "save" });
      expect(event?.exception?.cause).toMatchObject({ code: "ECONNRESET", message: "network unavailable https://private.test/[REDACTED_URL_DETAILS]" });
      expect(JSON.parse(String(write.mock.calls[0][0])).exception.cause.code).toBe("ECONNRESET");
      const direct = logEvent({ level: "error", event: "test.failure", scope: "test", operation: "test", exception: { message: "outer", cause: { message: "token=private" } } });
      expect(JSON.stringify(direct)).not.toContain("private");
    } finally { write.mockRestore(); }
  });
  it("contains correlation and deployment fields while keeping context bounded", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef123456");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_424");
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const event = logEvent({
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
    });

    expect(event).toMatchObject({
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
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    writeSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("logs expected outcomes as low-noise info without recording an exception", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const event = captureException("action.expected", new AppError(ErrorCode.VALIDATION_FAILED, "输入无效"), {
      scope: "action",
      operation: "validate",
    });

    expect(event).toMatchObject({ level: "info", errorClass: "expected" });
    expect(event?.exception).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the deployment as a release marker for CLI deployments", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_424");
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    try {
      const event = logEvent({
        event: "observability.exporter.enabled",
        scope: "observability",
        operation: "configuration",
      });

      expect(event).toMatchObject({ release: "dpl_424", deployment: "dpl_424" });
    } finally {
      writeSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
