import { playerRowLenientSchema, type ScoreboardOCRResult, type OCRProvider, type PlayerRowOCR } from "./types";

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
    throw new Error("OCR 结果格式校验失败：模型返回格式异常，请重试");
  }

  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.players)) return obj.players as unknown[];

  const data = obj.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).players)) {
    return (data as Record<string, unknown>).players as unknown[];
  }

  throw new Error("OCR 结果格式校验失败：未找到 players 数组，请确认截图清晰可读");
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
    if (!match) throw new Error("模型没有返回可解析 JSON");
    return JSON.parse(match[0]);
  }
}

interface CallParams {
  apiUrl: string;
  apiKey: string;
  model: string;
  base64Image: string;
  mimeType: string;
  withResponseFormat: boolean;
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

  const response = await fetch(params.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const status = response.status;
    return { ok: false, status, text } as const;
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("SiliconFlow API 返回为空");
  }
  return { ok: true, content } as const;
}

async function extract(base64Image: string, mimeType: string): Promise<ScoreboardOCRResult> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY 未配置");
  }

  const apiUrl = process.env.SILICONFLOW_API_URL || DEFAULT_API_URL;
  const model = process.env.SILICONFLOW_MODEL || DEFAULT_MODEL;

  console.error("[OCR] 图片大小:", base64Image.length, "bytes, MIME:", mimeType, "模型:", model);

  const callParams: CallParams = { apiUrl, apiKey, model, base64Image, mimeType, withResponseFormat: true };

  let result = await callAPI(callParams);

  if (!result.ok && result.status === 400) {
    console.error("[OCR] response_format 被拒（400），回退无格式重试");
    callParams.withResponseFormat = false;
    result = await callAPI(callParams);
  }

  if (!result.ok) {
    throw new Error(`SiliconFlow API 错误 ${result.status}: ${result.text}`);
  }

  console.error("[OCR] 模型原始返回:", result.content);

  const parsed = extractJson(result.content);
  console.error("[OCR] JSON 解析结果:", JSON.stringify(parsed).slice(0, 500));

  let rawPlayers = extractPlayersArray(parsed);

  if (rawPlayers.length === 0) {
    throw new Error("OCR 结果格式校验失败：players 数组为空");
  }
  if (rawPlayers.length > 20) {
    rawPlayers = rawPlayers.slice(0, 20);
  }

  const validPlayers: PlayerRowOCR[] = [];
  let idx = 0;
  for (const row of rawPlayers) {
    const r = playerRowLenientSchema.safeParse(row);
    if (!r.success) {
      console.warn(`[OCR] 第 ${idx + 1} 行无有效玩家名称，已丢弃`, r.error.issues);
    } else {
      validPlayers.push(r.data);
    }
    idx++;
  }

  if (validPlayers.length === 0) {
    throw new Error("OCR 结果格式校验失败：没有可用的玩家数据行");
  }

  return { players: validPlayers };
}

export const siliconflowProvider: OCRProvider = {
  name: "siliconflow",
  extract,
};
