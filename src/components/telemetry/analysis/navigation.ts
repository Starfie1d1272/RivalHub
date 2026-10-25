import type { Route } from "next";
import { analysisDefaults, analysisFields, type AnalysisFilters } from "@/lib/telemetry/analysis-query";
export const analysisSections = [["overview", "产品概况"], ["tasks", "用户任务"], ["experience", "页面体验"], ["problems", "问题排查"], ["workflows", "业务流程"], ["history", "长期趋势"], ["quality", "数据质量"]] as const;
export const isLongWindow = (filters: AnalysisFilters) => filters.from
  ? Date.parse(filters.to) - Date.parse(filters.from) > 86400000 : filters.hours === "168";
export function analysisHref(filters: AnalysisFilters, view = "overview", bounded = false, compare = false, taskDefinition?: number | null) {
  const query = new URLSearchParams();
  for (const key of analysisFields) if (filters[key] && filters[key] !== analysisDefaults[key]) query.set(key, filters[key]);
  if (view !== "overview") query.set("view", view);
  if (bounded && isLongWindow(filters)) query.set("analysisMode", "bounded");
  if (compare) query.set("compare", "1");
  if (taskDefinition != null && filters.task) query.set("taskDefinition", String(taskDefinition));
  return `/admin/telemetry${query.size ? `?${query}` : ""}` as Route;
}
export function readTaskDefinition(value: string | null | undefined) {
  return value != null && /^(0|[1-9][0-9]{0,3})$/.test(value) ? Number(value) : null;
}
