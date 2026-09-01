"use client";

import { ArrowRight, CheckCircle2, Download, FileSearch, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import { applyStudentImportAction, previewStudentImportAction } from "./actions/students";
import {
  STUDENT_IMPORT_TEMPLATE_VERSION,
  type ImportStudentRow,
  type StudentImportBatchResult,
  type StudentImportBatchSummary,
} from "./actions/types";
import { DashboardSection, DashboardTableShell, StatusStrip } from "./dashboard-page";

interface PreviewRow extends ImportStudentRow {
  line: number;
  gradeText: string;
  errors: string[];
}

const HEADER_NAMES = new Set(["姓名", "name"]);
const CSV_HEADERS = ["name", "phone", "grade", "region", "source", "remark"];

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseInput(text: string): PreviewRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows: PreviewRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    const cells = splitLine(raw, raw.includes("\t") ? "\t" : ",");
    if (rows.length === 0 && HEADER_NAMES.has((cells[0] ?? "").trim().toLowerCase())) continue;
    const [name = "", phone = "", gradeText = "", region = "", source = "", remark = ""] = cells;
    const grade = gradeText.trim() === "" ? null : Number(gradeText);
    const errors: string[] = [];
    if (!name.trim()) errors.push("EMPTY_NAME");
    if (gradeText.trim() && (!Number.isInteger(grade) || grade! < 1 || grade! > 12)) errors.push("INVALID_GRADE");
    rows.push({
      line: index + 1,
      name: name.trim(),
      phone: phone.trim(),
      grade: gradeText.trim(),
      gradeText: gradeText.trim(),
      region: region.trim(),
      source: source.trim(),
      remark: [remark, ...cells.slice(6)].filter(Boolean).join(",").trim(),
      errors,
    });
  }
  return rows;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", body], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function nextIdempotencyKey() {
  return newId();
}

