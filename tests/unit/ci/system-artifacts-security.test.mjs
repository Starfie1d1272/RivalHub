import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { copySafeTree, redact } from "../../../scripts/ci/system-artifact-sanitizer.mjs";

describe("system artifact sanitizer", () => {
  it("redacts credentials and drops binary or credential-bearing files", () => {
    const source = mkdtempSync(join(tmpdir(), "rivalhub-artifact-source-"));
    const target = mkdtempSync(join(tmpdir(), "rivalhub-artifact-target-"));
    try {
      mkdirSync(join(source, "nested"));
      writeFileSync(join(source, "nested", "debug.log"), "password=local-secret access_token=auth-secret Bearer abc.def.ghi alice@example.com evidence_object_key=education-evidence/01234567-89ab-4cde-8123-456789abcdef/abcdef12-3456-4abc-8123-abcdef123456.pdf\n", "utf8");
      writeFileSync(join(source, "screenshot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(join(source, "session.webm"), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      writeFileSync(join(source, "credentials.json"), '{"password":"must-not-copy"}\n', "utf8");

      copySafeTree(source, join(target, "safe"), true);

      const safeLog = readFileSync(join(target, "safe", "nested", "debug.log"), "utf8");
      expect(safeLog).not.toContain("local-secret");
      expect(safeLog).not.toContain("auth-secret");
      expect(safeLog).not.toContain("abc.def.ghi");
      expect(safeLog).not.toContain("alice@example.com");
      expect(safeLog).not.toContain("education-evidence");
      expect(safeLog).not.toContain("01234567-89ab-4cde-8123-456789abcdef");
      expect(safeLog).toContain("[REDACTED]");
      expect(existsSync(join(target, "safe", "screenshot.png"))).toBe(false);
      expect(existsSync(join(target, "safe", "session.webm"))).toBe(false);
      expect(existsSync(join(target, "safe", "credentials.json"))).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("redacts storage URLs and environment-shaped secrets without changing safe text", () => {
    const value = redact("GET https://local/storage/v1/object/sign/education-evidence/a/b.pdf?token=secret; signed=https://example.test/download/object-key.pdf?signature=signature-secret; SUPABASE_SERVICE_ROLE_KEY=service-role-secret");
    expect(value).not.toContain("service-role-secret");
    expect(value).not.toContain("?token=secret");
    expect(value).not.toContain("/storage/v1/object/");
    expect(value).not.toContain("signature-secret");
    expect(value).not.toContain("education-evidence");
    expect(value).toContain("[REDACTED_SIGNED_URL]");
  });
});
