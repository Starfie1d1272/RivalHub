/** Shared browser/server budget under the 10 MiB Server Action body limit.
 * 7 MiB encodes to <9.34 MiB, leaving >680 KiB for the action envelope.
 * The existing MIME/signature validation remains authoritative on the server.
 */
export const OCR_MAX_IMAGE_BYTES = 7 * 1024 * 1024;
export const OCR_MAX_ENCODED_LENGTH = 4 * Math.ceil(OCR_MAX_IMAGE_BYTES / 3);
export const OCR_IMAGE_SIZE_MESSAGE = "截图不超过 7 MiB，请先压缩或裁剪后重试。";
export const OCR_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export function isOCRImageMimeType(value: string): value is typeof OCR_IMAGE_MIME_TYPES[number] {
  return (OCR_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}
