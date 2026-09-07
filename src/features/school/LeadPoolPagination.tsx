"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
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
import {
  LEAD_DEFAULT_PAGE_SIZE,
  LEAD_PAGE_SIZES,
  type LeadPageSize,
  type LeadPoolScope,
  type LeadStatus,
} from "./lead-contract";
import { leadPaginationTokens } from "./lead-pagination";

export function LeadPoolPagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  scope,
  status,
  q,
  baseHref = "/dashboard/followups/leads",
  focusLeadId,
  extraQuery = {},
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: LeadPageSize;
  scope: LeadPoolScope;
  status?: LeadStatus;
  q?: string;
  baseHref?: "/dashboard/followups/leads" | "/dashboard/followups/communication";
  focusLeadId?: string;
  extraQuery?: Record<string, string>;
}) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const hrefFor = (page: number, size: LeadPageSize = pageSize) => {
    const query = new URLSearchParams(extraQuery);
    query.set("scope", scope);
    if (status) query.set("status", status);
    if (q) query.set("q", q);
    if (focusLeadId) query.set("lead", focusLeadId);
    if (size !== LEAD_DEFAULT_PAGE_SIZE || baseHref === "/dashboard/followups/communication") query.set("pageSize", String(size));
    if (page > 1) query.set("page", String(page));
    const value = query.toString();
    return `${baseHref}${value ? `?${value}` : ""}`;
  };
  const tokens = leadPaginationTokens(currentPage, totalPages);
  const previousDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  const previousContent = (
    <ChevronLeft className="size-3.5" aria-hidden />
  );
  const nextContent = (
    <ChevronRight className="size-3.5" aria-hidden />
  );

  return (
    <div data-followup-pagination className="flex w-full min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted">
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span className="tabular-nums">
          {t("paginationCompactSummary", { page: currentPage, pages: totalPages, count: totalCount })}
        </span>
        <Select
          value={String(pageSize)}
          disabled={pending}
          onValueChange={(value) => {
            const nextPageSize = Number(value) as LeadPageSize;
            startTransition(() => router.replace(hrefFor(1, nextPageSize)));
          }}
        >
          <SelectTrigger className="h-7 w-auto min-w-24 gap-1 rounded-full bg-card px-2 py-0 text-xs shadow-none" aria-label={t("rowsPerPageLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("rowsPerPageCompact", { count: size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Pagination className="mx-0 w-auto justify-end" aria-label={t("paginationLabel")}>
        <PaginationContent className="gap-0.5">
          <PaginationItem>
            {previousDisabled ? (
              <PaginationPrevious
                aria-label={t("previous")}
                title={t("previous")}
                aria-disabled="true"
                tabIndex={-1}
                className="size-7 p-0 opacity-40"
              >
                {previousContent}
              </PaginationPrevious>
            ) : (
              <PaginationPrevious asChild aria-label={t("previous")} title={t("previous")} className="size-7 p-0">
                <Link href={hrefFor(currentPage - 1)}>{previousContent}</Link>
              </PaginationPrevious>
            )}
          </PaginationItem>

          {tokens.map((token) => token === "ellipsis-left" || token === "ellipsis-right" ? (
            <PaginationItem key={token}>
              <PaginationEllipsis className="size-7" label={t("morePages")} />
            </PaginationItem>
          ) : (
            <PaginationItem key={token}>
              {token === currentPage ? (
                <PaginationLink className="size-7 text-xs" asChild isActive aria-label={t("pageLabel", { page: token })}>
                  <span>{token}</span>
                </PaginationLink>
              ) : (
                <PaginationLink className="size-7 text-xs" asChild aria-label={t("pageLabel", { page: token })}>
                  <Link href={hrefFor(token)}>{token}</Link>
                </PaginationLink>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            {nextDisabled ? (
              <PaginationNext
                aria-label={t("next")}
                title={t("next")}
                aria-disabled="true"
                tabIndex={-1}
                className="size-7 p-0 opacity-40"
              >
                {nextContent}
              </PaginationNext>
            ) : (
              <PaginationNext asChild aria-label={t("next")} title={t("next")} className="size-7 p-0">
                <Link href={hrefFor(currentPage + 1)}>{nextContent}</Link>
              </PaginationNext>
            )}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
