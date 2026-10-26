import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchProvider } = vi.hoisted(() => ({ fetchProvider: vi.fn() }));
vi.mock("@/lib/observability/fetch", () => ({ providerFetch: () => fetchProvider }));
vi.mock("@/lib/observability/server", () => ({
  logEvent: vi.fn(),
  traceOperation: (_name: string, _options: unknown, execute: () => unknown) => execute(),
}));

import { siliconflowProvider } from "@/lib/ocr/siliconflow";
import { logEvent } from "@/lib/observability/server";
import { OCRFailure, presentOCRFailure } from "@/lib/ocr/errors";

const image = "private-image-fixture";
const key = "private-provider-key-fixture";
const run = () => siliconflowProvider.extract(image, "image/png");

describe("OCR response-body failure boundary", () => {
  beforeEach(() => {
    fetchProvider.mockReset();
    vi.mocked(logEvent).mockClear();
    vi.stubEnv("SILICONFLOW_MODEL", "");
    vi.stubEnv("SILICONFLOW_API_KEY", key);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("maps compact scoreboard columns and rejects incomplete rows", async () => {
    fetchProvider.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ players: [
      ["fixture", 20, 10, 5, 30, 3, 2, 1, 85.5, 12.34, 1.25, 10.5],
      ["shifted", 20],
    ] }) } }] }));
    expect(await run()).toEqual({ players: [{ perfectName: "fixture", kills: 20, deaths: 10, assists: 5, hsPercent: 30, firstKills: 3, multiKills: 2, clutches: 1, adr: 85.5, rws: 12.34, ratingPro: 1.25, we: 10.5 }] });
  });

  it("disables thinking for the default extraction model", async () => {
    fetchProvider.mockResolvedValue(Response.json({ choices: [{ message: { content: '{"players":[{"perfectName":"fixture"}]}' } }] }));
    await run();
    expect(JSON.parse(fetchProvider.mock.calls[0][1].body)).toMatchObject({
      model: "Qwen/Qwen3.5-27B", enable_thinking: false,
      temperature: 0.7, top_p: 0.8, top_k: 20, max_tokens: 2048,
    });
  });

  // Provider output is private. Diagnose truncation without retaining content or
  // exposing upstream metadata in the public action error, and never replay it.
  it.each(['{"players":[{"perfectName":"fixture"}]}', '{"players":' + " ".repeat(10_000)])(
    "rejects length-limited output even if it happens to parse (case %#)",
    async (content) => {
      fetchProvider.mockResolvedValue(Response.json({
        choices: [{ finish_reason: "length", message: { content } }],
        usage: { completion_tokens: 2048 },
      }));
      const error = await run().catch((failure: unknown) => failure);
      expect(error).toMatchObject({ kind: "upstream", phase: "response", reason: "output_truncated",
        responseSummary: { finishReason: "length", completionTokens: 2048, outputChars: content.length } });
      expect(fetchProvider).toHaveBeenCalledTimes(1);
      expect(presentOCRFailure(error as OCRFailure).message).toContain("未完整生成");
      expect(presentOCRFailure(error as OCRFailure).message).not.toContain("HTTP 200");
      expect(JSON.stringify(presentOCRFailure(error as OCRFailure))).not.toMatch(/completionTokens|outputChars|finishReason/);
      expect(JSON.stringify(error)).not.toContain(content);
    },
  );

  it("projects bounded counters and fixed finish reasons from private malformed output", async () => {
    const content = `private-output ${key} ${image} `;
    fetchProvider.mockResolvedValue(Response.json({
      choices: [{ finish_reason: `${key} ${image}`, message: { content } }],
      usage: { completion_tokens: key },
    }));
    const error = await run().catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason: "invalid_model_json", responseSummary: {
      finishReason: "unknown", outputChars: content.length, completionTokens: undefined,
      outputWhitespacePercent: Math.round(3 / content.length * 100),
    } });
    expect(JSON.stringify(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(image);
  });

  it("diagnoses missing names and correlates requests without logging private input", async () => {
    const content = JSON.stringify({ players: [[null, 20, 10, 5, 30, 3, 2, 1, 85.5, 12.34, 1.25, 10.5]] });
    fetchProvider.mockResolvedValue(Response.json({
      choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 400 },
    }, { headers: { "x-siliconcloud-trace-id": "ti_fixture12345678" } }));
    const error = await run().catch((failure: unknown) => failure);
    expect(error).toMatchObject({ reason: "invalid_player_rows", responseSummary: {
      providerTraceId: "ti_fixture12345678", promptTokens: 1200, rowCount: 1, emptyNameRows: 1,
    } });
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "provider.siliconflow.request_started",
      safeContext: expect.objectContaining({ model: "Qwen/Qwen3.5-27B", imageDigest: expect.stringMatching(/^[a-f0-9]{64}$/), configDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "provider.siliconflow.result",
      safeContext: expect.objectContaining({ count: 0, rowCount: 1, emptyNameRows: 1, status: "rejected" }),
    }));
    expect(fetchProvider).toHaveBeenCalledTimes(1);
    const exposed = JSON.stringify({ logs: vi.mocked(logEvent).mock.calls, error, publicError: presentOCRFailure(error as OCRFailure) });
    expect(exposed).not.toContain(content);
    expect(exposed).not.toContain(key);
    expect(exposed).not.toContain(image);
    expect(JSON.stringify(presentOCRFailure(error as OCRFailure))).not.toMatch(/providerTraceId|rowCount|emptyNameRows|promptTokens/);
  });

  it("retains response-header correlation on transport failure and discards hostile trace headers", async () => {
    fetchProvider.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("terminated")); },
    }), { headers: { "x-siliconcloud-trace-id": "ti_fixture12345678" } }));
    expect(await run().catch((error: unknown) => error)).toMatchObject({ responseSummary: { providerTraceId: "ti_fixture12345678" } });
    fetchProvider.mockResolvedValue(Response.json({ choices: [{ finish_reason: "length", message: { content: "x".repeat(8192) } }],
      usage: { prompt_tokens: key } }, { headers: { "x-siliconcloud-trace-id": `ti_${key}` } }));
    const error = await run().catch((failure: unknown) => failure);
    expect(error.responseSummary).toMatchObject({ outputRepeatedChunkPercent: 100, promptTokens: undefined });
    expect(error.responseSummary.providerTraceId).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(key);
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
  it("shares the original deadline with the explicit response-format fallback", async () => {
    vi.useFakeTimers();
    let attempt = 0;
    fetchProvider.mockImplementation((_url: string, options: RequestInit) => {
      attempt++;
      if (attempt === 1) return new Promise(resolve => setTimeout(() => resolve(new Response(
        '{"error":{"message":"response_format is not supported"}}', { status: 400 })), 100000));
      return new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const pending = run().catch((failure: unknown) => failure);
    await vi.advanceTimersByTimeAsync(100000);
    expect(fetchProvider).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(80000);
    expect(await pending).toMatchObject({ kind: "timeout" });
  });

});
