export const taskGroupKey = (name: string, definitionVersion: number) => `${name}:v${definitionVersion}`;
export const taskDefinitionLabel = (version: number) => version === 0 ? "定义版本未知" : `定义 v${version}`;
export const readyBasisLabel = (basis?: string) => basis === "demand" ? "从需求触发开始" : "从导航开始";
export const readyGroupKey = (row: { route: string; module: string; phase: string; basis?: string }) =>
  JSON.stringify([row.route, row.module, row.phase, row.basis === "demand" ? "demand" : "navigation"]);
export const sampledValue = (n: number, value: number | null | undefined) => n > 0 ? value ?? null : null;
