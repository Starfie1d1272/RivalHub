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
      unresolvedPrestartIssues: 1,
      unconfirmedEntrants: 3,
      scheduledMatchesWithoutConfirmedLineups: 4,
      finalResultPendingConfirmation: true,
      activeAdjudications: 5,
    }} />);

    expect(screen.getByRole("link", { name: /赛前待解决事项/ })).toHaveAttribute("href", "/admin/nju-major/prestart");
    expect(screen.getByRole("link", { name: /已排期但名单未确认/ })).toHaveAttribute("href", "/admin/nju-major/matches");
    expect(screen.getByRole("link", { name: /最终结果待确认/ })).toHaveAttribute("href", "/admin/nju-major/post-event");
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("omits zero-valued exceptions and renders a light empty state", () => {
    render(<AdminExceptionSummary seasonSlug="rivals-s1" data={{
      competitionTemplate: "rivals",
      unresolvedPrestartIssues: 0,
      unconfirmedEntrants: 0,
      scheduledMatchesWithoutConfirmedLineups: 0,
      finalResultPendingConfirmation: false,
      activeAdjudications: 0,
    }} />);

    expect(screen.getByText("当前无待处理事项。")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
