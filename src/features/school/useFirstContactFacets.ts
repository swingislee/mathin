"use client";

import { useEffect, useRef, useState } from "react";
import type { getFirstContactFacetsAction } from "./first-contact-facets-action";
import { readDashboardDetail } from "./dashboard-page/readDashboardDetail";
import type { FollowupServerFields } from "./followup-table-page";

type Facets = FollowupServerFields["facets"];
// 仅在当前浏览器内保留 30 秒，按账号、语言和条件隔离；翻页与排序复用候选。
const cache = new Map<string, { expires: number; result: Promise<Facets> }>();
const MAX_ENTRIES = 12;

export function useFirstContactFacets(data: FollowupServerFields | undefined, locale: string, currentUserId: string) {
  const language = locale.startsWith("en") ? "en" : "zh";
  const query = JSON.stringify({ version: 2, filters: Object.fromEntries(Object.entries(data?.query.filters ?? {}).sort(([a], [b]) => a.localeCompare(b))), sort: null });
  const key = JSON.stringify([currentUserId, language, query]);
  const activeKey = useRef<string | null>(key);
  useEffect(() => { activeKey.current = key; return () => { activeKey.current = null; }; }, [key]);
  const [loaded, setLoaded] = useState<{ key: string; facets?: Facets; status: "loading" | "error" | "ready" } | null>(null);
  const current = loaded?.key === key ? loaded : null;
  const load = async () => {
    if (!data?.facetsDeferred || current?.status === "loading") return;
    const now = Date.now();
    for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
    let entry = cache.get(key);
    if (!entry) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const result = readDashboardDetail<Awaited<ReturnType<typeof getFirstContactFacetsAction>>>(
        `/${language}/dashboard/communication/filter-options`, { locale: language, fields: query }, controller.signal,
      ).then(response => {
        if (!response.ok) throw new Error(response.code);
        return response.data;
      }).finally(() => clearTimeout(timeout));
      entry = { expires: now + 30_000, result };
      cache.set(key, entry);
      if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    }
    setLoaded({ key, status: "loading", facets: current?.facets });
    try {
      const facets = await entry.result;
      if (activeKey.current === key) setLoaded({ key, status: "ready", facets });
    }
    catch {
      if (cache.get(key) === entry) cache.delete(key);
      if (activeKey.current === key) setLoaded({ key, status: "error" });
    }
  };
  return {
    fieldView: data?.facetsDeferred && current?.facets ? { ...data, facets: current.facets } : data,
    onLoadFacets: data?.facetsDeferred ? load : undefined,
    facetsStatus: data?.facetsDeferred && current?.status !== "ready" ? current?.status ?? "loading" : undefined,
  };
}
