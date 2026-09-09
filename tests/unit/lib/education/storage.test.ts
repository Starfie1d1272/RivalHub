import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const { createServiceClientMock, fromMock, uploadMock, removeMock, signedUrlMock, logEventMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  signedUrlMock: vi.fn(),
  logEventMock: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/observability/server", () => ({ logEvent: logEventMock }));

import { educationEvidenceStorage } from "@/lib/education/storage";

describe("education evidence Storage adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServiceClientMock.mockReturnValue({ storage: { from: fromMock } });
    fromMock.mockReturnValue({ upload: uploadMock, remove: removeMock, createSignedUrl: signedUrlMock });
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    signedUrlMock.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  });

  it("owns the private bucket call and never requests a public URL", async () => {
    const file = new File(["png"], "original-private-name.png", { type: "image/png" });

    await expect(educationEvidenceStorage.upload("verification/object.png", file, "image/png")).resolves.toBeUndefined();

    expect(fromMock).toHaveBeenCalledWith("education-evidence");
    expect(uploadMock).toHaveBeenCalledWith("verification/object.png", file, { upsert: false, contentType: "image/png" });
    expect(JSON.stringify(fromMock.mock.results)).not.toContain("getPublicUrl");
  });

  it("converts provider failures into safe errors without logging the key or raw response", async () => {
    const objectKey = "private-name@example.test/secret-object.png";
    const rawProviderMessage = `provider leaked ${objectKey}`;
    uploadMock.mockRejectedValue(new Error(rawProviderMessage));

    await expect(educationEvidenceStorage.upload(objectKey, new File(["png"], "secret.png", { type: "image/png" } ), "image/png"))
      .rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR, message: "教育材料存储服务暂时不可用，请稍后重试。" });

    expect(logEventMock).toHaveBeenCalledWith(expect.objectContaining({
      event: "education.evidence_storage.failure",
      operation: "upload",
      safeContext: { provider: "supabase", bucket: "education-evidence" },
    }));
    expect(JSON.stringify(logEventMock.mock.calls)).not.toContain(objectKey);
    expect(JSON.stringify(logEventMock.mock.calls)).not.toContain(rawProviderMessage);
  });

  it("treats an already missing object as an idempotent remove", async () => {
    removeMock.mockRejectedValue({ status: 404, message: "object missing" });

    await expect(educationEvidenceStorage.remove("verification/object.png")).resolves.toBeUndefined();
    expect(removeMock).toHaveBeenCalledWith(["verification/object.png"]);
  });

  it("returns only the short-lived signed URL and safely handles signing failure", async () => {
    await expect(educationEvidenceStorage.createSignedUrl("verification/object.png")).resolves.toBe("https://storage.test/signed");
    expect(signedUrlMock).toHaveBeenCalledWith("verification/object.png", 60);

    signedUrlMock.mockResolvedValue({ data: null, error: { status: 500, message: "provider details" } });
    await expect(educationEvidenceStorage.createSignedUrl("verification/object.png"))
      .rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR, message: "教育材料存储服务暂时不可用，请稍后重试。" });
  });
});
