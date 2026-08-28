"use client";

import { CheckCircle2, Download, FileSearch, LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { applyStudentImportAction, previewStudentImportAction } from "./actions/students";
import { DashboardTableShell } from "./dashboard-page";
import {
  STUDENT_IMPORT_TEMPLATE_VERSION,
  type ImportStudentRow,
  type StudentImportBatchResult,
} from "./actions/types";

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
  return globalThis.crypto.randomUUID();
}

export function ImportStudentsPanel() {
  const t = useTranslations("school.students");
  const [text, setText] = useState("");
  const [batch, setBatch] = useState<StudentImportBatchResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(nextIdempotencyKey);
  const rows = useMemo(() => parseInput(text), [text]);

  const importErrors = {
    default: t("importFailed"),
    IDEMPOTENCY_CONFLICT: t("importIdempotencyConflict"),
    BATCH_HAS_ERRORS: t("importBatchHasErrors"),
    BATCH_EXPIRED: t("importBatchExpired"),
  };
  const { run: preview, pending: previewPending } = useAction(previewStudentImportAction, {
    successMessage: t("importPreviewSuccess"),
    errorMessage: importErrors,
    onSuccess: setBatch,
  });
  const { run: apply, pending: applyPending } = useAction(applyStudentImportAction, {
    successMessage: t("importSuccessToast"),
    errorMessage: importErrors,
    onSuccess: setBatch,
  });
  const pending = previewPending || applyPending;

  const changeText = (value: string) => {
    setText(value);
    setBatch(null);
    setIdempotencyKey(nextIdempotencyKey());
  };
  const startPreview = () => preview({
    templateVersion: STUDENT_IMPORT_TEMPLATE_VERSION,
    idempotencyKey,
    rows: rows.map((row) => ({
      name: row.name,
      phone: row.phone,
      grade: row.gradeText || null,
      region: row.region,
      source: row.source,
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
          source?.source ?? "",
          source?.remark ?? "",
        ];
      }),
    ]);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-ink">{t("importStepInput")}</h2>
            <p className="mt-1 text-xs text-muted">{t("importTemplateVersion", { version: STUDENT_IMPORT_TEMPLATE_VERSION })}</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={downloadTemplate}>
            <Download size={15} />
            {t("downloadImportTemplate")}
          </Button>
        </div>
        <Label className="mt-4 grid gap-2 text-sm font-medium">
          {t("pasteData")}
          <Textarea
            value={text}
            onChange={(event) => changeText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={t("importPlaceholder")}
            className="resize-y font-mono text-xs"
          />
        </Label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span>{t("importLimit", { count: rows.length })}</span>
          <Button type="button" size="sm" disabled={pending || rows.length === 0 || rows.length > 500} onClick={startPreview}>
            {previewPending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <FileSearch size={15} />}
            {t("dryRunImport")}
          </Button>
        </div>
      </section>

      {rows.length > 0 && (
        <DashboardTableShell>
          <div className="border-b border-line px-4 py-3 text-sm font-medium">{t("preview")}</div>
          <div className="max-h-96 overflow-auto">
            <Table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <TableHeader className="sticky top-0 bg-card text-muted">
                <TableRow>{["line", "name", "phone", "gradeCol", "region", "source", "remark", "validation"].map((key) => <TableHead key={key} className="px-3 py-2 font-medium">{t(key)}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.line} className={row.errors.length ? "bg-rose/5" : undefined}>
                    <TableCell className="px-3 py-2 font-mono text-muted">{row.line}</TableCell>
                    <TableCell className="px-3 py-2 font-medium">{row.name || "—"}</TableCell>
                    <TableCell className="px-3 py-2">{row.phone || "—"}</TableCell>
                    <TableCell className="px-3 py-2">{row.gradeText || "—"}</TableCell>
                    <TableCell className="px-3 py-2">{row.region || "—"}</TableCell>
                    <TableCell className="px-3 py-2">{row.source || "—"}</TableCell>
                    <TableCell className="max-w-52 truncate px-3 py-2">{row.remark || "—"}</TableCell>
                    <TableCell className="px-3 py-2 text-rose">{row.errors.map((code) => t(`importError_${code}`)).join("；") || t("valid")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DashboardTableShell>
      )}

      {batch && (
        <section className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium text-ink">{t("importDryRunResult")}</h2>
                <Badge variant={batch.errorCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>
                  {t(`importBatchStatus_${batch.status}`)}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-muted">{batch.batchId}</p>
            </div>
            {batch.errorCount > 0 && (
              <Button type="button" size="sm" variant="secondary" onClick={downloadErrors}>
                <Download size={15} />
                {t("downloadImportErrors")}
              </Button>
            )}
          </div>
          <p className="mt-4 text-sm">{t("importSummary", { inserted: batch.inserted, dup: batch.dup, errors: batch.errorCount })}</p>
          <p className="mt-1 text-xs text-muted">{t("importDryRunCounts", { total: batch.total, valid: batch.valid })}</p>
          {batch.errorCount > 0 && <p role="alert" className="mt-3 text-sm text-rose">{t("importBatchHasErrors")}</p>}
          <ul className="mt-3 space-y-1 text-xs text-rose">
            {batch.rows.filter((row) => row.status === "error").map((item) => (
              <li key={item.row}>{t("importErrorRow", { row: rows[item.row - 1]?.line ?? item.row, reason: item.errors.map((code) => t(`importError_${code}`)).join("；") })}</li>
            ))}
          </ul>
          {batch.status === "validated" && batch.errorCount === 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-xs text-muted">{t("importApplyHint")}</p>
              <Button type="button" disabled={pending} onClick={() => apply(batch.batchId)}>
                {applyPending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}
                {t("applyImport")}
              </Button>
            </div>
          )}
          {batch.status === "completed" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-leaf-deep"><CheckCircle2 size={16} />{t("importCompleted", { count: batch.inserted })}</p>
          )}
        </section>
      )}
    </div>
  );
}
