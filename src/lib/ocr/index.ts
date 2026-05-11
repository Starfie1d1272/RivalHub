import type { OCRProvider, ScoreboardOCRResult } from "./types";
import { siliconflowProvider } from "./siliconflow";

// 注册表：可扩展
const providers: Record<string, OCRProvider> = {
  siliconflow: siliconflowProvider,
};

function getOCRProvider(): OCRProvider {
  const name = process.env.OCR_PROVIDER || "siliconflow";
  const provider = providers[name];
  if (!provider) {
    throw new Error(`未知 OCR provider: ${name}。可用: ${Object.keys(providers).join(", ")}`);
  }
  return provider;
}

export async function extractScoreboardFromBase64(
  base64Image: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
): Promise<ScoreboardOCRResult> {
  return getOCRProvider().extract(base64Image, mimeType);
}

// 重新导出
export type { PlayerRowOCR, ScoreboardOCRResult, OCRProvider } from "./types";
export { siliconflowProvider } from "./siliconflow";
