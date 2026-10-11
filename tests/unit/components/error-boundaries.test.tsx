import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StatsError from "@/app/stats/error";
import MatchDetailError from "@/app/[seasonSlug]/matches/[matchId]/error";
import { ErrorState } from "@/components/rivalhub/ErrorState";

afterEach(cleanup);
describe("safe error recovery", () => {
  it.each([StatsError, MatchDetailError])("shows the server hash, hides raw causes and invokes recovery only on click", Boundary => {
    const reset = vi.fn();
    render(<Boundary error={Object.assign(new Error("private cause token=private-token"), { digest: "1234567890" })} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("排查编号：1234567890");
    expect(screen.getByRole("alert")).toHaveTextContent("先确认操作结果");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private");
    expect(reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /重新加载/ }));
    expect(reset).toHaveBeenCalledOnce();
  });
  it.each([undefined, "secret-value", "1".repeat(21)])("does not render an absent or unsafe identifier", errorDigest => {
    render(<ErrorState errorDigest={errorDigest} />);
    expect(screen.queryByText(/排查编号/)).toBeNull();
  });
});
