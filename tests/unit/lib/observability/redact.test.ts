import { describe, expect, it } from "vitest";
import { extractSafeException, redactText, sanitizeSafeContext } from "@/lib/observability/redact";

describe("observability redaction", () => {
  it("ignores accessor and hostile array context without losing other diagnostic fields", () => {
    let reads = 0;
    const context = Object.defineProperties({ provider: "steam", httpStatus: 503 }, {
      password: { enumerable: true, get: () => { reads++; throw new Error("private"); } },
      reason: { enumerable: true, get: () => { reads++; throw new Error("private"); } },
      errorCodes: { enumerable: true, value: new Proxy([], { get: () => { throw new Error("private array"); } }) },
    });
    expect(sanitizeSafeContext(context)).toEqual({ provider: "steam", httpStatus: 503 });
    expect(reads).toBe(0);
  });

  // Security contract: inner causes add diagnostic value without introducing
  // unbounded data, URL secrets, or a second path around PostgreSQL redaction.
  it("suppresses every wrapper message when a nested cause is PostgreSQL", () => {
    const error = { message: "private bound value", cause: { code: "23505", constraint: "users_email_unique", message: "private params", params: ["private"] } };
    expect(extractSafeException(error)).toEqual({ name: "PostgreSQLError", code: "23505", constraint: "users_email_unique" });
  });

  it("redacts opaque Supabase secrets from text and exception codes", () => {
    expect(redactText("provider failed sb_secret_abc123_X-y")).not.toContain("abc123_X-y");
    expect(extractSafeException({ code: "sb_secret_abc123_X-y" }).code).toBeUndefined();
  });

  it("retains each bounded cause, removes secret URLs, and tolerates hostile getters", () => {
    const inner = { name: "NetworkError", code: "ECONNRESET", message: "failed https://user:pass@example.test/private-material?signature=opaque#secret" };
    Object.defineProperty(inner, "stack", { get: () => { throw new Error("do not read inner stack"); } });
    const outer = { name: "Error", message: "operation failed", cause: inner };
    const safe = extractSafeException(outer);
    expect(safe).toMatchObject({ message: "operation failed", cause: { name: "NetworkError", code: "ECONNRESET", message: "failed https://example.test/[REDACTED_URL_DETAILS]" } });
    expect(JSON.stringify(safe)).not.toMatch(/pass|private-material|opaque|secret/);
    const cycle: { message: string; cause?: unknown } = { message: "x".repeat(10_000) };
    cycle.cause = cycle;
    expect(extractSafeException(cycle).cause).toBeUndefined();
    let chain: unknown = cycle;
    for (let i = 0; i < 20; i++) chain = { message: "x".repeat(10_000), cause: chain };
    const bounded = extractSafeException(chain);
    let count = 0;
    for (let item: typeof bounded | undefined = bounded; item; item = item.cause) {
      count++;
      expect(item.message?.length).toBeLessThanOrEqual(600);
    }
    expect(count).toBe(8);
    const hostile = Object.defineProperty({}, "cause", { get: () => { throw new Error("private"); } });
    expect(() => extractSafeException(hostile)).not.toThrow();
  });

  it("uses the PostgreSQL classification fields without exposing query details or params", () => {
    const error = {
      name: "DatabaseError",
      code: "23505",
      constraint: "users_email_unique",
      detail: "Key (email)=(student@example.edu) already exists",
      query: "insert into users (email, student_id) values ($1, $2)",
      params: ["student@example.edu", "education-code"],
    };

    const safe = extractSafeException(error);

    expect(safe).toEqual({ name: "PostgreSQLError", code: "23505", constraint: "users_email_unique" });
    expect(JSON.stringify(safe)).not.toContain("student@example.edu");
    expect(JSON.stringify(safe)).not.toContain("education-code");
    expect(JSON.stringify(safe)).not.toContain("insert into");
  });

  it("keeps only the explicit safe-context allowlist", () => {
    const safe = sanitizeSafeContext({
      provider: "turnstile",
      count: 2,
      jobKey: "draft-timeout",
      source: "github-watchdog",
      password: "do-not-log",
      query: "select * from users where id = $1",
      raw: { educationCode: "private" },
      errorCodes: ["invalid-input-response"],
    });

    expect(safe).toEqual({ provider: "turnstile", count: 2, jobKey: "draft-timeout", source: "github-watchdog", errorCodes: ["invalid-input-response"] });
    expect(JSON.stringify(safe)).not.toContain("do-not-log");
    expect(JSON.stringify(safe)).not.toContain("educationCode");
  });

  it("redacts credentials, email addresses, data URLs, and SQL-like text", () => {
    const safe = redactText("Bearer abcdefghijkl password=secret user@example.com data:image/png;base64,AAAA select * from users");
    expect(safe).toBe("[REDACTED]");
    expect(safe).not.toContain("abcdefghijkl");
    expect(safe).not.toContain("user@example.com");
  });

  it("redacts education evidence and verification code key-value pairs", () => {
    const safe = redactText("educationCode=private verification_code=private evidence=private education verification code: private");
    expect(safe).not.toContain("private");
  });

  it("redacts a standalone natural-language verification code", () => {
    const safe = redactText("verification code: private");
    expect(safe).not.toContain("private");
  });
});
