"use client";

import { useEffect, useRef, useState, useTransition, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { AssessmentUnifiedWorkbench } from "./AssessmentUnifiedWorkbench";
import type { AssessmentWorkbenchPage } from "./assessment-workbench-page";

type Props = Omit<ComponentProps<typeof AssessmentUnifiedWorkbench>, "initialRows" | "initialQuery" | "initialRecordState" | "pageControl">;

export function AssessmentPagedWorkbench({ data, ...props }: Props & { data: AssessmentWorkbenchPage }) {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ data, q: data.q, state: data.state, fields: data.fieldView.query });
  const nextSearch = useRef(new URLSearchParams(search.toString()));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchText = search.toString();
  useEffect(() => {
    nextSearch.current = new URLSearchParams(searchText);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [searchText]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (draft.data !== data) {
    setDraft({ data, q: data.q, state: data.state, fields: data.fieldView.query });
  }
  const navigate = (values: Record<string, string>, delay = 0) => {
    if (timer.current) clearTimeout(timer.current);
    for (const [key, value] of Object.entries(values)) {
      if (value) nextSearch.current.set(key, value); else nextSearch.current.delete(key);
    }
    const href = `${pathname}?${nextSearch.current}`;
    timer.current = setTimeout(() => {
      timer.current = null;
      startTransition(() => router.replace(href, { scroll: false }));
    }, delay);
  };
  return <AssessmentUnifiedWorkbench {...props} initialRows={data.rows} initialQuery={data.q} initialRecordState={data.state}
    pageControl={{ data, pending, q: draft.q, state: draft.state, fields: draft.fields,
      onSearch: q => { setDraft(current => ({ ...current, q })); navigate({ q, page: "" }, 250); },
      onState: state => { setDraft(current => ({ ...current, state })); navigate({ state, page: "" }); },
      onFields: fields => { setDraft(current => ({ ...current, fields })); navigate({ fields: JSON.stringify(fields), page: "" }, 180); },
      onPage: (page, pageSize) => navigate({ page: String(page), pageSize: String(pageSize) }),
    }} />;
}
