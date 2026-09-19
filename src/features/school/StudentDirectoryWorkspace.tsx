"use client";

import { useState, useTransition, type ReactNode } from "react";
import { BookOpen, ClipboardCheck, History, Phone, PhoneOutgoing, Send, UserRoundPlus, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardPage } from "./dashboard-page";
import { DashboardTablePagination } from "./dashboard-page/DashboardTablePagination";
import { FilterBar, FilterSearchInput, FilterBarSubmit } from "./FilterBar";
import { Student360Trigger } from "./Student360Sheet";
import { STUDENT_STAGE_TABS } from "./student-stage-contract";
import { studentStageMessages } from "./student-stage-messages";
import { DIRECTORY_GROUPINGS, directoryContactHref, groupDirectoryCards, studentDirectoryHref, type DirectoryGroup,
  type StudentDirectoryCard, type StudentDirectoryData, type StudentDirectoryFilters } from "./student-directory-contract";
import { studentDirectoryMessages } from "./student-directory-messages";

const stageStyle = {
  awaiting_first_contact: { icon: PhoneOutgoing, surface: "border-crater/25 bg-moon/10", iconClass: "text-crater" },
  awaiting_assessment: { icon: ClipboardCheck, surface: "border-blue/30 bg-blue/5", iconClass: "text-blue" },
  awaiting_enrollment: { icon: UserRoundPlus, surface: "border-rose/30 bg-cheek/15", iconClass: "text-rose" },
  awaiting_renewal: { icon: BookOpen, surface: "border-leaf/35 bg-leaf/5", iconClass: "text-leaf-deep" },
  former_student: { icon: History, surface: "border-line bg-card", iconClass: "text-muted" },
} as const;

function StudentCard({ student, locale, selected, selectable, disabled, onSelect }: {
  student: StudentDirectoryCard; locale: string; selected: boolean; selectable: boolean; disabled: boolean; onSelect: (selected: boolean) => void;
}) {
  const m = studentDirectoryMessages(locale), stages = studentStageMessages(locale);
  const style = stageStyle[student.stage], Icon = style.icon;
  const stateLabel = `${stages.stages[student.stage]} · ${stages.details[student.detail] ?? student.detail}`;
  const grade = student.grade ? `${locale.startsWith("en") ? "G" : ""}${student.grade}${locale.startsWith("en") ? "" : "年级"}` : student.gradeText || m.unknownGrade;
  const assessment = student.assessment;
  const result = assessment ? [assessment.band?.toUpperCase().replaceAll("_PLUS", "+"), assessment.score !== null ? String(assessment.score) : null].filter(Boolean).join(" · ") || m.assessed : "";
  return <Card data-student-card={student.id} data-student-stage={student.stage} data-selected={selected || undefined}
    className={cn("relative min-w-0 rounded-lg border p-0 shadow-none transition-colors", style.surface,
      selected && "border-crater bg-moon/25 ring-1 ring-crater/60")}>
    <Student360Trigger subject={{ studentId: student.id, leadId: null }} fallback={{ name: student.name, grade: student.grade, phone: student.phoneTail ? `···· ${student.phoneTail}` : "" }}
      className="block w-full rounded-lg px-3 py-2.5 hover:no-underline focus-visible:ring-inset">
      <span className="flex min-w-0 items-center gap-1.5 pr-5"><Tooltip><TooltipTrigger asChild><span title={stateLabel} className={cn("shrink-0", style.iconClass)}><Icon className="size-3.5" aria-hidden="true" /></span></TooltipTrigger><TooltipContent>{stateLabel}</TooltipContent></Tooltip>
        <span className="truncate text-sm font-semibold" title={student.name}>{student.name}</span></span>
      <span className="mt-1 flex items-center justify-between gap-1 text-[11px] font-normal text-muted"><span className="truncate">{grade}</span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums" aria-label={`${m.phone} ${student.phoneTail || m.noPhone}`}><Phone className="size-2.5" aria-hidden="true" />{student.phoneTail || "—"}</span></span>
      <span className="mt-1 flex h-4 items-center gap-1 text-[10px] font-normal text-muted" title={assessment ? `${m.assessment} · ${result}${assessment.at ? ` · ${assessment.at.slice(0, 10)}` : ""}` : m.noAssessment}>
        {assessment ? <><ClipboardCheck className="size-3 shrink-0 text-blue" aria-hidden="true" /><span className="truncate">{result}</span>{assessment.at ? <span className="ml-auto shrink-0 tabular-nums">{assessment.at.slice(0, 10)}</span> : null}</> : null}
      </span>
      <span className="sr-only">{stateLabel}</span>
    </Student360Trigger>
    {selectable ? <Checkbox checked={selected} disabled={disabled} onCheckedChange={value => onSelect(value === true)}
      aria-label={`${m.select} · ${student.name}`} className="absolute right-2.5 top-3 size-3.5 bg-card" /> : null}
  </Card>;
}

