import { describe, expect, it, vi } from "vitest";
import { PreviewMirrorError, reportPreviewFailure } from "../../../scripts/db/preview/diagnostics";
import { runPreviewRefreshPhase } from "../../../scripts/db/preview/refresh";

describe("preview mirror diagnostics", () => {
  it("keeps a safe structural code while preserving the internal cause chain", async () => {
    const cause = new Error("provider body row-value SELECT * FROM users WHERE email=student@example.com Bearer fake-token /private/assets/logo.png");
    const wrapped = await runPreviewRefreshPhase("public asset upload", async () => {
      throw cause;
    }, () => {} ).catch((error: unknown) => error);

    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped).toMatchObject({
      code: "PREVIEW_PHASE_FAILED",
      phase: "public asset upload",
      message: "Preview mirror phase failed: public asset upload",
    });
    expect((wrapped as Error & { cause?: unknown }).cause).toBe(cause);
  });

  it("does not emit SQL, credentials, row values, emails, provider bodies, or asset paths", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const raw = new Error("provider body row-value SELECT * FROM users WHERE email=student@example.com Bearer fake-token /private/assets/logo.png");
      const error = new PreviewMirrorError("PREVIEW_STORAGE_FAILED", "Preview provider operation failed.", {
        cause: raw,
        context: { phase: "public asset upload", provider: "supabase", providerCode: "storage_error", httpStatus: 502, table: "users" },
        retryable: true,
      });
      const event = reportPreviewFailure("preview.mirror.refresh_failed", error, { operation: "refresh" });
      const output = JSON.stringify(event) + JSON.stringify(stderr.mock.calls) + JSON.stringify(stdout.mock.calls);

      expect(event).toMatchObject({
        errorClass: "dependency",
        errorCode: "PREVIEW_STORAGE_FAILED",
        retryable: true,
        safeContext: { phase: "public asset upload", provider: "supabase", providerCode: "storage_error", httpStatus: 502, table: "users" },
      });
      expect(output).not.toContain("student@example.com");
      expect(output).not.toContain("fake-token");
      expect(output).not.toContain("row-value");
      expect(output).not.toContain("provider body");
      expect(output).not.toContain("/private/assets/logo.png");
      expect(output).toContain("PREVIEW_STORAGE_FAILED");
      expect(output).toContain("public asset upload");
      expect(output).toContain("table");
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });
});
