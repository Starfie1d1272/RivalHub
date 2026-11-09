import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DisciplineManagement } from "@/components/admin/DisciplineManagement";
import {
  DISCIPLINE_ADMIN_DEFAULTS,
  type DisciplineSubjectOption,
} from "@/lib/discipline/admin-review-contract";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
  search: vi.fn(),
  issue: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/admin/fixture/discipline",
  useSearchParams: () => mocks.params,
}));
vi.mock("@/actions/discipline", () => ({
  searchSanctionSubjects: mocks.search,
  issueSanction: mocks.issue,
  revokeSanction: vi.fn(),
  expireSanction: vi.fn(),
}));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderDiscipline() {
  render(
    <DisciplineManagement
      seasonId="fixture-season"
      seasonSlug="fixture"
      sanctions={[]}
      total={0}
      page={1}
      pageSize={25}
      totalPages={1}
      normalizedQuery={{ ...DISCIPLINE_ADMIN_DEFAULTS, page: 1, pageSize: 25 }}
      hasAnyRecords={false}
    />,
  );
  return screen.getByRole("searchbox", { name: /搜索被处罚用户/ });
}

function debounceSearch() {
  return act(async () => void (await vi.advanceTimersByTimeAsync(310)));
}

it("discards stale subject searches after a new query or clearing the input", async () => {
  vi.useFakeTimers();
  type SearchSuccess = { success: true; data: DisciplineSubjectOption[] };
  const responses = new Map<string, (value: SearchSuccess) => void>();
  mocks.search.mockImplementation(
    ({ query }) => new Promise<SearchSuccess>((resolve) => responses.set(query, resolve)),
  );
  const search = renderDiscipline();

  fireEvent.change(search, { target: { value: "alpha" } });
  await debounceSearch();
  fireEvent.change(search, { target: { value: "beta" } });
  expect(screen.getByText("正在搜索用户…")).toBeVisible();
  expect(screen.queryByText("没有匹配的用户。")).toBeNull();
  await debounceSearch();
  const beta = { id: "beta", label: "Beta fixture", detail: null };
  const alpha = { id: "alpha", label: "Alpha fixture", detail: null };
  await act(async () => responses.get("beta")!({ success: true, data: [beta] }));
  const subject = screen.getByRole("combobox", { name: "选择被处罚用户" });
  fireEvent.change(subject, { target: { value: beta.id } });
  await act(async () => responses.get("alpha")!({ success: true, data: [alpha] }));
  expect(subject).toHaveValue(beta.id);
  expect(screen.queryByRole("option", { name: alpha.label })).toBeNull();

  fireEvent.change(search, { target: { value: "gamma" } });
  expect(subject).toBeDisabled();
  expect(subject).toHaveValue("");
  await debounceSearch();
  fireEvent.change(search, { target: { value: "" } });
  await act(async () => responses.get("gamma")!({ success: true, data: [alpha] }));
  expect(subject).toBeDisabled();
  expect(screen.queryByRole("option", { name: alpha.label })).toBeNull();
  expect(screen.queryByText("正在搜索用户…")).toBeNull();
});

it("sends the exact reviewed sanction only after explicit confirmation", async () => {
  vi.useFakeTimers();
  mocks.search.mockResolvedValue({
    success: true,
    data: [{ id: "beta", label: "Beta fixture", detail: "beta@example.test" }],
  });
  mocks.issue.mockResolvedValue({ success: true, data: { caseId: "sanction" } });
  const search = renderDiscipline();
  fireEvent.change(search, { target: { value: "beta" } });
  await debounceSearch();
  fireEvent.change(screen.getByRole("combobox", { name: "选择被处罚用户" }), {
    target: { value: "beta" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "报名拦截" }));
  fireEvent.change(screen.getByRole("textbox", { name: "公开处罚说明" }), {
    target: { value: "  合成公开说明  " },
  });
  fireEvent.change(screen.getByLabelText(/有效期至/), {
    target: { value: "2030-10-01T20:30" },
  });
  const trigger = screen.getByRole("button", { name: "核对处罚" });
  fireEvent.click(trigger);
  let dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("Beta fixture");
  expect(dialog).toHaveTextContent("beta@example.test");
  expect(dialog).toHaveTextContent("报名拦截");
  expect(dialog).toHaveTextContent(/20:30.*北京时间/);
  expect(dialog).toHaveTextContent("合成公开说明");
  expect(mocks.issue).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "返回修改" }));
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  expect(trigger).toHaveFocus();
  expect(mocks.issue).not.toHaveBeenCalled();

  fireEvent.click(trigger);
  dialog = screen.getByRole("alertdialog");
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "确认签发处罚" })));
  expect(mocks.issue).toHaveBeenCalledExactlyOnceWith({
    seasonId: "fixture-season",
    subjectUserId: "beta",
    effects: ["registration_block"],
    internalEvidence: null,
    publicExplanation: "合成公开说明",
    effectiveUntil: new Date("2030-10-01T12:30:00.000Z"),
  });
});
