/** @vitest-environment jsdom */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MapPoolEditor } from "@/components/admin/MapPoolEditor";

describe("MapPoolEditor", () => {
  beforeEach(() => vi.stubGlobal("React", React));

  it("uses the Chinese current map pool label for the default candidate group", () => {
    render(<MapPoolEditor value={[]} onChange={() => {}} />);

    expect(screen.getByText("当前地图池（默认候选）")).toBeInTheDocument();
    expect(screen.queryByText(/Active Duty/)).not.toBeInTheDocument();
  });
});
