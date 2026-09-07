"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { saveMonthlyTargetsAction } from "../actions/monthly-targets";
import { DashboardCommandActions, DashboardCommandPanel, DashboardCommandState, DashboardPage, DashboardTableShell } from "../dashboard-page";
import {
  monthlyTargetCellKey, monthlyTargetCells, parseMonthlyTargetInput, sumMonthlyTargets,
  type MonthlyTargetPlan,
} from "./monthly-targets-contract";

const display = (value: number | null) => value === null ? "—" : String(value);

export function MonthlyTargetsEditor({ plan }: { plan: MonthlyTargetPlan }) {
  const t = useTranslations("school.monthlyTargets");
  const locale = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState(() => Object.fromEntries(monthlyTargetCells(plan).map(cell => [monthlyTargetCellKey(cell.teacher, cell.grade), cell.target === null ? "" : String(cell.target)])));
  const [arrival, setArrival] = useState(plan.arrivalTarget === null ? "" : String(plan.arrivalTarget));
  const [invitation, setInvitation] = useState(plan.invitationTarget === null ? "" : String(plan.invitationTarget));
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cells = monthlyTargetCells(plan).map(cell => ({ ...cell, target: parseMonthlyTargetInput(draft[monthlyTargetCellKey(cell.teacher, cell.grade)]) ?? null }));
  const invalid = Object.values(draft).some(value => parseMonthlyTargetInput(value) === undefined)
    || parseMonthlyTargetInput(arrival, 1000000) === undefined || parseMonthlyTargetInput(invitation, 1000000) === undefined;
  const total = sumMonthlyTargets(cells);
  const assignedCount = cells.filter(cell => cell.target !== null).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(Object.fromEntries(monthlyTargetCells(plan).map(cell => [monthlyTargetCellKey(cell.teacher, cell.grade), cell.target === null ? "" : String(cell.target)])))
    || arrival !== (plan.arrivalTarget === null ? "" : String(plan.arrivalTarget))
    || invitation !== (plan.invitationTarget === null ? "" : String(plan.invitationTarget));
  const source = plan.source;
  const reference = (teacher?: string, grade?: string) => source.cells
    .filter(cell => (teacher === undefined || cell.teacher === teacher) && (grade === undefined || cell.grade === grade))
    .reduce((sum, cell) => sum + cell.actual, 0);
  const gradeLabel = (grade: string) => /^\d+年级$/.test(grade) ? t("grade", { grade: grade.replace("年级", "") })
    : grade === "中班" ? t("kindergartenMiddle") : grade === "大班" ? t("kindergartenSenior") : grade;
  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${plan.month}-01T00:00:00Z`));
  const sourceCell = (teacher: string, grade: string) => source.cells.find(cell => cell.teacher === teacher && cell.grade === grade);
  const save = () => {
    if (invalid || (total !== null && total > 1000000)) { setStatus("VALIDATION"); return; }
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await saveMonthlyTargetsAction({ month: plan.month, revision: plan.revision, cells,
          arrivalTarget: parseMonthlyTargetInput(arrival, 1000000) ?? null,
          invitationTarget: parseMonthlyTargetInput(invitation, 1000000) ?? null });
        if (!result.ok) { setStatus(result.code); return; }
        setStatus("SAVED");
        router.refresh();
      } catch { setStatus("UNKNOWN"); }
    });
  };
  const statusKey = status === "VERSION_CONFLICT" ? "conflict" : status === "VALIDATION" ? "invalid"
    : status === "FORBIDDEN" || status === "UNAUTHENTICATED" ? "forbidden" : status === "SAVED" ? "saved" : "failed";

  return <DashboardPage title={t("title", { month: monthLabel })}
    backHref={`/dashboard?view=overview&period=month&date=${plan.month}-01`} backLabel={t("back")}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandState><span className="text-sm text-muted">{t("definition")}</span></DashboardCommandState>
      <DashboardCommandActions>
        <span aria-live="polite" className="text-xs text-muted">{t(dirty ? "unsaved" : "savedVersion", { revision: plan.revision })}</span>
        <Button type="submit" form="monthly-target-form" size="sm" disabled={pending || !dirty || invalid || (total ?? 0) > 1000000}>
          {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {t(pending ? "saving" : "save")}
        </Button>
      </DashboardCommandActions>
    </DashboardCommandPanel>}
    density="compact">
    <form id="monthly-target-form" data-monthly-target-editor data-month={plan.month} data-source-enrollments={source.enrollments}
      data-target-revision={plan.revision} className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); save(); }}>
      {status ? <div role={status === "SAVED" ? "status" : "alert"} className="flex flex-wrap items-center gap-3 text-sm text-ink">
        {t(statusKey)}
        {status === "VERSION_CONFLICT" ? <Button variant="secondary" size="sm" type="button" onClick={() => router.refresh()}>{t("reload")}</Button> : null}
      </div> : null}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-sm text-muted">{t("allocatedTotal")}</p>
          <p className="mt-1 font-display text-3xl font-medium tabular-nums text-ink" data-target-draft-total={total ?? "unset"}>{display(total)}<span className="ml-2 font-sans text-sm font-normal text-muted">{t("people")}</span></p>
          <p className="mt-2 text-xs text-muted">{t("allocatedCells", { count: assignedCount, total: cells.length })}</p>
        </div>
        <div>
          <p className="text-sm text-muted">{t("referenceTarget")}</p>
          <p className="mt-1 font-display text-3xl font-medium tabular-nums text-ink">{source.enrollmentTarget}<span className="ml-2 font-sans text-sm font-normal text-muted">{t("people")}</span></p>
          <p className="mt-2 text-xs text-muted">{total === null ? t("noAllocation") : t(total >= source.enrollmentTarget ? "aboveReference" : "belowReference", { count: Math.abs(total - source.enrollmentTarget) })}</p>
        </div>
        <div>
          <p className="text-sm text-muted">{t("baseActual")}</p>
          <p className="mt-1 font-display text-3xl font-medium tabular-nums text-ink">{source.enrollments}<span className="ml-2 font-sans text-sm font-normal text-muted">{t("people")}</span></p>
          <p className="mt-2 text-xs text-muted">{t("snapshotDate", { date: source.capturedOn })}</p>
        </div>
      </div>

      <section className="space-y-3" aria-labelledby="teacher-grade-target-heading">
        <div>
          <h2 id="teacher-grade-target-heading" className="text-base font-medium text-ink">{t("matrixTitle")}</h2>
          <p id="target-cell-help" className="mt-1 text-xs leading-5 text-muted">{t("matrixHelp")}</p>
        </div>
        <DashboardTableShell>
          <Table containerClassName="max-h-[65vh] overflow-auto" className="min-w-[1080px]" aria-describedby="target-cell-help">
            <TableHeader className="sticky top-0 z-20 bg-card">
              <TableRow>
                <TableHead scope="col" className="sticky left-0 z-30 min-w-24 bg-card">{t("teacher")}</TableHead>
                {source.grades.map(grade => <TableHead scope="col" key={grade} className="px-2 text-center">{gradeLabel(grade)}</TableHead>)}
                <TableHead scope="col" className="min-w-24 text-right">{t("total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.teachers.map(teacher => <TableRow key={teacher}>
                <TableHead scope="row" className="sticky left-0 z-10 bg-card text-sm text-ink">{teacher}</TableHead>
                {source.grades.map(grade => {
                  const key = monthlyTargetCellKey(teacher, grade), baseline = sourceCell(teacher, grade);
                  return <TableCell key={grade} className="min-w-22 px-2 py-1.5">
                    <Input type="number" min={0} max={9999} step={1} inputMode="numeric" value={draft[key]} placeholder="—"
                      disabled={pending} aria-label={t("cellLabel", { teacher, grade: gradeLabel(grade) })} aria-describedby="target-cell-help"
                      aria-invalid={parseMonthlyTargetInput(draft[key]) === undefined || undefined}
                      onChange={event => { setDraft(previous => ({ ...previous, [key]: event.target.value })); setStatus(null); }}
                      className="h-8 px-2 text-center tabular-nums" />
                    <p className="mt-0.5 text-center text-xs tabular-nums text-muted" title={baseline?.undated ? t("cellUndated", { count: baseline.undated }) : undefined}>
                      {t("cellReference", { count: baseline?.actual ?? 0 })}{baseline?.undated ? " *" : ""}
                    </p>
                  </TableCell>;
                })}
                <TableCell className="text-right tabular-nums"><strong className="font-medium">{display(sumMonthlyTargets(cells.filter(cell => cell.teacher === teacher)))}</strong><p className="mt-1.5 text-xs text-muted">{t("cellReference", { count: reference(teacher) })}</p></TableCell>
              </TableRow>)}
              {source.unassignedTeacher > 0 ? <TableRow>
                <TableHead scope="row" className="sticky left-0 z-10 bg-card text-ink">{t("unassignedTeacher")}</TableHead>
                {source.grades.map(grade => <TableCell key={grade} className="text-center text-xs tabular-nums text-muted">{t("cellReference", { count: reference("", grade) })}</TableCell>)}
                <TableCell className="text-right text-xs tabular-nums text-muted">{t("cellReference", { count: source.unassignedTeacher })}</TableCell>
              </TableRow> : null}
              <TableRow>
                <TableHead scope="row" className="sticky left-0 z-10 bg-card text-ink">{t("total")}</TableHead>
                {source.grades.map(grade => <TableCell key={grade} className="text-center tabular-nums"><strong className="font-medium">{display(sumMonthlyTargets(cells.filter(cell => cell.grade === grade)))}</strong><p className="mt-1.5 text-xs text-muted">{t("cellReference", { count: reference(undefined, grade) })}</p></TableCell>)}
                <TableCell className="text-right tabular-nums"><strong className="font-medium text-leaf-deep">{display(total)}</strong><p className="mt-1.5 text-xs text-muted">{t("cellReference", { count: source.enrollments })}</p></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DashboardTableShell>
        <p className="text-xs leading-5 text-muted">{t("sourceNote", { teachers: source.unassignedTeacher, dates: source.missingDate })}</p>
        <p className="text-xs leading-5 text-muted">{t("gradeSourceNote")}</p>
      </section>

      <section className="space-y-4" aria-labelledby="related-target-heading">
        <h2 id="related-target-heading" className="text-base font-medium text-ink">{t("relatedTitle")}</h2>
        <div className="flex flex-wrap gap-8">
          {([{ key: "arrivals", value: arrival, set: setArrival, count: source.arrivals, target: source.arrivalTarget }, { key: "invitations", value: invitation, set: setInvitation, count: source.invitations, target: source.invitationTarget }] as const).map(item => <div key={item.key} className="space-y-2">
            <Label htmlFor={`target-${item.key}`}>{t(item.key)}</Label>
            <Input id={`target-${item.key}`} type="number" min={0} max={1000000} step={1} inputMode="numeric" value={item.value} disabled={pending}
              onChange={event => { item.set(event.target.value); setStatus(null); }} className="w-40 tabular-nums" />
            <p className="text-xs text-muted">{t("relatedReference", { target: item.target, actual: item.count })}</p>
          </div>)}
        </div>
      </section>
    </form>
  </DashboardPage>;
}
