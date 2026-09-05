"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TableCell, TableRow } from "@/components/ui/table";
import { DashboardInlineEntry } from "./DashboardInlineEntry";

/** 详情单独占据当前记录的下一行；数据行和固定列宽保持原样。 */
export function FollowupInlineDetails({
  open, onOpenChange, title, colSpan, children, pending = false, autoFocus = false, onSubmit, id,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  colSpan: number;
  children?: ReactNode;
  pending?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  id?: string;
}) {
  const t = useTranslations("school.followupWorkspace");
  const rowRef = useRef<HTMLTableRowElement>(null);
  if (!open) return null;

  const close = () => {
    if (pending) return;
    const summary = rowRef.current?.previousElementSibling as HTMLElement | null;
    const trigger = summary?.querySelector<HTMLElement>("button[aria-expanded='true']");
    onOpenChange(false);
    (trigger ?? summary)?.focus({ preventScroll: true });
  };

  return <TableRow ref={rowRef} id={id} data-followup-inline-details className="bg-blue/5 hover:bg-blue/5">
    <TableCell colSpan={colSpan} className="p-3 align-top whitespace-normal">
      <DashboardInlineEntry title={title} closeLabel={t("close")} onClose={close} onSubmit={onSubmit} pending={pending} autoFocus={autoFocus} flush>
        <div className="min-w-0 max-w-full pt-2">{children}</div>
      </DashboardInlineEntry>
    </TableCell>
  </TableRow>;
}
