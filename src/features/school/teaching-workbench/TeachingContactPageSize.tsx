"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";

export function TeachingContactPageSize({ pageSize, currentHref }: { pageSize: 10 | 20; currentHref: string }) {
  const t = useTranslations("school.teachingWorkbench");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Select value={String(pageSize)} disabled={pending} onValueChange={value => {
    const [path, query] = currentHref.split("?");
    const params = new URLSearchParams(query);
    params.set("contactSize", value);
    params.delete("contactPage");
    startTransition(() => router.replace(`${path}?${params}`));
  }}>
    <SelectTrigger className="h-8 w-auto" aria-label={t("pageSize")}><SelectValue /></SelectTrigger>
    <SelectContent>{[10, 20].map(size => <SelectItem key={size} value={String(size)}>{t("rowsPerPage", { count: size })}</SelectItem>)}</SelectContent>
  </Select>;
}
