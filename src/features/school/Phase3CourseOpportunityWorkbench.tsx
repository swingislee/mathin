"use client";

import { FilterSearchInput } from "./FilterBar";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardEmptyCard,
  DashboardPage,
  DashboardTableShell,
} from "./dashboard-page";
import {
  confirmCourseEnrollmentAction,
  saveCourseOpportunityAction,
} from "./phase3-enrollment-actions";
import type {
  CourseOpportunityRow,
  CourseOpportunitySource,
  CourseOpportunityStage,
  CourseOpportunityType,
  Phase3EnrollmentOptions,
  SaveCourseOpportunityInput,
} from "./phase3-enrollment-contract";
import { COURSE_OPPORTUNITY_TYPES } from "./phase3-enrollment-contract";

type View = "sources" | "active" | "closed" | "all";
type Sort = "updated" | "expected";
type EditableStage = Exclude<CourseOpportunityStage, "enrolled">;

const EDITABLE_STAGES: readonly EditableStage[] = [
  "planning",
  "contacted",
  "considering",
  "committed",
  "payment_pending",
  "not_enrolled",
  "nurturing",
];

function defaultStage(source: CourseOpportunitySource): EditableStage {
  if (source.route === "enrollment_pending") return "committed";
  if (source.route === "continue_follow_up") return "contacted";
  return "nurturing";
}

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function subjectGrade(grade: number | null, gradeText: string, gradeLabel: (grade: number) => string) {
  return grade === null ? gradeText || "—" : gradeLabel(grade);
}

