import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsDataTable, type StatsDataColumn } from "./StatsDataTable";

interface Row { name: string; rating: number | null }

const rows: Row[] = [
  { name: "Missing", rating: null },
  { name: "Low", rating: 1 },
  { name: "High", rating: 3 },
];
const columns: StatsDataColumn<Row>[] = [
  { key: "name", label: "Player", render: (row) => row.name },
  { key: "rating", label: "Rating", numeric: true, sortable: true, sortValue: (row) => row.rating, render: (row) => row.rating ?? "—" },
];

describe("StatsDataTable client state", () => {
  it("sorts locally while keeping missing observations last in either direction", () => {
    render(<StatsDataTable rows={rows} columns={columns} rowKey={(row) => row.name} initialSortKey="rating" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual(["High3", "Low1", "Missing—"]);

    fireEvent.click(screen.getByRole("button", { name: "Rating ↓" }));
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual(["Low1", "High3", "Missing—"]);
    expect(screen.getByRole("columnheader", { name: "Rating ↑" })).toHaveAttribute("aria-sort", "ascending");
  });

  it("paginates locally", () => {
    render(<StatsDataTable rows={rows} columns={columns} rowKey={(row) => row.name} initialSortKey="rating" pageSize={1} />);
    expect(screen.getByRole("row", { name: "High 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByRole("row", { name: "Low 1" })).toBeInTheDocument();
    expect(screen.getByText("第 2 / 3 页")).toBeInTheDocument();
  });
  it("offsets the sticky identity column when rank is visible", () => {
    render(<StatsDataTable rows={rows} columns={columns} rowKey={(row) => row.name} showRank />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveClass("left-0", "w-12");
    expect(headers[1]).toHaveClass("left-12");
  });

  it("omits pagination chrome for a single page", () => {
    render(<StatsDataTable rows={rows} columns={columns} rowKey={(row) => row.name} />);
    expect(screen.queryByText(/第 1 \/ 1 页/)).not.toBeInTheDocument();
    expect(screen.queryByText(/共 3 条/)).not.toBeInTheDocument();
  });

});
