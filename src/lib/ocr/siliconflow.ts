import "server-only";

import { playerRowLenientSchema, type ScoreboardOCRResult, type OCRProvider, type PlayerRowOCR } from "./types";
import { OCRFailure } from "./errors";
import { providerFetch } from "@/lib/observability/fetch";
import { logEvent, traceOperation } from "@/lib/observability/server";

const DEFAULT_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const DEFAULT_MODEL = "Qwen/Qwen3-VL-8B-Instruct";

const SYSTEM_PROMPT = `提取这张 CS2 记分板截图中所有玩家的数据，返回 JSON。

截图是一个表格，每行一个玩家，共 10 行。列从左到右：玩家昵称、击杀、死亡、助攻、爆头率、首杀、多杀、残局、ADR、RWS、Rating、WE。
跳过标题行，只取数据行。无法辨认的格子填 null。

返回格式：
{"players":[{"perfectName":"昵称","kills":20,"deaths":10,"assists":5,"hsPercent":30,"firstKills":3,"multiKills":2,"clutches":1,"adr":85.5,"rws":12.34,"ratingPro":1.25,"we":10.5}]}`;

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
}

function safeTransportCause(error: unknown): Error {
  // Keep an allowlisted transport cause, never its arbitrary message/URL.
  let code: unknown;
  try {
    const source = error as { code?: unknown; cause?: { code?: unknown } } | null;
    code = source?.cause?.code ?? source?.code;
  } catch { /* Untrusted exception getters must not mask the original failure. */ }
  const allowed = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"];
  return new Error(typeof code === "string" && allowed.includes(code) ? code : "transport_failure");
}

async function readFailureReason(response: Response): Promise<string> {
  // Inspect a bounded body solely to select fixed diagnostic codes. Never retain
  // arbitrary provider messages, codes, headers, request bodies or image data.
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
  if (response.status === 401) return "invalid_credentials";
  if (response.status === 403) return "permission_denied";
  if (response.status === 429) return /quota|balance|credit|额度|余额/i.test(text) ? "quota_exceeded" : "rate_limited";
  if (response.status >= 500) return "upstream_failure";
  if (response.status === 400) {
    if (/response_format/i.test(text) && /unsupported|not supported|does not support|not support|不支持/i.test(text)) return "response_format_rejected";
    if (/invalid[_ ]image|image[_ ](?:decode|parse)|(?:invalid|unable to (?:decode|parse)|cannot (?:decode|parse)).{0,40}image|图片.{0,20}(?:无效|解析失败)/i.test(text)) return "invalid_image";
  }
  return "request_rejected";
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
          { type: "text", text: "请识别并返回这张完美平台记分板截图中所有玩家的数据。" },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0,
  };

  if (params.withResponseFormat) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);

  return traceOperation("provider.siliconflow.chat_completion", {
    scope: "provider",
    operation: "ocr.chat_completion",
    provider: "siliconflow",
    attributes: { "rivalhub.workflow": "ocr" },
  }, async () => {
    let phase: "request" | "response" = "request";
    try {
      const response = await providerFetch("siliconflow")(params.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      phase = "response";
      if (!response.ok) {
        const reason = await readFailureReason(response);
        const kind = response.status === 401 || response.status === 403 ? "authentication"
          : response.status === 429 ? "rate_limit"
            : reason === "invalid_image" ? "image" : "upstream";
        throw new OCRFailure(kind, "response", reason, response.status, {
          requestId: params.requestId,
          cause: new Error(`siliconflow.http.${response.status}.${reason}`),
        });
      }

      let json: unknown;
      try { json = await response.json(); } catch {
        if (controller.signal.aborted) throw new OCRFailure("timeout", "response", "response_timeout", undefined, { requestId: params.requestId });
        throw new OCRFailure("upstream", "json_parse", "invalid_response_json", response.status, { requestId: params.requestId });
      }
      const content = getResponseContent(json);
      if (!content) throw new OCRFailure("upstream", "response", "empty_response", response.status, { requestId: params.requestId });
      return { content, httpStatus: response.status };
    } catch (error) {
      if (error instanceof OCRFailure) throw error;
      const timedOut = controller.signal.aborted;
      throw new OCRFailure(timedOut ? "timeout" : "network", phase, timedOut ? "request_timeout" : "network_failure", undefined, {
        requestId: params.requestId,
        // Provider exceptions can contain URLs, credentials or user data.
        cause: safeTransportCause(error),
      });
    } finally {
      // The deadline includes reading the response body, not only HTTP headers.
      clearTimeout(timer);
    }
  });
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

  return traceOperation("provider.siliconflow.ocr", {
    scope: "provider",
    operation: "ocr.extract",
    provider: "siliconflow",
    attributes: { "rivalhub.workflow": "ocr" },
  }, async () => {
    logEvent({
      level: "info",
      event: "provider.siliconflow.request_started",
      scope: "provider",
      operation: "ocr.extract",
      requestId,
      safeContext: { provider: "siliconflow", imageBytes: base64Image.length, mimeType },
    });

    const callParams: CallParams = { apiUrl, apiKey, model, base64Image, mimeType, withResponseFormat: true, requestId };

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
          requestId, cause: new Error(`siliconflow.http.${fallbackError.httpStatus ?? 0}.${fallbackError.reason}`, { cause: error }),
        });
      }
    }

    let parsed: unknown;
    try { parsed = extractJson(result.content); } catch {
      throw new OCRFailure("upstream", "json_parse", "invalid_model_json", result.httpStatus, { requestId });
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
      throw new OCRFailure("upstream", "shape", error instanceof OCRFailure ? error.reason : "invalid_result_shape", result.httpStatus, { requestId });
    }

    if (rawPlayers.length === 0) {
      throw new OCRFailure("upstream", "shape", "empty_players", result.httpStatus, { requestId });
    }
    if (rawPlayers.length > 20) rawPlayers = rawPlayers.slice(0, 20);

    const validPlayers: PlayerRowOCR[] = [];
    let idx = 0;
    for (const row of rawPlayers) {
      const r = playerRowLenientSchema.safeParse(row);
      if (!r.success) {
        logEvent({
          level: "warn",
          event: "provider.siliconflow.row_rejected",
          scope: "provider",
          operation: "ocr.validate",
          requestId,
          errorClass: "expected",
          safeContext: { provider: "siliconflow", rowIndex: idx + 1, reason: "invalid_player_row" },
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
      safeContext: { provider: "siliconflow", count: validPlayers.length, status: "completed" },
    });

    if (validPlayers.length === 0) {
      throw new OCRFailure("upstream", "shape", "invalid_player_rows", result.httpStatus, { requestId });
    }

    return { players: validPlayers };
  });
}

function getResponseContent(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const choices = (value as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" && content.trim() ? content : null;
}

export const siliconflowProvider: OCRProvider = {
  name: "siliconflow",
  extract,
};
