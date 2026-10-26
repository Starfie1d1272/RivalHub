import { expect, it } from "vitest";
import { analysisDefaults } from "@/lib/telemetry/analysis-query";
import { analysisHref, isLongWindow, parseUIAnalysisQuery, uiAnalysisDefaults } from "@/components/telemetry/analysis/navigation";

// Browser defaults must not change the provider/CLI contract or erase seven-day links.
it("round-trips UI defaults, six hours, seven days, and explicit custom ranges", () => {
  expect(analysisDefaults.hours).toBe("168");
  expect(parseUIAnalysisQuery({})?.filters.hours).toBe("24");
  expect(parseUIAnalysisQuery({ hours: undefined })?.filters.hours).toBe("24");
  for (const hours of ["6", "24", "168"]) {
    const filters = { ...uiAnalysisDefaults, hours };
    const href = new URL(analysisHref(filters), "http://local");
    expect(parseUIAnalysisQuery(Object.fromEntries(href.searchParams))?.filters).toEqual(filters);
    expect(isLongWindow(filters)).toBe(hours === "168");
    if (hours === "168") expect(href.searchParams.get("hours")).toBe("168");
  }
  const filters = { ...uiAnalysisDefaults, from: "2026-10-20T00:00:00Z", to: "2026-10-25T00:00:00Z" };
  const href = new URL(analysisHref(filters, "experience", true), "http://local");
  expect(href.searchParams.get("analysisMode")).toBe("bounded");
  href.searchParams.delete("analysisMode"); href.searchParams.delete("view");
  expect(parseUIAnalysisQuery(Object.fromEntries(href.searchParams))?.filters).toEqual(filters);
});
