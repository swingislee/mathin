"use client";

import { useEffect, useImperativeHandle, useRef, type ComponentProps, type KeyboardEventHandler, type ReactNode, type Ref } from "react";
import { TableBody, TableRow } from "@/components/ui/table";
import { followupFocusActivatesRow, followupKeyboardCommand, followupKeyContext, navigateFollowupTable } from "../followup-keyboard";
import { FollowupInlineDetails } from "./FollowupInlineDetails";

/** 名单与跟进共用摘要、详情及键盘作用域；业务页面只提供列和登记内容。 */
export function FollowupRecordRow({
  rowKey, active, expanded, onExpandedChange, onActivate, pending = false, selected = false,
  rowRef, rowProps, detailsId, title, colSpan, keepMounted, hideTitle, summary, children, onKeyDown, onOutcomeChange, onSave, focusOnActivate = false, renderDetails = true,
}: {
  rowKey: string;
  active: boolean;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onActivate?: () => void;
  pending?: boolean;
  selected?: boolean;
  rowRef?: Ref<HTMLTableRowElement>;
  rowProps?: ComponentProps<typeof TableRow> & { [key: `data-${string}`]: unknown };
  detailsId: string;
  title: string;
  colSpan: number;
  keepMounted?: boolean;
  hideTitle?: boolean;
  summary: ReactNode;
  children?: ReactNode | (() => ReactNode);
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onOutcomeChange?: (outcome: "" | "unreachable" | "connected" | "declined" | "invalid_number") => void;
  onSave?: () => void;
  focusOnActivate?: boolean;
  /** 分组行的子记录由同一张表排列时，保留展开与键盘语义，交由调用方呈现子行。 */
  renderDetails?: boolean;
}) {
  const summaryRef = useRef<HTMLTableRowElement>(null);
  useImperativeHandle(rowRef, () => summaryRef.current!, []);
  useEffect(() => {
    if (!focusOnActivate || !active || summaryRef.current?.contains(document.activeElement) || document.getElementById(detailsId)?.contains(document.activeElement)) return;
    summaryRef.current?.focus({ preventScroll: true });
    summaryRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, detailsId, focusOnActivate]);
  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    const context = followupKeyContext(event);
    if (context.overlay || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || pending) return;
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const command = followupKeyboardCommand(event, context);
    if (command?.type === "save" && onSave) {
      event.preventDefault(); onSave();
    } else if (command?.type === "outcome" && onOutcomeChange) {
      event.preventDefault(); onOutcomeChange(command.outcome);
    } else if (event.target === event.currentTarget && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault(); onExpandedChange(!expanded);
    } else if (followupKeyboardCommand(event, context)?.type === "close" && expanded) {
      event.preventDefault(); onExpandedChange(false);
      const summary = event.currentTarget.hasAttribute("data-followup-inline-details") ? event.currentTarget.previousElementSibling : event.currentTarget;
      (summary as HTMLElement | null)?.focus({ preventScroll: true });
    }
  };
  return <>
    <TableRow tabIndex={0} {...rowProps} ref={summaryRef} data-followup-row-key={rowKey}
      aria-selected={selected} aria-expanded={expanded} aria-controls={detailsId} aria-busy={pending}
      data-followup-active={active} data-followup-expanded={expanded}
      onFocusCapture={(event) => { if (followupFocusActivatesRow(event)) onActivate?.(); rowProps?.onFocusCapture?.(event); }}
      onClick={rowProps?.onClick ?? ((event) => {
        onActivate?.();
        if (!pending && !(event.target as Element).closest("button,a,input,textarea,select,[role='combobox'],[role='option'],[role='checkbox']")) onExpandedChange(!expanded);
      })} onKeyDown={handleKeyDown}>
      {summary}
    </TableRow>
    {renderDetails && <FollowupInlineDetails id={detailsId} open={expanded} onOpenChange={onExpandedChange} title={title} hideTitle={hideTitle}
      active={active} colSpan={colSpan} pending={pending} onActivate={onActivate} onKeyDown={handleKeyDown} keepMounted={keepMounted}>
      {children}
    </FollowupInlineDetails>}
  </>;
}

/** 所有记录表沿同一个可见行序列移动焦点，编辑器和弹层保留自己的方向键。 */
export function FollowupTableBody({ onNavigate, ...props }: Omit<ComponentProps<typeof TableBody>, "onKeyDown"> & {
  onNavigate: (key: string) => boolean;
}) {
  return <TableBody {...props} onKeyDown={(event) => navigateFollowupTable(event, onNavigate)} />;
}
