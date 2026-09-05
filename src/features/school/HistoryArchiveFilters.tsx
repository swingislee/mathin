"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { historyArchiveHref, type HistoryArchiveFilters as Filters } from "./history-archive-contract";
import type { HistoryArchiveMessages } from "./history-archive-messages";
import { leadPaginationTokens } from "./lead-pagination";

export function HistoryArchiveSearch({ filters, messages }: { filters: Filters; messages: HistoryArchiveMessages }) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => router.push(historyArchiveHref(filters, { q: q.trim(), page: 1, record: "", relatedPage: 1 })));
  }

  return (
    <form onSubmit={submit} role="search" className="flex w-full min-w-0 flex-wrap items-center gap-2" aria-busy={pending}>
      <Input
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        maxLength={200}
        aria-label={messages.search}
        placeholder={messages.searchPlaceholder}
        className="h-9 min-w-40 flex-1 sm:max-w-md"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{messages.searchAction}</Button>
    </form>
  );
}

export function HistoryArchiveColumnFilter({ filters, field, label, options }: {
  filters: Filters;
  field: "status" | "table";
  label: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={filters[field] || "__all__"}
      disabled={pending}
      onValueChange={(value) => startTransition(() => router.push(historyArchiveHref(filters, {
        [field]: value === "__all__" ? "" : value,
        page: 1,
        record: "",
        relatedPage: 1,
      })))}
    >
      <SelectTrigger aria-label={label} className="h-8 w-full min-w-32 max-w-60 text-xs shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function HistoryArchivePagination({ filters, page, pageSize, total, messages, related = false }: {
  filters: Filters;
  page: number;
  pageSize: number;
  total: number;
  messages: HistoryArchiveMessages;
  related?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const tokens = leadPaginationTokens(page, pages);
  const hrefFor = (nextPage: number) => historyArchiveHref(filters, related ? { relatedPage: nextPage } : { page: nextPage });
  const previousContent = <><ChevronLeft className="size-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{messages.previous}</span></>;
  const nextContent = <><span className="sr-only sm:not-sr-only">{messages.next}</span><ChevronRight className="size-4" aria-hidden="true" /></>;

  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 text-xs text-muted" aria-busy={pending}>
      <span className="tabular-nums">{messages.page} {page} / {pages} · {messages.total} {total.toLocaleString()} {messages.rows}</span>
      {related ? <span>{messages.relatedPerPage} {pageSize}</span> : (
        <div className="flex items-center gap-2">
          <span>{messages.perPage}</span>
          <Select value={String(pageSize)} disabled={pending} onValueChange={(value) => startTransition(() => router.push(historyArchiveHref(filters, { pageSize: Number(value), page: 1 })))}>
            <SelectTrigger className="h-8 w-20 text-xs" aria-label={messages.perPage}><SelectValue /></SelectTrigger>
            <SelectContent>{[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      <Pagination className="w-full justify-start sm:ml-auto sm:w-auto" aria-label={related ? messages.relatedPagination : messages.pagination}>
        <PaginationContent>
          <PaginationItem>
            {page <= 1 ? <PaginationPrevious asChild aria-disabled="true" className="opacity-40"><span>{previousContent}</span></PaginationPrevious> : (
              <PaginationPrevious asChild aria-label={messages.previous}><Link href={hrefFor(page - 1)} scroll={false}>{previousContent}</Link></PaginationPrevious>
            )}
          </PaginationItem>
          {tokens.map((token) => typeof token === "number" ? (
            <PaginationItem key={token}>
              <PaginationLink asChild isActive={token === page} aria-label={`${messages.page} ${token}`}>
                <Link href={hrefFor(token)} scroll={false}>{token}</Link>
              </PaginationLink>
            </PaginationItem>
          ) : <PaginationItem key={token}><PaginationEllipsis label={messages.morePages} /></PaginationItem>)}
          <PaginationItem>
            {page >= pages ? <PaginationNext asChild aria-disabled="true" className="opacity-40"><span>{nextContent}</span></PaginationNext> : (
              <PaginationNext asChild aria-label={messages.next}><Link href={hrefFor(page + 1)} scroll={false}>{nextContent}</Link></PaginationNext>
            )}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
