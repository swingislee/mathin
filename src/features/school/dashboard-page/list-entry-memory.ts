/**
 * 名单页进入时恢复的查询条件（FollowupQueryMemory 按账号记在本机）。
 * 侧栏入口直接链接到恢复后的地址，进入时不再先按默认条件读取一次、再切换到上次的条件。
 */
export const WORKLIST_QUERY_KEYS = ["stage", "scope", "group", "marker", "periodField", "period", "page", "pageSize", "fields", "batch", "interest", "channel"] as const;
export const ASSESSMENT_QUERY_KEYS = ["periodField", "period", "group", "pageSize", "fields"] as const;

export const LIST_ENTRY_MEMORY = {
  "/dashboard/leads": { preferenceKey: "leads-first-contact-entry:v2", keys: WORKLIST_QUERY_KEYS },
  "/dashboard/communication": { preferenceKey: "communication-stage-entry:v2", keys: WORKLIST_QUERY_KEYS },
  "/dashboard/assessments": { preferenceKey: "assessment-months-entry:v1", keys: ASSESSMENT_QUERY_KEYS },
} as const;
export type ListEntryPath = keyof typeof LIST_ENTRY_MEMORY;

export function isListEntryPath(path: string): path is ListEntryPath {
  return Object.hasOwn(LIST_ENTRY_MEMORY, path);
}

/** 与 FollowupQueryMemory 使用同一偏好键。 */
export function followupQueryPreferenceKey(preferenceKey: string) {
  return `query:${preferenceKey}`;
}

/** 按页面允许的参数还原上次条件；没有记忆时回到默认入口。 */
export function rememberedListHref(path: ListEntryPath, raw: string | null): string {
  try {
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (typeof stored !== "string" || !stored || stored.length > 20_000) return path;
    const restored = new URLSearchParams(stored);
    const keys: readonly string[] = LIST_ENTRY_MEMORY[path].keys;
    for (const key of [...restored.keys()]) if (!keys.includes(key)) restored.delete(key);
    return restored.size ? `${path}?${restored}` : path;
  } catch {
    return path;
  }
}
