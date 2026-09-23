import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricValue } from "./MetricValue";

describe("MetricValue sample labels", () => {
  it("shows undefined rates as an em dash while keeping the 0/0 sample visible", () => {
    render(<MetricValue metric="clutch" value={{ rate: null, wins: 0, opportunities: 0 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0/0 attempts")).toBeInTheDocument();
  });

  it("renders a zero rate when the denominator is nonzero", () => {
    render(<MetricValue metric="roundWin" value={{ rate: 0, wins: 0, opportunities: 8 }} />);
    expect(screen.getByText("0.0%")).toBeInTheDocument();
    expect(screen.getByText("0/8 rounds")).toBeInTheDocument();
  });

  it("can reduce sample chrome without losing the denominator", () => {
    const { rerender } = render(<MetricValue metric="clutch" value={{ rate: 0.5, wins: 1, opportunities: 2 }} sampleDisplay="compact" />);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    rerender(<MetricValue metric="clutch" value={{ rate: 0.5, wins: 1, opportunities: 2 }} sampleDisplay="hidden" />);
    expect(screen.queryByText("1 / 2")).not.toBeInTheDocument();
  });

  it("shows Blind/Flash with a flash denominator instead of leaking the floating total blind seconds", () => {
    render(<MetricValue metric="blindPerFlash" value={{ rate: 2.4464, successes: 386.534, attempts: 158 }} />);
    expect(screen.getByText("2.4s")).toBeInTheDocument();
    expect(screen.getByText("158 flashes")).toBeInTheDocument();
    expect(screen.queryByText(/386/)).not.toBeInTheDocument();
  });
  it("scales low-frequency per-round events to a per-100-round display", () => {
    render(<MetricValue metric="flashAssist" value={{ rate: 0.05, successes: 15, attempts: 301 }} sampleDisplay="hidden" />);
    expect(screen.getByText("5.0")).toBeInTheDocument();
  });

  it("keeps standard per-round metrics on their native scale", () => {
    render(<MetricValue metric="kpr" value={0.98} />);
    expect(screen.getByText("0.98")).toBeInTheDocument();
  });

});
