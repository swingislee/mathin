"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useDashboardPreference } from "./dashboard-page/DashboardPreferenceScope";

/** 保存服务端查询条件；分页和临时定位参数不进入偏好。 */
const DEFAULT_KEYS = ["q", "scope", "assignment", "status", "pageSize", "queue", "stage", "cycle", "fields"];
export function FollowupQueryMemory({ keys = DEFAULT_KEYS, preferenceKey }: { keys?: string[]; preferenceKey?: string }) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const router = useRouter();
  const memoryKey = `query:${preferenceKey ?? pathname}`;
  const preference = useDashboardPreference(memoryKey);
  const visited = useRef<string | null>(null);
  useEffect(() => {
    if (!preference.ready) return;
    const entering = visited.current !== memoryKey;
    visited.current = memoryKey;
    if (entering && !query && preference.raw) {
      try {
        const stored = JSON.parse(preference.raw);
        if (typeof stored === "string" && stored) {
          const restored = new URLSearchParams(stored);
          for (const key of [...restored.keys()]) if (!keys.includes(key)) restored.delete(key);
          if (restored.size) { router.replace(`${pathname}?${restored}`); return; }
        }
      } catch { /* 使用默认筛选。 */ }
    }
    const selected = new URLSearchParams(query);
    if (selected.has("lead")) return;
    for (const key of [...selected.keys()]) if (!keys.includes(key)) selected.delete(key);
    preference.save(selected.toString());
  // preference.save 随渲染重建；只有路径或查询变化时保存。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryKey, pathname, query, preference.ready]);
  return null;
}
