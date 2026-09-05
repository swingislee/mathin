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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { sha256Hex } from "@/lib/sha256";
import { newId } from "@/lib/uuid";
import {
  applyMofaxiaoStudentImportAction,
  getMofaxiaoStudentImportBatchAction,
  previewMofaxiaoStudentImportAction,
} from "./actions/mofaxiao-student-imports";
import {
  MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION,
  type MofaxiaoStudentImportBatchRow,
  type MofaxiaoStudentImportBatchResult,
  type MofaxiaoStudentImportBatchSummary,
} from "./actions/types";
import {
  DashboardSection,
  DashboardTableColumnHeader,
  DashboardTableShell,
  StatusStrip,
  type DashboardTableColumnDefinition,
  useDashboardTableView,
} from "./dashboard-page";
import {
  MofaxiaoParseError,
  parseMofaxiaoWorksheet,
  type ParsedMofaxiaoWorksheet,
} from "./mofaxiao-student-import";

const PREVIEW_LIMIT = 100;
const EMPTY_VALUE = "$empty";

type PreviewColumn = "sourceRow" | "sourceId" | "student" | "phone" | "grade" | "school" | "parent" | "market" | "validation";
type IssueColumn = "sourceRow" | "student" | "result" | "reason";
type BatchColumn = "createdAt" | "label" | "status" | "total" | "duplicates" | "errors" | "inserted" | "batchId";

interface PreviewEntry {
  ordinal: number;
  row: ParsedMofaxiaoWorksheet["rows"][number];
}

function filenameLabel(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "").slice(0, 160);
}

