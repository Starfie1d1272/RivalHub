import { execFileSync } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { ARTIFACT_LIMITS, copySafeTree, createArtifactBudget, readArtifactText, redact } from "../../../scripts/ci/system-artifact-sanitizer.mjs";

describe("system artifact sanitizer", () => {
  it("redacts opaque Supabase secrets without an env label", () => {
    expect(redact("provider failed sb_secret_abc123_X-y")).not.toContain("abc123_X-y");
    expect(redact("SUPABASE_SECRET_KEY=opaque-value")).not.toContain("opaque-value");
  });

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

      copySafeTree(source, join(target, "safe-with-screenshot"), false, { allowFailureScreenshots: true });
      expect(existsSync(join(target, "safe-with-screenshot", "screenshot.png"))).toBe(true);
      expect(existsSync(join(target, "safe-with-screenshot", "session.webm"))).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("omits Playwright trace archives from the default failure bundle", () => {
    const source = mkdtempSync(join(tmpdir(), "rivalhub-trace-source-"));
    const archiveContent = mkdtempSync(join(tmpdir(), "rivalhub-trace-content-"));
    const target = mkdtempSync(join(tmpdir(), "rivalhub-trace-target-"));
    try {
      writeFileSync(join(archiveContent, "trace.trace"), "password=private-value\n", "utf8");
      execFileSync("zip", ["-q", join(source, "trace.zip"), "trace.trace"], { cwd: archiveContent });

      copySafeTree(source, join(target, "safe"), false);

      expect(existsSync(join(target, "safe", "trace.zip"))).toBe(false);
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(archiveContent, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});

function withWorkspace(work) {
  const root = mkdtempSync(join(tmpdir(), "rivalhub-bounded-artifacts-"));
  try { return work(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function sparseFile(path, size, tail = "") {
  const fd = openSync(path, "w");
  try {
    ftruncateSync(fd, size);
    if (tail) writeSync(fd, Buffer.from(tail), 0, Buffer.byteLength(tail), size - Buffer.byteLength(tail));
  } finally { closeSync(fd); }
}

describe("bounded failure evidence", () => {
  it("skips oversized HTML and entire long-line reports, retaining small redacted diagnostics", () => withWorkspace(root => {
    const source = join(root, "input"), target = join(root, "output"); mkdirSync(source);
    sparseFile(join(source, "huge.html"), ARTIFACT_LIMITS.textFileBytes + 1);
    writeFileSync(join(source, "embedded.js"), `password=PRIVATE_START\n${"A".repeat(ARTIFACT_LIMITS.lineBytes + 1)}PRIVATE_END\n`);
    writeFileSync(join(source, "small.html"), "<p>failed: user@example.com password=private-value</p>\n");
    const budget = copySafeTree(source, target, true);
    expect(existsSync(join(target, "huge.html"))).toBe(false);
    expect(existsSync(join(target, "embedded.js"))).toBe(false);
    expect(readFileSync(join(target, "small.html"), "utf8")).toContain("failed:");
    expect(readFileSync(join(target, "small.html"), "utf8")).not.toMatch(/user@example|private-value/);
    expect(budget.skipped).toMatchObject({ fileBytes: 1, longLine: 1 });
    expect(JSON.stringify(budget)).not.toMatch(/PRIVATE|huge.html|embedded.js/);
  }));

  it("bounds eligible file count and lazy traversal even when entries cannot be copied", () => withWorkspace(root => {
    const source = join(root, "input"), target = join(root, "output"); mkdirSync(source);
    for (let i = 0; i < ARTIFACT_LIMITS.files + 5; i++) writeFileSync(join(source, `${i}.log`), "diagnostic\n");
    const budget = copySafeTree(source, target, true);
    expect(readdirSync(target)).toHaveLength(ARTIFACT_LIMITS.files);
    expect(budget.files).toBe(ARTIFACT_LIMITS.files);
    expect(budget.skipped.fileLimit).toBeGreaterThan(0);
    const uncopyable = join(root, "uncopyable"); mkdirSync(uncopyable);
    for (let i = 0; i < ARTIFACT_LIMITS.entries + 5; i++) writeFileSync(join(uncopyable, `${i}.zip`), "not uploaded");
    const traversal = copySafeTree(uncopyable, join(root, "unused"), true);
    expect(traversal.entries).toBe(ARTIFACT_LIMITS.entries);
    expect(traversal.skipped.entryLimit).toBeGreaterThan(0);
  }));

  it("stops directory nesting at the declared depth", () => withWorkspace(root => {
    let nested = root;
    for (let i = 0; i < ARTIFACT_LIMITS.depth + 2; i++) { nested = join(nested, "nested"); mkdirSync(nested); }
    writeFileSync(join(nested, "deep.log"), "not visited");
    const target = join(root, "output");
    const budget = copySafeTree(join(root, "nested"), target, true);
    expect(budget.skipped.depthLimit).toBeGreaterThan(0);
    expect(budget.files).toBe(0);
  }));

  it("shares input/output budgets across trees and preserves the existing screenshot cap", () => withWorkspace(root => {
    const source = join(root, "images"), target = join(root, "output"); mkdirSync(source);
    sparseFile(join(source, "valid.png"), ARTIFACT_LIMITS.failureScreenshotBytes);
    sparseFile(join(source, "oversized.png"), ARTIFACT_LIMITS.failureScreenshotBytes + 1);
    const budget = createArtifactBudget();
    copySafeTree(source, target, false, { budget, allowFailureScreenshots: true });
    expect(statSync(join(target, "valid.png")).size).toBe(ARTIFACT_LIMITS.failureScreenshotBytes);
    expect(existsSync(join(target, "oversized.png"))).toBe(false);
    for (let i = 0; i < 4; i++) copySafeTree(source, join(root, `more-${i}`), false, { budget, allowFailureScreenshots: true });
    expect(budget.inputBytes).toBeLessThanOrEqual(ARTIFACT_LIMITS.inputBytes);
    expect(budget.outputBytes).toBeLessThanOrEqual(ARTIFACT_LIMITS.outputBytes - ARTIFACT_LIMITS.summaryReserveBytes);
    expect(budget.skipped.inputBytes).toBeGreaterThan(0);
  }));

  it("caps aggregate text reads and skips output expansion as a whole file", () => withWorkspace(root => {
    const source = join(root, "input"), target = join(root, "output"); mkdirSync(source);
    const text = "diagnostic\n".repeat(Math.floor(ARTIFACT_LIMITS.textFileBytes / 11));
    for (let i = 0; i < 6; i++) writeFileSync(join(source, `${i}.txt`), text);
    const budget = copySafeTree(source, target, true);
    expect(budget.textInputBytes).toBeLessThanOrEqual(ARTIFACT_LIMITS.textInputBytes);
    expect(budget.skipped.textInputBytes).toBeGreaterThan(0);
    const expanding = join(root, "expanding"); mkdirSync(expanding);
    writeFileSync(join(expanding, "expanded.txt"), "password=x\n".repeat(80_000));
    const expanded = copySafeTree(expanding, join(root, "expanded-output"), true);
    expect(existsSync(join(root, "expanded-output", "expanded.txt"))).toBe(false);
    expect(expanded.skipped.outputBytes).toBe(1);
  }));

  it("ignores file and directory symlinks, including a symlinked tree root", () => withWorkspace(root => {
    const source = join(root, "input"), target = join(root, "output"); mkdirSync(source);
    writeFileSync(join(root, "private.txt"), "PRIVATE_ORIGINAL");
    symlinkSync(join(root, "private.txt"), join(source, "linked.log"));
    symlinkSync(root, join(source, "linked-dir"), "dir");
    const budget = copySafeTree(source, target, true);
    expect(existsSync(target)).toBe(false);
    expect(budget.skipped.symbolicLink).toBe(2);
    const linkedRoot = join(root, "linked-root"); symlinkSync(source, linkedRoot, "dir");
    expect(copySafeTree(linkedRoot, target, true).skipped.symbolicLink).toBe(1);
  }));

  it("reads only a bounded log suffix, omits partial/long lines, and keeps the last 2000 redacted lines", () => withWorkspace(root => {
    const log = join(root, "huge.log");
    sparseFile(log, 64 * 1024 * 1024, `PRIVATE_PARTIAL_FRAGMENT\n${"PRIVATE_LONG_LINE".repeat(500)}\nretained password=private-value\n`);
    const budget = createArtifactBudget();
    const text = readArtifactText(log, budget, { tail: true });
    expect(text).not.toMatch(/PRIVATE_PARTIAL_FRAGMENT|PRIVATE_LONG_LINE/);
    expect(text).toContain("retained");
    expect(budget.inputBytes).toBe(ARTIFACT_LIMITS.logTailBytes);
    expect(budget.skipped).toMatchObject({ partialTailLine: 1, longLine: 1 });
    writeFileSync(log, `${"normal diagnostic\n".repeat(2500)}final token=private-token\n`);
    const latest = readArtifactText(log, createArtifactBudget(), { tail: true });
    expect(latest.split("\n")).toHaveLength(ARTIFACT_LIMITS.logTailLines);
  }));

  it("fails closed when suffix selection could expose a fragment of a multiline env secret", () => withWorkspace(root => {
    vi.stubEnv("ARTIFACT_TEST_SECRET", "private-start\nprivate-middle\nprivate-end");
    try {
      expect(redact("private-start\nprivate-middle\nprivate-end")).toBe("[REDACTED_ENV]");
      const log = join(root, "cut.log");
      writeFileSync(log, `${"normal\n".repeat(2500)}private-end\n`);
      const budget = createArtifactBudget();
      expect(readArtifactText(log, budget, { tail: true })).toBeUndefined();
      expect(budget.skipped.multilineSecretBoundary).toBe(1);
    } finally { vi.unstubAllEnvs(); }
  }));

  it("prepares a bounded bundle with mixed secrets, attempts and normal reports without uploading skipped input", () => withWorkspace(root => {
    mkdirSync(join(root, ".agent-tmp", "e2e-attempts"), { recursive: true });
    mkdirSync(join(root, "playwright-report"));
    writeFileSync(join(root, "playwright-report", "index.html"), "<p>normal small report</p>\n");
    sparseFile(join(root, "playwright-report", "large.html"), 8 * 1024 * 1024);
    writeFileSync(join(root, ".agent-tmp", "e2e-attempts", "safe.attempt.json"), JSON.stringify({ scenarioId: "e2e-fixed", retry: 1, status: "passed" }));
    sparseFile(join(root, ".agent-tmp", "next-server.log"), 64 * 1024 * 1024,
      "old-partial-fragment\nKEEP_CURRENT alice@example.com password=private-value Bearer opaque-auth https://example.test/path?signature=private-signature evidence_object_key=education-evidence/private-object\n");
    symlinkSync(join(root, "playwright-report", "index.html"), join(root, ".agent-tmp", "e2e-exit-boundary.jsonl"));
    const script = fileURLToPath(new URL("../../../scripts/ci/prepare-system-artifacts.mjs", import.meta.url));
    execFileSync(process.execPath, [script], { cwd: root });
    const output = join(root, ".agent-tmp", "system-artifacts");
    const log = readFileSync(join(output, "next-server.safe.log"), "utf8");
    expect(log).toContain("KEEP_CURRENT");
    expect(log).not.toMatch(/old-partial-fragment|alice@example.com|private-value|opaque-auth|private-signature|private-object/);
    expect(existsSync(join(output, "e2e-exit-boundary.safe.jsonl"))).toBe(false);
    expect(existsSync(join(output, "playwright-report", "large.html"))).toBe(false);
    expect(readFileSync(join(output, "playwright-report", "index.html"), "utf8")).toContain("normal small report");
    expect(JSON.parse(readFileSync(join(output, "e2e-attempts.json"), "utf8"))).toMatchObject({ retryCount: 1, flakyCount: 1 });
    const summary = JSON.parse(readFileSync(join(output, "sanitization-summary.json"), "utf8"));
    expect(summary.inputBytes).toBeLessThan(ARTIFACT_LIMITS.logTailBytes + 1024);
    expect(summary.skipped).toMatchObject({ symbolicLink: 1, fileBytes: 1, partialTailLine: 1 });
    expect(JSON.stringify(summary)).not.toMatch(/private|alice|signature|large.html/);
  }));
});
