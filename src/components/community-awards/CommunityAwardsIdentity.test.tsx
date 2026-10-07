import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CommunityAwardModel } from "@/lib/community-awards/data";

vi.mock("@/actions/community-awards", () => Object.fromEntries(["addCommunityAwardEvidence", "requestCommunityAwardSupplement", "resolveCommunityAward", "reviewCommunityAward", "reviseCommunityAward", "submitCommunityAward", "withdrawCommunityAward"].map(name => [name, vi.fn()])));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => <select aria-label="人员选择" value={value} onChange={event => onValueChange(event.target.value)}><option value="" />{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
import { CommunityAwardsBoard } from "./CommunityAwardsBoard";
import { CommunityAwardEvidenceForm } from "./CommunityAwardEvidenceForm";

const award: CommunityAwardModel = {
  id: "award", name: "最佳解说", condition: "精彩解说", prize: "奖杯", supplementaryNote: null, publicNote: null, reviewNote: null, status: "awarded", outcomeNote: null,
  submittedByUserId: "organizer", submitterPlayerUserId: null, submitterName: "组织者",
  recipientUserId: "caster", recipientName: "解说甲", recipientTarget: null,
  evidence: [{ id: "evidence", submittedByUserId: "viewer", submitterPlayerUserId: null, submitterName: "观众", candidateUserId: "caster", candidatePlayerUserId: null, candidateName: "解说甲", matchLabel: null, explanation: "精彩", videoUrl: null, createdAt: "2026-10-07" }],
};

describe("community award person identity", () => {
  it("keeps related users as text, and consumes explicit player facts instead of raw user IDs", () => {
    const { rerender } = render(<CommunityAwardsBoard seasonId="event" awards={[award]} candidates={[]} matches={[]} currentUserId={null} isAdmin allowSubmission={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByText("解说甲", { exact: false })).toHaveLength(2);
    rerender(<CommunityAwardsBoard seasonId="event" awards={[{ ...award, submitterPlayerUserId: "organizer", recipientTarget: "/players/caster", evidence: award.evidence!.map(item => ({ ...item, candidatePlayerUserId: "caster" })) }]} candidates={[]} matches={[]} currentUserId={null} isAdmin allowSubmission={false} />);
    expect(screen.getByRole("link", { name: "组织者" })).toHaveAttribute("href", "/players/organizer");
    expect(screen.getAllByRole("link", { name: "解说甲" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "观众" })).not.toBeInTheDocument();
  });

  it("offers a profile for a historical/profile-backed candidate without converting every candidate to Player", async () => {
    render(<CommunityAwardEvidenceForm awardId="award" candidates={[{ id: "admin", name: "管理员", playerUserId: null }, { id: "veteran", name: "往届选手", playerUserId: "veteran" }]} matches={[]} />);
    const user = userEvent.setup();
    const candidate = screen.getAllByRole("combobox")[0]!;
    await user.selectOptions(candidate, "admin");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.selectOptions(candidate, "veteran");
    expect(screen.getByRole("link", { name: "查看候选选手 ↗" })).toHaveAttribute("href", "/players/veteran");
    expect(candidate).toHaveValue("veteran");
  });
});
