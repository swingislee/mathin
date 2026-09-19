"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { LEAD_DEFAULT_PAGE_SIZE, LEAD_PAGE_SIZES, type LeadPageSize, type LeadPoolScope, type LeadStatus } from "./lead-contract";
import { DashboardTablePagination } from "./dashboard-page/DashboardTablePagination";

export function LeadPoolPagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  scope = "all",
  status,
  q,
  baseHref = "/dashboard/leads",
  focusLeadId,
  extraQuery = {},
  onPageChange,
  disabled = false,
}: {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: LeadPageSize;
  scope?: LeadPoolScope;
  status?: LeadStatus;
  q?: string;
  baseHref?: `/dashboard/${string}`;
  focusLeadId?: string;
  extraQuery?: Record<string, string>;
  onPageChange?: (page: number, pageSize: LeadPageSize) => void;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const hrefFor = (page: number, size: LeadPageSize = pageSize) => {
    const query = new URLSearchParams(extraQuery);
    query.set("scope", scope);
    if (status) query.set("status", status);
    if (q) query.set("q", q);
    if (focusLeadId) query.set("lead", focusLeadId);
    if (size !== LEAD_DEFAULT_PAGE_SIZE || baseHref === "/dashboard/communication" || baseHref.startsWith("/dashboard/communication/")) query.set("pageSize", String(size));
    if (page > 1) query.set("page", String(page));
    const value = query.toString();
    return `${baseHref}${value ? `?${value}` : ""}`;
  };
  return <DashboardTablePagination currentPage={currentPage} totalPages={totalPages} totalCount={totalCount}
    pageSize={pageSize} pageSizes={LEAD_PAGE_SIZES} hrefFor={hrefFor} disabled={disabled} pending={pending}
    onPageChange={onPageChange ? page => onPageChange(page, pageSize) : undefined}
    onPageSizeChange={size => {
      const nextPageSize = size as LeadPageSize;
      if (onPageChange) onPageChange(1, nextPageSize);
      else startTransition(() => router.replace(hrefFor(1, nextPageSize)));
    }} />;
}
