import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock("@/lib/ocr/siliconflow", () => ({ siliconflowProvider: { extract: mocks.extract } }));
import { extractScoreboardFromBase64 } from "@/lib/ocr";
import { OCR_MAX_IMAGE_BYTES, OCR_MAX_ENCODED_LENGTH } from "@/lib/ocr/input-contract";
beforeEach(() => { vi.clearAllMocks(); mocks.extract.mockResolvedValue({ players: [] }); });

it.each([6, 7, 7.5, 8, 10])("enforces the shared body budget for a %s MiB image before the provider", async mib => {
  const bytes = Buffer.alloc(mib * 1024 * 1024);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const work = extractScoreboardFromBase64(bytes.toString("base64"), "image/png");
  if (bytes.length <= OCR_MAX_IMAGE_BYTES) { await work; expect(mocks.extract).toHaveBeenCalledOnce(); }
  else { await expect(work).rejects.toMatchObject({ kind: "image" }); expect(mocks.extract).not.toHaveBeenCalled(); }
});
it("leaves action-envelope capacity and rejects disguised/truncated images", async () => {
  expect(OCR_MAX_ENCODED_LENGTH + 64 * 1024).toBeLessThan(10 * 1024 * 1024);
  await expect(extractScoreboardFromBase64(Buffer.from("not png").toString("base64"), "image/png")).rejects.toMatchObject({ kind: "image" });
  await expect(extractScoreboardFromBase64("iVBORw0KGgo", "image/png")).rejects.toMatchObject({ kind: "image" });
  expect(mocks.extract).not.toHaveBeenCalled();
});
