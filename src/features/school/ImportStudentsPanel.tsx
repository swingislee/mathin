"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { LoaderCircle, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/action-form";
import { importStudentsAction, type ImportStudentRow, type ImportStudentsResult } from "./actions";
import { inputClass } from "./controls";

interface PreviewRow extends ImportStudentRow {
  line: number;
  gradeText: string;
  errors: string[];
}

const HEADER_NAMES = new Set(["姓名", "name"]);

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

export function ImportStudentsPanel() {
  const t = useTranslations("school.students");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportStudentsResult | null>(null);
  const rows = useMemo(() => parseInput(text), [text]);

  const { run: submit, pending } = useAction(importStudentsAction, {
    successMessage: t("importSuccessToast"),
    errorMessage: { default: t("importFailed") },
    onSuccess: setResult,
  });
  const startImport = () => {
    setResult(null);
    submit(rows.map((row) => ({
      name: row.name,
      phone: row.phone,
      grade: row.gradeText || null,
      region: row.region,
      source: row.source,
      remark: row.remark,
    })));
  };

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-xl border border-line bg-card p-5">
        <Label className="grid gap-2 text-sm font-medium">
          {t("pasteData")}
          <textarea
            value={text}
            onChange={(event) => { setText(event.target.value); setResult(null); }}
            rows={8}
            spellCheck={false}
            placeholder={t("importPlaceholder")}
            className={`${inputClass} resize-y font-mono text-xs`}
          />
        </Label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <span>{t("importLimit", { count: rows.length })}</span>
          <Button type="button" size="sm" disabled={pending || rows.length === 0 || rows.length > 500} onClick={startImport} className="gap-1.5">
            {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}
            {t("submitImport")}
          </Button>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-line bg-card">
          <div className="border-b border-line px-4 py-3 text-sm font-medium">{t("preview")}</div>
          <div className="max-h-96 overflow-auto">
            <Table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <TableHeader className="sticky top-0 bg-card text-muted">
                <TableRow>{["line", "name", "phone", "gradeCol", "region", "source", "remark", "validation"].map((key) => <TableHead key={key} className="px-3 py-2 font-medium">{t(key)}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-line">
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
        </section>
      )}

      {result && (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-medium">{t("importResult")}</h2>
          <p className="mt-3 text-sm">{t("importSummary", { inserted: result.inserted, dup: result.dup, errors: result.errors.length })}</p>
          {result.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-rose">
              {result.errors.map((item, index) => <li key={`${item.row}-${index}`}>{t("importErrorRow", { row: rows[item.row - 1]?.line ?? item.row, reason: t(`importError_${item.reason}`) })}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
