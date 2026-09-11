import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthMock,
  manualCommandMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  manualCommandMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  auditActorId: vi.fn(() => "user-1"),
}));
vi.mock("@/lib/education/commands", () => ({
  submitAdmissionNoticeEducationCommand: manualCommandMock,
  submitChsiEducationVerification: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

import {
  submitAdmissionNoticeEducation,
} from "@/actions/education-verifications";

const SESSION = { userId: "00000000-0000-4000-8000-000000000001", email: "player@example.test" };
const INSTITUTION_ID = "00000000-0000-4000-8000-000000000002";
function manualForm(): FormData {
  const form = new FormData();
  form.set("institutionId", INSTITUTION_ID);
  form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "notice.pdf", { type: "image/png" }));
  return form;
}

describe("manual education evidence actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(SESSION);
    manualCommandMock.mockResolvedValue("created");
  });

  it("passes only the validated institution and file to the server workflow", async () => {
    const form = manualForm();

    await expect(submitAdmissionNoticeEducation(form)).resolves.toEqual({ success: true, data: "created" });

    expect(manualCommandMock).toHaveBeenCalledWith({
      session: SESSION,
      institutionId: INSTITUTION_ID,
      file: expect.objectContaining({ mimeType: "image/png", extension: "png" }),
    });
    const submittedFile = manualCommandMock.mock.calls[0]?.[0]?.file?.file as File;
    expect(submittedFile.name).toBe("notice.pdf");
  });

});
