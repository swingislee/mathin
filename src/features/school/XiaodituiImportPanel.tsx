"use client";

import { ArrowRight, CheckCircle2, FileSearch, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import {
  applyLeadImportAction,
  decideLeadImportRowAction,
  getLeadImportBatchAction,
  previewLeadImportAction,
} from "./actions/lead-imports";
import {
  XIAODITUI_IMPORT_TEMPLATE_VERSION,
  type LeadImportBatchResult,
  type LeadImportBatchRow,
  type LeadImportBatchSummary,
  type LeadImportDecision,
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
  XiaodituiParseError,
  classifyXiaodituiInterest,
  isXiaodituiSourceMarkedDuplicate,
  parseXiaodituiWorksheet,
  resolveXiaodituiMathinMatch,
  type ParsedXiaodituiWorksheet,
} from "./xiaoditui-import";

const PREVIEW_LIMIT = 100;
const EMPTY_VALUE = "$empty";

type PreviewColumn = "sourceRow" | "child" | "phone" | "grade" | "interests" | "location" | "submittedAt" | "promoter" | "sourceDuplicate" | "match";
type ReviewColumn = "sourceRow" | "identity" | "sourceSignal" | "reason" | "existingIdentity";
type BatchColumn = "createdAt" | "label" | "status" | "total" | "duplicates" | "errors" | "created" | "batchId";

interface PreviewEntry {
  ordinal: number;
  row: ParsedXiaodituiWorksheet["rows"][number];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function filenameLabel(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "").slice(0, 160);
}

type ReviewDecision = Extract<LeadImportDecision, "create_new" | "link_existing" | "skip">;

function reviewDecisions(row: LeadImportBatchRow): ReviewDecision[] {
  if (row.matchedLeadId) return ["create_new", "link_existing", "skip"];
  return ["create_new", "skip"];
}

export function XiaodituiImportPanel({ recentBatches }: { recentBatches: LeadImportBatchSummary[] }) {
  const t = useTranslations("school.students.xiaoditui");
  const tableT = useTranslations("school.table");
  const locale = useLocale();
  const formatAt = useMemo(() => (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value)), [locale]);
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [parsed, setParsed] = useState<ParsedXiaodituiWorksheet | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [batch, setBatch] = useState<LeadImportBatchResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newId);

  const resetServerBatch = () => {
    setBatch(null);
    setIdempotencyKey(newId());
  };
  const previewRows = useMemo<PreviewEntry[]>(
    () => (parsed?.rows.slice(0, PREVIEW_LIMIT) ?? []).map((row, index) => ({ row, ordinal: index + 1 })),
    [parsed],
  );
  const reviewRows = useMemo(() => batch?.rows.filter((row) => row.decision === "pending") ?? [], [batch]);
  const rowByOrdinal = useMemo(() => new Map(parsed?.rows.map((row, index) => [index + 1, row]) ?? []), [parsed]);
  const serverRowByOrdinal = useMemo(() => new Map(batch?.rows.map((row) => [row.row, row]) ?? []), [batch]);
  const interestCounts = useMemo(() => {
    const counts = { assessment: 0, activity: 0, nurture: 0, product_interest: 0, unknown: 0 };
    for (const row of parsed?.rows ?? []) {
      for (const interest of row.interests) counts[classifyXiaodituiInterest(interest)] += 1;
    }
    return counts;
  }, [parsed]);
  const acquisitionQuality = useMemo(() => ({
    missingTime: parsed?.rows.filter((row) => !row.submittedAt).length ?? 0,
    missingLocation: parsed?.rows.filter((row) => !row.location.trim()).length ?? 0,
  }), [parsed]);
  const previewColumns = useMemo<Record<PreviewColumn, DashboardTableColumnDefinition<PreviewEntry>>>(() => ({
    sourceRow: {
      filterValues: ({ row }) => ({ value: String(row.sourceRow), label: String(row.sourceRow) }),
      sortValue: ({ row }) => row.sourceRow,
    },
    child: {
      filterValues: ({ row }) => ({ value: row.childName || EMPTY_VALUE, label: row.childName || tableT("emptyValue") }),
      sortValue: ({ row }) => row.childName,
    },
    phone: {
      filterValues: ({ row }) => ({ value: row.phone || EMPTY_VALUE, label: row.phone || tableT("emptyValue") }),
      sortValue: ({ row }) => row.phone,
    },
    grade: {
      filterValues: ({ row }) => ({ value: row.gradeText || EMPTY_VALUE, label: row.gradeText || tableT("emptyValue") }),
      sortValue: ({ row }) => row.grade,
    },
    interests: {
      filterValues: ({ row }) => row.interests.length > 0
        ? row.interests.map((interest) => ({ value: interest, label: interest }))
        : { value: EMPTY_VALUE, label: tableT("emptyValue") },
      sortValue: ({ row }) => row.interests.join("|"),
    },
    location: {
      filterValues: ({ row }) => ({ value: row.location || EMPTY_VALUE, label: row.location || t("acquisitionLocationMissing") }),
      sortValue: ({ row }) => row.location,
    },
    submittedAt: {
      filterValues: ({ row }) => ({
        value: row.submittedAt?.slice(0, 10) ?? EMPTY_VALUE,
        label: row.submittedAt ? formatAt(row.submittedAt) : tableT("emptyValue"),
      }),
      sortValue: ({ row }) => row.submittedAt,
    },
    promoter: {
      filterValues: ({ row }) => [
        {
          value: row.promoter ? `promoter:${row.promoter}` : `promoter:${EMPTY_VALUE}`,
          label: row.promoter || tableT("emptyValue"),
          group: tableT("fieldPromoter"),
        },
        ...(row.acquisitionMethod
          ? [{ value: `method:${row.acquisitionMethod}`, label: row.acquisitionMethod, group: tableT("fieldMethod") }]
          : []),
      ],
      sortValue: ({ row }) => `${row.promoter}\u0000${row.acquisitionMethod}`,
    },
    sourceDuplicate: {
      filterValues: ({ row }) => ({
        value: row.sourceDuplicate ? "duplicate" : "unique",
        label: row.sourceDuplicate ? t("sourceDuplicateAdvisory") : t("none"),
      }),
      sortValue: ({ row }) => row.sourceDuplicate ? 1 : 0,
    },
    match: {
      filterValues: ({ ordinal }) => {
        const serverRow = serverRowByOrdinal.get(ordinal);
        const match = serverRow ? resolveXiaodituiMathinMatch(serverRow, batch?.rows ?? []) : null;
        return { value: match ?? "not_checked", label: match ? t(`match_${match}`) : t("notChecked") };
      },
      sortValue: ({ ordinal }) => {
        const serverRow = serverRowByOrdinal.get(ordinal);
        return serverRow ? resolveXiaodituiMathinMatch(serverRow, batch?.rows ?? []) : "not_checked";
      },
    },
  }), [batch, formatAt, serverRowByOrdinal, t, tableT]);
  const previewTable = useDashboardTableView({ rows: previewRows, columns: previewColumns, locale });
  const reviewColumns = useMemo<Record<ReviewColumn, DashboardTableColumnDefinition<LeadImportBatchRow>>>(() => ({
    sourceRow: {
      filterValues: (row) => {
        const value = rowByOrdinal.get(row.row)?.sourceRow ?? row.sourceRow;
        return { value: String(value), label: String(value) };
      },
      sortValue: (row) => rowByOrdinal.get(row.row)?.sourceRow ?? row.sourceRow,
    },
    identity: {
      filterValues: (row) => {
        const source = rowByOrdinal.get(row.row);
        const name = source?.childName || row.sourceName;
        const phone = source?.phone || row.sourcePhone;
        return [
          {
            value: name ? `name:${name}` : `name:${EMPTY_VALUE}`,
            label: name || tableT("emptyValue"),
            group: tableT("fieldName"),
          },
          {
            value: phone ? `phone:${phone}` : `phone:${EMPTY_VALUE}`,
            label: phone || tableT("emptyValue"),
            group: tableT("fieldPhone"),
          },
        ];
      },
      sortValue: (row) => rowByOrdinal.get(row.row)?.childName || row.sourceName,
    },
    sourceSignal: {
      filterValues: (row) => ({
        value: isXiaodituiSourceMarkedDuplicate(row) ? "duplicate" : "unique",
        label: isXiaodituiSourceMarkedDuplicate(row) ? t("sourceDuplicateAdvisory") : t("none"),
      }),
      sortValue: (row) => isXiaodituiSourceMarkedDuplicate(row) ? 1 : 0,
    },
    reason: {
      filterValues: (row) => {
        const match = resolveXiaodituiMathinMatch(row, batch?.rows ?? []);
        return { value: match, label: t(`match_${match}`) };
      },
      sortValue: (row) => resolveXiaodituiMathinMatch(row, batch?.rows ?? []),
    },
    existingIdentity: {
      filterValues: (row) => {
        const value = row.matchedLeadName
          ? t("existingLead", { name: row.matchedLeadName })
          : row.suggestedStudentName
            ? t("studentHint", { name: row.suggestedStudentName })
            : t("none");
        return { value, label: value };
      },
      sortValue: (row) => row.matchedLeadName || row.suggestedStudentName || "",
    },
  }), [batch, rowByOrdinal, t, tableT]);
  const reviewTable = useDashboardTableView({ rows: reviewRows, columns: reviewColumns, locale });
  const batchColumns = useMemo<Record<BatchColumn, DashboardTableColumnDefinition<LeadImportBatchSummary>>>(() => ({
    createdAt: {
      filterValues: (item) => ({ value: item.createdAt.slice(0, 10), label: formatAt(item.createdAt) }),
      sortValue: (item) => item.createdAt,
    },
    label: {
      filterValues: (item) => ({ value: item.batchLabel || item.fileName, label: item.batchLabel || item.fileName }),
      sortValue: (item) => item.batchLabel || item.fileName,
    },
    status: {
      filterValues: (item) => ({
        value: item.reviewCount > 0 ? "pending_review" : item.status,
        label: item.reviewCount > 0 ? t("pendingCount", { count: item.reviewCount }) : t(`status_${item.status}`),
      }),
      sortValue: (item) => item.reviewCount > 0 ? "pending_review" : item.status,
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
    created: {
      filterValues: (item) => ({ value: String(item.created), label: String(item.created) }),
      sortValue: (item) => item.created,
    },
    batchId: {
      filterValues: (item) => ({ value: item.batchId, label: item.batchId.slice(0, 8) }),
      sortValue: (item) => item.batchId,
    },
  }), [formatAt, t]);
  const batchTable = useDashboardTableView({ rows: recentBatches, columns: batchColumns, locale });

  const errorMessages = {
    default: t("failed"),
    IDEMPOTENCY_CONFLICT: t("idempotencyConflict"),
    BATCH_HAS_ERRORS: t("batchHasErrors"),
    BATCH_HAS_PENDING_REVIEWS: t("pendingReviews"),
    BATCH_EXPIRED: t("batchExpired"),
  };
  const previewRun = useAction(previewLeadImportAction, {
    successMessage: t("previewSuccess"),
    errorMessage: errorMessages,
    onSuccess: setBatch,
  });
  const decisionRun = useAction(decideLeadImportRowAction, {
    successMessage: t("decisionSaved"),
    errorMessage: errorMessages,
    onSuccess: setBatch,
  });
  const openBatchRun = useAction(getLeadImportBatchAction, {
    successMessage: t("openBatchSuccess"),
    errorMessage: errorMessages,
    onSuccess: (next) => {
      setParsed(null);
      setFileName("");
      setFileBase64("");
      setBatchLabel(next.batchLabel);
      setBatch(next);
    },
  });
  const applyRun = useAction(applyLeadImportAction, {
    successMessage: t("applySuccess"),
    errorMessage: errorMessages,
    onSuccess: (next) => {
      setBatch(next);
      router.refresh();
    },
  });
  const pending = reading || previewRun.pending || decisionRun.pending || openBatchRun.pending || applyRun.pending;

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setParseError(null);
    resetServerBatch();
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new XiaodituiParseError("UNRECOGNIZED_HEADERS");
      const [{ readSheet }, buffer] = await Promise.all([
        import("read-excel-file/browser"),
        file.arrayBuffer(),
      ]);
      const worksheet = await readSheet(file);
      const next = parseXiaodituiWorksheet(worksheet);
      setFileName(file.name);
      setFileBase64(arrayBufferToBase64(buffer));
      setBatchLabel(filenameLabel(file.name));
      setParsed(next);
    } catch (error) {
      setFileName(file.name);
      setFileBase64("");
      setParsed(null);
      setParseError(error instanceof XiaodituiParseError ? error.code : "READ_FAILED");
    } finally {
      setReading(false);
    }
  };

  const startPreview = () => {
    if (!parsed || !fileBase64) return;
    previewRun.run({
      templateVersion: XIAODITUI_IMPORT_TEMPLATE_VERSION,
      idempotencyKey,
      fileName,
      fileBase64,
      sheetName: "Worksheet",
      batchLabel,
      rows: parsed.rows,
    });
  };
  return (
    <div className="space-y-10">
      <DashboardSection title={t("inputTitle")} description={t("inputDescription")}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-0">
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
            <h3 className="text-sm font-medium text-ink">{t("mappingTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{t("mappingDescription")}</p>
            <dl className="mt-4 space-y-3 text-xs">
              <div><dt className="font-medium text-ink">{t("identityLayer")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("identityLayerHint")}</dd></div>
              <div><dt className="font-medium text-ink">{t("interestLayer")}</dt><dd className="mt-0.5 leading-5 text-muted">{t("interestLayerHint")}</dd></div>
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
              {
                label: t("missingAcquisitionTime"),
                value: acquisitionQuality.missingTime,
                tone: acquisitionQuality.missingTime > 0 ? "warning" : "default",
              },
              {
                label: t("missingAcquisitionLocation"),
                value: acquisitionQuality.missingLocation,
                tone: acquisitionQuality.missingLocation > 0 ? "warning" : "default",
              },
              { label: t("assessmentIntent"), value: interestCounts.assessment },
              { label: t("activityIntent"), value: interestCounts.activity },
              { label: t("nurtureIntent"), value: interestCounts.nurture },
              { label: t("productIntent"), value: interestCounts.product_interest },
            ]}
          />
          <DashboardTableShell>
            <Table className="w-full min-w-[84rem] text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead><DashboardTableColumnHeader label={t("sourceRow")} {...previewTable.columnProps("sourceRow")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("child")} {...previewTable.columnProps("child")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("phone")} {...previewTable.columnProps("phone")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("grade")} {...previewTable.columnProps("grade")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("interests")} {...previewTable.columnProps("interests")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("acquisitionLocation")} {...previewTable.columnProps("location")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("submittedAt")} {...previewTable.columnProps("submittedAt")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("promoter")} {...previewTable.columnProps("promoter")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("sourceDuplicate")} {...previewTable.columnProps("sourceDuplicate")} /></TableHead>
                  <TableHead><DashboardTableColumnHeader label={t("matchResult")} {...previewTable.columnProps("match")} /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewTable.visibleRows.map(({ row, ordinal }) => {
                  const serverRow = serverRowByOrdinal.get(ordinal);
                  return (
                    <TableRow key={row.sourceRow}>
                      <TableCell className="font-mono text-muted">{row.sourceRow}</TableCell>
                      <TableCell className="font-medium">{row.childName || "—"}</TableCell>
                      <TableCell>{row.phone || "—"}</TableCell>
                      <TableCell>{row.gradeText || "—"}</TableCell>
                      <TableCell className="max-w-[28rem]">
                        <div className="flex flex-wrap gap-1">
                          {row.interests.length > 0 ? row.interests.map((interest) => (
                            <Badge key={interest} variant="outline" className="font-normal">{interest}</Badge>
                          )) : <span className="text-muted">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-72">
                        {row.location
                          ? <span title={row.location}>{row.location}</span>
                          : <span className="text-rose">{t("acquisitionLocationMissing")}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted">{row.submittedAt ? formatAt(row.submittedAt) : "—"}</TableCell>
                      <TableCell>
                        <span>{row.promoter || "—"}</span>
                        {row.acquisitionMethod ? <p className="mt-0.5 text-[11px] text-muted">{row.acquisitionMethod}</p> : null}
                      </TableCell>
                      <TableCell>
                        {row.sourceDuplicate
                          ? <Badge variant="outline" className="whitespace-nowrap font-normal">{t("sourceDuplicateAdvisory")}</Badge>
                          : <span className="text-muted">—</span>}
                      </TableCell>
                      <TableCell>
                        {serverRow
                          ? <span className={serverRow.decision === "pending" ? "text-rose" : "text-muted"}>{t(`match_${resolveXiaodituiMathinMatch(serverRow, batch?.rows ?? [])}`)}</span>
                          : <span className="text-muted">{t("notChecked")}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {previewTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </DashboardTableShell>
          {parsed.rows.length > PREVIEW_LIMIT ? <p className="mt-2 text-xs text-muted">{t("previewLimited", { count: PREVIEW_LIMIT, total: parsed.rows.length })}</p> : null}
        </DashboardSection>
      ) : null}

      {batch ? (
        <DashboardSection title={t("dryRunTitle")} description={t("dryRunDescription", { file: batch.fileName })}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={batch.errorCount > 0 || batch.reviewCount > 0 ? "danger" : batch.status === "completed" ? "secondary" : "outline"}>
              {t(`status_${batch.status}`)}
            </Badge>
            <span className="font-mono text-xs text-muted">{batch.batchId}</span>
          </div>
          <StatusStrip
            className="mt-3"
            items={[
              { label: t("rows"), value: batch.total },
              { label: t("newSeeds"), value: batch.newCount },
              { label: t("matchedSeeds"), value: batch.matchedCount },
              { label: t("needsReview"), value: batch.reviewCount, tone: batch.reviewCount > 0 ? "warning" : "default" },
              { label: t("errors"), value: batch.errorCount, tone: batch.errorCount > 0 ? "critical" : "default" },
            ]}
          />

          {reviewRows.length > 0 ? (
            <div className="mt-6 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-ink">{t("reviewTitle")}</h3>
                <p className="mt-1 text-xs text-muted">{t("reviewDescription")}</p>
              </div>
              <DashboardTableShell>
                <Table className="w-full min-w-[76rem] text-xs">
                  <TableHeader><TableRow>
                    <TableHead><DashboardTableColumnHeader label={t("sourceRow")} {...reviewTable.columnProps("sourceRow")} /></TableHead>
                    <TableHead><DashboardTableColumnHeader label={t("sourceIdentity")} {...reviewTable.columnProps("identity")} /></TableHead>
                    <TableHead><DashboardTableColumnHeader label={t("sourceSignal")} {...reviewTable.columnProps("sourceSignal")} /></TableHead>
                    <TableHead><DashboardTableColumnHeader label={t("matchReason")} {...reviewTable.columnProps("reason")} /></TableHead>
                    <TableHead><DashboardTableColumnHeader label={t("existingIdentity")} {...reviewTable.columnProps("existingIdentity")} /></TableHead>
                    <TableHead>{t("decision")}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {reviewTable.visibleRows.map((serverRow) => {
                      const source = rowByOrdinal.get(serverRow.row);
                      const sourceMarkedDuplicate = isXiaodituiSourceMarkedDuplicate(serverRow);
                      const mathinMatch = resolveXiaodituiMathinMatch(serverRow, batch.rows);
                      return <TableRow key={serverRow.row}>
                        <TableCell className="font-mono text-muted">{source?.sourceRow ?? serverRow.sourceRow}</TableCell>
                        <TableCell><span className="font-medium">{source?.childName || serverRow.sourceName || "—"}</span><span className="ml-2 text-muted">{source?.phone || serverRow.sourcePhone || "—"}</span></TableCell>
                        <TableCell>{sourceMarkedDuplicate ? <Badge variant="outline" className="whitespace-nowrap font-normal">{t("sourceDuplicateAdvisory")}</Badge> : <span className="text-muted">—</span>}</TableCell>
                        <TableCell className="text-rose">{t(`match_${mathinMatch}`)}</TableCell>
                        <TableCell>
                          {serverRow.matchedLeadName
                            ? t("existingLead", { name: serverRow.matchedLeadName })
                            : serverRow.suggestedStudentName
                              ? t("studentHint", { name: serverRow.suggestedStudentName })
                              : t("none")}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {reviewDecisions(serverRow).map((decision) => <Button
                              key={decision}
                              type="button"
                              size="sm"
                              variant={decision === "skip" ? "ghost" : "secondary"}
                              className="h-7 px-2 text-xs"
                              disabled={pending}
                              onClick={() => decisionRun.run(batch.batchId, serverRow.row, decision)}
                            >{t(`decision_${decision}`)}</Button>)}
                          </div>
                        </TableCell>
                      </TableRow>;
                    })}
                    {reviewTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}
                  </TableBody>
                </Table>
              </DashboardTableShell>
            </div>
          ) : null}

          {batch.status === "validated" ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
              <p className="text-xs text-muted">{batch.reviewCount > 0 ? t("applyBlocked", { count: batch.reviewCount }) : t("applyHint")}</p>
              <Button type="button" disabled={pending || batch.reviewCount > 0 || batch.errorCount > 0} onClick={() => applyRun.run(batch.batchId)}>
                {applyRun.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <Upload size={15} />}
                {t("apply")}
              </Button>
            </div>
          ) : null}

          {batch.status === "completed" ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="flex items-center gap-2 text-sm text-leaf-deep"><CheckCircle2 size={16} />{t("completed", { applied: batch.applied, created: batch.created, skipped: batch.skippedCount })}</p>
              <Link href="/dashboard/followups/leads" className={buttonVariants({ size: "sm" })}>{t("openLeadPool")}<ArrowRight size={15} /></Link>
            </div>
          ) : null}
        </DashboardSection>
      ) : null}

      <DashboardSection title={t("recentTitle")} description={t("recentDescription")}>
        {recentBatches.length === 0 ? <div className="grid min-h-28 place-items-center text-sm text-muted">{t("recentEmpty")}</div> : (
          <DashboardTableShell>
            <Table className="w-full min-w-[52rem] text-sm">
              <TableHeader><TableRow>
                <TableHead><DashboardTableColumnHeader label={t("createdAt")} {...batchTable.columnProps("createdAt")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("batchLabel")} {...batchTable.columnProps("label")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("statusLabel")} {...batchTable.columnProps("status")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("rows")} {...batchTable.columnProps("total")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("duplicates")} {...batchTable.columnProps("duplicates")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("errors")} {...batchTable.columnProps("errors")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("createdLeads")} {...batchTable.columnProps("created")} /></TableHead>
                <TableHead><DashboardTableColumnHeader label={t("batchId")} {...batchTable.columnProps("batchId")} /></TableHead>
                <TableHead />
              </TableRow></TableHeader>
              <TableBody>{batchTable.visibleRows.map((item) => <TableRow key={item.batchId}>
                <TableCell className="whitespace-nowrap">{formatAt(item.createdAt)}</TableCell><TableCell>{item.batchLabel || item.fileName}</TableCell><TableCell><Badge variant={item.status === "completed" ? "secondary" : item.reviewCount > 0 ? "danger" : "outline"}>{item.reviewCount > 0 ? t("pendingCount", { count: item.reviewCount }) : t(`status_${item.status}`)}</Badge></TableCell><TableCell>{item.total}</TableCell><TableCell>{item.duplicates}</TableCell><TableCell className={item.errors > 0 ? "text-rose" : undefined}>{item.errors}</TableCell><TableCell>{item.created}</TableCell><TableCell className="font-mono text-xs text-muted">{item.batchId.slice(0, 8)}</TableCell><TableCell className="text-right">{item.status === "validated" ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => openBatchRun.run(item.batchId)}>{t("openBatch")}</Button> : null}</TableCell>
              </TableRow>)}
              {batchTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
            </Table>
          </DashboardTableShell>
        )}
      </DashboardSection>

      <div className="flex justify-end"><Link href="/dashboard/followups/leads" className={buttonVariants({ variant: "secondary", size: "sm" })}><FileSpreadsheet size={15} />{t("openLeadPool")}</Link></div>
    </div>
  );
}
