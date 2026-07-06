"use client";

import { useEffect, useSyncExternalStore } from "react";
import { MINDS_READ_KEY, markRead, readSet, subscribeStorage } from "@/lib/read-store";

/** 路灯：读过灯亮（点灯人星球的核心意象，docs/plan/05-3.3）。状态存 localStorage。 */
export function Lamp({ slug, litLabel, unlitLabel }: { slug: string; litLabel: string; unlitLabel: string }) {
  const lit = useSyncExternalStore(
    subscribeStorage,
    () => readSet(MINDS_READ_KEY).includes(slug),
    () => false,
  );
  return (
    <svg width={26} height={38} viewBox="0 0 26 38" aria-label={lit ? litLabel : unlitLabel} role="img" className="shrink-0">
      {lit && <circle cx={13} cy={9} r={8.5} fill="var(--p-accent)" opacity={0.25} />}
      <circle cx={13} cy={9} r={4.5} fill={lit ? "var(--p-accent)" : "none"} stroke="var(--crater)" strokeWidth={1.5} />
      <line x1={13} y1={14} x2={13} y2={32} stroke="var(--crater)" strokeWidth={1.8} strokeLinecap="round" />
      <line x1={8} y1={34} x2={18} y2={34} stroke="var(--crater)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

/** 文章页挂载即标记已读（点亮这盏灯） */
export function MarkRead({ slug }: { slug: string }) {
  useEffect(() => markRead(MINDS_READ_KEY, slug), [slug]);
  return null;
}
