/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminExceptionSummary } from "@/components/admin/AdminExceptionSummary";

describe("AdminExceptionSummary", () => {
  it("links each canonical exception count to its existing operator surface", () => {
    render(<AdminExceptionSummary seasonSlug="nju-major" data={{
      competitionTemplate: "major",
      pendingApplications: 2,
      unresolvedPrestartIssues: 1,
      unconfirmedEntrants: 3,
      scheduledMatchesWithoutConfirmedLineups: 4,
      finalResultPendingConfirmation: true,
      activeAdjudications: 5,
      registrationMode: "team",
    }} />);

    expect(screen.getByRole("link", { name: /待审核组队报名/ })).toHaveAttribute("href", "/admin/nju-major/registrations");
    expect(screen.getByRole("link", { name: /赛前待解决事项/ })).toHaveAttribute("href", "/admin/nju-major/prestart");
    expect(screen.getByRole("link", { name: /已排期但名单未确认/ })).toHaveAttribute("href", "/admin/nju-major/matches");
    expect(screen.getByRole("link", { name: /最终结果待确认/ })).toHaveAttribute("href", "/admin/nju-major/post-event");
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
