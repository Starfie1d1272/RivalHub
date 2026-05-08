import { z } from "zod";

const SF_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const SF_MODEL = "Qwen/Qwen2.5-VL-72B-Instruct";

const playerRowSchema = z.object({
  perfectName: z.string(),
  kills: z.number().int().nonnegative().nullable().default(null),
  deaths: z.number().int().nonnegative().nullable().default(null),
  assists: z.number().int().nonnegative().nullable().default(null),
  hsPercent: z.number().int().min(0).max(100).nullable().default(null),
  firstKills: z.number().int().nonnegative().nullable().default(null),
  multiKills: z.number().int().nonnegative().nullable().default(null),
  clutches: z.number().int().nonnegative().nullable().default(null),
  adr: z.number().nonnegative().nullable().default(null),
  rws: z.number().nonnegative().nullable().default(null),
  ratingPro: z.number().nonnegative().nullable().default(null),
  we: z.number().min(0).max(16).nullable().default(null),
});

const ocrResponseSchema = z.object({
  players: z.array(playerRowSchema).min(1).max(20),
});

export type PlayerRowOCR = z.infer<typeof playerRowSchema>;
export type ScoreboardOCRResult = z.infer<typeof ocrResponseSchema>;

const SYSTEM_PROMPT = `你是一个电竞赛事数据录入助手。用户会发送一张完美平台（Perfect World）CS2 赛后记分板截图。
请精确识别截图中所有玩家的统计数据，以 JSON 格式返回，不要添加任何解释文字。

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

export async function extractScoreboardFromBase64(
  base64Image: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg"
): Promise<ScoreboardOCRResult> {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY 未配置");
  }

  const response = await fetch(SF_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: SF_MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "请识别并返回这张完美平台记分板截图中所有玩家的数据。",
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2048,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SiliconFlow API 错误 ${response.status}: ${text}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("SiliconFlow API 返回为空");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`无法解析 API 返回的 JSON: ${content.slice(0, 200)}`);
  }

  const validated = ocrResponseSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => i.message).join("; ");
    throw new Error(`OCR 结果格式校验失败: ${issues}`);
  }

  return validated.data;
}
