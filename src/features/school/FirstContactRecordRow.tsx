"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { businessRecordMessages } from "./business-record-messages";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { type FollowupTone } from "./dashboard-page/FollowupChoice";
import { FirstContactStatusTags, type FirstContactFacts } from "./FirstContactStatusTags";
import { firstContactRowMessages } from "./first-contact-row-messages";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { FollowupRecordRow } from "./dashboard-page/FollowupRecordRow";
import { communicationNoteSummary } from './source-worklist/summary';

export interface FirstContactRecord {
  key: string;
  missingFirstContact?: boolean;
  visitCommitted?: boolean;
  person: Omit<ComponentProps<typeof FollowupPersonCell>, "selection" | "expanded" | "detailsId" | "onToggle">;
  status: { label: string; tone: FollowupTone; context: string; contextTitle?: string };
  contactFacts?: FirstContactFacts;
  statusContent?: ReactNode;
  pendingChanges?: boolean;
  updated: string;
  /** 带日期依据提示的最近更新；缺省时显示 updated 文本。 */
  updatedContent?: ReactNode;
  countLabel?: string;
  note?: string;
}

/** 首联记录共用身份、字段、主行和详情布局；写入控制器在详情中提供业务操作。 */
export function FirstContactRecordRow({
  record, locale, active, selected = false, expanded, onExpandedChange, onActivate,
  rowRef, tabIndex = 0, pending = false, layout = "communication", canAssign = false,
  detailsId, onKeyDown, onClick, selection, historicalSummary,
  defaultCells, children, onOutcomeChange, onSave, identityHint, ownerControl, sourceInfo, attention, inlineOutcomes, hideStatusLabel = false,
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
  identityHint?: ReactNode;
  ownerControl?: ReactNode;
  sourceInfo?: ReactNode;
  attention?: ReactNode;
  inlineOutcomes?: ReactNode;
  hideStatusLabel?: boolean;
  children?: ReactNode | (() => ReactNode);
  onOutcomeChange?: ComponentProps<typeof FollowupRecordRow>["onOutcomeChange"];
  onSave?: () => void;
}) {
  const m = businessRecordMessages(locale);
  const fields = firstContactRowMessages(locale);
  const noteSummary = communicationNoteSummary(record.note);
  return <FollowupRecordRow rowKey={record.key} active={active} selected={selected} expanded={expanded} pending={pending}
    profileSubject={record.person.subject}
    focusOnActivate={Boolean(rowRef)}
    rowRef={rowRef} onActivate={onActivate} onExpandedChange={onExpandedChange} onKeyDown={onKeyDown} onOutcomeChange={onOutcomeChange} onSave={onSave}
    detailsId={detailsId} title={record.person.name} hideTitle colSpan={layout === "communication" ? 7 : canAssign ? 6 : 5}
    rowProps={{ tabIndex, onClick, "data-first-contact-record": record.key,
      "data-first-contact-missing": record.missingFirstContact ? record.person.subject.studentId : undefined,
      "data-communication-work-key": layout === "communication" ? record.key : undefined,
      "data-followup-success": record.visitCommitted === true,
      className: cn("focus-visible:outline-none [&>td]:min-w-0", layout === "communication" ? "h-11" : "h-16") }}
    summary={layout === "communication" ? <>
        <TableCell mobileSpan="primary" className="sticky left-0 z-10 border-r border-line bg-card px-2 py-1.5">
          <FollowupPersonCell {...record.person} nameOnly selection={selection} expanded={expanded} detailsId={detailsId} onToggle={() => onExpandedChange(!expanded)} />
          {identityHint}
          {attention}
        </TableCell>
        <TableCell mobileLabel={fields.phone} className="px-2 py-1.5"><a className="block truncate font-mono text-[11px] hover:underline" href={`tel:${record.person.phone}`} title={record.person.phone}>{record.person.phone || "—"}</a></TableCell>
        <TableCell mobileLabel={fields.grade} className="px-2 py-1.5"><p className="truncate text-[11px] text-muted" title={record.person.grade}>{record.person.grade || "—"}</p></TableCell>
        <TableCell mobileLabel={fields.owner} className="px-2 py-1.5">{ownerControl ?? <p className="truncate text-xs" title={record.person.owner}>{record.person.owner || fields.unassigned}</p>}</TableCell>
        <TableCell mobileSpan="secondary" className="px-2 py-1.5">{historicalSummary ? historicalSummary.state : <div className="flex items-center gap-1.5">
          {inlineOutcomes}
          <FirstContactStatusTags label={hideStatusLabel ? '' : record.status.label} tone={record.status.tone} facts={record.statusContent ? undefined : record.contactFacts} locale={locale} dirty={record.pendingChanges} />
          {record.statusContent}
        </div>}</TableCell>
        <TableCell mobileLabel={fields.notes} mobileEmpty={!historicalSummary && !noteSummary} className="px-2 py-1.5">{historicalSummary ? historicalSummary.details : <p className="line-clamp-2 whitespace-normal break-words text-xs leading-5" title={noteSummary}>
          {noteSummary || "—"}
        </p>}</TableCell>
        <TableCell mobileLabel={fields.updated} className="px-2 py-1.5 text-[11px] text-muted">{historicalSummary ? historicalSummary.updated : <>
          {record.updatedContent ? <span className="block truncate">{record.updatedContent}</span> : <span className="block truncate" title={record.updated}>{record.updated}</span>}{record.countLabel ? <p className="mt-0.5 truncate">{record.countLabel}</p> : null}
        </>}</TableCell>
      </> : defaultCells}>
      {() => <>
        {typeof children === 'function' ? children() : children ?? (record.missingFirstContact ? <p className="text-xs leading-6 text-muted">{m.firstContactHint}</p> : <FollowupEntryFields id={detailsId} readOnly note={record.note ?? ''} noteLabel={m.recordedOnly} />)}
        {sourceInfo}
        {record.note ? <details className="text-xs"><summary className="cursor-pointer text-muted">{locale.startsWith('en') ? 'Original latest note' : '最近备注原文'}</summary><p className="mt-2 whitespace-pre-wrap break-words leading-5">{record.note}</p></details> : null}
      </>}
  </FollowupRecordRow>;
}
