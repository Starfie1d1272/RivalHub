import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuditLogTable } from "@/components/admin/AuditLogTable";
import type { AuditLogView } from "@/lib/audit/presentation";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), read: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/logs", useSearchParams: () => new URLSearchParams(nav.query), useRouter: () => ({ replace: nav.replace, push: nav.replace }) }));
vi.mock("@/actions/audit", () => ({ fetchAuditLogs: nav.read }));
vi.mock("@/components/admin/AuditLogDetailDialog", () => ({ AuditLogDetailDialog: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); nav.query = ""; });

const row = (id: string): AuditLogView => ({ id, createdAt: "2051-01-01T00:00:00Z", actionKey: "match.start", actionLabel: "开始比赛", categoryLabel: "比赛", categoryColor: "accent", actorLabel: "管理员", targetTypeLabel: "比赛", targetLabel: id, summary: null, seasonLabel: "赛事" });

it("renders fresh RSC props after URL navigation without a second list action", () => {
  const view = render(<AuditLogTable initialLogs={[row("first")]} initialTotal={1} seasons={[]} />);
  fireEvent.change(screen.getByLabelText("起始日期"), { target: { value: "2051-01-02" } });
  expect(nav.replace).toHaveBeenCalledTimes(1);
  nav.query = "dateFrom=2051-01-02";
  view.rerender(<AuditLogTable initialLogs={[row("second")]} initialTotal={1} seasons={[]} />);
  expect(screen.getByText("second")).toBeInTheDocument();
  expect(screen.queryByText("first")).not.toBeInTheDocument();
  expect(nav.read).not.toHaveBeenCalled();
});

it("uses the resolved last page with an out-of-range direct URL", () => {
  nav.query = "page=999";
  render(<AuditLogTable initialLogs={[row("last-page")]} initialTotal={65} seasons={[]} />);
  expect(screen.getByText("last-page")).toBeInTheDocument();
  expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  expect(nav.read).not.toHaveBeenCalled();
});