export function MofaxiaoStudentImportPanel({
  recentBatches,
}: {
  recentBatches: MofaxiaoStudentImportBatchSummary[];
}) {
  const t = useTranslations("school.students.mofaxiao");
  const tableT = useTranslations("school.table");
  const locale = useLocale();
  const formatAt = useMemo(() => (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value)), [locale]);
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileHash, setFileHash] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [parsed, setParsed] = useState<ParsedMofaxiaoWorksheet | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [batch, setBatch] = useState<MofaxiaoStudentImportBatchResult | null>(null);
  const [duplicatesConfirmed, setDuplicatesConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newId);

  const resetServerBatch = () => {
    setBatch(null);
    setDuplicatesConfirmed(false);
    setIdempotencyKey(newId());
  };

  const previewRows = useMemo<PreviewEntry[]>(
    () => (parsed?.rows.slice(0, PREVIEW_LIMIT) ?? []).map((row, index) => ({ row, ordinal: index + 1 })),
    [parsed],
  );
  const rowByOrdinal = useMemo(() => new Map(parsed?.rows.map((row, index) => [index + 1, row]) ?? []), [parsed]);
  const serverRowByOrdinal = useMemo(() => new Map(batch?.rows.map((row) => [row.row, row]) ?? []), [batch]);
  const maskedPhones = useMemo(() => (parsed?.rows ?? []).filter((row) => row.phoneMasked || row.parentPhoneMasked).length, [parsed]);
  const previewColumns = useMemo<Record<PreviewColumn, DashboardTableColumnDefinition<PreviewEntry>>>(() => ({
    sourceRow: {
      filterValues: ({ row }) => ({ value: String(row.sourceRow), label: String(row.sourceRow) }),
      sortValue: ({ row }) => row.sourceRow,
    },
    sourceId: {
      filterValues: ({ row }) => ({ value: row.externalStudentId || EMPTY_VALUE, label: row.externalStudentId || tableT("emptyValue") }),
      sortValue: ({ row }) => row.externalStudentId,
    },
    student: {
      filterValues: ({ row }) => [
        {
          value: row.name ? `name:${row.name}` : `name:${EMPTY_VALUE}`,
          label: row.name || tableT("emptyValue"),
          group: tableT("fieldName"),
        },
        ...(row.gender
          ? [{ value: `gender:${row.gender}`, label: row.gender, group: tableT("fieldGender") }]
          : []),
      ],
      sortValue: ({ row }) => row.name,
    },
    phone: {
      filterValues: ({ row }) => row.phoneMasked
        ? { value: "masked", label: t("maskedNotImported") }
        : { value: row.phone || EMPTY_VALUE, label: row.phone || tableT("emptyValue") },
      sortValue: ({ row }) => row.phoneMasked ? null : row.phone,
    },
    grade: {
      filterValues: ({ row }) => ({ value: row.gradeText || EMPTY_VALUE, label: row.gradeText || tableT("emptyValue") }),
      sortValue: ({ row }) => row.grade,
    },
    school: {
      filterValues: ({ row }) => [
        {
          value: row.school ? `school:${row.school}` : `school:${EMPTY_VALUE}`,
          label: row.school || tableT("emptyValue"),
          group: tableT("fieldSchool"),
        },
        ...(row.publicSchoolClass
          ? [{ value: `class:${row.publicSchoolClass}`, label: row.publicSchoolClass, group: tableT("fieldClass") }]
          : []),
      ],
      sortValue: ({ row }) => `${row.school}\u0000${row.publicSchoolClass}`,
    },
    parent: {
      filterValues: ({ row }) => [
        {
          value: row.parentName ? `parent-name:${row.parentName}` : `parent-name:${EMPTY_VALUE}`,
          label: row.parentName || tableT("emptyValue"),
          group: tableT("fieldName"),
        },
        {
          value: row.parentPhoneMasked
            ? "parent-phone:masked"
            : row.parentPhone
              ? `parent-phone:${row.parentPhone}`
              : `parent-phone:${EMPTY_VALUE}`,
          label: row.parentPhoneMasked ? t("maskedNotImported") : row.parentPhone || tableT("emptyValue"),
          group: tableT("fieldPhone"),
        },
      ],
      sortValue: ({ row }) => row.parentName,
    },
    market: {
      filterValues: ({ row }) => ({ value: row.marketActivity || EMPTY_VALUE, label: row.marketActivity || tableT("emptyValue") }),
      sortValue: ({ row }) => row.marketActivity,
    },
    validation: {
      filterValues: ({ ordinal }) => {
        const status = serverRowByOrdinal.get(ordinal)?.status;
        return { value: status ?? "not_checked", label: status ? t(`status_${status}`) : t("notChecked") };
      },
      sortValue: ({ ordinal }) => serverRowByOrdinal.get(ordinal)?.status ?? "not_checked",
    },
  }), [serverRowByOrdinal, t, tableT]);
  const previewTable = useDashboardTableView({ rows: previewRows, columns: previewColumns, locale });
  const issueRows = useMemo(
    () => (batch?.rows ?? []).filter((row) => row.status !== "valid" && row.status !== "inserted"),
    [batch],
  );
  const issueColumns = useMemo<Record<IssueColumn, DashboardTableColumnDefinition<MofaxiaoStudentImportBatchRow>>>(() => ({
    sourceRow: {
      filterValues: (row) => {
        const value = rowByOrdinal.get(row.row)?.sourceRow ?? row.sourceRow;
        return { value: String(value), label: String(value) };
      },
      sortValue: (row) => rowByOrdinal.get(row.row)?.sourceRow ?? row.sourceRow,
    },
    student: {
      filterValues: (row) => {
        const value = rowByOrdinal.get(row.row)?.name || row.sourceName;
        return { value: value || EMPTY_VALUE, label: value || tableT("emptyValue") };
      },
      sortValue: (row) => rowByOrdinal.get(row.row)?.name || row.sourceName,
    },
    result: {
      filterValues: (row) => ({ value: row.status, label: t(`status_${row.status}`) }),
      sortValue: (row) => row.status,
    },
    reason: {
      filterValues: (row) => row.errors.length > 0
        ? row.errors.map((code) => ({ value: code, label: t(`error_${code}`) }))
        : { value: EMPTY_VALUE, label: tableT("emptyValue") },
      sortValue: (row) => row.errors.join("|"),
    },
  }), [rowByOrdinal, t, tableT]);
  const issueTable = useDashboardTableView({ rows: issueRows, columns: issueColumns, locale });
  const batchColumns = useMemo<Record<BatchColumn, DashboardTableColumnDefinition<MofaxiaoStudentImportBatchSummary>>>(() => ({
    createdAt: {
      filterValues: (item) => ({ value: item.createdAt.slice(0, 10), label: formatAt(item.createdAt) }),
      sortValue: (item) => item.createdAt,
    },
    label: {
      filterValues: (item) => ({ value: item.batchLabel || item.fileName, label: item.batchLabel || item.fileName }),
      sortValue: (item) => item.batchLabel || item.fileName,
    },
    status: {
      filterValues: (item) => ({ value: item.status, label: t(`batchStatus_${item.status}`) }),
      sortValue: (item) => item.status,
    },
    total: {
      filterValues: (item) => ({ value: String(item.total), label: String(item.total) }),
      sortValue: (item) => item.total,
    },
    duplicates: {
      filterValues: (item) => ({ value: String(item.duplicates), label: String(item.duplicates) }),
      sortValue: (item) => item.duplicates,
    },
    errors: {
      filterValues: (item) => ({ value: String(item.errors), label: String(item.errors) }),
      sortValue: (item) => item.errors,
    },
    inserted: {
      filterValues: (item) => ({ value: String(item.inserted), label: String(item.inserted) }),
      sortValue: (item) => item.inserted,
    },
    batchId: {
      filterValues: (item) => ({ value: item.batchId, label: item.batchId.slice(0, 8) }),
      sortValue: (item) => item.batchId,
    },
  }), [formatAt, t]);
  const batchTable = useDashboardTableView({ rows: recentBatches, columns: batchColumns, locale });

  const errors = {
    default: t("failed"),
    IDEMPOTENCY_CONFLICT: t("idempotencyConflict"),
    BATCH_HAS_ERRORS: t("batchHasErrors"),
    BATCH_EXPIRED: t("batchExpired"),
  };
  const previewRun = useAction(previewMofaxiaoStudentImportAction, {
    successMessage: t("previewSuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setBatch(next);
      setDuplicatesConfirmed(false);
    },
  });
  const openBatchRun = useAction(getMofaxiaoStudentImportBatchAction, {
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
  const applyRun = useAction(applyMofaxiaoStudentImportAction, {
    successMessage: t("applySuccess"),
    errorMessage: errors,
    onSuccess: (next) => {
      setBatch(next);
      router.refresh();
    },
  });
  const pending = reading || previewRun.pending || openBatchRun.pending || applyRun.pending;

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setParseError(null);
    resetServerBatch();
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new MofaxiaoParseError("UNRECOGNIZED_HEADERS");
      const [{ readSheet }, buffer] = await Promise.all([
        import("read-excel-file/browser"),
        file.arrayBuffer(),
      ]);
      const worksheet = await readSheet(file);
      const [next, hash] = await Promise.all([
        Promise.resolve(parseMofaxiaoWorksheet(worksheet)),
        sha256Hex(buffer),
      ]);
      setFileName(file.name);
      setFileHash(hash);
      setBatchLabel(filenameLabel(file.name));
      setParsed(next);
    } catch (error) {
      setFileName(file.name);
      setFileHash("");
      setParsed(null);
      setParseError(error instanceof MofaxiaoParseError ? error.code : "READ_FAILED");
    } finally {
      setReading(false);
    }
  };

  const startPreview = () => {
    if (!parsed || !fileHash) return;
    previewRun.run({
      templateVersion: MOFAXIAO_STUDENT_IMPORT_TEMPLATE_VERSION,
      idempotencyKey,
      fileName,
      fileHash,
      sheetName: "Worksheet",
      batchLabel,
      rows: parsed.rows,
    });
  };

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
            {parseError ? <p role="alert" className="text-sm text-rose">{t(`parse_${parseError}`)}</p> : null}
            {parsed ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">{t("recognized", { count: parsed.rows.length, header: parsed.headerRow })}</span>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !batchLabel.trim() || parsed.rows.length === 0 || parsed.rows.length > 5_000}
                  onClick={startPreview}
                >
                  {previewRun.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <FileSearch size={15} />}
                  {t("dryRun")}
                </Button>
              </div>
            ) : null}
          </div>
          <aside className="min-w-0 lg:border-l lg:border-line lg:pl-6">
            <h3 className="flex items-center gap-2 text-sm font-medium text-ink"><ShieldCheck size={16} />{t("mappingTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{t("mappingDescription")}</p>
            <dl className="mt-4 space-y-3 text-xs">
              <div><dt className="font-medium text-ink">{t("included")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("includedHint")}</dd></div>
              <div><dt className="font-medium text-ink">{t("ignored")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("ignoredHint")}</dd></div>
              <div><dt className="font-medium text-ink">{t("privacy")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("privacyHint")}</dd></div>
              <div><dt className="font-medium text-ink">{t("notCreated")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("notCreatedHint")}</dd></div>
            </dl>
          </aside>
        </div>
      </DashboardSection>

      {parsed ? (
        <DashboardSection title={t("previewTitle")} description={t("previewDescription")}>
          <StatusStrip
            className="mb-3"
            items={[
              { label: t("rows"), value: parsed.rows.length },
              { label: t("recognizedFields"), value: parsed.recognizedHeaders.length },
              { label: t("maskedPhones"), value: maskedPhones, tone: maskedPhones > 0 ? "warning" : "default" },
            ]}
          />
          <DashboardTableShell>
            <Table className="w-full min-w-[76rem] text-xs">
              <TableHeader><TableRow>
                <TableHead><DashboardTableColumnHeader label={t("sourceRow")} {...previewTable.columnProps("sourceRow")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("sourceId")} {...previewTable.columnProps("sourceId")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("student")} {...previewTable.columnProps("student")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("phone")} {...previewTable.columnProps("phone")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("grade")} {...previewTable.columnProps("grade")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("schoolAndClass")} {...previewTable.columnProps("school")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("parent")} {...previewTable.columnProps("parent")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("marketActivity")} {...previewTable.columnProps("market")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("validation")} {...previewTable.columnProps("validation")} /></TableHead>
              </TableRow></TableHeader>
              <TableBody>{previewTable.visibleRows.map(({ row, ordinal }) => <TableRow key={`${row.sourceRow}-${row.externalStudentId}-${ordinal}`}>
                <TableCell className="font-mono text-muted">{row.sourceRow}</TableCell>
                <TableCell className="font-mono">{row.externalStudentId || "—"}</TableCell>
                <TableCell><span className="font-medium">{row.name || "—"}</span><span className="ml-2 text-muted">{row.gender}</span></TableCell>
                <TableCell>{row.phoneMasked ? <span className="text-amber-700 dark:text-amber-300">{t("maskedNotImported")}</span> : row.phone || "—"}</TableCell>
                <TableCell>{row.gradeText || "—"}</TableCell>
                <TableCell><span>{row.school || "—"}</span>{row.publicSchoolClass ? <span className="ml-2 text-muted">{row.publicSchoolClass}</span> : null}</TableCell>
                <TableCell><span>{row.parentName || "—"}</span>{row.parentPhoneMasked ? <span className="ml-2 text-amber-700 dark:text-amber-300">{t("maskedNotImported")}</span> : row.parentPhone ? <span className="ml-2 text-muted">{row.parentPhone}</span> : null}</TableCell>
                <TableCell>{row.marketActivity || "—"}</TableCell>
                <TableCell>{serverStatus(ordinal)}</TableCell>
              </TableRow>)}
              {previewTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
            </Table>
          </DashboardTableShell>
          {parsed.rows.length > PREVIEW_LIMIT ? <p className="mt-2 text-xs text-muted">{t("previewLimited", { count: PREVIEW_LIMIT, total: parsed.rows.length })}</p> : null}
        </DashboardSection>
      ) : null}

      {batch ? (
        <DashboardSection title={t("dryRunTitle")} description={t("dryRunDescription", { file: batch.fileName })}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={batch.errorCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>{t(`batchStatus_${batch.status}`)}</Badge>
            <span className="font-mono text-xs text-muted">{batch.batchId}</span>
          </div>
          <StatusStrip
            className="mt-3"
            items={[
              { label: t("rows"), value: batch.total },
              { label: t("ready"), value: batch.valid },
              { label: t("duplicates"), value: batch.dup, tone: batch.dup > 0 ? "warning" : "default" },
              { label: t("errors"), value: batch.errorCount, tone: batch.errorCount > 0 ? "critical" : "default" },
              { label: t("inserted"), value: batch.inserted },
            ]}
          />

          {issueRows.length > 0 ? (
            <DashboardTableShell className="mt-5">
              <Table className="w-full min-w-[54rem] text-xs">
                <TableHeader><TableRow>
                  <TableHead><DashboardTableColumnHeader label={t("sourceRow")} {...issueTable.columnProps("sourceRow")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("student")} {...issueTable.columnProps("student")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("result")} {...issueTable.columnProps("result")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("reason")} {...issueTable.columnProps("reason")} /></TableHead>
                </TableRow></TableHeader>
                <TableBody>{issueTable.visibleRows.map((row) => {
                  const source = rowByOrdinal.get(row.row);
                  return <TableRow key={row.row}>
                    <TableCell className="font-mono text-muted">{source?.sourceRow ?? row.sourceRow}</TableCell>
                    <TableCell className="font-medium">{source?.name || row.sourceName || "—"}</TableCell>
                    <TableCell>{t(`status_${row.status}`)}</TableCell>
                    <TableCell className={row.status === "error" ? "text-rose" : "text-muted"}>{row.errors.map((code) => t(`error_${code}`)).join("；")}</TableCell>
                  </TableRow>;
                })}
                {issueTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
              </Table>
            </DashboardTableShell>
          ) : null}

          {batch.status === "validated" ? (
            <div className="mt-5 space-y-4 border-t border-line pt-4">
              {batch.dup > 0 ? (
                <Label className="flex items-start gap-2 text-sm font-normal text-ink">
                  <Checkbox checked={duplicatesConfirmed} disabled={pending} onCheckedChange={(checked) => setDuplicatesConfirmed(checked === true)} />
                  <span>{t("confirmDuplicates", { count: batch.dup })}</span>
                </Label>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs text-muted">{batch.errorCount > 0 ? t("applyBlocked", { count: batch.errorCount }) : t("applyHint")}</p>
                <Button type="button" disabled={pending || batch.errorCount > 0 || (batch.dup > 0 && !duplicatesConfirmed)} onClick={() => applyRun.run(batch.batchId)}>
                  {applyRun.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}
                  {t("apply")}
                </Button>
              </div>
            </div>
          ) : null}

          {batch.status === "completed" ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm text-leaf-deep"><CheckCircle2 size={16} />{t("completed", { inserted: batch.inserted, duplicates: batch.dup })}</p>
              <Link href="/dashboard/students" className={buttonVariants({ size: "sm" })}>{t("openStudents")}<ArrowRight size={15} /></Link>
            </div>
          ) : null}
        </DashboardSection>
      ) : null}

      <DashboardSection title={t("recentTitle")} description={t("recentDescription")}>
        {recentBatches.length === 0 ? <div className="grid min-h-28 place-items-center text-sm text-muted">{t("recentEmpty")}</div> : (
          <DashboardTableShell>
            <Table className="w-full min-w-[58rem] text-sm">
              <TableHeader><TableRow>
                <TableHead><DashboardTableColumnHeader label={t("createdAt")} {...batchTable.columnProps("createdAt")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("batchLabel")} {...batchTable.columnProps("label")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("statusLabel")} {...batchTable.columnProps("status")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("rows")} {...batchTable.columnProps("total")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("duplicates")} {...batchTable.columnProps("duplicates")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("errors")} {...batchTable.columnProps("errors")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("inserted")} {...batchTable.columnProps("inserted")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("batchId")} {...batchTable.columnProps("batchId")} /></TableHead>
                <TableHead />
              </TableRow></TableHeader>
              <TableBody>{batchTable.visibleRows.map((item) => <TableRow key={item.batchId}>
                <TableCell className="whitespace-nowrap">{formatAt(item.createdAt)}</TableCell><TableCell>{item.batchLabel || item.fileName}</TableCell><TableCell><Badge variant={item.status === "completed" ? "secondary" : item.errors > 0 ? "danger" : "outline"}>{t(`batchStatus_${item.status}`)}</Badge></TableCell><TableCell>{item.total}</TableCell><TableCell>{item.duplicates}</TableCell><TableCell className={item.errors > 0 ? "text-rose" : undefined}>{item.errors}</TableCell><TableCell>{item.inserted}</TableCell><TableCell className="font-mono text-xs text-muted">{item.batchId.slice(0, 8)}</TableCell><TableCell className="text-right">{item.status === "validated" ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openBatchRun.run(item.batchId)}>{t("openBatch")}</Button> : null}</TableCell>
              </TableRow>)}
              {batchTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
            </Table>
          </DashboardTableShell>
        )}
      </DashboardSection>
    </div>
  );
}
