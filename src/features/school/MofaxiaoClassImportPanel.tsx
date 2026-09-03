"use client";

import { ArrowRight, CheckCircle2, FileSearch, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { sha256Hex } from "@/lib/sha256";
import { newId } from "@/lib/uuid";
import {
  applyMofaxiaoClassImportAction,
  getMofaxiaoClassImportBatchAction,
  previewMofaxiaoClassImportAction,
} from "./actions/mofaxiao-class-imports";
import {
  MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION,
  type ClassImportCourseOption,
  type MofaxiaoClassImportBatchResult,
  type MofaxiaoClassImportBatchSummary,
  type MofaxiaoClassImportRow,
} from "./actions/types";
import type { StaffOption } from "./classes";
import type { SchoolTermRow } from "./courses";
import { DashboardSection, DashboardTableShell, StatusStrip } from "./dashboard-page";
import {
  inferMofaxiaoSchoolYearStart,
  isCreatableMofaxiaoRoomName,
  isSupportedMofaxiaoClassType,
  listMofaxiaoClassCourseCandidates,
  MofaxiaoClassParseError,
  normalizeClassImportText,
  normalizeMofaxiaoCampusName,
  parseMofaxiaoClassWorksheet,
  preferredMofaxiaoClassCourseCandidate,
  suggestMofaxiaoClassRoomMapping,
  type ParsedMofaxiaoClassWorksheet,
} from "./mofaxiao-class-import";
import type { CampusOptionV2, RoomOptionV2 } from "./organization-locations";

const FREE_CLASS = "__free_class__";
const NO_ROOM = "__no_room__";
const CREATE_ROOM_PREFIX = "__create_room__:";
const UNMAPPED = "__unmapped__";
const PREVIEW_LIMIT = 200;

function filenameLabel(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "").slice(0, 160);
}

function courseKey(value: string) {
  return normalizeClassImportText(value);
}

function courseMappingKey(row: MofaxiaoClassImportRow) {
  return `${courseKey(row.courseName)}::${row.grade ?? "any"}::${row.season ?? "any"}`;
}

function teacherKey(value: string) {
  return normalizeClassImportText(value);
}

function roomKey(campus: string, room: string) {
  return `${normalizeMofaxiaoCampusName(campus)}::${normalizeClassImportText(room)}`;
}

function createRoomMappingValue(campusId: string) {
  return `${CREATE_ROOM_PREFIX}${campusId}`;
}

function createRoomCampusIdFromMapping(value: string): string | null {
  return value.startsWith(CREATE_ROOM_PREFIX) ? value.slice(CREATE_ROOM_PREFIX.length) : null;
}

function groupRows(rows: readonly MofaxiaoClassImportRow[], keyOf: (row: MofaxiaoClassImportRow) => string) {
  const groups = new Map<string, MofaxiaoClassImportRow[]>();
  for (const row of rows) {
    if (!isSupportedMofaxiaoClassType(row.courseType)) continue;
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, groupedRows]) => ({ key, rows: groupedRows, first: groupedRows[0] }));
}

function preferredDefaultSchoolYearId(terms: readonly SchoolTermRow[]): string {
  const current = terms.find((term) => term.isCurrent);
  if (current) return current.schoolYearId;
  return [...terms].sort((left, right) => right.year - left.year)[0]?.schoolYearId ?? "";
}

function classTypeLabel(courseType: string): "long" | "short" | "excluded" {
  if (courseType === "长期班") return "long";
  if (courseType === "短期班") return "short";
  return "excluded";
}

