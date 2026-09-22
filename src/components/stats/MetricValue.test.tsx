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
});
