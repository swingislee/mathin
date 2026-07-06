"use client";

import { useEffect, useSyncExternalStore } from "react";
import { TERMS_READ_KEY, markRead, readSet, subscribeStorage } from "@/lib/read-store";

/** 词条页挂载即记为「深入学习过」（点亮这颗星） */
export function MarkStudied({ slug }: { slug: string }) {
  useEffect(() => markRead(TERMS_READ_KEY, slug), [slug]);
  return null;
}

/** 订阅已学集合（以原始字符串为快照，保证引用稳定） */
export function useStudiedRaw(): string {
  return useSyncExternalStore(
    subscribeStorage,
    () => localStorage.getItem(TERMS_READ_KEY) ?? "[]",
    () => "[]",
  );
}

export function parseStudied(raw: string): Set<string> {
  try {
    const v = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

export { readSet };
