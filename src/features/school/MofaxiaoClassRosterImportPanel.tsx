"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  CircleAlert,
  FileSearch,
  LoaderCircle,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { sha256Hex } from "@/lib/sha256";
import { newId } from "@/lib/uuid";
import {
  applyMofaxiaoClassRosterImportAction,
  getMofaxiaoClassRosterImportBatchAction,
  previewMofaxiaoClassRosterImportAction,
} from "./actions/mofaxiao-class-roster-imports";
import {
  MOFAXIAO_CLASS_ROSTER_IMPORT_TEMPLATE_VERSION,
  type ClassRosterSavedMapping,
  type ClassRosterStudentOption,
  type ClassRosterTargetOption,
  type MofaxiaoClassRosterDecision,
  type MofaxiaoClassRosterDefaultClass,
  type MofaxiaoClassRosterImportBatchResult,
  type MofaxiaoClassRosterImportBatchSummary,
  type MofaxiaoClassRosterImportRow,
} from "./actions/types";
import { DashboardSection, DashboardTableShell, StatusStrip } from "./dashboard-page";
import {
  buildMofaxiaoRosterDefaultClass,
  defaultMofaxiaoRosterStudentDecision,
  listMofaxiaoRosterClassCandidates,
  matchMofaxiaoRosterStudent,
  MofaxiaoClassRosterParseError,
  parseMofaxiaoClassRosterWorkbook,
  preferredMofaxiaoRosterClassCandidate,
  type ParsedMofaxiaoClassRosterWorkbook,
  type ParsedMofaxiaoRosterClass,
  type ParsedMofaxiaoRosterStudent,
  type RosterStudentMatch,
} from "./mofaxiao-class-roster-import";

const UNMAPPED = "__unmapped__";
const CREATE_DEFAULT_CLASS = "__create_default_class__";
const PENDING = "__pending__";
const PREVIEW_LIMIT = 250;

type LocalDecision = MofaxiaoClassRosterDecision | "pending";

interface DecisionState {
  decision: LocalDecision;
  studentId: string | null;
}

interface MembershipView {
  key: string;
  sourceClass: ParsedMofaxiaoRosterClass;
  student: ParsedMofaxiaoRosterStudent;
  match: RosterStudentMatch;
}

function filenameLabel(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "").slice(0, 160);
}

function classRepairHref(
  batchId: string,
  classroomId: string,
  reviewIssues: MofaxiaoClassRosterImportBatchResult["createdClasses"][number]["reviewIssues"],
): string {
  const query = new URLSearchParams({
    tab: "sessions",
    repair: reviewIssues.join(","),
    returnTo: `/dashboard/classes/import/roster?batch=${batchId}`,
  });
  return `/dashboard/classes/${classroomId}?${query.toString()}`;
}