function OpportunityDialog({
  source,
  opportunity,
  options,
  onSaved,
}: {
  source?: CourseOpportunitySource;
  opportunity?: CourseOpportunityRow;
  options: Phase3EnrollmentOptions;
  onSaved: () => void;
}) {
  const t = useTranslations("school.courseOpportunities");
  const [open, setOpen] = useState(false);
  const suggestedCourse = options.courses.find((course) => course.grade === source?.grade) ?? options.courses[0];
  const suggestedTerm = options.terms.find((term) => term.isCurrent) ?? options.terms[0];
  const [opportunityType, setOpportunityType] = useState<CourseOpportunityType>(opportunity?.opportunityType ?? "new");
  const [courseId, setCourseId] = useState(opportunity?.courseId ?? suggestedCourse?.id ?? "");
  const [termId, setTermId] = useState(opportunity?.termId ?? suggestedTerm?.id ?? "");
  const [stage, setStage] = useState<EditableStage>(
    opportunity && opportunity.stage !== "enrolled" ? opportunity.stage : source ? defaultStage(source) : "planning",
  );
  const [nextAction, setNextAction] = useState(opportunity?.nextAction ?? "");
  const [nextActionAt, setNextActionAt] = useState(toLocalDateTime(opportunity?.nextActionAt ?? null));
  const [note, setNote] = useState(opportunity?.note ?? source?.routeNote ?? "");
  const [pending, startTransition] = useTransition();

  const save = () => startTransition(async () => {
    const input: SaveCourseOpportunityInput = {
      opportunityId: opportunity?.id ?? null,
      activityRouteId: source?.id ?? null,
      studentId: null,
      leadId: null,
      opportunityType,
      courseId,
      termId,
      stage,
      ownerId: null,
      nextAction,
      nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null,
      note,
    };
    const result = await saveCourseOpportunityAction(input);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t(opportunity ? "updated" : "created"));
    setOpen(false);
    onSaved();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={opportunity ? "secondary" : "primary"}>
          {t(opportunity ? "edit" : "create")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(opportunity ? "editTitle" : "createTitle")}</DialogTitle>
          <DialogDescription>{t("formDescription", { name: opportunity?.name ?? source?.name ?? "" })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("opportunityType")}</Label>
            <Select value={opportunityType} onValueChange={(value) => setOpportunityType(value as CourseOpportunityType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COURSE_OPPORTUNITY_TYPES.map((value) => (
                <SelectItem key={value} value={value}>{t(`type_${value}`)}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>{t("course")}</Label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger><SelectValue placeholder={t("chooseCourse")} /></SelectTrigger>
              <SelectContent>
                {options.courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.title}{course.productCode ? ` · ${course.productCode}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("term")}</Label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger><SelectValue placeholder={t("chooseTerm")} /></SelectTrigger>
              <SelectContent>
                {options.terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("stage")}</Label>
            <Select value={stage} onValueChange={(value) => setStage(value as EditableStage)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EDITABLE_STAGES.map((value) => <SelectItem key={value} value={value}>{t(`stage_${value}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`next-${source?.id ?? opportunity?.id}`}>{t("nextAction")}</Label>
            <Input id={`next-${source?.id ?? opportunity?.id}`} value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={500} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`next-at-${source?.id ?? opportunity?.id}`}>{t("nextActionAt")}</Label>
            <Input id={`next-at-${source?.id ?? opportunity?.id}`} type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`note-${source?.id ?? opportunity?.id}`}>{t("note")}</Label>
            <Textarea id={`note-${source?.id ?? opportunity?.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>{t("cancel")}</Button>
          <Button type="button" onClick={save} disabled={pending || !courseId || !termId}>{pending ? t("saving") : t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmEnrollmentButton({ row, onSaved }: { row: CourseOpportunityRow; onSaved: () => void }) {
  const t = useTranslations("school.courseOpportunities");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = () => startTransition(async () => {
    const result = await confirmCourseEnrollmentAction(row.id, row.note);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t("enrollmentConfirmed"));
    setOpen(false);
    onSaved();
  });
  return <>
    <Button type="button" size="sm" onClick={() => setOpen(true)}>{t("confirmEnrollment")}</Button>
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={t("confirmTitle")}
      description={t("confirmDescription", { name: row.name, course: row.courseTitle, term: row.termName })}
      confirmLabel={t("confirmEnrollment")}
      cancelLabel={t("cancel")}
      pending={pending}
      onConfirm={confirm}
    />
  </>;
}

export function Phase3CourseOpportunityWorkbench({
  initialSources,
  initialOpportunities,
  options,
  canWrite,
  canConfirm,
}: {
  initialSources: CourseOpportunitySource[];
  initialOpportunities: CourseOpportunityRow[];
  options: Phase3EnrollmentOptions;
  canWrite: boolean;
  canConfirm: boolean;
}) {
  const t = useTranslations("school.courseOpportunities");
  const locale = useLocale();
  const router = useRouter();
  const [view, setView] = useState<View>(initialSources.length ? "sources" : "active");
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [termFilter, setTermFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<Sort>("expected");
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const refresh = () => router.refresh();
  const needle = query.trim().toLocaleLowerCase(locale);
  const matches = (values: Array<string | null>) => !needle || values.some((value) => value?.toLocaleLowerCase(locale).includes(needle));
  const active = initialOpportunities.filter((row) => !["enrolled", "not_enrolled"].includes(row.stage));
  const closed = initialOpportunities.filter((row) => ["enrolled", "not_enrolled"].includes(row.stage));
  const sourceRows = initialSources.filter((row) => matches([row.name, row.phone, row.activityTitle, row.routeNote]));
  const opportunityBase = view === "active" ? active : view === "closed" ? closed : initialOpportunities;
  const owners = [...new Map(initialOpportunities.map((row) => [row.ownerId, row.ownerName])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1], locale));
  const opportunityRows = opportunityBase
    .filter((row) => (
      (courseFilter === "all" || row.courseId === courseFilter)
      && (termFilter === "all" || row.termId === termFilter)
      && (ownerFilter === "all" || row.ownerId === ownerFilter)
      && (typeFilter === "all" || row.opportunityType === typeFilter)
      && matches([
        row.name,
        row.phone,
        row.courseTitle,
        row.termName,
        row.ownerName,
        row.nextAction,
        row.sourceActivityTitle,
        row.teacherRecommendation,
      ])
    ))
    .sort((left, right) => {
      if (sort === "updated") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (!left.nextActionAt) return right.nextActionAt ? 1 : 0;
      if (!right.nextActionAt) return -1;
      return new Date(left.nextActionAt).getTime() - new Date(right.nextActionAt).getTime();
    });

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={
        <DashboardCommandPanel>
          <DashboardCommandState>
            {(["sources", "active", "closed", "all"] as const).map((item) => (
              <Button key={item} type="button" size="sm" variant={view === item ? "primary" : "secondary"} onClick={() => setView(item)}>
                {t(`view_${item}`, { count: item === "sources" ? initialSources.length : item === "active" ? active.length : item === "closed" ? closed.length : initialOpportunities.length })}
              </Button>
            ))}
          </DashboardCommandState>
          <DashboardCommandFilters>
            <FilterSearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchLabel")} className="w-full sm:max-w-sm" />
            {view !== "sources" ? <>
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger className="w-full sm:w-48" aria-label={t("courseFilter")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{t("allCourses")}</SelectItem>{options.courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>
                ))}</SelectContent>
              </Select>
              <Select value={termFilter} onValueChange={setTermFilter}>
                <SelectTrigger className="w-full sm:w-40" aria-label={t("termFilter")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{t("allTerms")}</SelectItem>{options.terms.map((term) => (
                  <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>
                ))}</SelectContent>
              </Select>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-full sm:w-40" aria-label={t("ownerFilter")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{t("allOwners")}</SelectItem>{owners.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}</SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-40" aria-label={t("typeFilter")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{t("allTypes")}</SelectItem>{COURSE_OPPORTUNITY_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{t(`type_${value}`)}</SelectItem>
                ))}</SelectContent>
              </Select>
              <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
                <SelectTrigger className="w-full sm:w-44" aria-label={t("sortLabel")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expected">{t("sortExpected")}</SelectItem>
                  <SelectItem value="updated">{t("sortUpdated")}</SelectItem>
                </SelectContent>
              </Select>
            </> : null}
          </DashboardCommandFilters>
          <DashboardCommandActions>
            <Link href="/dashboard/followups/enrollments" className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>{t("openEnrollments")}</Link>
          </DashboardCommandActions>
        </DashboardCommandPanel>
      }
    >
      {view === "sources" ? (
        sourceRows.length === 0 ? <DashboardEmptyCard>{t("emptySources")}</DashboardEmptyCard> : (
          <DashboardTableShell>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("student")}</TableHead>
                <TableHead>{t("activity")}</TableHead>
                <TableHead>{t("route")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{sourceRows.map((row) => <TableRow key={row.id}>
                <TableCell className="min-w-44"><div className="font-medium text-ink">{row.name}</div><div className="text-xs text-muted">{row.phone || "—"} · {subjectGrade(row.grade, row.gradeText, (grade) => t("gradeValue", { grade }))}</div></TableCell>
                <TableCell className="min-w-48"><div>{row.activityTitle}</div><div className="text-xs text-muted">{dateTime.format(new Date(row.activityAt))}</div></TableCell>
                <TableCell className="max-w-80"><Badge variant="secondary">{t(`route_${row.route}`)}</Badge>{row.routeNote ? <p className="mt-1 line-clamp-2 text-xs text-muted">{row.routeNote}</p> : null}</TableCell>
                <TableCell className="text-right">{canWrite ? <OpportunityDialog source={row} options={options} onSaved={refresh} /> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </DashboardTableShell>
        )
      ) : opportunityRows.length === 0 ? <DashboardEmptyCard>{t("emptyOpportunities")}</DashboardEmptyCard> : (
        <DashboardTableShell>
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("student")}</TableHead>
              <TableHead>{t("courseAndTerm")}</TableHead>
              <TableHead>{t("sourceAndRecommendation")}</TableHead>
              <TableHead>{t("stage")}</TableHead>
              <TableHead>{t("nextAction")}</TableHead>
              <TableHead>{t("owner")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{opportunityRows.map((row) => {
              const confirmable = row.studentId && ["committed", "payment_pending"].includes(row.stage);
              return <TableRow key={row.id}>
                <TableCell className="min-w-44"><div className="font-medium text-ink">{row.name}</div><div className="text-xs text-muted">{row.phone || "—"} · {subjectGrade(row.grade, row.gradeText, (grade) => t("gradeValue", { grade }))}</div>{row.leadId ? <Badge className="mt-1" variant="outline">{t("identityPending")}</Badge> : null}</TableCell>
                <TableCell className="min-w-56"><div>{row.courseTitle}</div><div className="text-xs text-muted">{row.termName}</div></TableCell>
                <TableCell className="max-w-72"><div>{row.sourceActivityTitle || "—"}</div>{row.teacherRecommendation ? <div className="mt-1 line-clamp-2 text-xs text-muted">{row.teacherRecommendation}</div> : null}</TableCell>
                <TableCell><Badge variant={row.stage === "enrolled" ? "default" : "secondary"}>{t(`stage_${row.stage}`)}</Badge></TableCell>
                <TableCell className="max-w-64"><div className="line-clamp-2">{row.nextAction || "—"}</div>{row.nextActionAt ? <div className="text-xs text-muted">{dateTime.format(new Date(row.nextActionAt))}</div> : null}</TableCell>
                <TableCell>{row.ownerName}</TableCell>
                <TableCell><div className="flex min-w-max justify-end gap-2">
                  {canWrite && row.stage !== "enrolled" ? <OpportunityDialog opportunity={row} options={options} onSaved={refresh} /> : null}
                  {row.leadId ? <Link href={`/dashboard/followups/leads?q=${encodeURIComponent(row.phone || row.name)}`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>{t("resolveIdentity")}</Link> : null}
                  {canConfirm && confirmable ? <ConfirmEnrollmentButton row={row} onSaved={refresh} /> : null}
                  {row.courseEnrollmentId ? <Link href="/dashboard/followups/enrollments" className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}>{t("viewEnrollment")}</Link> : null}
                </div></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </DashboardTableShell>
      )}
    </DashboardPage>
  );
}
