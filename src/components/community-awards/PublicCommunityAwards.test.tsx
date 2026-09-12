/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./CommunityAwardsBoard", () => ({ CommunityAwardsBoard: () => <div data-testid="legacy-board" /> }));
vi.mock("./CommunityAwardSubmissionForm", () => ({ CommunityAwardSubmissionForm: () => <div data-testid="submission-form" /> }));
vi.mock("./CommunityAwardEvidenceForm", () => ({ CommunityAwardEvidenceForm: () => <div data-testid="evidence-form" /> }));

import { PublicCommunityAwards } from "./PublicCommunityAwards";

const award = {
  id: "award-1",
  submittedByUserId: "user-1",
  name: "最佳解说",
  condition: "解说精彩",
  prize: "奖杯",
  supplementaryNote: null,
  publicNote: null,
  reviewNote: null,
  status: "approved",
  outcomeNote: null,
  submitterName: "发起人",
  recipientName: null,
  recipientUserId: null,
  recipientTarget: null,
};

describe("PublicCommunityAwards", () => {
  it("uses focused public forms in dialogs instead of nesting the legacy board", () => {
    render(<PublicCommunityAwards seasonId="season-1" awards={[award]} currentUserId="user-1" candidates={[]} matches={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "提出社区奖" }));
    expect(screen.getByTestId("submission-form")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-board")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "提交候选证据" }));
    expect(screen.getByTestId("evidence-form")).toBeInTheDocument();
  });
});
