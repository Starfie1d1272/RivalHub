import { ocrResponseSchema, type ScoreboardOCRResult, type OCRProvider } from "./types";

const DEFAULT_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const DEFAULT_MODEL = "PaddlePaddle/PaddleOCR-VL-1.5";

const SYSTEM_PROMPT = `你是一个电竞赛事数据录入助手。用户会发送一张完美平台（Perfect World）CS2 赛后记分板截图。
请精确识别截图中所有玩家的统计数据，以 JSON 格式返回，不要添加任何解释文字。

你必须只输出合法 JSON，不要输出 Markdown 代码块，不要输出解释文字。

输出格式（严格遵守）：
{
  "players": [
    {
      "perfectName": "玩家昵称（与截图完全一致）",
      "kills": 数字或null,
      "deaths": 数字或null,
      "assists": 数字或null,
      "hsPercent": 0-100整数或null,
      "firstKills": 整数或null,
      "multiKills": 整数或null,
      "clutches": 整数或null,
      "adr": 小数或null,
      "rws": 两位小数或null,
      "ratingPro": 两位小数或null,
      "we": 0.0-16.0一位小数或null
    }
  ]
}

规则：
- perfectName 必须与截图中显示的完美平台昵称完全一致
- 整数字段（kills/deaths/assists/hsPercent/firstKills/multiKills/clutches）无上限，保持整数
- adr 可以为 0，保留一位或两位小数
- rws 保留两位小数
- we 范围 0.0–16.0，保留一位小数
- 如果某个格子无法识别或为空，填 null
- 不要推断或捏造任何数据`;

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

  const callParams: CallParams = { apiUrl, apiKey, model, base64Image, mimeType, withResponseFormat: true };

  // 第一次尝试：带 response_format json_object（LLM 模型支持，VL 模型可能拒绝）
  let result = await callAPI(callParams);

  // 如果是 400 错误，可能是模型不支持 response_format，回退到不带 response_format
  if (!result.ok && result.status === 400) {
    callParams.withResponseFormat = false;
    result = await callAPI(callParams);
  }

  if (!result.ok) {
    throw new Error(`SiliconFlow API 错误 ${result.status}: ${result.text}`);
  }

  const parsed = extractJson(result.content);
  const validated = ocrResponseSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => i.message).join("; ");
    throw new Error(`OCR 结果格式校验失败: ${issues}`);
  }

  return validated.data;
}

export const siliconflowProvider: OCRProvider = {
  name: "siliconflow",
  extract,
};
