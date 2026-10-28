import "server-only";

import { createHash } from "node:crypto";

import { playerRowLenientSchema, type ScoreboardOCRResult, type OCRProvider, type PlayerRowOCR } from "./types";
import { OCRFailure, type OCRResponseSummary } from "./errors";
import { extractOCRDiagnostics } from "./diagnostics";
import { logEvent } from "@/lib/observability/server";

const DEFAULT_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const DEFAULT_MODEL = "Qwen/Qwen3.5-27B";

// Tuple columns follow the screenshot; expand them only after provider parsing.
const SCOREBOARD_COLUMNS = ["perfectName", "kills", "deaths", "assists", "hsPercent", "firstKills", "multiKills", "clutches", "adr", "rws", "ratingPro", "we"] as const;
const SYSTEM_PROMPT = `读取记分板全部10行。只返回JSON：{"players":[["昵称",20,10,5,30,3,2,1,85.5,12.34,1.25,10.5]]}。
每行按截图列序：昵称、击杀、死亡、助攻、爆头率、首杀、多杀、残局、ADR、RWS、Rating、WE。
每行必须有12个值，未知填null，数值不带单位。跳过标题行，最多10行。
输出紧凑JSON，字符串以外不加空格或换行；输出完players对象后立即结束。`;

const USER_PROMPT = "请识别并返回这张完美平台记分板截图中所有玩家的数据。";

function expandPlayerRow(row: unknown): unknown {
  if (!Array.isArray(row)) return row;
  // Missing cells must be explicit nulls; reject shifted or truncated rows.
  if (row.length !== SCOREBOARD_COLUMNS.length) return null;
  return Object.fromEntries(SCOREBOARD_COLUMNS.map((column, index) => [column, row[index]]));
}

function extractPlayersArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;

  if (!parsed || typeof parsed !== "object") {
    throw new OCRFailure("upstream", "shape", "invalid_result_shape");
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.players)) return obj.players as unknown[];

  const data = obj.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).players)) {
    return (data as Record<string, unknown>).players as unknown[];
  }

  throw new OCRFailure("upstream", "shape", "missing_players");
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new OCRFailure("upstream", "json_parse", "invalid_model_json");
    try { return JSON.parse(match[0]); } catch {
      throw new OCRFailure("upstream", "json_parse", "invalid_model_json");
    }
  }
}

interface CallParams {
  apiUrl: string;
  apiKey: string;
  model: string;
  base64Image: string;
  mimeType: string;
  withResponseFormat: boolean;
  requestId: string;
  deadline: number;
}

async function readFailureReason(response: Response, sensitiveValues: readonly string[]) {
  // Inspect a bounded error body and retain only sanitized scalar reasons.
  // Request bodies, headers and image data never enter this projection.
  const reader = response.body?.getReader();
  let text = "";
  if (reader) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (length < 8192) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value.subarray(0, 8192 - length);
        chunks.push(chunk);
        length += chunk.length;
      }
      text = Buffer.concat(chunks).toString("utf8");
    } catch { /* HTTP status remains authoritative if the body cannot be read. */ }
    finally { await reader.cancel().catch(() => undefined); }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* Do not retain unstructured bodies. */ }
  const error = parsed && typeof parsed === "object" && "error" in parsed ? (parsed as { error: unknown }).error : parsed;
  const diagnostics = error && typeof error === "object" ? extractOCRDiagnostics(error, sensitiveValues) : [];
  const reason = response.status === 401 ? "invalid_credentials"
    : response.status === 403 ? "permission_denied"
      : response.status === 429 ? /quota|balance|credit|额度|余额/i.test(text) ? "quota_exceeded" : "rate_limited"
        : response.status >= 500 ? "upstream_failure"
          : response.status === 400 && /response_format/i.test(text) && /unsupported|not supported|does not support|not support|不支持/i.test(text) ? "response_format_rejected"
            : response.status === 400 && /invalid[_ ]image|image[_ ](?:decode|parse)|(?:invalid|unable to (?:decode|parse)|cannot (?:decode|parse)).{0,40}image|图片.{0,20}(?:无效|解析失败)/i.test(text) ? "invalid_image"
              : "request_rejected";
  return { reason, diagnostics };
}

