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
    <>
      <ChevronLeft className="size-4" />
      <span className="hidden sm:inline">{t("previous")}</span>
    </>
  );
  const nextContent = (
    <>
      <span className="hidden sm:inline">{t("next")}</span>
      <ChevronRight className="size-4" />
    </>
  );

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      <span className="whitespace-nowrap tabular-nums">
        {t("paginationSummary", { page: currentPage, pages: totalPages, count: totalCount })}
      </span>
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span>{t("rowsPerPage")}</span>
        <Select
          value={String(pageSize)}
          disabled={pending}
          onValueChange={(value) => {
            const nextPageSize = Number(value) as LeadPageSize;
            startTransition(() => router.replace(hrefFor(1, nextPageSize)));
          }}
        >
          <SelectTrigger className="h-8 w-24 rounded-full bg-card shadow-none" aria-label={t("rowsPerPageLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {t("rowsPerPageValue", { count: size })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Pagination className="w-full justify-start sm:ml-auto sm:w-auto sm:justify-end" aria-label={t("paginationLabel")}>
        <PaginationContent>
          <PaginationItem>
            {previousDisabled ? (
              <PaginationPrevious
                aria-label={t("previous")}
                aria-disabled="true"
                tabIndex={-1}
                className="w-8 px-0 opacity-40 sm:w-auto sm:px-2.5"
              >
                {previousContent}
              </PaginationPrevious>
            ) : (
              <PaginationPrevious asChild aria-label={t("previous")} className="w-8 px-0 sm:w-auto sm:px-2.5">
                <Link href={hrefFor(currentPage - 1)}>{previousContent}</Link>
              </PaginationPrevious>
            )}
          </PaginationItem>

          {tokens.map((token) => token === "ellipsis-left" || token === "ellipsis-right" ? (
            <PaginationItem key={token}>
              <PaginationEllipsis label={t("morePages")} />
            </PaginationItem>
          ) : (
            <PaginationItem key={token}>
              {token === currentPage ? (
                <PaginationLink asChild isActive aria-label={t("pageLabel", { page: token })}>
                  <span>{token}</span>
                </PaginationLink>
              ) : (
                <PaginationLink asChild aria-label={t("pageLabel", { page: token })}>
                  <Link href={hrefFor(token)}>{token}</Link>
                </PaginationLink>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            {nextDisabled ? (
              <PaginationNext
                aria-label={t("next")}
                aria-disabled="true"
                tabIndex={-1}
                className="w-8 px-0 opacity-40 sm:w-auto sm:px-2.5"
              >
                {nextContent}
              </PaginationNext>
            ) : (
              <PaginationNext asChild aria-label={t("next")} className="w-8 px-0 sm:w-auto sm:px-2.5">
                <Link href={hrefFor(currentPage + 1)}>{nextContent}</Link>
              </PaginationNext>
            )}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