export function ImportStudentsPanel({ recentBatches }: { recentBatches: StudentImportBatchSummary[] }) {
  const t = useTranslations("school.students");
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [batchSource, setBatchSource] = useState("");
  const [fileError, setFileError] = useState(false);
  const [batch, setBatch] = useState<StudentImportBatchResult | null>(null);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(nextIdempotencyKey);
  const rows = useMemo(() => parseInput(text), [text]);
  const serverRows = useMemo(() => new Map(batch?.rows.map((row) => [row.row, row]) ?? []), [batch]);
  const missingSource = rows.some((row) => !row.source) && !batchSource.trim();

  const importErrors = {
    default: t("importFailed"),
    IDEMPOTENCY_CONFLICT: t("importIdempotencyConflict"),
    BATCH_HAS_ERRORS: t("importBatchHasErrors"),
    BATCH_EXPIRED: t("importBatchExpired"),
  };
  const { run: preview, pending: previewPending } = useAction(previewStudentImportAction, {
    successMessage: t("importPreviewSuccess"),
    errorMessage: importErrors,
    onSuccess: (next) => {
      setBatch(next);
      setDuplicatesReviewed(false);
    },
  });
  const { run: apply, pending: applyPending } = useAction(applyStudentImportAction, {
    successMessage: t("importSuccessToast"),
    errorMessage: importErrors,
    onSuccess: (next) => {
      setBatch(next);
      router.refresh();
    },
  });
  const pending = previewPending || applyPending;

  const resetBatch = () => {
    setBatch(null);
    setDuplicatesReviewed(false);
    setIdempotencyKey(nextIdempotencyKey());
  };
  const changeText = (value: string) => {
    setText(value);
    resetBatch();
  };
  const changeBatchSource = (value: string) => {
    setBatchSource(value);
    resetBatch();
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const value = await file.text();
      setFileName(file.name);
      setFileError(false);
      changeText(value);
    } catch {
      setFileError(true);
    }
  };
  const startPreview = () => preview({
    templateVersion: STUDENT_IMPORT_TEMPLATE_VERSION,
    idempotencyKey,
    rows: rows.map((row) => ({
      name: row.name,
      phone: row.phone,
      grade: row.gradeText || null,
      region: row.region,
      source: row.source || batchSource.trim(),
      remark: row.remark,
    })),
  });
  const downloadTemplate = () => downloadCsv(`mathin-students-v1.csv`, [CSV_HEADERS]);
  const downloadErrors = () => {
    if (!batch) return;
    const findings = batch.rows.filter((row) => row.status === "error");
    downloadCsv(`student-import-${batch.batchId}-errors.csv`, [
      ["line", "status", "error_codes", ...CSV_HEADERS],
      ...findings.map((finding) => {
        const source = rows[finding.row - 1];
        return [
          source?.line ?? finding.row,
          finding.status,
          finding.errors.join("|"),
          source?.name ?? "",
          source?.phone ?? "",
          source?.gradeText ?? "",
          source?.region ?? "",
          source?.source || batchSource.trim(),
          source?.remark ?? "",
        ];
      }),
    ]);
  };
  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

  return (
    <div className="space-y-10">
      <DashboardSection
        title={t("importStepInput")}
        description={t("importInputDescription")}
        actions={
          <Button type="button" size="sm" variant="secondary" onClick={downloadTemplate}>
            <Download size={15} />
            {t("downloadImportTemplate")}
          </Button>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-0">
          <div className="min-w-0 space-y-4 lg:pr-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("importFile")}
                <Input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  onChange={(event) => void readFile(event.currentTarget.files?.[0])}
                />
                <span>{fileName || t("importFileHint")}</span>
              </Label>
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("importBatchSource")}
                <Input
                  value={batchSource}
                  onChange={(event) => changeBatchSource(event.target.value)}
                  maxLength={100}
                  placeholder={t("importBatchSourcePlaceholder")}
                />
                <span>{t("importBatchSourceHint")}</span>
              </Label>
            </div>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("pasteData")}
              <Textarea
                value={text}
                onChange={(event) => changeText(event.target.value)}
                rows={9}
                spellCheck={false}
                placeholder={t("importPlaceholder")}
                className="resize-y font-mono text-xs"
              />
            </Label>
            {fileError ? <p role="alert" className="text-xs text-rose">{t("importFileError")}</p> : null}
            {missingSource ? <p role="alert" className="text-xs text-rose">{t("importMissingSource")}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted">{t("importLimit", { count: rows.length })}</span>
              <Button
                type="button"
                size="sm"
                disabled={pending || rows.length === 0 || rows.length > 500 || missingSource}
                onClick={startPreview}
              >
                {previewPending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <FileSearch size={15} />}
                {t("dryRunImport")}
              </Button>
            </div>
          </div>
          <aside className="min-w-0 lg:border-l lg:border-line lg:pl-6">
            <h3 className="text-sm font-medium text-ink">{t("importFieldsTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{t("importFieldsHint")}</p>
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="font-medium text-ink">{t("importRequiredFields")}</dt>
                <dd className="mt-0.5 leading-5 text-muted">name · source</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">{t("importOptionalFields")}</dt>
                <dd className="mt-0.5 leading-5 text-muted">phone · grade · region · remark</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">{t("importDuplicateRule")}</dt>
                <dd className="mt-0.5 leading-5 text-muted">{t("importDuplicateRuleHint")}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </DashboardSection>

      {rows.length > 0 ? (
        <DashboardSection title={t("preview")} description={t("importPreviewDescription")}>
          <StatusStrip
            className="mb-3"
            items={[
              { label: t("importRowsCount"), value: rows.length },
              { label: t("importBatchSource"), value: batchSource.trim() || t("importSourcePerRow") },
              { label: t("importTemplateVersion", { version: STUDENT_IMPORT_TEMPLATE_VERSION }), value: fileName || t("pasteData") },
            ]}
          />
          <DashboardTableShell>
            <Table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <TableHeader className="sticky top-0 bg-card text-muted">
                <TableRow>
                  {["line", "name", "phone", "gradeCol", "region", "source", "remark", "validation"].map((key) => (
                    <TableHead key={key} className="px-3 py-2 font-medium">{t(key)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const serverRow = serverRows.get(index + 1);
                  const rowErrors = serverRow?.errors ?? row.errors;
                  const rowStatus = serverRow?.status ?? (rowErrors.length > 0 ? "error" : "valid");
                  return (
                    <TableRow key={row.line} className={rowStatus === "error" ? "bg-rose/5" : undefined}>
                      <TableCell className="px-3 py-2 font-mono text-muted">{row.line}</TableCell>
                      <TableCell className="px-3 py-2 font-medium">{row.name || "—"}</TableCell>
                      <TableCell className="px-3 py-2">{row.phone || "—"}</TableCell>
                      <TableCell className="px-3 py-2">{row.gradeText || "—"}</TableCell>
                      <TableCell className="px-3 py-2">{row.region || "—"}</TableCell>
                      <TableCell className="px-3 py-2">{row.source || batchSource.trim() || "—"}</TableCell>
                      <TableCell className="max-w-52 truncate px-3 py-2">{row.remark || "—"}</TableCell>
                      <TableCell className={cn("px-3 py-2", rowStatus === "error" || rowStatus === "duplicate" ? "text-rose" : "text-muted")}>
                        {rowErrors.length > 0
                          ? rowErrors.map((code) => t(`importError_${code}`)).join("；")
                          : t(`importRowStatus_${rowStatus}`)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DashboardTableShell>
        </DashboardSection>
      ) : null}

      {batch ? (
        <DashboardSection
          title={t("importDryRunResult")}
          description={t("importDryRunCounts", { total: batch.total, valid: batch.valid })}
          actions={
            batch.errorCount > 0 ? (
              <Button type="button" size="sm" variant="secondary" onClick={downloadErrors}>
                <Download size={15} />
                {t("downloadImportErrors")}
              </Button>
            ) : undefined
          }
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={batch.errorCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>
              {t(`importBatchStatus_${batch.status}`)}
            </Badge>
            <span className="font-mono text-xs text-muted">{batch.batchId}</span>
          </div>
          <StatusStrip
            className="mt-3"
            items={[
              { label: t("importRowsCount"), value: batch.total },
              { label: t("valid"), value: batch.valid },
              { label: t("importDuplicates"), value: batch.dup, tone: batch.dup > 0 ? "warning" : "default" },
              { label: t("importErrors"), value: batch.errorCount, tone: batch.errorCount > 0 ? "critical" : "default" },
              { label: t("importWrittenCount"), value: batch.inserted },
            ]}
          />
          {batch.errorCount > 0 ? <p role="alert" className="mt-3 text-sm text-rose">{t("importBatchHasErrors")}</p> : null}
          {batch.status === "validated" && batch.errorCount === 0 ? (
            <div className="mt-4 flex min-w-0 flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
              <div className="min-w-0 flex-1">
                {batch.dup > 0 ? (
                  <Label className="flex max-w-2xl items-start gap-2 text-xs font-normal leading-5 text-muted">
                    <Checkbox
                      checked={duplicatesReviewed}
                      onCheckedChange={(checked) => setDuplicatesReviewed(checked === true)}
                      className="mt-0.5"
                    />
                    <span>{t("importDuplicateReview", { count: batch.dup })}</span>
                  </Label>
                ) : <p className="text-xs text-muted">{t("importApplyHint")}</p>}
              </div>
              <Button type="button" disabled={pending || (batch.dup > 0 && !duplicatesReviewed)} onClick={() => apply(batch.batchId)}>
                {applyPending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}
                {t("applyImport")}
              </Button>
            </div>
          ) : null}
          {batch.status === "completed" ? (
            <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm text-leaf-deep">
                <CheckCircle2 size={16} />
                {t("importCompleted", { count: batch.inserted })}
              </p>
              <Link href="/dashboard/followups" className={buttonVariants({ size: "sm" })}>
                {t("openLeadWorkspace")}
                <ArrowRight size={15} />
              </Link>
            </div>
          ) : null}
        </DashboardSection>
      ) : null}

      <DashboardSection title={t("recentImportBatches")} description={t("recentImportBatchesHint")}>
        {recentBatches.length === 0 ? (
          <div className="grid min-h-28 place-items-center text-sm text-muted">{t("recentImportEmpty")}</div>
        ) : (
          <DashboardTableShell>
            <Table className="w-full min-w-[44rem] text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("importCreatedAt")}</TableHead>
                  <TableHead>{t("importStatus")}</TableHead>
                  <TableHead>{t("importRowsCount")}</TableHead>
                  <TableHead>{t("importDuplicates")}</TableHead>
                  <TableHead>{t("importErrors")}</TableHead>
                  <TableHead>{t("importWrittenCount")}</TableHead>
                  <TableHead>{t("importBatchId")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBatches.map((item) => (
                  <TableRow key={item.batchId}>
                    <TableCell className="whitespace-nowrap">{formatAt(item.createdAt)}</TableCell>
                    <TableCell><Badge variant={item.status === "completed" ? "secondary" : "outline"}>{t(`importBatchStatus_${item.status}`)}</Badge></TableCell>
                    <TableCell>{item.total}</TableCell>
                    <TableCell>{item.duplicates}</TableCell>
                    <TableCell className={item.errors > 0 ? "text-rose" : undefined}>{item.errors}</TableCell>
                    <TableCell>{item.inserted}</TableCell>
                    <TableCell className="font-mono text-xs text-muted">{item.batchId.slice(0, 8)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DashboardTableShell>
        )}
      </DashboardSection>

      <div className="flex justify-end">
        <Link href="/dashboard/followups" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          <FileSpreadsheet size={15} />
          {t("openLeadWorkspace")}
        </Link>
      </div>
    </div>
  );
}
