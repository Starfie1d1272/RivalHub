import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchProvider } = vi.hoisted(() => ({ fetchProvider: vi.fn() }));
vi.mock("@/lib/observability/fetch", () => ({ providerFetch: () => fetchProvider }));
vi.mock("@/lib/observability/server", () => ({
  logEvent: vi.fn(),
  traceOperation: (_name: string, _options: unknown, execute: () => unknown) => execute(),
}));

import { siliconflowProvider } from "@/lib/ocr/siliconflow";
import { OCRFailure, presentOCRFailure } from "@/lib/ocr/errors";

const image = "private-image-fixture";
const key = "private-provider-key-fixture";
const run = () => siliconflowProvider.extract(image, "image/png");

describe("OCR response-body failure boundary", () => {
  beforeEach(() => {
    fetchProvider.mockReset();
    vi.stubEnv("SILICONFLOW_API_KEY", key);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("retains a redacted transport cause when a successful HTTP response body fails", async () => {
    const cause = Object.assign(new Error(`socket closed ${key} ${image}`), { code: "UND_ERR_SOCKET" });
    const response = new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("terminated", { cause })); },
    }), { status: 200 });
    fetchProvider.mockResolvedValue(response);

    const error = await run().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(OCRFailure);
    expect(error).toMatchObject({ kind: "network", phase: "response", reason: "network_failure" });
    expect((error as OCRFailure).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UND_ERR_SOCKET" }),
    ]));
    const exposed = JSON.stringify({ error, presented: presentOCRFailure(error as OCRFailure) });
    expect(exposed).not.toContain(key);
    expect(exposed).not.toContain(image);
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });

  it("keeps malformed JSON separate without retaining the upstream body", async () => {
    fetchProvider.mockResolvedValue(new Response(`not-json ${key} ${image}`, { status: 200 }));
    const error = await run().catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind: "upstream", phase: "json_parse", reason: "invalid_response_json", diagnostics: [] });
    expect(JSON.stringify(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(image);
  });

  it("retains the abort cause and response phase when the body exceeds the deadline", async () => {
    vi.useFakeTimers();
    fetchProvider.mockImplementation((_url: string, options: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        options.signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("body aborted"), { name: "AbortError", code: "ABORT_ERR" })), { once: true });
      },
    })));
    const pending = run().catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(180000);
    const error = await pending;
    expect(error).toMatchObject({ kind: "timeout", phase: "response", reason: "response_timeout" });
    expect((error as OCRFailure).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AbortError" }),
    ]));
  });

  it("preserves an HTTP rejection when its error body cannot be read", async () => {
    fetchProvider.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("terminated")); },
    }), { status: 503 }));
    const error = await run().catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind: "upstream", phase: "response", httpStatus: 503 });
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });
});
