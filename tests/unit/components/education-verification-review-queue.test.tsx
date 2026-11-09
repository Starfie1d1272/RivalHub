import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EducationVerificationReviewQueue } from "@/components/admin/EducationVerificationReviewQueue";
import type { EducationReviewRow } from "@/lib/education/admin-review-contract";

const mocks = vi.hoisted(() => ({ review: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/actions/education-verifications", () => ({ reviewEducationVerification: mocks.review }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row: EducationReviewRow = {
  id: "verification",
  userId: "applicant",
  email: "applicant@example.test",
  displayName: "合成申请人",
  institution: "合成高校",
  code: null,
  academicStatus: "enrolled",
  evidenceLabel: "录取通知书材料",
  chsiEvidenceCode: null,
  manualEvidenceAvailable: true,
  status: "pending",
  submittedAt: "2026-10-01T08:30:00.000Z",
  reviewNote: null,
};

it("cancels approval without reviewing, requires a rejection reason, and explicitly approves an empty note", async () => {
  mocks.review.mockResolvedValue({ success: true, data: undefined });
  const user = userEvent.setup();
  render(<EducationVerificationReviewQueue rows={[row]} emptyState="no-pending" />);
  const approve = screen.getByRole("button", { name: "通过" });
  const reject = screen.getByRole("button", { name: "驳回" });

  await user.click(approve);
  let dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent(row.displayName!);
  expect(dialog).toHaveTextContent(row.institution);
  await user.type(within(dialog).getByRole("textbox", { name: /审核备注/ }), "临时审核备注");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(approve).toHaveFocus());
  expect(mocks.review).not.toHaveBeenCalled();

  await user.click(reject);
  dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "确认驳回" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("请填写驳回原因");
  expect(within(dialog).getByRole("textbox", { name: /驳回原因/ })).toHaveFocus();
  expect(mocks.review).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "返回审核队列" }));
  await waitFor(() => expect(reject).toHaveFocus());

  await user.click(approve);
  dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("textbox", { name: /审核备注/ })).toHaveValue("");
  await user.click(within(dialog).getByRole("button", { name: "确认通过" }));
  expect(mocks.review).toHaveBeenCalledExactlyOnceWith({
    id: row.id,
    decision: "approved",
    reviewNote: "",
  });
});
