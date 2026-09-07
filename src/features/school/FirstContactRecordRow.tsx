"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { HistoricalRecordBadge } from "./BusinessRecordStateFilter";
import { businessRecordMessages, type BusinessRecordState } from "./business-record-state-contract";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { type FollowupTone } from "./dashboard-page/FollowupChoice";
import { FirstContactStatusTags, type FirstContactFacts } from "./FirstContactStatusTags";
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
  contactFacts?: FirstContactFacts;
  pendingChanges?: boolean;
  updated: string;
  countLabel?: string;
  note?: string;
}

/** 首联记录共用身份、字段、主行和详情布局；写入控制器在详情中提供业务操作。 */
export function FirstContactRecordRow({
  record, locale, active, selected = false, expanded, onExpandedChange, onActivate,
  rowRef, tabIndex = 0, pending = false, layout = "communication", canAssign = false,
  detailsId, onKeyDown, onClick, selection, historicalSummary,
  defaultCells, children,
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
  historicalSummary?: { state: ReactNode; details: ReactNode; updated: ReactNode };
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
      className={cn("focus-visible:outline-none [&>td]:min-w-0", layout === "communication" ? "h-11" : "h-16")} onFocusCapture={(event) => { if (followupFocusActivatesRow(event)) onActivate?.(); }}
      onClick={onClick ?? ((event) => {
        onActivate?.();
        if (!pending && !(event.target as HTMLElement).closest("button,a,input,textarea,[role='combobox'],[role='option'],[role='checkbox']")) onExpandedChange(!expanded);
      })} onKeyDown={handleKeyDown}>
      {layout === "communication" ? <>
        <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1.5">
          <FollowupPersonCell {...record.person} inline selection={selection} expanded={expanded} detailsId={detailsId} onToggle={() => onExpandedChange(!expanded)} />
        </TableCell>
        <TableCell className="px-2 py-1.5"><p className="truncate text-xs" title={record.person.owner}>{record.person.owner || "—"}</p></TableCell>
        <TableCell className="px-2 py-1.5">{historicalSummary ? historicalSummary.state : <>
          <FirstContactStatusTags label={record.status.label} tone={record.status.tone} facts={record.contactFacts} locale={locale} dirty={record.pendingChanges} />
          {record.state === "historical" ? <HistoricalRecordBadge locale={locale} /> : null}
        </>}</TableCell>
        <TableCell className="px-2 py-1.5">{historicalSummary ? historicalSummary.details : <p className="line-clamp-2 whitespace-normal break-words text-xs leading-5" title={record.missingFirstContact ? undefined : record.note}>
          {record.missingFirstContact ? "—" : record.note || "—"}
        </p>}</TableCell>
        <TableCell className="px-2 py-1.5 text-[11px] text-muted">{historicalSummary ? historicalSummary.updated : <>
          <span className="block truncate" title={record.updated}>{record.updated}</span>{record.countLabel ? <p className="mt-0.5 truncate">{record.countLabel}</p> : null}
        </>}</TableCell>
      </> : defaultCells}
    </TableRow>
    <FollowupInlineDetails id={detailsId} open={expanded} onOpenChange={onExpandedChange} title={record.person.name} hideTitle active={active}
      colSpan={layout === "communication" ? 5 : canAssign ? 6 : 5} pending={pending} onActivate={onActivate} onKeyDown={handleKeyDown}>
      {children ?? (() => record.missingFirstContact ? <p className="text-xs leading-6 text-muted">{m.firstContactHint}</p> : <FollowupEntryFields id={detailsId} readOnly note={record.note ?? ''} noteLabel={m.recordedOnly} />)}
    </FollowupInlineDetails>
  </>;
}
