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
    expect(screen.getByRole("button", { name: "Rating ↑" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "ascending");
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

  it("accepts a layout class for dense fixed tables", () => {
    render(<StatsDataTable rows={rows} columns={columns} rowKey={(row) => row.name} tableClassName="min-w-[720px] table-fixed" />);
    expect(screen.getByRole("table")).toHaveClass("min-w-[720px]", "table-fixed");
  });

  it("keeps limited samples below ranked rows in both sort directions and uses a separate baseline", () => {
    interface RankedRow { name: string; rating: number; rounds: number }
    const baseline: RankedRow[] = [
      { name: "Tiny", rating: 9, rounds: 5 },
      { name: "Floor", rating: 2, rounds: 20 },
      { name: "Mid", rating: 3, rounds: 80 },
      { name: "High", rating: 4, rounds: 100 },
    ];
    const visible = baseline.filter((row) => row.name !== "Floor");
    const rankedColumns: StatsDataColumn<RankedRow>[] = [
      { key: "name", label: "Player", render: (row) => row.name },
      { key: "rating", label: "Rating", metric: "rating", numeric: true, sortable: true, sortValue: (row) => row.rating, rankingSample: (row) => row.rounds, render: (row) => row.rating },
    ];

    render(<StatsDataTable rows={visible} rankingBaselineRows={baseline} columns={rankedColumns} rowKey={(row) => row.name} initialSortKey="rating" />);

    expect(screen.getByText("2 ranked · 1 limited sample")).toBeInTheDocument();
    expect(screen.getByText("min 20 rounds")).toBeInTheDocument();
    const rankingHelp = screen.getByRole("button", { name: "排名样本说明" });
    fireEvent.mouseEnter(rankingHelp);
    expect(screen.getByRole("tooltip")).toHaveTextContent("排名样本线");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "High4",
      "Mid3",
      "Limited sample · below 20 rounds",
      "Tiny9",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Rating ↓" }));
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "Mid3",
      "High4",
      "Limited sample · below 20 rounds",
      "Tiny9",
    ]);
  });

  it("shows the Chinese metric explanation without replacing the English header", () => {
    const metricColumns: StatsDataColumn<Row>[] = [
      columns[0]!,
      { key: "rating", metric: "rating", numeric: true, render: (row) => row.rating ?? "—" },
    ];
    render(<StatsDataTable rows={rows} columns={metricColumns} rowKey={(row) => row.name} />);
    expect(screen.getByText("Rating")).toBeInTheDocument();
    const help = screen.getByRole("button", { name: "Rating 指标说明" });
    fireEvent.mouseEnter(help);
    expect(screen.getByRole("tooltip")).toHaveTextContent("综合衡量选手整体表现的评分");
    expect(screen.getByRole("tooltip").closest("table")).toBeNull();
  });

});
