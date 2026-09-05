"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";

const Scope = createContext<string | null>(null);
const CHANGE = "mathin:dashboard-preferences";

export function DashboardPreferenceScope({ userId, children }: { userId: string; children: ReactNode }) {
  return <Scope.Provider value={userId}>{children}</Scope.Provider>;
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(CHANGE, listener); };
}

/** 仅保存当前账号的展示偏好；读取失败时继续使用页面默认配置。 */
export function useDashboardPreference(key?: string) {
  const userId = useContext(Scope);
  const storageKey = key && userId ? `mathin:dashboard:v1:${userId}:${key}` : null;
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const raw = useSyncExternalStore(subscribe, () => {
    try { return storageKey ? localStorage.getItem(storageKey) : null; } catch { return null; }
  }, () => null);
  const save = (value: unknown) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(value)); window.dispatchEvent(new Event(CHANGE)); } catch { /* 私密浏览仍可使用当前页面。 */ }
  };
  return { raw, save, ready };
}

export function useDashboardSearchQuery(key: string): [string, (value: string) => void] {
  const [localQuery, setLocalQuery] = useState("");
  const preference = useDashboardPreference(`search:${key}`);
  let query = localQuery;
  try {
    const saved = preference.raw ? JSON.parse(preference.raw) : null;
    if (typeof saved === "string") query = saved;
  } catch { /* 无效缓存使用空搜索。 */ }
  return [query, (value) => { setLocalQuery(value); preference.save(value); }];
}