async function callAPI(params: CallParams) {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${params.mimeType};base64,${params.base64Image}` },
          },
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
    max_tokens: 2048,
    temperature: 0,
  };

  if (params.model.startsWith("Qwen/Qwen3.5-")) {
    // Qwen3.5 non-thinking recommendations; use SiliconFlow's documented knobs.
    // https://huggingface.co/Qwen/Qwen3.5-9B#best-practices
    body.enable_thinking = false;
    body.temperature = 0.7;
    body.top_p = 0.8;
    body.top_k = 20;
  }

  if (params.withResponseFormat) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const remaining = params.deadline - performance.now();
  if (remaining <= 0) throw new OCRFailure("timeout", "request", "request_timeout", undefined, { requestId: params.requestId });
  const timer = setTimeout(() => controller.abort(), remaining);

  logEvent({
    level: "info", event: "provider.siliconflow.request_started", scope: "provider", operation: "ocr.extract",
    requestId: params.requestId,
    safeContext: {
      provider: "siliconflow", model: [DEFAULT_MODEL, "Qwen/Qwen3.5-9B"].includes(params.model) ? params.model : "custom",
      imageBytes: Buffer.byteLength(params.base64Image, "base64"), mimeType: params.mimeType,
      imageDigest: createHash("sha256").update(Buffer.from(params.base64Image, "base64")).digest("hex"),
      configDigest: createHash("sha256").update(JSON.stringify({ ...body, apiUrl: params.apiUrl, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: USER_PROMPT }] })).digest("hex"),
      responseFormat: params.withResponseFormat,
    },
  });
  let phase: "request" | "response" = "request";
  let responseSummary: Partial<OCRResponseSummary> = {};
  try {
    const response = await fetch(params.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    phase = "response";
    const providerTraceId = response.headers.get("x-siliconcloud-trace-id");
    if (providerTraceId && /^ti_[a-zA-Z0-9_-]{8,64}$/.test(providerTraceId)
      && ![params.apiKey, params.base64Image].some(value => value && providerTraceId.includes(value))) {
      responseSummary.providerTraceId = providerTraceId;
    }
    if (!response.ok) {
      const { reason, diagnostics } = await readFailureReason(response, [params.apiKey, params.base64Image]);
      const kind = response.status === 401 || response.status === 403 ? "authentication"
        : response.status === 429 ? "rate_limit"
          : reason === "invalid_image" ? "image" : "upstream";
      throw new OCRFailure(kind, "response", reason, response.status, {
        requestId: params.requestId,
        diagnostics, responseSummary,
        cause: new Error(`siliconflow.http.${response.status}.${reason}`),
      });
    }

    let json: unknown;
    try { json = await response.json(); } catch (error) {
      if (!controller.signal.aborted && error instanceof SyntaxError) {
        throw new OCRFailure("upstream", "json_parse", "invalid_response_json", response.status, { requestId: params.requestId, responseSummary });
      }
      // Body streams can fail after valid HTTP headers; preserve the transport boundary.
      throw error;
    }
    const { content, summary } = readCompletion(json);
    Object.assign(summary, responseSummary);
    responseSummary = summary;
    const failureOptions = { requestId: params.requestId, responseSummary: summary };
    // Even syntactically valid JSON can be a partial scoreboard at the limit.
    if (summary.finishReason === "length") {
      throw new OCRFailure("upstream", "response", "output_truncated", response.status, failureOptions);
    }
    if (summary.finishReason === "content_filter" || summary.finishReason === "tool_calls") {
      throw new OCRFailure("upstream", "response", "unexpected_finish_reason", response.status, failureOptions);
    }
    if (!content?.trim()) throw new OCRFailure("upstream", "response", "empty_response", response.status, failureOptions);
    return { content, httpStatus: response.status, summary };
  } catch (error) {
    if (error instanceof OCRFailure) throw error;
    const timedOut = controller.signal.aborted;
    throw new OCRFailure(timedOut ? "timeout" : "network", phase, timedOut ? (phase === "response" ? "response_timeout" : "request_timeout") : "network_failure", undefined, {
      requestId: params.requestId, responseSummary,
      // Preserve the real transport cause only after bounded projection and redaction.
      diagnostics: extractOCRDiagnostics(error, [params.apiKey, params.base64Image]),
    });
  } finally {
    // The deadline includes reading the response body, not only HTTP headers.
    clearTimeout(timer);
  }
}

async function extract(base64Image: string, mimeType: string): Promise<ScoreboardOCRResult> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey?.trim()) {
    throw new OCRFailure("configuration", "configuration", "missing_credentials");
  }

  const apiUrl = process.env.SILICONFLOW_API_URL || DEFAULT_API_URL;
  const model = process.env.SILICONFLOW_MODEL || DEFAULT_MODEL;
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    throw new OCRFailure("configuration", "configuration", "invalid_endpoint");
  }
  const requestId = crypto.randomUUID();

  const callParams: CallParams = { apiUrl, apiKey, model, base64Image, mimeType, withResponseFormat: true, requestId, deadline: performance.now() + 180000 };

  let result;
  try {
    result = await callAPI(callParams);
  } catch (error) {
    if (!(error instanceof OCRFailure) || error.httpStatus !== 400 || error.reason !== "response_format_rejected") throw error;
    logEvent({
      level: "info",
      event: "provider.siliconflow.response_format_fallback",
      scope: "provider",
      operation: "ocr.extract",
      requestId,
      errorClass: "expected",
      safeContext: { provider: "siliconflow", httpStatus: 400, reason: error.reason },
    });
    callParams.withResponseFormat = false;
    try { result = await callAPI(callParams); } catch (fallbackError) {
      if (!(fallbackError instanceof OCRFailure)) throw fallbackError;
      throw new OCRFailure(fallbackError.kind, fallbackError.phase, fallbackError.reason, fallbackError.httpStatus, {
        diagnostics: [...error.diagnostics.slice(0, 2), ...fallbackError.diagnostics],
        responseSummary: fallbackError.responseSummary,
        requestId, cause: new Error(`siliconflow.http.${fallbackError.httpStatus ?? 0}.${fallbackError.reason}`, { cause: error }),
      });
    }
  }

  const failureOptions = { requestId, responseSummary: result.summary };
  let parsed: unknown;
  try { parsed = extractJson(result.content); } catch {
    throw new OCRFailure("upstream", "json_parse", "invalid_model_json", result.httpStatus, failureOptions);
  }

  const parsedCount = Array.isArray(parsed)
    ? parsed.length
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).players)
      ? ((parsed as Record<string, unknown>).players as unknown[]).length
      : 0;
  logEvent({
    level: "info",
    event: "provider.siliconflow.response_received",
    scope: "provider",
    operation: "ocr.parse",
    requestId,
    safeContext: { provider: "siliconflow", count: parsedCount, responseFormat: callParams.withResponseFormat },
  });

  let rawPlayers: unknown[];
  try { rawPlayers = extractPlayersArray(parsed); } catch (error) {
    throw new OCRFailure("upstream", "shape", error instanceof OCRFailure ? error.reason : "invalid_result_shape", result.httpStatus, failureOptions);
  }

  result.summary.rowCount = Math.min(rawPlayers.length, 1_000_000);
  result.summary.emptyNameRows = Math.min(rawPlayers.filter(row => {
    const expanded = expandPlayerRow(row) as Record<string, unknown> | null;
    return expanded && (typeof expanded.perfectName !== "string" || !expanded.perfectName.trim());
  }).length, 1_000_000);

  if (rawPlayers.length === 0) {
    throw new OCRFailure("upstream", "shape", "empty_players", result.httpStatus, failureOptions);
  }
  if (rawPlayers.length > 20) rawPlayers = rawPlayers.slice(0, 20);

  const validPlayers: PlayerRowOCR[] = [];
  let idx = 0;
  for (const row of rawPlayers) {
    const r = playerRowLenientSchema.safeParse(expandPlayerRow(row));
    if (!r.success) {
      logEvent({
        level: "warn",
        event: "provider.siliconflow.row_rejected",
        scope: "provider",
        operation: "ocr.validate",
        requestId,
        errorClass: "expected",
        safeContext: {
          provider: "siliconflow", rowIndex: idx + 1,
          reason: Array.isArray(row) && row.length !== SCOREBOARD_COLUMNS.length ? "invalid_column_count"
            : Array.isArray(row) && (typeof row[0] !== "string" || !row[0].trim()) ? "missing_player_name" : "invalid_player_row",
          count: Array.isArray(row) ? Math.min(row.length, 100) : undefined,
        },
      });
    } else {
      validPlayers.push(r.data);
    }
    idx++;
  }

  logEvent({
    level: "info",
    event: "provider.siliconflow.result",
    scope: "provider",
    operation: "ocr.validate",
    requestId,
    safeContext: { ...result.summary, provider: "siliconflow", count: validPlayers.length, status: validPlayers.length ? "completed" : "rejected" },
  });

  if (validPlayers.length === 0) {
    throw new OCRFailure("upstream", "shape", "invalid_player_rows", result.httpStatus, failureOptions);
  }

  return { players: validPlayers };
}

function readCompletion(value: unknown): { content: string | null; summary: OCRResponseSummary } {
  const envelope = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const choices = envelope.choices;
  const choice = Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
    ? choices[0] as Record<string, unknown> : {};
  const message = choice.message && typeof choice.message === "object" ? choice.message as Record<string, unknown> : {};
  const content = typeof message.content === "string" ? message.content : null;
  const reason = choice.finish_reason;
  // Provider strings are untrusted: only a fixed enum and bounded counts leave here.
  const finishReason = reason === "stop" || reason === "eos" || reason === "length" || reason === "content_filter" || reason === "tool_calls"
    ? reason : "unknown";
  const usage = envelope.usage && typeof envelope.usage === "object" ? envelope.usage as Record<string, unknown> : {};
  const tokens = usage.completion_tokens;
  const promptTokens = usage.prompt_tokens;
  // Repeated 32-character chunks in the final 8192 characters are a signal, not a loop verdict.
  const chunks = content?.slice(-8192).match(/[\s\S]{32}/g) ?? [];
  const outputRepeatedChunkPercent = chunks.length ? Math.round((chunks.length - new Set(chunks).size) / chunks.length * 100) : 0;
  return {
    content,
    summary: {
      finishReason,
      outputRepeatedChunkPercent,
      promptTokens: typeof promptTokens === "number" && Number.isSafeInteger(promptTokens) && promptTokens >= 0 && promptTokens <= 1_000_000 ? promptTokens : undefined,
      outputChars: Math.min(content?.length ?? 0, 1_000_000),
      outputWhitespacePercent: content?.length ? Math.round((content.match(/\s/g)?.length ?? 0) / content.length * 100) : 0,
      completionTokens: typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= 1_000_000 ? tokens : undefined,
    },
  };
}

export const siliconflowProvider: OCRProvider = {
  name: "siliconflow",
  extract,
};
