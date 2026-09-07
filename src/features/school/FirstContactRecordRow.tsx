"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { HistoricalRecordBadge } from "./BusinessRecordStateFilter";
import { businessRecordMessages, type BusinessRecordState } from "./business-record-state-contract";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { followupToneClasses, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { followupFocusActivatesRow } from "./followup-keyboard";

export interface FirstContactRecord {
  key: string;
  state?: BusinessRecordState;
  missingFirstContact?: boolean;
  visitCommitted?: boolean;
  person: Omit<ComponentProps<typeof FollowupPersonCell>, "selection" | "expanded" | "detailsId" | "onToggle">;
  status: { label: string; tone: FollowupTone; context: string; contextTitle?: string };
  updated: string;
  countLabel?: string;
  note?: string;
}

/** 首联记录共用身份、字段、主行和详情布局；写入控制器通过 entry 与 children 提供业务操作。 */
export function FirstContactRecordRow({
  record, locale, active, selected = false, expanded, onExpandedChange, onActivate,
  rowRef, tabIndex = 0, pending = false, layout = "communication", canAssign = false,
  detailsId, onKeyDown, onClick, selection, workPurpose, historicalSummary,
  rowActions, entry, defaultCells, children,
}: {
  record: FirstContactRecord;
  locale: string;
  active: boolean;
  selected?: boolean;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onActivate?: () => void;
  rowRef?: Ref<HTMLTableRowElement>;
  tabIndex?: number;
  pending?: boolean;
  layout?: "default" | "communication";
  canAssign?: boolean;
  detailsId: string;
  onKeyDown?: ComponentProps<typeof FollowupInlineDetails>["onKeyDown"];
  onClick?: ComponentProps<typeof TableRow>["onClick"];
  selection?: ReactNode;
  workPurpose?: ReactNode;
  historicalSummary?: { state: ReactNode; details: ReactNode; updated: ReactNode };
  rowActions?: ReactNode;
  entry?: ReactNode;
  defaultCells?: ReactNode;
  children?: ReactNode | (() => ReactNode);
}) {
  const m = businessRecordMessages(locale);
  const handleKeyDown: NonNullable<typeof onKeyDown> = onKeyDown ?? ((event) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.repeat) return;
    if (event.target === event.currentTarget && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault(); onExpandedChange(!expanded);
    }
    if (event.key === "Escape" && expanded) { event.preventDefault(); onExpandedChange(false); }
  });
  return <>
    <TableRow ref={rowRef} data-first-contact-record={record.key} data-record-state={record.state ?? "current"}
      data-first-contact-missing={record.missingFirstContact ? record.person.subject.studentId : undefined}
      data-communication-work-key={layout === "communication" ? record.key : undefined} data-followup-row-key={record.key}
      data-followup-success={record.visitCommitted === true}
      tabIndex={tabIndex} aria-selected={selected} data-followup-active={active} data-followup-expanded={expanded} aria-busy={pending}
      className="h-16 focus-visible:outline-none [&>td]:min-w-0" onFocusCapture={(event) => { if (followupFocusActivatesRow(event)) onActivate?.(); }}
      onClick={onClick ?? ((event) => {
        onActivate?.();
        if (!pending && !(event.target as HTMLElement).closest("button,a,input,textarea,[role='combobox'],[role='option'],[role='checkbox']")) onExpandedChange(!expanded);
      })} onKeyDown={handleKeyDown}>
      {layout === "communication" ? <>
        <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
          <FollowupPersonCell {...record.person} selection={selection} expanded={expanded} detailsId={detailsId} onToggle={() => onExpandedChange(!expanded)} />
        </TableCell>
        <TableCell className="px-2 py-2">{historicalSummary ? historicalSummary.state : <>
          <Badge variant="outline" className={cn("max-w-full whitespace-normal rounded-md px-1.5 text-[11px]", followupToneClasses[record.status.tone])}><span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />{record.status.label}</Badge>
          {record.state === "historical" ? <HistoricalRecordBadge locale={locale} /> : null}
          {workPurpose ? <div className="mt-1 truncate text-[11px] text-muted">{workPurpose}</div> : record.status.context ? <p className="mt-1 truncate text-[11px] text-muted" title={record.status.contextTitle ?? record.status.context}>{record.status.context}</p> : null}
        </>}</TableCell>
        <TableCell className="px-2 py-2">{entry ?? (record.missingFirstContact ? !expanded && <p className="truncate text-xs text-muted" title={m.firstContactHint}>{m.firstContactHint}</p> : <>
          <p className="mb-1 text-[11px] text-muted">{m.recordedOnly}</p>
          <p className="truncate text-xs" title={record.note}>{record.note || m.unknown}</p>
        </>)}</TableCell>
        <TableCell className="px-2 py-2 text-[11px] text-muted">{historicalSummary ? historicalSummary.updated : <>
          <span className="block break-words">{record.updated}</span>{record.countLabel ? <p className="mt-1 truncate">{record.countLabel}</p> : null}
        </>}{rowActions ? <div className="mt-1 flex min-w-0 flex-wrap gap-1">{rowActions}</div> : null}</TableCell>
      </> : defaultCells}
    </TableRow>
    <FollowupInlineDetails id={detailsId} open={expanded} onOpenChange={onExpandedChange} title={record.person.name} hideTitle active={active}
      colSpan={layout === "communication" ? 4 : canAssign ? 6 : 5} pending={pending} onActivate={onActivate} onKeyDown={handleKeyDown}>
      {children ?? (() => record.missingFirstContact ? <p className="text-xs leading-6 text-muted">{m.firstContactHint}</p> : <FollowupEntryFields id={detailsId} readOnly note={record.note ?? ''} noteLabel={m.recordedOnly} />)}
    </FollowupInlineDetails>
  </>;
}
