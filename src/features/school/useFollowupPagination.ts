"use client";

import { useMemo, useState } from "react";
import { followupPage, FOLLOWUP_DEFAULT_PAGE_SIZE, type FollowupPageSize } from "./followup-table-page";

export function useFollowupPagination<Row>(rows: readonly Row[], viewKey: string) {
  const [state, setState] = useState({ viewKey, page: 1, pageSize: FOLLOWUP_DEFAULT_PAGE_SIZE as FollowupPageSize });
  const currentPage = state.viewKey === viewKey ? state.page : 1;
  const page = useMemo(() => followupPage(rows, currentPage, state.pageSize), [rows, currentPage, state.pageSize]);
  if (state.viewKey !== viewKey || state.page !== page.page) setState({ ...state, viewKey, page: page.page });
  return { ...page, onPageChange: (next: number, size: FollowupPageSize) => setState({ viewKey, page: size === state.pageSize ? next : 1, pageSize: size }) };
}
