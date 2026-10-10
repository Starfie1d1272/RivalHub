import "server-only";

import type { OCRProvider, ScoreboardOCRResult } from "./types";
import { siliconflowProvider } from "./siliconflow";
import { OCRFailure } from "./errors";

// 注册表：可扩展
const providers: Record<string, OCRProvider> = {
  siliconflow: siliconflowProvider,
};

function getOCRProvider(): OCRProvider {
  const name = process.env.OCR_PROVIDER || "siliconflow";
  const provider = Object.hasOwn(providers, name) ? providers[name] : undefined;
  if (!provider) {
    throw new OCRFailure("configuration", "configuration", "unsupported_provider");
  }
  return provider;
}

export async function extractScoreboardFromBase64(
  base64Image: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
): Promise<ScoreboardOCRResult> {
  // Do not trust the Client's MIME type or Buffer's permissive base64 decoder.
  if (typeof base64Image !== "string" || base64Image.length === 0 || base64Image.length > Math.ceil(10 * 1024 * 1024 / 3) * 4
    || base64Image.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Image)) {
    throw new OCRFailure("image", "image", "invalid_image_encoding");
  }
  const bytes = Buffer.from(base64Image, "base64");
  if (bytes.toString("base64") !== base64Image) throw new OCRFailure("image", "image", "invalid_image_encoding");
  const recognized = mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mimeType === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!recognized || bytes.length > 10 * 1024 * 1024) {
    throw new OCRFailure("image", "image", "invalid_image_signature");
  }
  return getOCRProvider().extract(base64Image, mimeType);
}

// 重新导出
export type { PlayerRowOCR, ScoreboardOCRResult, OCRProvider } from "./types";
