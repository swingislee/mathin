"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Student360Trigger } from "../Student360Sheet";
import type { Student360SubjectRef } from "../student-360-contract";

/** 共用身份排版；横排名单将姓名、电话和年级放在同一行。 */
export function FollowupPersonCell({ name, phone, grade, owner, selection, expanded, detailsId, onToggle, subject, studentGrade, inline = false }: {
  name: string; phone: string; grade: string; owner?: string; selection?: ReactNode;
  expanded: boolean; detailsId: string; onToggle: () => void;
  subject: Student360SubjectRef; studentGrade?: number | null; inline?: boolean;
}) {
  return <div data-followup-person data-followup-person-inline={inline || undefined}>
    <div className="flex min-w-0 items-center gap-1">{selection}
      <Button type="button" size="sm" variant="ghost" className="size-5 shrink-0 rounded-sm p-0"
        aria-expanded={expanded} aria-controls={detailsId} aria-label={name} onClick={onToggle}>
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </Button>
      <Student360Trigger subject={subject} fallback={{ name, phone, grade: studentGrade ?? null, gradeText: grade }} className="truncate">{name}</Student360Trigger>
      {inline ? <>
        <a className="ml-1 shrink-0 font-mono text-[11px] hover:underline" href={`tel:${phone}`}>{phone}</a>
        {grade ? <span className="ml-auto max-w-[25%] truncate text-[11px] text-muted" title={grade}>{grade}</span> : null}
      </> : null}
    </div>
    {!inline ? <>
      <p className="mt-0.5 truncate pl-6 text-[11px] text-muted" title={[owner, grade].filter(Boolean).join(" · ")}>{[owner, grade].filter(Boolean).join(" · ")}</p>
      <a className="mt-0.5 block pl-6 font-mono text-[11px] hover:underline" href={`tel:${phone}`}>{phone}</a>
    </> : null}
  </div>;
}
