import { afterEach, expect, it, vi } from "vitest";
import { trace, type Tracer } from "@opentelemetry/api";
vi.mock("@/db/client", () => ({ db: { transaction: async (work: (tx: unknown) => unknown) => work({}) } }));
vi.mock("@/lib/auth/session-registry", () => ({ beginPasswordMutationInTx: async () => "mutation", finishPasswordMutationInTx: vi.fn() }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: vi.fn() }));
import { mutatePassword } from "@/lib/auth/password-mutation";
import { PasswordMutationError } from "@/lib/auth/password-error";
afterEach(() => vi.restoreAllMocks());
// Exercise the actual generic tracing/export boundary: final actionError
// sanitization cannot undo a credential already recorded by span.recordException.
it("projects credential-provider throws before any span sees free text or stack", async () => {
  const span = { setStatus: vi.fn(), setAttribute: vi.fn(), recordException: vi.fn(), end: vi.fn() };
  const startSpan = vi.fn(() => span);
  vi.spyOn(trace, "getTracer").mockReturnValue({ startSpan } as unknown as Tracer);
  const secret = "TraceCredential7!Synthetic";
  const providerError = Object.assign(new Error(`Rejected input ${secret}`), { code: "ETIMEDOUT" });
  providerError.stack = `free stack with ${secret}\nat credential endpoint`;
  const failure = await mutatePassword("user", "clock", "user.reset_password", async () => { throw providerError; }).catch(error => error);
  expect(failure).toBeInstanceOf(PasswordMutationError);
  expect(failure).toMatchObject({ outcome: "unknown" });
  expect(failure.cause).toBe(providerError);
  expect(span.recordException).toHaveBeenCalled();
  const exported = JSON.stringify([startSpan.mock.calls, span.recordException.mock.calls, span.setAttribute.mock.calls, span.setStatus.mock.calls]);
  expect(exported).not.toContain(secret);
  expect(exported).not.toContain("Rejected input");
  expect(exported).not.toContain("free stack");
  expect(span.recordException.mock.calls.every(([event]) => !("message" in event) && !("stack" in event))).toBe(true);
});
