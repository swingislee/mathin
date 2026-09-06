"use client";

import { useRef, type KeyboardEventHandler, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TableCell, TableRow } from "@/components/ui/table";
import { DashboardInlineEntry } from "./DashboardInlineEntry";

/** 详情单独占据当前记录的下一行；数据行和固定列宽保持原样。 */
export function FollowupInlineDetails({
  open, onOpenChange, title, colSpan, children, pending = false, autoFocus = false, onSubmit, id, hideTitle = false, active = true, onKeyDown, onActivate, keepMounted = false,
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
  hideTitle?: boolean;
  active?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onActivate?: () => void;
  /** 已打开的测评登记可收起并保留草稿；其他入口沿用关闭即卸载的默认行为。 */
  keepMounted?: boolean;
}) {
  const t = useTranslations("school.followupWorkspace");
  const rowRef = useRef<HTMLTableRowElement>(null);
  if (!open && !keepMounted) return null;

  const close = () => {
    if (pending) return;
    const summary = rowRef.current?.previousElementSibling as HTMLElement | null;
    const trigger = summary?.querySelector<HTMLElement>("button[aria-expanded='true']");
    onOpenChange(false);
    (trigger ?? summary)?.focus({ preventScroll: true });
  };

  return <TableRow ref={rowRef} id={id} tabIndex={-1} hidden={!open} aria-hidden={!open || undefined} inert={!open || undefined} data-followup-inline-details data-followup-active={active} onKeyDown={onKeyDown}
    onFocusCapture={(event) => { if (event.currentTarget.contains(event.target)) onActivate?.(); }}
    onPointerDown={(event) => {
      if (!event.currentTarget.contains(event.target as Node)) return;
      onActivate?.();
      const focusTarget = (event.target as Element).closest("button,a,input,textarea,select,[tabindex],[contenteditable],[role='combobox'],[role='option']");
      if (!focusTarget || focusTarget === event.currentTarget) {
        event.currentTarget.focus({ preventScroll: true });
      }
    }}>
    <TableCell colSpan={colSpan} className="p-3 align-top whitespace-normal">
      <DashboardInlineEntry title={title} hideTitle={hideTitle} closeLabel={t("close")} onClose={close} onSubmit={onSubmit} pending={pending} autoFocus={autoFocus} flush>
        <div className="@container/followup-entry min-w-0 max-w-full space-y-3 break-words pt-2">{children}</div>
      </DashboardInlineEntry>
    </TableCell>
  </TableRow>;
}
