"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";
import type { FollowupServerFields } from "./followup-table-page";

/** URL 是服务端查询的权威状态；快速连续输入合并发送，Next 路由丢弃过期响应。 */
export function useFollowupServerFields(data?: FollowupServerFields) {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const source = JSON.stringify(data?.query);
  const [draft, setDraft] = useState<{ source: string | undefined; query: DashboardFieldQuery } | null>(null);
  if (draft && draft.source !== source) setDraft(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!data) return undefined;
  return { ...data, pending, query: draft?.source === source ? draft.query : data.query,
    onChange: (query: DashboardFieldQuery) => {
      setDraft({ source, query });
      if (timer.current) clearTimeout(timer.current);
      const next = new URLSearchParams(search.toString());
      next.set("fields", JSON.stringify(query));
      next.delete("page");
      timer.current = setTimeout(() => startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false })), 180);
    } };
}
