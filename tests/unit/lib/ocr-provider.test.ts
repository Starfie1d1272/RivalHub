import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractScoreboardFromBase64 } from "@/lib/ocr";
import { OCRFailure, presentOCRFailure } from "@/lib/ocr/errors";
import { extractSafeException, sanitizeSafeContext } from "@/lib/observability/redact";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/fetch", () => ({ providerFetch: () => fetchMock }));
vi.mock("@/lib/observability/server", () => ({ logEvent: vi.fn(), traceOperation: (_name: string, _options: unknown, work: () => unknown) => work() }));

// Provider-boundary evidence: existing schema tests cannot prove that a readable
// PNG plus upstream 401 survives classification, fallback and safe diagnostics.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1EAAAAASUVORK5CYII=";
const successResponse = () => Response.json({ choices: [{ message: { content: JSON.stringify({ players: [{ perfectName: "Fixture", kills: 0, adr: "85.5" }] }) } }] });
const extract = () => extractScoreboardFromBase64(png, "image/png");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SILICONFLOW_API_KEY", "synthetic-test-credential");
  vi.stubEnv("SILICONFLOW_API_URL", "https://provider.invalid/v1/chat/completions");
  vi.stubEnv("OCR_PROVIDER", "siliconflow");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("OCR provider failure contract", () => {
  it.each([
    [401, "authentication", "invalid_credentials"],
    [403, "authentication", "permission_denied"],
    [429, "rate_limit", "rate_limited"],
    [503, "upstream", "upstream_failure"],
  ] as const)("preserves HTTP %i without blaming the PNG or retrying", async (status, kind, reason) => {
    fetchMock.mockResolvedValue(new Response("arbitrary private payload synthetic-test-credential", { status }));
    const error = await extract().catch(error => error as OCRFailure);
    expect(error).toMatchObject({ kind, reason, httpStatus: status, phase: "response" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const failure = presentOCRFailure(error as OCRFailure);
    expect(failure.message).toContain(`HTTP ${status}`);
    expect(failure.message).not.toContain("截图");
    expect(failure.meta).toMatchObject({ requestId: expect.any(String), configurationRequired: kind === "authentication" });
    expect(JSON.stringify({ error, exception: extractSafeException(error), context: sanitizeSafeContext({ errorCodes: (error as OCRFailure).errorChain }) })).not.toMatch(/arbitrary private|synthetic-test-credential/);
  });

  it("keeps network cause codes while discarding raw messages and URLs", async () => {
    fetchMock.mockRejectedValue(new TypeError("private data https://provider.invalid?key=synthetic-test-credential", { cause: Object.assign(new Error("private account"), { code: "ENOTFOUND" }) }));
    const error = await extract().catch(error => error as OCRFailure);
    expect(error).toMatchObject({ kind: "network", phase: "request", reason: "network_failure", errorChain: ["ocr.request.network_failure", "ENOTFOUND"] });
    expect(JSON.stringify(error)).not.toMatch(/private|synthetic-test-credential/);
  });

  it("distinguishes request timeout from network failures", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("private", "AbortError")))));
    const outcome = extract().catch(error => error);
    await vi.advanceTimersByTimeAsync(180000);
    expect(await outcome).toMatchObject({ kind: "timeout", phase: "request" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the timeout active while reading a successful response body", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) }));
    const outcome = extract().catch(error => error);
    await vi.advanceTimersByTimeAsync(180000);
    expect(await outcome).toMatchObject({ kind: "timeout", phase: "response" });
  });

  it.each(["not JSON private payload", JSON.stringify({ choices: [] }), JSON.stringify({ choices: [{ message: { content: "private invalid model text" } }] })])("classifies malformed provider/model output as upstream, not image", async body => {
    fetchMock.mockResolvedValue(new Response(body));
    const error = await extract().catch(error => error);
    expect(error).toMatchObject({ kind: "upstream", httpStatus: 200 });
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("falls back only for explicit response_format incompatibility and retains both failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("response_format is not supported", { status: 400 })).mockResolvedValueOnce(new Response("private account", { status: 401 }));
    const error = await extract().catch(error => error);
    expect(error).toMatchObject({ kind: "authentication", httpStatus: 401 });
    expect(error.errorChain.join(" ")).toMatch(/401.*400|400.*401/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("response_format");
  });

  it("recognizes image rejection without a pointless format retry", async () => {
    fetchMock.mockResolvedValue(new Response("invalid_image: unable to decode image", { status: 400 }));
    const error = await extract().catch(error => error);
    expect(error).toMatchObject({ kind: "image", phase: "response", reason: "invalid_image" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not relabel an unrelated 400 as an image failure", async () => {
    fetchMock.mockResolvedValue(new Response("invalid model", { status: 400 }));
    expect(await extract().catch(error => error)).toMatchObject({ kind: "upstream", reason: "request_rejected" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid encoding, MIME/signature and oversized input before a provider call", async () => {
    for (const [image, mime] of [["invalid!", "image/png"], [btoa("not an image"), "image/png"], [png, "image/jpeg"], [png, "text/plain"], ["A".repeat(14 * 1024 * 1024), "image/png"]]) {
      expect(await extractScoreboardFromBase64(image, mime as "image/png").catch(error => error)).toMatchObject({ kind: "image", phase: "image" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports absent configuration without claiming credential validity", async () => {
    vi.stubEnv("SILICONFLOW_API_KEY", "");
    expect(await extract().catch(error => error)).toMatchObject({ kind: "configuration", reason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("regresses normal PNG recognition and the supported fallback", async () => {
    fetchMock.mockResolvedValueOnce(new Response("response_format unsupported", { status: 400 })).mockResolvedValueOnce(successResponse());
    expect(await extract()).toMatchObject({ players: [{ perfectName: "Fixture", kills: 0, adr: 85.5 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
