"use client";

import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  saveAssessmentWorkbenchRouteAction,
  saveAssessmentWorkbenchRowAction,
} from "./assessment-workbench-actions";
import type {
  AssessmentWorkbenchAssessment,
  AssessmentWorkbenchRoute,
  AssessmentWorkbenchRow,
} from "./assessment-workbench-contract";
import { ACTIVITY_ROUTES, ASSESSMENT_BANDS, type ActivityRouteKind, type AssessmentBand } from "./activity-workflow-contract";
import { DashboardTableShell } from "./dashboard-page";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface AssessmentDraft {
  assessmentBand: AssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
}

interface RouteDraft {
  route: ActivityRouteKind | "";
  note: string;
}

interface SavedRegistration {
  registrationId: string;
}

export function AssessmentAggregateWorkbench({
  rows,
  locale,
  canAssess,
}: {
  rows: AssessmentWorkbenchRow[];
  locale: string;
  canAssess: boolean;
}) {
  const t = useTranslations("school.assessments");
  const [activeId, setActiveId] = useState<string | null>(() => rows.find((row) => !row.assessment)?.id ?? rows[0]?.id ?? null);
  const [overrides, setOverrides] = useState<Record<string, AssessmentWorkbenchRow>>({});
  const sessionRows = rows.map((row) => overrides[row.id] ?? row);
  const formatDateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);

  const updateRow = (id: string, update: (row: AssessmentWorkbenchRow) => AssessmentWorkbenchRow) => {
    setOverrides((current) => {
      const original = current[id] ?? rows.find((row) => row.id === id);
      if (!original) return current;
      return { ...current, [id]: update(original) };
    });
  };

  const onAssessmentSaved = (
    row: AssessmentWorkbenchRow,
    draft: AssessmentDraft,
    registrationId: string,
  ) => {
    const now = new Date().toISOString();
    updateRow(row.id, (current) => ({
      ...current,
      registrationId,
      participationStatus: "attended",
      updatedAt: now,
      assessment: {
        id: current.assessment?.id ?? `session-assessment:${registrationId}`,
        ...draft,
        updatedAt: now,
      },
    }));
  };

  const onRouteSaved = (
    row: AssessmentWorkbenchRow,
    draft: RouteDraft,
    registrationId: string,
  ) => {
    if (!draft.route) return;
    const now = new Date().toISOString();
    updateRow(row.id, (current) => ({
      ...current,
      registrationId,
      participationStatus: "attended",
      updatedAt: now,
      route: {
        id: current.route?.id ?? `session-route:${registrationId}`,
        route: draft.route as ActivityRouteKind,
        note: draft.note,
        updatedAt: now,
      },
    }));
  };

  return (
    <DashboardTableShell>
      <Table className="min-w-[80rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 top-0 z-30 h-9 w-60 border-r border-line bg-card px-2">{t("personColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-48 bg-card px-2">{t("appointmentColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2">{t("attendanceColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-72 bg-card px-2">{t("quickEntryColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 bg-card px-2">{t("recordColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-24 bg-card px-2">{t("saveColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessionRows.map((row) => (
            <AssessmentEntryRows
              key={row.id}
              row={row}
              active={activeId === row.id}
              canAssess={canAssess}
              formatDateTime={(value) => formatDateTime.format(new Date(value))}
              onActivate={() => setActiveId((current) => current === row.id ? null : row.id)}
              onAssessmentSaved={(draft, registrationId) => onAssessmentSaved(row, draft, registrationId)}
              onRouteSaved={(draft, registrationId) => onRouteSaved(row, draft, registrationId)}
            />
          ))}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}

function AssessmentEntryRows({
  row,
  active,
  canAssess,
  formatDateTime,
  onActivate,
  onAssessmentSaved,
  onRouteSaved,
}: {
  row: AssessmentWorkbenchRow;
  active: boolean;
  canAssess: boolean;
  formatDateTime: (value: string) => string;
  onActivate: () => void;
  onAssessmentSaved: (draft: AssessmentDraft, registrationId: string) => void;
  onRouteSaved: (draft: RouteDraft, registrationId: string) => void;
}) {
  const t = useTranslations("school.assessments");
  const [registrationId, setRegistrationId] = useState(row.registrationId);
  const assessmentAutosave = useAutosavedDraft<AssessmentDraft>({
    initial: assessmentDraftFrom(row.assessment),
    enabled: canAssess,
    save: (draft) => saveAssessmentWorkbenchRowAction({
      invitationId: row.invitationId,
      registrationId,
      ...draft,
    }),
    errorMessage: t("assessmentSaveFailed"),
    onSaved: (draft, result) => {
      setRegistrationId(result.registrationId);
      onAssessmentSaved(draft, result.registrationId);
    },
  });
  const routeAutosave = useAutosavedDraft<RouteDraft>({
    initial: routeDraftFrom(row.route),
    enabled: canAssess && Boolean(row.route || registrationId || row.invitationId),
    save: (draft) => draft.route
      ? saveAssessmentWorkbenchRouteAction({
          invitationId: row.invitationId,
          registrationId,
          route: draft.route,
          note: draft.note,
        })
      : Promise.resolve({ ok: false, code: "INVALID_ACTIVITY_ROUTE" }),
    errorMessage: t("routeSaveFailed"),
    onSaved: (draft, result) => {
      setRegistrationId(result.registrationId);
      onRouteSaved(draft, result.registrationId);
    },
  });
  const updateAssessment = <K extends keyof AssessmentDraft>(key: K, value: AssessmentDraft[K]) => {
    assessmentAutosave.update(key, value);
  };
  const updateRoute = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) => {
    routeAutosave.update(key, value);
  };
  const saveState = mergeSaveStates([assessmentAutosave.state, routeAutosave.state]);
  const edited = assessmentAutosave.state !== "idle" || routeAutosave.state !== "idle";
  const attended = row.participationStatus === "attended" || (edited && saveState !== "error");
  const detailSummary = assessmentSummary(assessmentAutosave.draft, routeAutosave.draft, t);

  return (
    <Fragment>
      <TableRow
        aria-expanded={active}
        aria-selected={active}
        className={cn("cursor-pointer", active && "bg-moon/10 hover:bg-moon/10")}
        onClick={onActivate}
      >
        <TableCell
          className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2"
          style={active ? { backgroundColor: "color-mix(in srgb, var(--card) 90%, var(--moon))" } : undefined}
        >
          <div className="flex min-w-0 items-center gap-2">
            {active ? <ChevronDown className="size-3.5 shrink-0 text-muted" /> : <ChevronRight className="size-3.5 shrink-0 text-muted" />}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                {row.studentId ? (
                  <Link
                    href={`/dashboard/students/${row.studentId}`}
                    className="truncate font-medium text-ink hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.name}
                  </Link>
                ) : <span className="truncate font-medium text-ink">{row.name}</span>}
                {row.phone ? (
                  <a
                    href={`tel:${row.phone}`}
                    className="font-mono text-[11px] text-muted underline-offset-4 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.phone}
                  </a>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted">
                {row.gradeText || (row.grade ? t("gradeValue", { grade: row.grade }) : t("gradePending"))}
                {row.studentId ? ` · ${t("identityStudent")}` : ` · ${t("identityLead")}`}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell className="px-2 py-2">
          <p className="whitespace-nowrap font-medium text-ink">{formatDateTime(row.scheduledAt)}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted" title={row.location || undefined}>
            {row.location || t("locationPending")}
            {row.assessorName ? ` · ${row.assessorName}` : ""}
          </p>
        </TableCell>
        <TableCell className="px-2 py-2">
          <Badge variant={attended ? "secondary" : "outline"} className={cn(attended && "border-leaf-deep/40 bg-leaf/40")}>
            {attended ? t("attended") : t("confirmed")}
          </Badge>
          {!attended && canAssess ? <p className="mt-1 text-[10px] leading-4 text-muted">{t("autoAttendanceHint")}</p> : null}
        </TableCell>
        <TableCell className="px-2 py-2" onClick={(event) => event.stopPropagation()}>
          <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-1.5">
            <Select
              value={assessmentAutosave.draft.assessmentBand ?? "none"}
              disabled={!canAssess}
              onValueChange={(value) => updateAssessment("assessmentBand", value === "none" ? null : value as AssessmentBand)}
            >
              <SelectTrigger className="h-8 text-xs" aria-label={t("assessmentBand")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("bandPending")}</SelectItem>
                {ASSESSMENT_BANDS.map((band) => <SelectItem key={band} value={band}>{t(`band_${band}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              value={assessmentAutosave.draft.score ?? ""}
              disabled={!canAssess}
              aria-label={t("score")}
              placeholder={t("score")}
              onFocus={() => { if (!active) onActivate(); }}
              onChange={(event) => updateAssessment("score", event.target.value === "" ? null : Number(event.target.value))}
              className="h-8 px-2 text-xs"
            />
          </div>
        </TableCell>
        <TableCell className="px-2 py-2">
          <p className={cn("line-clamp-2 leading-5", detailSummary ? "text-ink" : "text-muted")}>
            {detailSummary || row.background || t("openForDetails")}
          </p>
        </TableCell>
        <TableCell className="px-2 py-2">
          <AutosaveState
            state={saveState}
            retry={() => {
              if (assessmentAutosave.state === "error") assessmentAutosave.retry();
              if (routeAutosave.state === "error") routeAutosave.retry();
            }}
          />
        </TableCell>
      </TableRow>
      {active ? (
        <TableRow className="bg-moon/5 hover:bg-moon/5">
          <TableCell colSpan={6} className="p-0">
            <div className="border-y border-line/70 bg-card/40">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-ink">{t("detailTitle", { name: row.name })}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted" title={row.background || undefined}>
                    {row.background ? `${t("background")}: ${row.background}` : t("backgroundEmpty")}
                  </p>
                </div>
                <p className="text-[11px] text-muted">{t("autosaveHint")}</p>
              </div>
              <div className="grid min-w-0 gap-0 lg:grid-cols-[1fr_1.15fr_1fr]">
                <EditorGroup title={t("learningGroup")} className="border-b border-line/60 lg:border-b-0 lg:border-r">
                  <LabeledTextarea
                    label={t("strengths")}
                    value={assessmentAutosave.draft.strengths}
                    disabled={!canAssess}
                    onChange={(value) => updateAssessment("strengths", value)}
                  />
                  <LabeledTextarea
                    label={t("focusAreas")}
                    value={assessmentAutosave.draft.focusAreas}
                    disabled={!canAssess}
                    onChange={(value) => updateAssessment("focusAreas", value)}
                  />
                </EditorGroup>
                <EditorGroup title={t("familyGroup")} className="border-b border-line/60 lg:border-b-0 lg:border-r">
                  <LabeledTextarea
                    label={t("parentConcerns")}
                    value={assessmentAutosave.draft.parentConcerns}
                    disabled={!canAssess}
                    onChange={(value) => updateAssessment("parentConcerns", value)}
                  />
                  <LabeledTextarea
                    label={t("teacherRecommendation")}
                    value={assessmentAutosave.draft.teacherRecommendation}
                    disabled={!canAssess}
                    onChange={(value) => updateAssessment("teacherRecommendation", value)}
                  />
                  <label className="block space-y-1 text-[11px] text-muted">
                    <span>{t("recommendedClass")}</span>
                    <Input
                      value={assessmentAutosave.draft.recommendedClass}
                      disabled={!canAssess}
                      maxLength={200}
                      placeholder={t("recommendedClassPlaceholder")}
                      onChange={(event) => updateAssessment("recommendedClass", event.target.value)}
                      className="h-8 text-xs text-ink"
                    />
                  </label>
                </EditorGroup>
                <EditorGroup title={t("routeGroup")}>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("routeGroup")}>
                    {ACTIVITY_ROUTES.map((route) => {
                      const selected = routeAutosave.draft.route === route;
                      return (
                        <Button
                          key={route}
                          type="button"
                          size="sm"
                          variant={selected ? "primary" : "secondary"}
                          className="h-8 px-2.5 text-[11px]"
                          disabled={!canAssess}
                          aria-pressed={selected}
                          onClick={() => updateRoute("route", route)}
                        >
                          {selected ? <CircleCheck className="size-3.5" /> : null}
                          {t(`route_${route}`)}
                        </Button>
                      );
                    })}
                  </div>
                  <LabeledTextarea
                    label={t("routeNote")}
                    value={routeAutosave.draft.note}
                    disabled={!canAssess || !routeAutosave.draft.route}
                    onChange={(value) => updateRoute("note", value)}
                  />
                  <p className="text-[11px] leading-5 text-muted">
                    {routeAutosave.draft.route ? t(`routeHint_${routeAutosave.draft.route}`) : t("routePendingHint")}
                  </p>
                </EditorGroup>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

function EditorGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 space-y-3 p-4", className)}>
      <h3 className="text-xs font-medium text-ink">{title}</h3>
      {children}
    </section>
  );
}

function LabeledTextarea({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-[11px] text-muted">
      <span>{label}</span>
      <Textarea
        value={value}
        disabled={disabled}
        rows={2}
        maxLength={2_000}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-16 resize-y px-2.5 py-2 text-xs leading-5 text-ink"
      />
    </label>
  );
}

function AutosaveState({ state, retry }: { state: SaveState; retry: () => void }) {
  const t = useTranslations("school.assessments");
  if (state === "saving") return <span className="flex items-center gap-1 text-[11px] text-muted"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />{t("saving")}</span>;
  if (state === "saved") return <span className="flex items-center gap-1 text-[11px] text-emerald-700"><CircleCheck className="size-3.5" />{t("saved")}</span>;
  if (state === "dirty") return <span className="text-[11px] text-muted">{t("waitingSave")}</span>;
  if (state === "error") return <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-[11px] text-rose" onClick={retry}><CircleAlert className="size-3.5" />{t("retry")}</Button>;
  return <span className="text-[11px] text-muted">—</span>;
}

function assessmentDraftFrom(value: AssessmentWorkbenchAssessment | null): AssessmentDraft {
  return {
    assessmentBand: value?.assessmentBand ?? null,
    score: value?.score ?? null,
    strengths: value?.strengths ?? "",
    focusAreas: value?.focusAreas ?? "",
    parentConcerns: value?.parentConcerns ?? "",
    teacherRecommendation: value?.teacherRecommendation ?? "",
    recommendedClass: value?.recommendedClass ?? "",
  };
}

function routeDraftFrom(value: AssessmentWorkbenchRoute | null): RouteDraft {
  return { route: value?.route ?? "", note: value?.note ?? "" };
}

function assessmentSummary(
  assessment: AssessmentDraft,
  route: RouteDraft,
  t: ReturnType<typeof useTranslations<"school.assessments">>,
): string {
  return [
    assessment.focusAreas ? `${t("focusAreasShort")}: ${assessment.focusAreas}` : "",
    assessment.teacherRecommendation ? `${t("teacherRecommendationShort")}: ${assessment.teacherRecommendation}` : "",
    route.route ? t(`route_${route.route}`) : "",
  ].filter(Boolean).join(" · ");
}

function mergeSaveStates(states: SaveState[]): SaveState {
  if (states.includes("error")) return "error";
  if (states.includes("saving")) return "saving";
  if (states.includes("dirty")) return "dirty";
  if (states.includes("saved")) return "saved";
  return "idle";
}

function useAutosavedDraft<T extends object>({
  initial,
  enabled,
  save,
  errorMessage,
  onSaved,
}: {
  initial: T;
  enabled: boolean;
  save: (draft: T) => Promise<ActionResult<SavedRegistration>>;
  errorMessage: string;
  onSaved: (draft: T, result: SavedRegistration) => void;
}) {
  const [draft, setDraft] = useState<T>(initial);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<SaveState>("idle");
  const latestRevisionRef = useRef(0);
  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  const queueRef = useRef(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || revision === 0) return;
    const snapshot = draft;
    const snapshotRevision = revision;
    const timer = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setState("saving");
      queueRef.current = queueRef.current.then(async () => {
        const result = await saveRef.current(snapshot);
        if (!mountedRef.current) return;
        if (result.ok) {
          onSavedRef.current(snapshot, result.data);
          setState(latestRevisionRef.current === snapshotRevision ? "saved" : "dirty");
          return;
        }
        if (latestRevisionRef.current === snapshotRevision) {
          setState("error");
          toast.error(errorMessage);
        }
      }).catch(() => {
        if (mountedRef.current && latestRevisionRef.current === snapshotRevision) {
          setState("error");
          toast.error(errorMessage);
        }
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, enabled, errorMessage, revision]);

  const update = <K extends keyof T>(key: K, value: T[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setState("dirty");
    setRevision((current) => {
      const next = current + 1;
      latestRevisionRef.current = next;
      return next;
    });
  };
  const retry = () => {
    setState("dirty");
    setRevision((current) => {
      const next = current + 1;
      latestRevisionRef.current = next;
      return next;
    });
  };
  return { draft, state, update, retry };
}
