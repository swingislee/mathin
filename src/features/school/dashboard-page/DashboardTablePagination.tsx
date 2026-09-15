"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { leadPaginationTokens } from "../lead-pagination";

/** 学服已使用的紧凑分页外观；调用方只决定翻页是路由导航还是本地更新。 */
export function DashboardTablePagination({ currentPage, totalPages, totalCount, pageSize, pageSizes,
  hrefFor, onPageChange, onPageSizeChange, disabled = false, pending = false,
}: {
  currentPage: number; totalPages: number; totalCount: number; pageSize: number; pageSizes: readonly number[];
  hrefFor?: (page: number) => string; onPageChange?: (page: number) => void; onPageSizeChange: (size: number) => void;
  disabled?: boolean; pending?: boolean;
}) {
  const t = useTranslations("school.leads");
  const blocked = disabled || pending;
  const target = (page: number, children: ReactNode) => hrefFor
    ? <Link aria-disabled={blocked || undefined} href={hrefFor(page)} onClick={event => {
      if (blocked) { event.preventDefault(); return; }
      if (onPageChange) { event.preventDefault(); onPageChange(page); }
    }}>{children}</Link>
    : <button type="button" disabled={blocked} onClick={() => onPageChange?.(page)}>{children}</button>;
  return <div data-followup-pagination data-page={currentPage} data-page-size={pageSize} aria-busy={pending}
    className="flex w-full min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-[11px] leading-4 text-muted">
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="tabular-nums">{t("paginationCompactSummary", { page: currentPage, pages: totalPages, count: totalCount })}</span>
      <Select value={String(pageSize)} disabled={blocked} onValueChange={value => onPageSizeChange(Number(value))}>
        <SelectTrigger className="h-6 w-auto min-w-20 gap-1 rounded-full bg-card px-2 py-0 text-[11px] shadow-none" aria-label={t("rowsPerPageLabel")}><SelectValue /></SelectTrigger>
        <SelectContent>{pageSizes.map(size => <SelectItem key={size} value={String(size)}>{t("rowsPerPageCompact", { count: size })}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <Pagination className="mx-0 w-auto justify-end" aria-label={t("paginationLabel")}><PaginationContent className="gap-0.5">
      <PaginationItem>{currentPage <= 1
        ? <PaginationPrevious aria-label={t("previous")} title={t("previous")} aria-disabled="true" tabIndex={-1} className="size-6 p-0 opacity-40"><ChevronLeft className="size-3.5" aria-hidden /></PaginationPrevious>
        : <PaginationPrevious asChild aria-label={t("previous")} title={t("previous")} className="size-6 p-0">{target(currentPage - 1, <ChevronLeft className="size-3.5" aria-hidden />)}</PaginationPrevious>}
      </PaginationItem>
      {leadPaginationTokens(currentPage, totalPages).map(token => typeof token === "string"
        ? <PaginationItem key={token}><PaginationEllipsis className="size-6" label={t("morePages")} /></PaginationItem>
        : <PaginationItem key={token}><PaginationLink className="size-6 text-[11px]" asChild isActive={token === currentPage} aria-label={t("pageLabel", { page: token })}>
          {token === currentPage ? <span>{token}</span> : target(token, token)}
        </PaginationLink></PaginationItem>)}
      <PaginationItem>{currentPage >= totalPages
        ? <PaginationNext aria-label={t("next")} title={t("next")} aria-disabled="true" tabIndex={-1} className="size-6 p-0 opacity-40"><ChevronRight className="size-3.5" aria-hidden /></PaginationNext>
        : <PaginationNext asChild aria-label={t("next")} title={t("next")} className="size-6 p-0">{target(currentPage + 1, <ChevronRight className="size-3.5" aria-hidden />)}</PaginationNext>}
      </PaginationItem>
    </PaginationContent></Pagination>
  </div>;
}
