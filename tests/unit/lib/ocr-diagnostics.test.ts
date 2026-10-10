import { describe, expect, it } from "vitest";
import { extractOCRDiagnostics } from "@/lib/ocr/diagnostics";

// Provider-controlled cause graphs need an independent privacy/termination
// contract; a status mapping test cannot expose cyclic or throwing objects.
describe("bounded OCR diagnostics", () => {
  it("bounds text and recursion and never invokes an arbitrary getter", () => {
    const chain: { message: string; cause?: unknown } = { message: "Detailed upstream cause ".repeat(100) };
    chain.cause = chain;
    const messages = extractOCRDiagnostics(chain);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toHaveLength(160);
    const malicious = Object.defineProperty({}, "message", { get() { throw new Error("private getter"); } });
    expect(extractOCRDiagnostics(malicious)).toEqual([]);
    let deep: unknown = { message: "last" };
    for (let i = 0; i < 20; i++) deep = { name: "TransportCause", code: `E${i}`, message: `cause ${i}`, cause: deep };
    expect(extractOCRDiagnostics(deep)).toHaveLength(6);
  });

  it("removes exact credential/image echoes, credential patterns, URL credentials and email", () => {
    const error = { code: "EUPSTREAM", message: "Key echo opaque-credential image short-base64 Bearer unknown-token sk-providerunknown123 https://owner:p%40ss@provider.invalid/p/opaque-token?access_token=other customer@example.com" };
    const diagnostic = extractOCRDiagnostics(error, ["opaque-credential", "short-base64"])[0];
    expect(diagnostic.code).toBe("EUPSTREAM");
    expect(diagnostic.message).toContain("Key echo");
    for (const secret of ["opaque-credential", "short-base64", "unknown-token", "sk-providerunknown123", "owner", "p%40ss", "opaque-token", "access_token", "customer@example.com"]) expect(diagnostic.message).not.toContain(secret);
    expect(extractOCRDiagnostics({ code: "EROOT", message: "Root failure", cause: "Proxy rejected the connection" })[1]).toMatchObject({ name: "ProviderCause", message: "Proxy rejected the connection" });
  });
});