export function StudentDirectoryWorkspace({ data, filters, locale, canContact, actions }: {
  data: StudentDirectoryData; filters: StudentDirectoryFilters; locale: string; canContact: boolean; actions: ReactNode;
}) {
  const m = studentDirectoryMessages(locale), stages = studentStageMessages(locale), router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = data.students.filter(student => canContact && student.canContact);
  const selectedOnPage = data.students.filter(student => selected.has(student.id)).length;
  const allSelected = selectable.length > 0 && selectable.every(student => selected.has(student.id));
  const sections = groupDirectoryCards(data.students, filters.group, locale);
  const navigate = (change: Partial<StudentDirectoryFilters>) => startTransition(() => router.replace(studentDirectoryHref(filters, { page: 1, ...change }), { scroll: false }));
  const groupLabel = (group: DirectoryGroup) => group.id === "unassigned" || group.id === "all" ? m.missingGroup[filters.groupBy]
    : filters.groupBy === "grade" ? `${m.grade} ${group.name}` : group.name;
  const select = (id: string, value: boolean) => setSelected(current => {
    const next = new Set(current);
    if (!value) next.delete(id); else if (next.size < 100) next.add(id);
    return next;
  });
  return <DashboardPage title={m.title} density="compact" commandPanel={<DashboardCommandPanel className="followup-command-panel">
    <DashboardCommandFilters>
      <FilterBar onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); navigate({ q: String(form.get("q") ?? "") }); }}>
        <FilterSearchInput key={filters.q} name="q" defaultValue={filters.q} placeholder={m.search} aria-label={m.search} disabled={pending} />
        <FilterBarSubmit disabled={pending}>{locale.startsWith("en") ? "Search" : "搜索"}</FilterBarSubmit>
      </FilterBar>
      <Select value={filters.scope} disabled={pending} onValueChange={scope => navigate({ scope: scope as StudentDirectoryFilters["scope"] })}>
        <SelectTrigger className="h-8 w-auto min-w-28 text-xs" aria-label={m.scope}><SelectValue /></SelectTrigger>
        <SelectContent>{[["mine",m.mine],["all",m.all],["group",m.myGroup],["unassigned",m.unassigned]].map(([id,label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.groupBy} disabled={pending} onValueChange={groupBy => navigate({ groupBy: groupBy as StudentDirectoryFilters["groupBy"], group: "" })}>
        <SelectTrigger className="h-8 w-auto min-w-28 text-xs" aria-label={m.groupBy}><SelectValue /></SelectTrigger>
        <SelectContent>{DIRECTORY_GROUPINGS.map(value => <SelectItem key={value} value={value}>{m.grouping[value]}</SelectItem>)}</SelectContent>
      </Select>
      {filters.groupBy !== "none" ? <Select value={filters.group || "all-groups"} disabled={pending} onValueChange={group => navigate({ group: group === "all-groups" ? "" : group })}>
        <SelectTrigger className="h-8 w-auto max-w-56 min-w-28 text-xs" aria-label={m.group}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all-groups">{m.allGroups}</SelectItem>{data.groups.map(group => <SelectItem key={group.id} value={group.id}>{groupLabel(group)} · {group.count}</SelectItem>)}</SelectContent>
      </Select> : null}
      <Select value={filters.stage} disabled={pending} onValueChange={stage => navigate({ stage: stage as StudentDirectoryFilters["stage"], group: "" })}>
        <SelectTrigger className="h-8 w-auto min-w-28 text-xs" aria-label={m.stage}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">{m.allStages}</SelectItem>{STUDENT_STAGE_TABS.map(stage => <SelectItem key={stage} value={stage}>{stages.stages[stage]}</SelectItem>)}</SelectContent>
      </Select>
    </DashboardCommandFilters>
    <DashboardCommandActions>{canContact ? <>
      <label className="flex items-center gap-1.5 text-xs text-muted"><Checkbox checked={allSelected ? true : selectedOnPage ? "indeterminate" : false} disabled={pending || !selectable.length || !allSelected && new Set([...selected,...selectable.map(student => student.id)]).size>100}
        onCheckedChange={value => setSelected(current => { const next = new Set(current); for (const student of selectable) { if (value === true) next.add(student.id); else next.delete(student.id); } return next; })} />{m.selectPage}</label>
      {selected.size ? <><span className="text-xs text-muted" title={`${m.hidden} ${selected.size-selectedOnPage}`}>{m.selected} {selected.size}{selected.size>selectedOnPage ? ` · ${m.hidden} ${selected.size-selectedOnPage}` : ""}</span>
        <Link className={buttonVariants({ size: "sm" })} href={directoryContactHref([...selected],studentDirectoryHref(filters))}><Send className="size-3.5" />{m.contact}</Link>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{m.clear}</Button></> : null}
    </> : null}{!selected.size ? actions : null}</DashboardCommandActions>
  </DashboardCommandPanel>} summary={<p className="text-xs text-muted">{m.hint}{selected.size>=100 ? ` ${m.limit}` : ""}</p>}
    footer={<DashboardTablePagination currentPage={data.page} totalPages={data.totalPages} totalCount={data.count} pageSize={data.pageSize} pageSizes={[20,50,100]}
      hrefFor={page => studentDirectoryHref(filters,{page})} onPageChange={page => navigate({ page })} onPageSizeChange={size => navigate({ pageSize: size as 20|50|100 })} pending={pending} />}>
    <TooltipProvider delayDuration={200}><div data-student-directory aria-busy={pending} className={cn("min-w-0 space-y-5", pending && "opacity-60")}>
      {sections.map(section => <section key={section.id} aria-label={groupLabel(section)}>
        <div className="mb-2 flex items-center gap-2 text-xs"><Users className="size-3.5 text-muted" aria-hidden="true" /><h2 className="font-medium">{groupLabel(section)}</h2><span className="text-[10px] text-muted">{m.pageGroup} {section.students.length}</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2">
          {section.students.map(student => <StudentCard key={student.id} student={student} locale={locale} selected={selected.has(student.id)} selectable={canContact && student.canContact}
            disabled={pending || selected.size>=100 && !selected.has(student.id)} onSelect={value => select(student.id,value)} />)}
        </div>
      </section>)}
      {!data.students.length ? <div role="status" className="py-16 text-center text-sm text-muted"><p>{m.empty}</p><Button variant="ghost" size="sm" className="mt-3" onClick={() => navigate({ q:"",stage:"all",group:"" })}>{m.reset}</Button></div> : null}
      {data.students.some(student => student.groups.length>1) ? <p className="text-[11px] text-muted">{m.shared}</p> : null}
    </div></TooltipProvider>
  </DashboardPage>;
}