export function MofaxiaoClassImportPanel({
  recentBatches,
  courseOptions,
  teachers,
  campusOptions,
  roomOptions,
  canCreateRooms,
  schoolTerms,
}: {
  recentBatches: MofaxiaoClassImportBatchSummary[];
  courseOptions: ClassImportCourseOption[];
  teachers: StaffOption[];
  campusOptions: CampusOptionV2[];
  roomOptions: RoomOptionV2[];
  canCreateRooms: boolean;
  schoolTerms: SchoolTermRow[];
}) {
  const t = useTranslations("school.classImport");
  const locale = useLocale();
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [parsed, setParsed] = useState<ParsedMofaxiaoClassWorksheet | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [courseMappings, setCourseMappings] = useState<Record<string, string>>({});
  const [teacherMappings, setTeacherMappings] = useState<Record<string, string>>({});
  const [roomMappings, setRoomMappings] = useState<Record<string, string>>({});
  const [defaultSchoolYearId, setDefaultSchoolYearId] = useState(() => preferredDefaultSchoolYearId(schoolTerms));
  const [batch, setBatch] = useState<MofaxiaoClassImportBatchResult | null>(null);
  const [duplicatesConfirmed, setDuplicatesConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newId);

  const resetServerBatch = () => {
    setBatch(null);
    setDuplicatesConfirmed(false);
    setIdempotencyKey(newId());
  };

  const errors = {
    default: t("failed"),
    IDEMPOTENCY_CONFLICT: t("idempotencyConflict"),
    BATCH_HAS_ERRORS: t("batchHasErrors"),
    BATCH_EXPIRED: t("batchExpired"),
    INVALID_ROOM_CREATION: t("invalidRoomCreation"),
    ROOM_NAME_EXISTS_INACTIVE: t("roomNameExistsInactive"),
    LOCATION_PERMISSION_REQUIRED: t("locationPermissionRequired"),
  };
  const previewRun = useAction(previewMofaxiaoClassImportAction, {
    successMessage: t("previewSuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setBatch(next);
      setDuplicatesConfirmed(false);
    },
  });
  const openBatchRun = useAction(getMofaxiaoClassImportBatchAction, {
    successMessage: t("openBatchSuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setParsed(null);
      setFileName("");
      setFileHash("");
      setBatchLabel(next.batchLabel);
      setBatch(next);
      setDuplicatesConfirmed(false);
    },
  });
  const applyRun = useAction(applyMofaxiaoClassImportAction, {
    successMessage: t("applySuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setBatch(next);
      router.refresh();
    },
  });
  const pending = reading || previewRun.pending || openBatchRun.pending || applyRun.pending;

  const supportedRows = useMemo(
    () => (parsed?.rows ?? []).filter((row) => isSupportedMofaxiaoClassType(row.courseType)),
    [parsed],
  );
  const excludedRows = (parsed?.rows.length ?? 0) - supportedRows.length;
  const courseGroups = useMemo(() => groupRows(parsed?.rows ?? [], courseMappingKey), [parsed]);
  const teacherGroups = useMemo(() => groupRows(parsed?.rows ?? [], (row) => teacherKey(row.teacherName)), [parsed]);
  const roomGroups = useMemo(() => groupRows(parsed?.rows ?? [], (row) => roomKey(row.campusName, row.roomName)), [parsed]);
  const schoolYears = useMemo(() => {
    const grouped = new Map<string, { id: string; year: number }>();
    for (const term of schoolTerms) grouped.set(term.schoolYearId, { id: term.schoolYearId, year: term.year });
    return [...grouped.values()].sort((left, right) => right.year - left.year);
  }, [schoolTerms]);

  const courseCandidates = (row: MofaxiaoClassImportRow) => listMofaxiaoClassCourseCandidates(row, courseOptions);

  const resolvedTerm = (row: MofaxiaoClassImportRow): SchoolTermRow | null => {
    if (row.season === null) return null;
    const fallbackYear = schoolYears.find((year) => year.id === defaultSchoolYearId)?.year ?? null;
    const startYear = inferMofaxiaoSchoolYearStart(row.startDate, row.season, fallbackYear);
    return schoolTerms.find((term) => term.year === startYear && term.term === row.season) ?? null;
  };

  const resolvedOperationalStatus = (row: MofaxiaoClassImportRow): "planning" | "active" | "completed" => {
    if (row.sourceStatus !== "开课中") return "planning";
    const effectiveEndDate = row.endDate ?? resolvedTerm(row)?.endsOn ?? null;
    const today = new Date().toISOString().slice(0, 10);
    return effectiveEndDate && effectiveEndDate < today ? "completed" : "active";
  };

  const resolveRow = (row: MofaxiaoClassImportRow): MofaxiaoClassImportRow => {
    const courseMapping = courseMappings[courseMappingKey(row)] ?? "";
    const roomMapping = roomMappings[roomKey(row.campusName, row.roomName)] ?? NO_ROOM;
    const createRoomCampusId = createRoomCampusIdFromMapping(roomMapping);
    return {
      ...row,
      courseId: courseMapping && courseMapping !== FREE_CLASS ? courseMapping : null,
      importAsFreeClass: courseMapping === FREE_CLASS,
      primaryTeacherId: teacherMappings[teacherKey(row.teacherName)] || null,
      roomId: roomMapping !== NO_ROOM && createRoomCampusId === null ? roomMapping : null,
      createRoomCampusId,
      schoolTermId: resolvedTerm(row)?.id ?? null,
    };
  };

  const localIssues = (row: MofaxiaoClassImportRow) => {
    const resolved = resolveRow(row);
    const issues: string[] = [];
    if (!resolved.externalClassId || !resolved.name) issues.push("identity");
    if (resolved.teachingMode !== "面授") issues.push("teachingMode");
    if (resolved.gradeUnmapped) issues.push("grade");
    if (resolved.capacityInvalid) issues.push("capacity");
    if (resolved.season === null || !resolved.schoolTermId) issues.push("term");
    if (!resolved.primaryTeacherId) issues.push("teacher");
    if (!resolved.courseId && !resolved.importAsFreeClass) issues.push("course");
    if (resolved.sourceStatus !== "未开课" && resolved.sourceStatus !== "开课中") issues.push("status");
    if (resolved.startDateText && !resolved.startDate) issues.push("startDate");
    if (resolved.endDateText && !resolved.endDate) issues.push("endDate");
    return issues;
  };

  const selectedSourceRows = useMemo(() => supportedRows.filter((row) => selectedRows.has(row.sourceRow)), [selectedRows, supportedRows]);
  const resolvedSelectedRows = selectedSourceRows.map(resolveRow);
  const unresolvedSelectedCount = selectedSourceRows.filter((row) => localIssues(row).length > 0).length;
  const plannedRoomCreations = new Set(resolvedSelectedRows.flatMap((row) => row.createRoomCampusId
    ? [`${row.createRoomCampusId}::${normalizeClassImportText(row.roomName)}`]
    : [])).size;
  const defaultSchoolYearRowCount = supportedRows.filter((row) => !row.startDate).length;
  const rowByOrdinal = useMemo(
    () => new Map(resolvedSelectedRows.map((row, index) => [index + 1, row])),
    [resolvedSelectedRows],
  );
  const serverRowByOrdinal = useMemo(() => new Map(batch?.rows.map((row) => [row.row, row]) ?? []), [batch]);

  const initializeMappings = (next: ParsedMofaxiaoClassWorksheet) => {
    const nextCourseMappings: Record<string, string> = {};
    for (const group of groupRows(next.rows, courseMappingKey)) {
      const preferred = preferredMofaxiaoClassCourseCandidate(group.first, courseOptions);
      nextCourseMappings[group.key] = preferred?.id ?? "";
    }

    const nextTeacherMappings: Record<string, string> = {};
    for (const group of groupRows(next.rows, (row) => teacherKey(row.teacherName))) {
      const matches = teachers.filter((teacher) => teacherKey(teacher.name) === group.key);
      nextTeacherMappings[group.key] = matches.length === 1 ? matches[0].id : "";
    }

    const nextRoomMappings: Record<string, string> = {};
    for (const group of groupRows(next.rows, (row) => roomKey(row.campusName, row.roomName))) {
      const suggestion = suggestMofaxiaoClassRoomMapping(
        group.first,
        roomOptions,
        campusOptions,
        canCreateRooms,
      );
      nextRoomMappings[group.key] = suggestion.roomId
        ?? (suggestion.createRoomCampusId ? createRoomMappingValue(suggestion.createRoomCampusId) : NO_ROOM);
    }
    setCourseMappings(nextCourseMappings);
    setTeacherMappings(nextTeacherMappings);
    setRoomMappings(nextRoomMappings);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setParseError(null);
    resetServerBatch();
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new MofaxiaoClassParseError("UNRECOGNIZED_HEADERS");
      const [{ default: readWorkbook }, buffer] = await Promise.all([
        import("read-excel-file/browser"),
        file.arrayBuffer(),
      ]);
      const [firstSheet] = await readWorkbook(file);
      if (!firstSheet) throw new MofaxiaoClassParseError("EMPTY_SHEET");
      const [next, hash] = await Promise.all([
        Promise.resolve(parseMofaxiaoClassWorksheet(firstSheet.data, firstSheet.sheet)),
        sha256Hex(buffer),
      ]);
      setFileName(file.name);
      setFileHash(hash);
      setBatchLabel(filenameLabel(file.name));
      setParsed(next);
      setSelectedRows(new Set(next.rows.filter((row) => isSupportedMofaxiaoClassType(row.courseType)).map((row) => row.sourceRow)));
      initializeMappings(next);
    } catch (error) {
      setFileName(file.name);
      setFileHash("");
      setParsed(null);
      setSelectedRows(new Set());
      setParseError(error instanceof MofaxiaoClassParseError ? error.code : "READ_FAILED");
    } finally {
      setReading(false);
    }
  };

  const updateMapping = (setter: typeof setCourseMappings, key: string, value: string) => {
    setter((current) => ({ ...current, [key]: value === UNMAPPED ? "" : value }));
    resetServerBatch();
  };

  const startPreview = () => {
    if (!parsed || !fileHash || resolvedSelectedRows.length === 0) return;
    previewRun.run({
      templateVersion: MOFAXIAO_CLASS_IMPORT_TEMPLATE_VERSION,
      idempotencyKey,
      fileName,
      fileHash,
      sheetName: parsed.sheetName,
      batchLabel,
      rows: resolvedSelectedRows,
    });
  };

  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

  const serverStatus = (ordinal: number) => {
    const row = serverRowByOrdinal.get(ordinal);
    if (!row) return <span className="text-muted">{t("notChecked")}</span>;
    return <span className={row.status === "error" ? "text-rose" : "text-muted"}>{t(`status_${row.status}`)}</span>;
  };

  return (
    <div className="space-y-10">
      <DashboardSection title={t("inputTitle")} description={t("inputDescription")}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-0">
          <div className="min-w-0 space-y-4 lg:pr-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("file")}
                <Input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={pending}
                  onChange={(event) => void readFile(event.currentTarget.files?.[0])}
                />
                <span>{reading ? t("reading") : fileName || t("fileHint")}</span>
              </Label>
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("batchLabel")}
                <Input
                  value={batchLabel}
                  maxLength={160}
                  disabled={!parsed || pending}
                  placeholder={t("batchLabelPlaceholder")}
                  onChange={(event) => {
                    setBatchLabel(event.target.value);
                    resetServerBatch();
                  }}
                />
                <span>{t("batchLabelHint")}</span>
              </Label>
            </div>
            <Label className="grid max-w-sm gap-1.5 text-xs font-normal text-muted">
              {t("defaultSchoolYear")}
              <Select
                value={defaultSchoolYearId || UNMAPPED}
                disabled={!parsed || pending}
                onValueChange={(value) => {
                  setDefaultSchoolYearId(value === UNMAPPED ? "" : value);
                  resetServerBatch();
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>{t("unmapped")}</SelectItem>
                  {schoolYears.map((year) => <SelectItem key={year.id} value={year.id}>{year.year}–{year.year + 1}</SelectItem>)}
                </SelectContent>
              </Select>
              <span>{t("defaultSchoolYearHint")}</span>
            </Label>
            {parseError ? <p role="alert" className="text-sm text-rose">{t(`parse_${parseError}`)}</p> : null}
            {parsed ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">{t("recognized", { count: parsed.rows.length, header: parsed.headerRow, sheet: parsed.sheetName })}</span>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !batchLabel.trim() || resolvedSelectedRows.length === 0}
                  onClick={startPreview}
                >
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
              <div><dt className="font-medium text-ink">{t("excluded")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("excludedHint")}</dd></div>
            </dl>
          </aside>
        </div>
      </DashboardSection>

      {parsed ? (
        <>
          <DashboardSection title={t("mappingTitle")} description={t("mappingDescription")}>
            <StatusStrip
              className="mb-4"
              items={[
                { label: t("sourceRows"), value: parsed.rows.length },
                { label: t("selectedRows"), value: selectedRows.size },
                { label: t("excludedRows"), value: excludedRows, tone: excludedRows > 0 ? "warning" : "default" },
                { label: t("unresolvedRows"), value: unresolvedSelectedCount, tone: unresolvedSelectedCount > 0 ? "critical" : "default" },
                { label: t("roomsToCreate"), value: plannedRoomCreations, tone: plannedRoomCreations > 0 ? "warning" : "default" },
                { label: t("defaultSchoolYearRows"), value: defaultSchoolYearRowCount },
              ]}
            />

            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-ink">{t("courseMappings")}</h3>
                <DashboardTableShell className="mt-2">
                  <Table className="w-full min-w-[52rem] text-xs">
                    <TableHeader><TableRow><TableHead>{t("sourceCourse")}</TableHead><TableHead>{t("affectedRows")}</TableHead><TableHead>{t("mathinCourse")}</TableHead></TableRow></TableHeader>
                    <TableBody>{courseGroups.map((group) => {
                      const candidates = courseCandidates(group.first);
                      const value = courseMappings[group.key] || UNMAPPED;
                      return <TableRow key={group.key}>
                        <TableCell>
                          <span className="font-medium">{group.first.courseName || "—"}</span>
                          <span className="ml-2 text-muted">{group.first.gradeText || "—"} · {group.first.seasonText || "—"}</span>
                        </TableCell>
                        <TableCell>{group.rows.length}</TableCell>
                        <TableCell className="min-w-80">
                          <Select value={value} disabled={pending} onValueChange={(next) => updateMapping(setCourseMappings, group.key, next)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNMAPPED}>{t("unmapped")}</SelectItem>
                              <SelectItem value={FREE_CLASS}>{t("freeClass")}</SelectItem>
                              {candidates.map((course) => <SelectItem key={course.id} value={course.id}>{course.title}{course.catalogVersionTitle ? ` · ${course.catalogVersionTitle}` : ""}{course.productCode ? ` · ${course.productCode}` : ""}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>;
                    })}</TableBody>
                  </Table>
                </DashboardTableShell>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div>
                  <h3 className="text-sm font-medium text-ink">{t("teacherMappings")}</h3>
                  <DashboardTableShell className="mt-2">
                    <Table className="w-full text-xs">
                      <TableHeader><TableRow><TableHead>{t("sourceTeacher")}</TableHead><TableHead>{t("mathinTeacher")}</TableHead></TableRow></TableHeader>
                      <TableBody>{teacherGroups.map((group) => <TableRow key={group.key}>
                        <TableCell className="font-medium">{group.first.teacherName || "—"}</TableCell>
                        <TableCell className="min-w-52"><Select value={teacherMappings[group.key] || UNMAPPED} disabled={pending} onValueChange={(next) => updateMapping(setTeacherMappings, group.key, next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={UNMAPPED}>{t("unmapped")}</SelectItem>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}</SelectContent></Select></TableCell>
                      </TableRow>)}</TableBody>
                    </Table>
                  </DashboardTableShell>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-ink">{t("roomMappings")}</h3>
                  <DashboardTableShell className="mt-2">
                    <Table className="w-full text-xs">
                      <TableHeader><TableRow><TableHead>{t("sourceRoom")}</TableHead><TableHead>{t("mathinRoom")}</TableHead></TableRow></TableHeader>
                      <TableBody>{roomGroups.map((group) => {
                        const canCreateSourceRoom = canCreateRooms && isCreatableMofaxiaoRoomName(group.first.roomName);
                        return <TableRow key={group.key}>
                          <TableCell><span className="font-medium">{group.first.roomName || "—"}</span><span className="ml-2 text-muted">{group.first.campusName}</span></TableCell>
                          <TableCell className="min-w-64">
                            <Select value={roomMappings[group.key] || NO_ROOM} disabled={pending} onValueChange={(next) => updateMapping(setRoomMappings, group.key, next)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NO_ROOM}>{t("noRoom")}</SelectItem>
                                {canCreateSourceRoom ? campusOptions.map((campus) => (
                                  <SelectItem key={`${CREATE_ROOM_PREFIX}${campus.id}`} value={createRoomMappingValue(campus.id)}>
                                    {t("createRoomInCampus", { campus: campus.name, room: group.first.roomName })}
                                  </SelectItem>
                                )) : null}
                                {roomOptions.map((room) => <SelectItem key={room.id} value={room.id}>{room.campusName} · {room.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>;
                      })}</TableBody>
                    </Table>
                  </DashboardTableShell>
                </div>
              </div>
            </div>
          </DashboardSection>

          <DashboardSection title={t("previewTitle")} description={t("previewDescription")}>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => { setSelectedRows(new Set(supportedRows.map((row) => row.sourceRow))); resetServerBatch(); }}>{t("selectAllClasses")}</Button>
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => { setSelectedRows(new Set(supportedRows.filter((row) => localIssues(row).length === 0).map((row) => row.sourceRow))); resetServerBatch(); }}>{t("selectReady")}</Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setSelectedRows(new Set()); resetServerBatch(); }}>{t("clearSelection")}</Button>
            </div>
            <DashboardTableShell>
              <Table className="w-full min-w-[84rem] text-xs">
                <TableHeader><TableRow>
                  <TableHead className="w-12">{t("include")}</TableHead><TableHead>{t("sourceRow")}</TableHead><TableHead>{t("className")}</TableHead><TableHead>{t("classKind")}</TableHead><TableHead>{t("course")}</TableHead><TableHead>{t("teacher")}</TableHead><TableHead>{t("term")}</TableHead><TableHead>{t("room")}</TableHead><TableHead>{t("sourceStatus")}</TableHead><TableHead>{t("validation")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{parsed.rows.slice(0, PREVIEW_LIMIT).map((row) => {
                  const supported = isSupportedMofaxiaoClassType(row.courseType);
                  const resolved = resolveRow(row);
                  const issues = supported ? localIssues(row) : ["excluded"];
                  const selected = selectedRows.has(row.sourceRow);
                  const course = courseOptions.find((item) => item.id === resolved.courseId);
                  const teacher = teachers.find((item) => item.id === resolved.primaryTeacherId);
                  const room = roomOptions.find((item) => item.id === resolved.roomId);
                  const createRoomCampus = campusOptions.find((item) => item.id === resolved.createRoomCampusId);
                  const term = resolvedTerm(row);
                  const ordinal = selectedSourceRows.findIndex((item) => item.sourceRow === row.sourceRow) + 1;
                  return <TableRow key={`${row.sourceRow}-${row.externalClassId}`}>
                    <TableCell><Checkbox checked={selected} disabled={!supported || pending} onCheckedChange={(checked) => { setSelectedRows((current) => { const next = new Set(current); if (checked === true) next.add(row.sourceRow); else next.delete(row.sourceRow); return next; }); resetServerBatch(); }} /></TableCell>
                    <TableCell className="font-mono text-muted">{row.sourceRow}</TableCell>
                    <TableCell><span className="font-medium">{row.name || "—"}</span><span className="ml-2 font-mono text-muted">{row.externalClassId}</span></TableCell>
                    <TableCell><Badge variant={supported ? "outline" : "secondary"}>{t(`kind_${classTypeLabel(row.courseType)}`)}</Badge></TableCell>
                    <TableCell>{resolved.importAsFreeClass ? t("freeClass") : course?.title ?? t("unmapped")}</TableCell>
                    <TableCell>{teacher?.name ?? t("unmapped")}</TableCell>
                    <TableCell>{term ? `${term.year}–${term.year + 1} · ${row.seasonText}` : t("unmapped")}</TableCell>
                    <TableCell>{room
                      ? `${room.campusName} · ${room.name}`
                      : createRoomCampus
                        ? t("roomWillCreate", { campus: createRoomCampus.name, room: row.roomName })
                        : t("noRoom")}</TableCell>
                    <TableCell>
                      <span>{row.sourceStatus || "—"}</span>
                      {supported ? <span className="ml-2 text-muted">→ {t(`operational_${resolvedOperationalStatus(row)}`)}</span> : null}
                    </TableCell>
                    <TableCell>{!supported ? <span className="text-muted">{t("experienceExcluded")}</span> : selected && ordinal > 0 && batch ? serverStatus(ordinal) : issues.length === 0 ? <span className="text-leaf-deep">{t("locallyReady")}</span> : <span className="text-rose">{t("needsMapping", { count: issues.length })}</span>}</TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </DashboardTableShell>
          </DashboardSection>
        </>
      ) : null}

      {batch ? (
        <DashboardSection title={t("dryRunTitle")} description={t("dryRunDescription", { file: batch.fileName })}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={batch.errorCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>{t(`batchStatus_${batch.status}`)}</Badge>
            <span className="font-mono text-xs text-muted">{batch.batchId}</span>
          </div>
          <StatusStrip className="mt-3" items={[
            { label: t("selectedRows"), value: batch.total },
            { label: t("readyRows"), value: batch.valid },
            { label: t("duplicateRows"), value: batch.dup, tone: batch.dup > 0 ? "warning" : "default" },
            { label: t("errorRows"), value: batch.errorCount, tone: batch.errorCount > 0 ? "critical" : "default" },
            { label: t("insertedRows"), value: batch.inserted },
          ]} />

          {batch.rows.some((row) => row.status !== "valid" && row.status !== "inserted") ? (
            <DashboardTableShell className="mt-5">
              <Table className="w-full min-w-[58rem] text-xs">
                <TableHeader><TableRow><TableHead>{t("sourceRow")}</TableHead><TableHead>{t("className")}</TableHead><TableHead>{t("result")}</TableHead><TableHead>{t("reason")}</TableHead></TableRow></TableHeader>
                <TableBody>{batch.rows.filter((row) => row.status !== "valid" && row.status !== "inserted").map((row) => {
                  const source = rowByOrdinal.get(row.row);
                  return <TableRow key={row.row}>
                    <TableCell className="font-mono text-muted">{source?.sourceRow ?? row.sourceRow}</TableCell>
                    <TableCell className="font-medium">{source?.name || row.sourceName || "—"}</TableCell>
                    <TableCell>{t(`status_${row.status}`)}</TableCell>
                    <TableCell className={row.status === "error" ? "text-rose" : "text-muted"}>{row.errors.map((code) => t.has(`error_${code}`) ? t(`error_${code}`) : code).join("；")}</TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </DashboardTableShell>
          ) : null}

          {batch.status === "validated" ? (
            <div className="mt-5 space-y-4 border-t border-line pt-4">
              {batch.dup > 0 ? <Label className="flex items-start gap-2 text-sm font-normal text-ink"><Checkbox checked={duplicatesConfirmed} disabled={pending} onCheckedChange={(checked) => setDuplicatesConfirmed(checked === true)} /><span>{t("confirmDuplicates", { count: batch.dup })}</span></Label> : null}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs text-muted">{batch.errorCount > 0 ? t("applyBlocked", { count: batch.errorCount }) : t("applyHint")}</p>
                <Button type="button" disabled={pending || batch.errorCount > 0 || (batch.dup > 0 && !duplicatesConfirmed)} onClick={() => applyRun.run(batch.batchId)}>
                  {applyRun.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}{t("apply")}
                </Button>
              </div>
            </div>
          ) : null}

          {batch.status === "completed" ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm text-leaf-deep"><CheckCircle2 size={16} />{t("completed", { inserted: batch.inserted, duplicates: batch.dup })}</p>
              <Link href="/dashboard/classes" className={buttonVariants({ size: "sm" })}>{t("openClasses")}<ArrowRight size={15} /></Link>
            </div>
          ) : null}
        </DashboardSection>
      ) : null}

      <DashboardSection title={t("recentTitle")} description={t("recentDescription")}>
        {recentBatches.length === 0 ? <div className="grid min-h-28 place-items-center text-sm text-muted">{t("recentEmpty")}</div> : (
          <DashboardTableShell>
            <Table className="w-full min-w-[58rem] text-sm">
              <TableHeader><TableRow><TableHead>{t("createdAt")}</TableHead><TableHead>{t("batchLabel")}</TableHead><TableHead>{t("statusLabel")}</TableHead><TableHead>{t("sourceRows")}</TableHead><TableHead>{t("duplicateRows")}</TableHead><TableHead>{t("errorRows")}</TableHead><TableHead>{t("insertedRows")}</TableHead><TableHead>{t("batchId")}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{recentBatches.map((item) => <TableRow key={item.batchId}>
                <TableCell className="whitespace-nowrap">{formatAt(item.createdAt)}</TableCell><TableCell>{item.batchLabel || item.fileName}</TableCell><TableCell><Badge variant={item.status === "completed" ? "secondary" : item.errors > 0 ? "danger" : "outline"}>{t(`batchStatus_${item.status}`)}</Badge></TableCell><TableCell>{item.total}</TableCell><TableCell>{item.duplicates}</TableCell><TableCell className={item.errors > 0 ? "text-rose" : undefined}>{item.errors}</TableCell><TableCell>{item.inserted}</TableCell><TableCell className="font-mono text-xs text-muted">{item.batchId.slice(0, 8)}</TableCell><TableCell className="text-right">{item.status === "validated" ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openBatchRun.run(item.batchId)}>{t("openBatch")}</Button> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </DashboardTableShell>
        )}
      </DashboardSection>
    </div>
  );
}