function StudentPicker({
  options,
  selectedId,
  disabled,
  onSelect,
}: {
  options: readonly ClassRosterStudentOption[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("school.classRosterImport");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === selectedId) ?? null;
  const visibleOptions = useMemo(() => {
    if (!open) return selected ? [selected] : [];
    const key = query.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\u3000]+/g, "");
    const matches = key
      ? options.filter((option) => [option.name, option.phone, option.parentPhone, String(option.grade ?? "")]
        .some((value) => value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\u3000]+/g, "").includes(key)))
      : options;
    const first = selected && !matches.some((option) => option.id === selected.id) ? [selected, ...matches] : matches;
    return first.slice(0, 80);
  }, [open, options, query, selected]);
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size="sm" disabled={disabled} className="w-full min-w-48 justify-between font-normal">
          <span className="truncate">{selected ? `${selected.name}${selected.grade ? ` · ${t("grade", { grade: selected.grade })}` : ""}` : t("chooseStudent")}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("searchStudent")} />
          <CommandList className="max-h-80">
            <CommandEmpty>{t("noStudentMatch")}</CommandEmpty>
            {visibleOptions.map((option) => (
              <CommandItem
                key={option.id}
                value={`${option.name} ${option.phone} ${option.parentPhone} ${option.grade ?? ""}`}
                onSelect={() => {
                  onSelect(option.id);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.name}{option.grade ? ` · ${t("grade", { grade: option.grade })}` : ""}</span>
                  <span className="block truncate text-xs text-muted">{option.phone || option.parentPhone || t("noPhone")}</span>
                </span>
                {option.id === selectedId ? <Check className="size-4" /> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MofaxiaoClassRosterImportPanel({
  initialBatch,
  recentBatches,
  targetClasses,
  students,
  savedMappings,
  canCreateStudents,
  canCreateClasses,
}: {
  initialBatch: MofaxiaoClassRosterImportBatchResult | null;
  recentBatches: MofaxiaoClassRosterImportBatchSummary[];
  targetClasses: ClassRosterTargetOption[];
  students: ClassRosterStudentOption[];
  savedMappings: ClassRosterSavedMapping[];
  canCreateStudents: boolean;
  canCreateClasses: boolean;
}) {
  const t = useTranslations("school.classRosterImport");
  const locale = useLocale();
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [parsed, setParsed] = useState<ParsedMofaxiaoClassRosterWorkbook | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [classMappings, setClassMappings] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});
  const [batch, setBatch] = useState<MofaxiaoClassRosterImportBatchResult | null>(initialBatch);
  const [idempotencyKey, setIdempotencyKey] = useState(newId);

  const resetServerBatch = () => {
    setBatch(null);
    setIdempotencyKey(newId());
  };

  const errors = {
    default: t("failed"),
    IDEMPOTENCY_CONFLICT: t("idempotencyConflict"),
    BATCH_HAS_ERRORS: t("batchHasErrors"),
    BATCH_EXPIRED: t("batchExpired"),
  };
  const previewRun = useAction(previewMofaxiaoClassRosterImportAction, {
    successMessage: t("previewSuccess"),
    errorMessage: errors,
    onSuccess: setBatch,
  });
  const openBatchRun = useAction(getMofaxiaoClassRosterImportBatchAction, {
    successMessage: t("openBatchSuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setParsed(null);
      setFileName("");
      setFileHash("");
      setBatchLabel(next.batchLabel);
      setBatch(next);
    },
  });
  const applyRun = useAction(applyMofaxiaoClassRosterImportAction, {
    successMessage: t("applySuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setBatch(next);
      router.refresh();
    },
  });
  const pending = reading || previewRun.pending || openBatchRun.pending || applyRun.pending;

  const membershipViews = useMemo<MembershipView[]>(() => (parsed?.classes ?? []).flatMap((sourceClass) =>
    sourceClass.students.map((student) => ({
      key: `${sourceClass.sourceClassKey}::${student.sourceCell}`,
      sourceClass,
      student,
      match: matchMofaxiaoRosterStudent(student, students),
    }))), [parsed, students]);
  const defaultClasses = useMemo(() => new Map<string, MofaxiaoClassRosterDefaultClass>(
    (parsed?.classes ?? []).map((sourceClass) => [
      sourceClass.sourceClassKey,
      buildMofaxiaoRosterDefaultClass(sourceClass, parsed?.schoolYear ?? 2026),
    ]),
  ), [parsed]);

  const initialize = (next: ParsedMofaxiaoClassRosterWorkbook) => {
    const saved = new Map(savedMappings.map((item) => [item.sourceClassKey, item.classroomId]));
    const nextClassMappings: Record<string, string> = {};
    for (const sourceClass of next.classes) {
      const candidates = listMofaxiaoRosterClassCandidates(sourceClass, targetClasses);
      const savedTarget = saved.get(sourceClass.sourceClassKey);
      const preferred = preferredMofaxiaoRosterClassCandidate(sourceClass, targetClasses);
      nextClassMappings[sourceClass.sourceClassKey] = savedTarget && candidates.some((target) => target.id === savedTarget)
        ? savedTarget
        : preferred?.id ?? (canCreateClasses ? CREATE_DEFAULT_CLASS : "");
    }
    const nextDecisions: Record<string, DecisionState> = {};
    for (const sourceClass of next.classes) {
      for (const student of sourceClass.students) {
        const view: MembershipView = {
          key: `${sourceClass.sourceClassKey}::${student.sourceCell}`,
          sourceClass,
          student,
          match: matchMofaxiaoRosterStudent(student, students),
        };
        nextDecisions[view.key] = defaultMofaxiaoRosterStudentDecision(view.match, canCreateStudents);
      }
    }
    setClassMappings(nextClassMappings);
    setDecisions(nextDecisions);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setParseError(null);
    resetServerBatch();
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new MofaxiaoClassRosterParseError("MISSING_ROSTER_SHEET");
      const [{ default: readWorkbook }, buffer] = await Promise.all([
        import("read-excel-file/browser"),
        file.arrayBuffer(),
      ]);
      const workbook = await readWorkbook(file);
      const [next, hash] = await Promise.all([
        Promise.resolve(parseMofaxiaoClassRosterWorkbook(workbook)),
        sha256Hex(buffer),
      ]);
      setFileName(file.name);
      setFileHash(hash);
      setBatchLabel(filenameLabel(file.name));
      setParsed(next);
      initialize(next);
    } catch (error) {
      setFileName(file.name);
      setFileHash("");
      setParsed(null);
      setClassMappings({});
      setDecisions({});
      setParseError(error instanceof MofaxiaoClassRosterParseError ? error.code : "READ_FAILED");
    } finally {
      setReading(false);
    }
  };

  const updateDecision = (item: MembershipView, decision: LocalDecision, studentId?: string | null) => {
    setDecisions((current) => ({
      ...current,
      [item.key]: {
        decision,
        studentId: decision === "link_existing" ? studentId ?? current[item.key]?.studentId ?? item.match.suggestedStudentId : null,
      },
    }));
    resetServerBatch();
  };

  const resolvedRows = useMemo<MofaxiaoClassRosterImportRow[]>(() => membershipViews.flatMap((item) => {
    const state = decisions[item.key];
    if (!state || state.decision === "pending") return [];
    const mapping = classMappings[item.sourceClass.sourceClassKey] ?? "";
    const createDefaultClass = mapping === CREATE_DEFAULT_CLASS;
    return [{
      sourceRow: item.student.sourceRow,
      sourceCell: item.student.sourceCell,
      sourceClassKey: item.sourceClass.sourceClassKey,
      sourceClassLabel: item.sourceClass.sourceClassLabel,
      rawName: item.student.rawName,
      studentName: item.student.name,
      sourcePhone: item.student.phone,
      grade: item.sourceClass.grade,
      classroomId: mapping && !createDefaultClass ? mapping : null,
      defaultClass: createDefaultClass ? defaultClasses.get(item.sourceClass.sourceClassKey) ?? null : null,
      decision: state.decision,
      studentId: state.decision === "link_existing" ? state.studentId : null,
      sourceNote: item.student.sourceNote,
    }];
  }), [classMappings, decisions, defaultClasses, membershipViews]);

  const unresolvedDecisionCount = membershipViews.filter((item) => {
    const state = decisions[item.key];
    return !state || state.decision === "pending" || (state.decision === "link_existing" && !state.studentId)
      || (state.decision === "create_student" && !canCreateStudents);
  }).length;
  const unresolvedClassMembershipCount = membershipViews.filter((item) => {
    const state = decisions[item.key];
    return state?.decision !== "skip" && !classMappings[item.sourceClass.sourceClassKey];
  }).length;
  const defaultClassCount = new Set((parsed?.classes ?? [])
    .filter((item) => classMappings[item.sourceClassKey] === CREATE_DEFAULT_CLASS)
    .map((item) => item.sourceClassKey)).size;
  const readyToPreview = Boolean(parsed && fileHash && batchLabel.trim()
    && resolvedRows.length === membershipViews.length
    && unresolvedDecisionCount === 0
    && unresolvedClassMembershipCount === 0);
  const rowByOrdinal = useMemo(() => new Map(resolvedRows.map((row, index) => [index + 1, row])), [resolvedRows]);

  const startPreview = () => {
    if (!parsed || !readyToPreview) return;
    previewRun.run({
      templateVersion: MOFAXIAO_CLASS_ROSTER_IMPORT_TEMPLATE_VERSION,
      idempotencyKey,
      fileName,
      fileHash,
      sheetName: parsed.sheetName,
      batchLabel,
      rows: resolvedRows,
    });
  };

  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const batchErrorRows = batch?.rows.filter((row) => row.status === "error" || row.status === "duplicate") ?? [];
  const createdClasses = batch?.createdClasses ?? [];
  const reviewClasses = createdClasses.filter((item) => item.reviewIssues.length > 0);

  return (
    <div className="space-y-10">
      <DashboardSection title={t("inputTitle")} description={t("inputDescription")}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-0">
          <div className="min-w-0 space-y-4 lg:pr-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("file")}
                <Input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending} onChange={(event) => void readFile(event.currentTarget.files?.[0])} />
                <span>{reading ? t("reading") : fileName || t("fileHint")}</span>
              </Label>
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("batchLabel")}
                <Input value={batchLabel} maxLength={160} disabled={!parsed || pending} placeholder={t("batchLabelPlaceholder")} onChange={(event) => { setBatchLabel(event.target.value); resetServerBatch(); }} />
                <span>{t("batchLabelHint")}</span>
              </Label>
            </div>
            {parseError ? <p role="alert" className="text-sm text-rose">{t(`parse_${parseError}`)}</p> : null}
            {parsed ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">{t("recognized", { sheet: parsed.sheetName, classes: parsed.classes.length, students: parsed.memberships })}</span>
                <Button type="button" size="sm" disabled={pending || !readyToPreview} onClick={startPreview}>
                  {previewRun.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <FileSearch size={15} />}
                  {t("dryRun")}
                </Button>
              </div>
            ) : null}
          </div>
          <aside className="min-w-0 lg:border-l lg:border-line lg:pl-6">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><ShieldCheck size={16} />{t("boundaryTitle")}</h3>
            <dl className="mt-4 space-y-3 text-xs">
              <div><dt className="font-medium text-ink">{t("created")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("createdHint")}</dd></div>
              <div><dt className="font-medium text-ink">{t("notCreated")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("notCreatedHint")}</dd></div>
              <div><dt className="font-medium text-ink">{t("scope")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("scopeHint")}</dd></div>
            </dl>
          </aside>
        </div>
      </DashboardSection>

      {parsed ? (
        <>
          <DashboardSection title={t("classMappingTitle")} description={t("classMappingDescription")}>
            <StatusStrip className="mb-4" items={[
              { label: t("sourceClasses"), value: parsed.classes.length },
              { label: t("sourceMemberships"), value: parsed.memberships },
              { label: t("defaultClasses"), value: defaultClassCount, tone: defaultClassCount > 0 ? "warning" : "default" },
              { label: t("unmappedClasses"), value: new Set(membershipViews.filter((item) => !classMappings[item.sourceClass.sourceClassKey]).map((item) => item.sourceClass.sourceClassKey)).size, tone: unresolvedClassMembershipCount > 0 ? "critical" : "default" },
              { label: t("savedMappings"), value: parsed.classes.filter((item) => savedMappings.some((saved) => saved.sourceClassKey === item.sourceClassKey && classMappings[item.sourceClassKey] === saved.classroomId)).length },
            ]} />
            {!canCreateClasses ? <p className="mb-3 text-xs text-rose">{t("cannotCreateClasses")}</p> : null}
            <DashboardTableShell>
              <Table className="w-full min-w-[76rem] text-xs">
                <TableHeader><TableRow><TableHead>{t("sourceRow")}</TableHead><TableHead>{t("sourceClass")}</TableHead><TableHead>{t("teacher")}</TableHead><TableHead>{t("schedule")}</TableHead><TableHead>{t("studentCount")}</TableHead><TableHead>{t("mathinClass")}</TableHead></TableRow></TableHeader>
                <TableBody>{parsed.classes.map((sourceClass) => {
                  const candidates = listMofaxiaoRosterClassCandidates(sourceClass, targetClasses);
                  const value = classMappings[sourceClass.sourceClassKey] || UNMAPPED;
                  const defaultClass = defaultClasses.get(sourceClass.sourceClassKey);
                  return <TableRow key={sourceClass.sourceClassKey} className={value === CREATE_DEFAULT_CLASS ? "bg-amber-500/5 hover:bg-amber-500/10" : undefined}>
                    <TableCell className="font-mono text-muted">{sourceClass.sourceRow}</TableCell>
                    <TableCell><span className="font-medium">{sourceClass.campus} · {sourceClass.gradeText} · {sourceClass.classType}</span><span className="block text-muted">{sourceClass.system || "—"}</span></TableCell>
                    <TableCell>{sourceClass.teacher || "—"}</TableCell>
                    <TableCell>{sourceClass.weekday || "—"} · {sourceClass.time || "—"}</TableCell>
                    <TableCell>{sourceClass.students.length}</TableCell>
                    <TableCell className="min-w-96">
                      <Select value={value} disabled={pending} onValueChange={(next) => { setClassMappings((current) => ({ ...current, [sourceClass.sourceClassKey]: next === UNMAPPED ? "" : next })); resetServerBatch(); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED}>{t("unmapped")}</SelectItem>
                          {canCreateClasses && defaultClass ? <SelectItem value={CREATE_DEFAULT_CLASS}>{t("createDefaultClass", { name: defaultClass.name })}</SelectItem> : null}
                          {candidates.map((target) => <SelectItem key={target.id} value={target.id}>{target.name} · {target.primaryTeacherNames.join("/") || t("noTeacher")} · {target.activeEnrollmentCount}/{target.capacity ?? "∞"}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </DashboardTableShell>
          </DashboardSection>

          <DashboardSection title={t("studentResolutionTitle")} description={t("studentResolutionDescription")}>
            <StatusStrip className="mb-4" items={[
              { label: t("exactMatches"), value: membershipViews.filter((item) => item.match.kind === "exact_phone").length },
              { label: t("nameSuggestions"), value: membershipViews.filter((item) => item.match.kind === "unique_name").length },
              { label: t("newStudents"), value: Object.values(decisions).filter((item) => item.decision === "create_student").length },
              { label: t("skippedStudents"), value: Object.values(decisions).filter((item) => item.decision === "skip").length },
              { label: t("unresolvedStudents"), value: unresolvedDecisionCount, tone: unresolvedDecisionCount > 0 ? "critical" : "default" },
            ]} />
            {!canCreateStudents ? <p className="mb-3 text-xs text-rose">{t("cannotCreateStudents")}</p> : null}
            <DashboardTableShell>
              <Table className="w-full min-w-[88rem] text-xs">
                <TableHeader><TableRow><TableHead>{t("sourceCell")}</TableHead><TableHead>{t("sourceStudent")}</TableHead><TableHead>{t("sourcePhone")}</TableHead><TableHead>{t("sourceClass")}</TableHead><TableHead>{t("matchResult")}</TableHead><TableHead>{t("decision")}</TableHead><TableHead>{t("studentRecord")}</TableHead></TableRow></TableHeader>
                <TableBody>{membershipViews.slice(0, PREVIEW_LIMIT).map((item) => {
                  const state = decisions[item.key] ?? { decision: "pending", studentId: null };
                  const target = targetClasses.find((option) => option.id === classMappings[item.sourceClass.sourceClassKey]);
                  const defaultClass = defaultClasses.get(item.sourceClass.sourceClassKey);
                  const targetName = classMappings[item.sourceClass.sourceClassKey] === CREATE_DEFAULT_CLASS ? defaultClass?.name : target?.name;
                  return <TableRow key={item.key} className={item.student.needsReview ? "bg-rose/5 hover:bg-rose/10" : undefined}>
                    <TableCell className="font-mono text-muted">{item.student.sourceCell}</TableCell>
                    <TableCell><span className="font-medium">{item.student.rawName}</span>{item.student.rawName !== item.student.name ? <span className="block text-rose">→ {item.student.name}</span> : null}{item.student.needsReview ? <Badge variant="danger" className="mt-1">{t("needsReview")}</Badge> : null}</TableCell>
                    <TableCell className="font-mono">{item.student.phone || "—"}</TableCell>
                    <TableCell><span>{targetName ?? t("unmapped")}</span><span className="block text-muted">{classMappings[item.sourceClass.sourceClassKey] === CREATE_DEFAULT_CLASS ? t("defaultClassNeedsReview") : `${item.sourceClass.gradeText} · ${item.sourceClass.classType}`}</span></TableCell>
                    <TableCell><Badge variant={item.match.kind === "exact_phone" ? "secondary" : item.match.kind === "new" ? "outline" : item.match.kind === "review" ? "danger" : "outline"}>{t(`match_${item.match.kind}`)}</Badge></TableCell>
                    <TableCell className="min-w-48">
                      <Select value={state.decision === "pending" ? PENDING : state.decision} disabled={pending} onValueChange={(value) => updateDecision(item, value === PENDING ? "pending" : value as MofaxiaoClassRosterDecision)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PENDING}>{t("decisionPending")}</SelectItem>
                          <SelectItem value="link_existing">{t("decisionLink")}</SelectItem>
                          <SelectItem value="create_student" disabled={!canCreateStudents}>{t("decisionCreate")}</SelectItem>
                          <SelectItem value="skip">{t("decisionSkip")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="min-w-56">
                      {state.decision === "link_existing" ? <StudentPicker options={students} selectedId={state.studentId} disabled={pending} onSelect={(id) => updateDecision(item, "link_existing", id)} /> : state.decision === "create_student" ? <span className="text-muted">{t("minimalProfile", { name: item.student.name })}</span> : <span className="text-muted">—</span>}
                    </TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </DashboardTableShell>
          </DashboardSection>
        </>
      ) : null}

      {batch ? (
        <DashboardSection title={t("dryRunTitle")} description={t("dryRunDescription", { file: batch.fileName })}>
          <div className="flex flex-wrap items-center gap-2"><Badge variant={batch.errorCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>{t(`batchStatus_${batch.status}`)}</Badge><span className="font-mono text-xs text-muted">{batch.batchId}</span></div>
          <StatusStrip className="mt-3" items={[
            { label: t("sourceMemberships"), value: batch.total },
            { label: t("readyRows"), value: batch.valid },
            { label: t("duplicateRows"), value: batch.dup, tone: batch.dup > 0 ? "warning" : "default" },
            { label: t("skippedRows"), value: batch.skipped },
            { label: t("errorRows"), value: batch.errorCount, tone: batch.errorCount > 0 ? "critical" : "default" },
            { label: t("insertedRows"), value: batch.inserted },
          ]} />
          {batchErrorRows.length > 0 ? (
            <DashboardTableShell className="mt-5">
              <Table className="w-full min-w-[64rem] text-xs">
                <TableHeader><TableRow><TableHead>{t("sourceCell")}</TableHead><TableHead>{t("sourceStudent")}</TableHead><TableHead>{t("mathinClass")}</TableHead><TableHead>{t("result")}</TableHead><TableHead>{t("reason")}</TableHead></TableRow></TableHeader>
                <TableBody>{batchErrorRows.map((row) => {
                  const source = rowByOrdinal.get(row.row);
                  return <TableRow key={row.row}><TableCell className="font-mono text-muted">{source?.sourceCell ?? row.sourceCell}</TableCell><TableCell>{source?.rawName || row.sourceName || "—"}</TableCell><TableCell>{row.classroomName || targetClasses.find((target) => target.id === source?.classroomId)?.name || "—"}</TableCell><TableCell>{t(`status_${row.status}`)}</TableCell><TableCell className={row.status === "error" ? "text-rose" : "text-muted"}>{row.errors.map((code) => t.has(`error_${code}`) ? t(`error_${code}`) : code).join("；")}</TableCell></TableRow>;
                })}</TableBody>
              </Table>
            </DashboardTableShell>
          ) : null}
          {batch.status === "validated" ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
              <p className="text-xs text-muted">{batch.errorCount > 0 ? t("applyBlocked", { count: batch.errorCount }) : t("applyHint")}</p>
              <Button type="button" disabled={pending || batch.errorCount > 0} onClick={() => applyRun.run(batch.batchId)}>{applyRun.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}{t("apply")}</Button>
            </div>
          ) : null}
          {batch.status === "completed" ? (
            <div className="mt-5 space-y-4 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-leaf-deep"><CheckCircle2 size={16} />{t("completed", { inserted: batch.inserted, created: batch.createdStudents, duplicates: batch.dup, skipped: batch.skipped, classes: createdClasses.length, review: reviewClasses.length })}</p>
                <Link href="/dashboard/classes" className={buttonVariants({ size: "sm" })}>{t("openClasses")}<ArrowRight size={15} /></Link>
              </div>
              {reviewClasses.length > 0 ? (
                <div className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink"><CircleAlert size={16} className="text-amber-700 dark:text-amber-300" />{t("createdClassReminderTitle", { count: reviewClasses.length })}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{t("createdClassReminderDescription")}</p>
                  <ul className="mt-3 grid gap-2">
                    {reviewClasses.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs"><span><span className="font-medium text-ink">{item.name}</span><span className="ml-2 text-rose">{item.reviewIssues.map((issue) => t(`classIssue_${issue}`)).join("、")}</span></span><Link href={classRepairHref(batch.batchId, item.id, item.reviewIssues)} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("repairClass")}<ArrowRight size={14} /></Link></li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </DashboardSection>
      ) : null}

      <DashboardSection title={t("recentTitle")} description={t("recentDescription")}>
        {recentBatches.length === 0 ? <div className="grid min-h-28 place-items-center text-sm text-muted">{t("recentEmpty")}</div> : (
          <DashboardTableShell>
            <Table className="w-full min-w-[64rem] text-sm">
              <TableHeader><TableRow><TableHead>{t("createdAt")}</TableHead><TableHead>{t("batchLabel")}</TableHead><TableHead>{t("statusLabel")}</TableHead><TableHead>{t("sourceMemberships")}</TableHead><TableHead>{t("duplicateRows")}</TableHead><TableHead>{t("skippedRows")}</TableHead><TableHead>{t("errorRows")}</TableHead><TableHead>{t("insertedRows")}</TableHead><TableHead>{t("batchId")}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{recentBatches.map((item) => <TableRow key={item.batchId}><TableCell className="whitespace-nowrap">{formatAt(item.createdAt)}</TableCell><TableCell>{item.batchLabel || item.fileName}</TableCell><TableCell><Badge variant={item.status === "completed" ? "secondary" : item.errors > 0 ? "danger" : "outline"}>{t(`batchStatus_${item.status}`)}</Badge></TableCell><TableCell>{item.total}</TableCell><TableCell>{item.duplicates}</TableCell><TableCell>{item.skipped}</TableCell><TableCell className={item.errors > 0 ? "text-rose" : undefined}>{item.errors}</TableCell><TableCell>{item.inserted}</TableCell><TableCell className="font-mono text-xs text-muted">{item.batchId.slice(0, 8)}</TableCell><TableCell className="text-right"><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openBatchRun.run(item.batchId)}>{t(item.status === "completed" ? "viewBatch" : "openBatch")}</Button></TableCell></TableRow>)}</TableBody>
            </Table>
          </DashboardTableShell>
        )}
      </DashboardSection>
    </div>
  );
}
