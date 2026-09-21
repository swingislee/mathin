"use client";

import { useRef, type KeyboardEventHandler, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TableCell, TableRow } from "@/components/ui/table";
import { DashboardInlineEntry } from "./DashboardInlineEntry";
import { cn } from "@/lib/utils";

export { FollowupDetailLoading } from "./DashboardInlineDetailBoundary";

/** 详情单独占据当前记录的下一行；数据行和固定列宽保持原样。 */
export function FollowupInlineDetails({
  open, onOpenChange, title, colSpan, children, pending = false, autoFocus = false, onSubmit, id, hideTitle = false, active = true, onKeyDown, onActivate, keepMounted = false, loadingLabel, closeLabel, flush = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  colSpan: number;
  /** 详情内容在打开或保留草稿时构造，收起的其他记录跳过字段计算。 */
  children?: ReactNode | (() => ReactNode);
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
  /** 可覆盖共用加载文案；每个详情始终拥有行内 Suspense 边界。 */
  loadingLabel?: string;
  closeLabel?: string;
  /** 已有详情内容自行提供内边距时，共用外壳贴合其布局。 */
  flush?: boolean;
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
    onFocusCapture={(event) => { if ((event.target as Element).closest("[data-followup-inline-details]") === event.currentTarget) onActivate?.(); }}
    onPointerDown={(event) => {
      if ((event.target as Element).closest("[data-followup-inline-details]") !== event.currentTarget) return;
      onActivate?.();
      const focusTarget = (event.target as Element).closest("button,a,input,textarea,select,[tabindex],[contenteditable],[role='combobox'],[role='option']");
      if (!focusTarget || focusTarget === event.currentTarget) {
        event.currentTarget.focus({ preventScroll: true });
      }
    }}>
    <TableCell colSpan={colSpan} className={cn("align-top whitespace-normal", flush ? "p-0" : "p-3")}>
      <DashboardInlineEntry title={title} hideTitle={hideTitle} closeLabel={closeLabel ?? t("close")} onClose={close} onSubmit={onSubmit} pending={pending} autoFocus={autoFocus} loadingLabel={loadingLabel} flush>
        {() => <div className={cn("@container/followup-entry min-w-0 max-w-full space-y-3 break-words", !flush && "pt-2")}>{typeof children === "function" ? children() : children}</div>}
      </DashboardInlineEntry>
    </TableCell>
  </TableRow>;
}
