"use client";

import { CheckCircle2, Download, FileSearch, LoaderCircle, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import { applyStaffImportAction, previewStaffImportAction } from "./actions/staff-imports";
import {
  STAFF_IMPORT_TEMPLATE_VERSION,
  type ImportStaffRow,
  type StaffImportBatchResult,
  type StaffImportBatchSummary,
} from "./actions/types";
import { DashboardSection, DashboardTableShell, StatusStrip } from "./dashboard-page";
import { parseDelimitedText } from "./delimited-text";
import type { StaffRoleInfo } from "./staff";

interface ParsedStaffRow extends ImportStaffRow {
  line: number;
  localErrors: string[];
}

const HEADER_NAMES = new Set(["name", "姓名"]);
const CSV_HEADERS = ["name", "identifier", "roles"];
const ROLE_SPLITTER = /[|,;；，]/;
const EXPIRY_OPTIONS = [1, 7, 14, 30] as const;

function parseRows(text: string, validDays: number): ParsedStaffRow[] {
  const records = parseDelimitedText(text);
  const body = records.length > 0 && HEADER_NAMES.has((records[0].cells[0] ?? "").trim().toLowerCase())
    ? records.slice(1)
    : records;
  return body.map((record) => {
    const name = (record.cells[0] ?? "").trim();
    const identifier = (record.cells[1] ?? "").trim();
    const roleText = record.cells.slice(2).join(",");
    const roles = [...new Set(roleText.split(ROLE_SPLITTER).map((value) => value.trim()).filter(Boolean))];
    const localErrors: string[] = [];
    if (!name) localErrors.push("EMPTY_NAME");
    if (!identifier) localErrors.push("EMPTY_IDENTIFIER");
    if (roles.length === 0) localErrors.push("EMPTY_ROLES");
    return { line: record.line, name, identifier, roles, validDays, localErrors };
  });
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

function downloadCredentialBatch(batch: StaffImportBatchResult) {
  if (!batch.codesAvailable || batch.invitations.length === 0) return;
  downloadCsv(`staff-invitations-${batch.batchId}.csv`, [
    ["name", "identifier_type", "identifier", "roles", "invite_code", "expires_at"],
    ...batch.invitations.map((invite) => [
      invite.name,
      invite.identifierType,
      invite.identifier,
      invite.roleKeys.join("|"),
      invite.inviteCode,
      invite.expiresAt,
    ]),
  ]);
}

export function StaffBulkInvitePanel({
  roles,
  recentBatches,
  isAdmin,
}: {
  roles: StaffRoleInfo[];
  recentBatches: StaffImportBatchSummary[];
  isAdmin: boolean;
}) {
  const t = useTranslations("school.staff");
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState(false);
  const [validDays, setValidDays] = useState(7);
  const [batch, setBatch] = useState<StaffImportBatchResult | null>(null);
  const [duplicatesReviewed, setDuplicatesReviewed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newId);
  const rows = useMemo(() => parseRows(text, validDays), [text, validDays]);
  const serverRows = useMemo(() => new Map(batch?.rows.map((row) => [row.row, row]) ?? []), [batch]);

  const errors = {
    default: t("bulkActionFailed"),
    VALIDATION: t("bulkInvalidInput"),
    IDEMPOTENCY_CONFLICT: t("bulkIdempotencyConflict"),
    BATCH_HAS_ERRORS: t("bulkBatchHasErrors"),
    BATCH_EXPIRED: t("bulkBatchExpired"),
    BATCH_STALE: t("bulkBatchStale"),
  };
  const previewRun = useAction(previewStaffImportAction, {
    successMessage: t("bulkPreviewSuccess"),
    errorMessage: errors,
    onSuccess: (value) => {
      setBatch(value);
      setDuplicatesReviewed(false);
    },
  });
  const applyRun = useAction(applyStaffImportAction, {
    successMessage: t("bulkApplySuccess"),
    errorMessage: errors,
    onSuccess: (value) => {
      setBatch(value);
      downloadCredentialBatch(value);
      router.refresh();
    },
  });
  const pending = previewRun.pending || applyRun.pending;

  const resetBatch = () => {
    setBatch(null);
    setDuplicatesReviewed(false);
    setIdempotencyKey(newId());
  };
  const changeText = (value: string) => {
    setText(value);
    resetBatch();
  };
  const changeExpiry = (value: string) => {
    setValidDays(Number(value));
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
  const startPreview = () => previewRun.run({
    templateVersion: STAFF_IMPORT_TEMPLATE_VERSION,
    idempotencyKey,
    rows: rows.map(({ name, identifier, roles: roleKeys }) => ({
      name,
      identifier,
      roles: roleKeys,
      validDays,
    })),
  });
  const downloadTemplate = () => downloadCsv(`${STAFF_IMPORT_TEMPLATE_VERSION}.csv`, [
    CSV_HEADERS,
    [t("bulkTemplateExampleName"), "teacher@example.com", "teacher|research"],
  ]);
  const downloadErrors = () => {
    if (!batch) return;
    downloadCsv(`staff-import-${batch.batchId}-errors.csv`, [
      ["line", "status", "error_codes", ...CSV_HEADERS],
      ...batch.rows
        .filter((row) => row.status === "error")
        .map((finding) => {
          const source = rows[finding.row - 1];
          return [
            source?.line ?? finding.row,
            finding.status,
            finding.errors.join("|"),
            source?.name ?? "",
            source?.identifier ?? "",
            source?.roles.join("|") ?? "",
          ];
        }),
    ]);
  };
  const downloadCredentials = () => batch && downloadCredentialBatch(batch);
  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  const rowFinding = (index: number, row: ParsedStaffRow) => {
    const server = serverRows.get(index + 1);
    return {
      status: server?.status ?? (row.localErrors.length > 0 ? "error" : "valid"),
      errors: server?.errors ?? row.localErrors,
    };
  };

  return (
    <div className="space-y-10">
      <DashboardSection
        title={t("bulkTitle")}
        description={t("bulkDescription")}
        actions={(
          <Button type="button" size="sm" variant="secondary" onClick={downloadTemplate}>
            <Download size={15} />
            {t("bulkDownloadTemplate")}
          </Button>
        )}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-0">
          <div className="min-w-0 space-y-4 lg:pr-6">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("bulkFile")}
                <Input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                  onChange={(event) => void readFile(event.currentTarget.files?.[0])}
                />
                <span>{fileName || t("bulkFileHint")}</span>
              </Label>
              <Label className="grid gap-1.5 text-xs font-normal text-muted">
                {t("bulkExpiry")}
                <Select value={String(validDays)} onValueChange={changeExpiry}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((days) => (
                      <SelectItem key={days} value={String(days)}>{t("bulkExpiryDays", { days })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>{t("bulkExpiryHint")}</span>
              </Label>
            </div>
            <Label className="grid gap-1.5 text-xs font-normal text-muted">
              {t("bulkPaste")}
              <Textarea
                value={text}
                onChange={(event) => changeText(event.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={t("bulkPlaceholder")}
                className="resize-y font-mono text-xs"
              />
            </Label>
            {fileError ? <p role="alert" className="text-xs text-rose">{t("bulkFileError")}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted">{t("bulkRowLimit", { count: rows.length })}</span>
              <Button
                type="button"
                size="sm"
                disabled={pending || rows.length === 0 || rows.length > 500}
                onClick={startPreview}
              >
                {previewRun.pending
                  ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
                  : <FileSearch size={15} />}
                {t("bulkPreview")}
              </Button>
            </div>
          </div>
          <aside className="min-w-0 lg:border-l lg:border-line lg:pl-6">
            <h3 className="text-sm font-medium text-ink">{t("bulkFieldsTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{t("bulkFieldsHint")}</p>
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="font-medium text-ink">{t("bulkColumns")}</dt>
                <dd className="mt-0.5 font-mono leading-5 text-muted">name · identifier · roles</dd>
              </div>
              <div>
                <dt className="font-medium text-ink">{t("bulkRoleKeys")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {roles.map((role) => (
                    <Badge
                      key={role.id}
                      variant={role.permKeys.includes("permission.configure") && !isAdmin ? "danger" : "secondary"}
                      title={role.name}
                    >
                      {role.key}
                    </Badge>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-ink">{t("bulkSafetyTitle")}</dt>
                <dd className="mt-0.5 leading-5 text-muted">{t("bulkSafetyHint")}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </DashboardSection>

      {rows.length > 0 ? (
        <DashboardSection title={t("bulkRowsTitle")} description={t("bulkRowsHint") }>
          <StatusStrip
            className="mb-3"
            items={[
              { label: t("bulkRows"), value: rows.length },
              { label: t("bulkExpiry"), value: t("bulkExpiryDays", { days: validDays }) },
              { label: t("bulkSource"), value: fileName || t("bulkPaste") },
            ]}
          />
          <DashboardTableShell>
            <Table className="w-full min-w-[760px] text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bulkLine")}</TableHead>
                  <TableHead>{t("colName")}</TableHead>
                  <TableHead>{t("bulkIdentifier")}</TableHead>
                  <TableHead>{t("colRoles")}</TableHead>
                  <TableHead>{t("bulkValidation")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const finding = rowFinding(index, row);
                  return (
                    <TableRow key={`${row.line}-${index}`} className={finding.status === "error" ? "bg-rose/5" : undefined}>
                      <TableCell className="font-mono text-muted">{row.line}</TableCell>
                      <TableCell className="font-medium">{row.name || "—"}</TableCell>
                      <TableCell>{row.identifier || "—"}</TableCell>
                      <TableCell className="font-mono">{row.roles.join(" · ") || "—"}</TableCell>
                      <TableCell className={cn(
                        finding.status === "error" || finding.status === "duplicate" ? "text-rose" : "text-muted",
                      )}>
                        {finding.errors.length > 0
                          ? finding.errors.map((code) => t(`bulkError_${code}`)).join("；")
                          : t(`bulkRowStatus_${finding.status}`)}
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
          title={t("bulkResultTitle")}
          description={t("bulkResultHint")}
          actions={batch.errorCount > 0 ? (
            <Button type="button" size="sm" variant="secondary" onClick={downloadErrors}>
              <Download size={15} />
              {t("bulkDownloadErrors")}
            </Button>
          ) : undefined}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={batch.errorCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>
              {t(`bulkBatchStatus_${batch.status}`)}
            </Badge>
            <span className="font-mono text-xs text-muted">{batch.batchId}</span>
          </div>
          <StatusStrip
            className="mt-3"
            items={[
              { label: t("bulkRows"), value: batch.total },
              { label: t("bulkValid"), value: batch.valid },
              { label: t("bulkDuplicates"), value: batch.dup, tone: batch.dup > 0 ? "warning" : "default" },
              { label: t("bulkErrors"), value: batch.errorCount, tone: batch.errorCount > 0 ? "critical" : "default" },
              { label: t("bulkIssued"), value: batch.issued },
            ]}
          />
          {batch.errorCount > 0 ? (
            <p role="alert" className="mt-3 text-sm text-rose">{t("bulkBatchHasErrors")}</p>
          ) : null}
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
                    <span>{t("bulkDuplicateReview", { count: batch.dup })}</span>
                  </Label>
                ) : <p className="text-xs text-muted">{t("bulkApplyHint")}</p>}
              </div>
              <Button
                type="button"
                disabled={pending || (batch.dup > 0 && !duplicatesReviewed)}
                onClick={() => applyRun.run(batch.batchId)}
              >
                {applyRun.pending
                  ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
                  : <Upload size={15} />}
                {t("bulkApply")}
              </Button>
            </div>
          ) : null}
        </DashboardSection>
      ) : null}

      {batch?.status === "completed" && batch.codesAvailable && batch.invitations.length > 0 ? (
        <DashboardSection
          title={t("bulkCredentialsTitle")}
          description={t("bulkCredentialsWarning")}
          actions={(
            <Button type="button" size="sm" onClick={downloadCredentials}>
              <Download size={15} />
              {t("bulkDownloadCredentials")}
            </Button>
          )}
        >
          <p role="status" className="mb-3 flex items-center gap-2 text-sm text-leaf-deep">
            <CheckCircle2 size={16} />
            {t("bulkCompleted", { count: batch.issued })}
          </p>
          <DashboardTableShell>
            <Table className="w-full min-w-[880px] text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("colName")}</TableHead>
                  <TableHead>{t("bulkIdentifier")}</TableHead>
                  <TableHead>{t("colRoles")}</TableHead>
                  <TableHead>{t("bulkInviteCode")}</TableHead>
                  <TableHead>{t("bulkExpiresAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.invitations.map((invite) => (
                  <TableRow key={`${invite.row}-${invite.identifier}`}>
                    <TableCell className="font-medium">{invite.name}</TableCell>
                    <TableCell>{invite.identifier}</TableCell>
                    <TableCell className="font-mono">{invite.roleKeys.join(" · ")}</TableCell>
                    <TableCell className="font-mono text-sm tracking-wider">{invite.inviteCode}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatAt(invite.expiresAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DashboardTableShell>
        </DashboardSection>
      ) : null}

      <DashboardSection title={t("bulkRecentTitle")} description={t("bulkRecentHint") }>
        {recentBatches.length === 0 ? (
          <div className="grid min-h-24 place-items-center text-sm text-muted">{t("bulkRecentEmpty")}</div>
        ) : (
          <DashboardTableShell>
            <Table className="w-full min-w-[720px] text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bulkCreatedAt")}</TableHead>
                  <TableHead>{t("bulkStatus")}</TableHead>
                  <TableHead>{t("bulkRows")}</TableHead>
                  <TableHead>{t("bulkDuplicates")}</TableHead>
                  <TableHead>{t("bulkErrors")}</TableHead>
                  <TableHead>{t("bulkIssued")}</TableHead>
                  <TableHead>{t("bulkBatchId")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBatches.map((item) => (
                  <TableRow key={item.batchId}>
                    <TableCell className="whitespace-nowrap">{formatAt(item.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === "completed" ? "secondary" : "outline"}>
                        {t(`bulkBatchStatus_${item.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.total}</TableCell>
                    <TableCell>{item.duplicates}</TableCell>
                    <TableCell className={item.errors > 0 ? "text-rose" : undefined}>{item.errors}</TableCell>
                    <TableCell>{item.issued}</TableCell>
                    <TableCell className="font-mono text-xs text-muted">{item.batchId.slice(0, 8)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DashboardTableShell>
        )}
      </DashboardSection>
    </div>
  );
}
