import { describe, expect, it } from "vitest";
import { extractSafeException, redactText, sanitizeSafeContext } from "@/lib/observability/redact";

describe("observability redaction", () => {
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

  it("bounds cause traversal and survives circular or throwing getters", () => {
    const circular: Record<string, unknown> = {
      name: "ProviderError",
      message: "Authorization: Bearer very-secret-token",
      stack: "ProviderError: Authorization: Bearer very-secret-token",
    };
    circular.cause = circular;
    Object.defineProperty(circular, "query", { get: () => { throw new Error("must not read"); } });

    const safe = extractSafeException(circular);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("very-secret-token");
    expect(serialized).not.toContain("query");
    expect(serialized.length).toBeLessThan(4_500);
  });

  it("keeps only the explicit safe-context allowlist", () => {
    const safe = sanitizeSafeContext({
      provider: "turnstile",
      count: 2,
      password: "do-not-log",
      query: "select * from users where id = $1",
      raw: { educationCode: "private" },
      errorCodes: ["invalid-input-response"],
    });

    expect(safe).toEqual({ provider: "turnstile", count: 2, errorCodes: ["invalid-input-response"] });
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
