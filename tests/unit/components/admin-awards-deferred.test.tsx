import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CommunityAwardAdminSummary, CommunityAwardModel } from "@/lib/community-awards/data";
const boundary = vi.hoisted(() => ({ detail: vi.fn(), options: vi.fn() }));
vi.mock("@/app/admin/[seasonSlug]/community-awards/actions", () => ({ readCommunityAwardDetail: boundary.detail, readCommunityAwardOptions: boundary.options }));
vi.mock("next/dynamic", () => ({ default: () => ({ awards }: { awards: CommunityAwardModel[] }) => <><input aria-label={`draft ${awards[0]!.id}`} defaultValue={awards[0]!.condition} /><button>确认 {awards[0]!.id}</button></> }));
import { AdminCommunityAwardsWorkspace } from "@/components/admin/AdminCommunityAwardsWorkspace";
const full = (id: string): CommunityAwardModel => ({ id, recipients: [], recipientPolicy: "single", recipientLimit: 1, settlementPolicy: "event_verified", settlementStageKey: null, resultVersion: 1, submittedByUserId: "submitter", submitterPlayerUserId: null,
  name: id, condition: "full private condition", prize: "gift", supplementaryNote: null, publicNote: null, reviewNote: null, status: "approved", outcomeNote: null, submitterName: "submitter", recipientName: null, recipientUserId: null, recipientTarget: null, evidence: [], settlementReady: true, nonAwardingReady: false });
const summary = (id: string): CommunityAwardAdminSummary => ({ ...full(id), evidenceCount: 1, eligibleEvidenceCount: 1, settlementReady: true, nonAwardingReady: false });
const initial = [summary("one"), summary("two")];
beforeEach(() => { boundary.detail.mockReset(); boundary.options.mockReset(); boundary.detail.mockImplementation(async ({ awardId }) => ({ success: true, data: full(awardId) })); boundary.options.mockResolvedValue({ success: true, data: { candidates: [], matches: [] } }); });
async function open(details: HTMLDetailsElement) { await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); }); }
it("reads nothing for closed awards and shares one form-options read across opened details", async () => {
  const { container } = render(<AdminCommunityAwardsWorkspace seasonId="season" currentUserId="admin" summaries={initial} stages={[]} />);
  expect(boundary.detail).not.toHaveBeenCalled(); expect(boundary.options).not.toHaveBeenCalled();
  const details = container.querySelectorAll("details");
  await open(details[0]!); await screen.findByRole("textbox", { name: "draft one" });
  await open(details[1]!); await screen.findByRole("textbox", { name: "draft two" });
  expect(boundary.detail).toHaveBeenCalledTimes(2); expect(boundary.options).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("textbox", { name: "draft one" }), { target: { value: "unsaved" } });
  await act(async () => { details[0]!.open = false; fireEvent(details[0]!, new Event("toggle")); }); await open(details[0]!);
  expect(boundary.detail).toHaveBeenCalledTimes(2); expect(screen.getByRole("textbox", { name: "draft one" })).toHaveValue("unsaved");
});
it("disables stale controls on RSC refresh and authorization rejection, preserving drafts until retry succeeds", async () => {
  const { container, rerender } = render(<AdminCommunityAwardsWorkspace seasonId="season" currentUserId="admin" summaries={initial} stages={[]} />);
  await open(container.querySelector("details")!);
  const input = await screen.findByRole("textbox", { name: "draft one" }); fireEvent.change(input, { target: { value: "unsaved" } });
  let resolve!: (value: unknown) => void;
  boundary.detail.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  rerender(<AdminCommunityAwardsWorkspace seasonId="season" currentUserId="admin" summaries={initial.map(item => ({ ...item }))} stages={[]} />);
  expect(screen.getByRole("button", { name: "确认 one" })).toBeDisabled();
  await act(async () => { resolve({ success: false, error: { message: "permission revoked" } }); });
  expect(await screen.findByRole("alert")).toHaveTextContent("permission revoked"); expect(input).toHaveValue("unsaved");
  expect(screen.getByRole("button", { name: "确认 one" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "确认 one" })).not.toBeDisabled()); expect(input).toHaveValue("unsaved");
});
it("rechecks activated details and options when the authenticated viewer changes", async () => {
  const { container, rerender } = render(<AdminCommunityAwardsWorkspace seasonId="season" currentUserId="admin" summaries={initial} stages={[]} />);
  await open(container.querySelector("details")!); await screen.findByRole("textbox", { name: "draft one" });
  rerender(<AdminCommunityAwardsWorkspace seasonId="season" currentUserId="other-admin" summaries={initial} stages={[]} />);
  expect(screen.getByRole("button", { name: "确认 one" })).toBeDisabled();
  await waitFor(() => expect(boundary.options).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "确认 one" })).not.toBeDisabled());
});
