/** Read-side identity semantics. Machine identifiers are never human labels. */
export function isAuditUserId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isAuditUserEmail(value: string): boolean {
  return /^[^\s@:]+@[^\s@]+$/.test(value);
}

export function getAuditActorLabel(actorId: string | null, names: ReadonlyMap<string, string>): string {
  if (!actorId || actorId === "system" || actorId.startsWith("system:")) return "系统";
  if (actorId.startsWith("dak:")) return "DAK Studio";
  if (actorId.startsWith("release:")) return "发布流程";
  if (isAuditUserId(actorId) || isAuditUserEmail(actorId)) return names.get(actorId) ?? "未知用户";
  return "未知来源";
}

const CONTEXT_USER_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "team.captain.transfer": ["fromUserId", "toUserId"],
  "competition_entry.representative.transfer": ["fromUserId", "toUserId"],
  "sanction.issue": ["subjectUserId"],
  "user_identity.merge": ["mergedUserId"],
};

/** Only these action-specific references may reach the server-side user lookup. */
export function getAuditContextUserReferences(action: string, meta: unknown): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return refs;
  const fields = Object.hasOwn(CONTEXT_USER_FIELDS, action) ? CONTEXT_USER_FIELDS[action] : [];
  for (const field of fields ?? []) {
    const value = (meta as Record<string, unknown>)[field];
    if (isAuditUserId(value)) refs.set(field, value);
  }
  return refs;
}

export function summarizeAuditPeople(action: string, meta: unknown, names: ReadonlyMap<string, string>): string | null {
  const refs = getAuditContextUserReferences(action, meta);
  if (refs.size === 0) return null;
  const name = (field: string) => names.get(refs.get(field) ?? "") ?? "未知用户";
  switch (action) {
    case "team.captain.transfer": return `队长：${name("fromUserId")} → ${name("toUserId")}`;
    case "competition_entry.representative.transfer": return `赛事代表：${name("fromUserId")} → ${name("toUserId")}`;
    case "sanction.issue": return `处罚对象：${name("subjectUserId")}`;
    case "user_identity.merge": return `合并来源：${name("mergedUserId")}`;
    default: return null;
  }
}
