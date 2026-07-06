"use client";

/** localStorage 已读集合（终版将迁 Supabase，键结构保持可迁移） */
export function readSet(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function markRead(key: string, slug: string) {
  try {
    const arr = readSet(key);
    if (!arr.includes(slug)) {
      arr.push(slug);
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过
  }
}

export function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

export const TERMS_READ_KEY = "mathin-terms-read";
export const MINDS_READ_KEY = "mathin-minds-read";
