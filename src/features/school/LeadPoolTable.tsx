"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DashboardTableColumnHeader,
  DashboardTableShell,
  type DashboardTableFilterOption,
} from "./dashboard-page";
import {
  filterAndSortLeadRows,
  leadAcquisitionDateFilterKey,
  leadGradeFilterKey,
  NO_ACQUISITION_LOCATION_FILTER,
  NO_ACQUISITION_TIME_FILTER,
  NO_CONTACT_FILTER,
  NO_OWNER_FILTER,
  type LeadTableColumn,
  type LeadTableFilters,
  type LeadTableSort,
  UNKNOWN_GRADE_FILTER,
} from "./lead-table-view";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import { LeadIdentityControl } from "./LeadIdentityControl";
import { LEAD_STATUSES, type LeadPoolRow } from "./lead-contract";

const CONTACT_OUTCOMES = ["unreachable", "connected", "declined", "invalid_number"] as const;
const ACQUISITION_TIME_ZONE = "Asia/Shanghai";

export function LeadPoolTable({
  leads,
  locale,
  canAssign,
  canManageIdentity,
}: {
  leads: LeadPoolRow[];
  locale: string;
  canAssign: boolean;
  canManageIdentity: boolean;
}) {
  const t = useTranslations("school.leads");
  const tableT = useTranslations("school.table");
  const extendRangeRef = useRef(false);
  const [columnFilters, setColumnFilters] = useState<LeadTableFilters>({});
  const [sort, setSort] = useState<LeadTableSort | null>(null);
  const {
    selected,
    assignmentPending,
    toggleLead,
    setVisibleSelection,
  } = useLeadPoolSelection();
  const visibleLeads = useMemo(
    () => filterAndSortLeadRows(leads, columnFilters, sort, locale),
    [columnFilters, leads, locale, sort],
  );
  const visibleAssignableIds = useMemo(
    () => visibleLeads
      .filter((lead) => lead.status !== "invalid" && lead.status !== "converted")
      .map((lead) => lead.id),
    [visibleLeads],
  );
  const tableColumnCount = 7 + (canAssign ? 1 : 0) + (canManageIdentity ? 1 : 0);
  const selectedVisibleCount = visibleAssignableIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleAssignableIds.length > 0
    && selectedVisibleCount === visibleAssignableIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ACQUISITION_TIME_ZONE,
  }), [locale]);
  const acquisitionDateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: ACQUISITION_TIME_ZONE,
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));

  const columnOptions = useMemo<Record<LeadTableColumn, DashboardTableFilterOption[]>>(() => {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    const sortOptions = (options: DashboardTableFilterOption[]) => {
      const groupOrder = new Map<string, number>();
      for (const option of options) {
        const group = option.group ?? "";
        if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size);
      }
      return options.sort((left, right) => {
        const groupDifference = (groupOrder.get(left.group ?? "") ?? 0) - (groupOrder.get(right.group ?? "") ?? 0);
        return groupDifference || collator.compare(left.label, right.label);
      });
    };
    const names = new Set<string>();
    const phones = new Set<string>();
    const grades = new Map<string, string>();
    const suggestions = new Set<string>();
    const interests = new Set<string>();
    const acquisitionLocations = new Set<string>();
    const acquisitionPromoters = new Set<string>();
    const acquisitionMethods = new Set<string>();
    const sourceCounts = new Set<number>();
    const acquisitionDates = new Map<string, string>();
    const owners = new Map<string, string>();
    const contactOutcomes = new Set<LeadPoolRow["lastContactOutcome"]>();
    const contactTimes = new Map<string, string>();
    const contactInterests = new Set<string>();
    const invitations = new Map<string, string>();
    const contactNotes = new Set<string>();
    const contactCounts = new Set<number>();
    let hasMissingAcquisitionLocation = false;
    let hasMissingAcquisitionTime = false;
    let hasUnassignedOwner = false;
    let hasNoContact = false;
    let hasNoContactNote = false;
    let hasDuplicate = false;
    let hasWechatAdded = false;

    for (const lead of leads) {
      names.add(lead.provisionalStudentName);
      phones.add(lead.phone);
      const gradeKey = leadGradeFilterKey(lead);
      grades.set(
        gradeKey,
        gradeKey === UNKNOWN_GRADE_FILTER
          ? t("unknownGrade")
          : lead.gradeText.trim() || t("gradeValue", { grade: lead.gradeHint ?? "" }),
      );
      if (lead.sourceMarkedDuplicate) hasDuplicate = true;
      if (lead.suggestedStudentName) suggestions.add(lead.suggestedStudentName);
      for (const interest of lead.interests) interests.add(interest);
      if (lead.acquisitionLocation.trim()) acquisitionLocations.add(lead.acquisitionLocation.trim());
      else hasMissingAcquisitionLocation = true;
      if (lead.acquisitionPromoter) acquisitionPromoters.add(lead.acquisitionPromoter);
      if (lead.acquisitionMethod) acquisitionMethods.add(lead.acquisitionMethod);
      if (lead.sourceCount > 1) sourceCounts.add(lead.sourceCount);
      if (lead.acquiredAt) {
        acquisitionDates.set(
          leadAcquisitionDateFilterKey(lead.acquiredAt),
          acquisitionDateFormatter.format(new Date(lead.acquiredAt)),
        );
      } else hasMissingAcquisitionTime = true;
      if (lead.ownerId) owners.set(lead.ownerId, lead.ownerName || t("unassignedOwner"));
      else hasUnassignedOwner = true;
      if (!lead.lastContactAt || !lead.lastContactOutcome) {
        hasNoContact = true;
      } else {
        contactOutcomes.add(lead.lastContactOutcome);
        contactTimes.set(lead.lastContactAt, dateTimeFormatter.format(new Date(lead.lastContactAt)));
        if (lead.interestLevel) contactInterests.add(lead.interestLevel);
        if (lead.wechatAdded === true) hasWechatAdded = true;
        if (lead.activeInvitation) {
          invitations.set(
            `${lead.activeInvitation.kind}:${lead.activeInvitation.state}`,
            `${t(`invitationKind_${lead.activeInvitation.kind}`)} · ${t(`invitationState_${lead.activeInvitation.state}`)}`,
          );
        }
        if (lead.lastContactNote) contactNotes.add(lead.lastContactNote);
        else if (lead.contactCount > 1) contactCounts.add(lead.contactCount);
        else hasNoContactNote = true;
      }
    }

    return {
      seed: sortOptions([
        ...[...names].map((value) => ({ value: `name:${value}`, label: value, group: tableT("fieldName") })),
        ...[...phones].map((value) => ({ value: `phone:${value}`, label: value, group: tableT("fieldPhone") })),
        ...[...grades].map(([value, label]) => ({ value, label, group: tableT("fieldGrade") })),
        { value: "identity:unconfirmed", label: t("identityUnconfirmed"), group: tableT("fieldIdentity") },
        ...(hasDuplicate
          ? [{ value: "duplicate:true", label: t("sourceDuplicateShort"), group: tableT("fieldDuplicate") }]
          : []),
        ...[...suggestions].map((value) => ({
          value: `suggested:${value}`,
          label: t("studentSuggestion", { name: value }),
          group: tableT("fieldSuggestedStudent"),
        })),
      ]),
      interests: sortOptions([...interests].map((value) => ({ value, label: value }))),
      acquisitionLocation: sortOptions([
        ...(hasMissingAcquisitionLocation
          ? [{ value: NO_ACQUISITION_LOCATION_FILTER, label: t("acquisitionLocationMissing"), group: tableT("fieldLocation") }]
          : []),
        ...[...acquisitionLocations].map((value) => ({ value, label: value, group: tableT("fieldLocation") })),
        ...[...acquisitionPromoters].map((value) => ({
          value: `promoter:${value}`,
          label: t("promoterValue", { name: value }),
          group: tableT("fieldPromoter"),
        })),
        ...[...acquisitionMethods].map((value) => ({ value: `method:${value}`, label: value, group: tableT("fieldMethod") })),
        ...[...sourceCounts].map((value) => ({
          value: `source-count:${value}`,
          label: t("sourceCount", { count: value }),
          group: tableT("fieldSourceCount"),
        })),
      ]),
      acquiredAt: [
        ...(hasMissingAcquisitionTime
          ? [{ value: NO_ACQUISITION_TIME_FILTER, label: t("acquisitionTimeMissing") }]
          : []),
        ...[...acquisitionDates]
          .sort(([left], [right]) => right.localeCompare(left))
          .map(([value, label]) => ({ value, label })),
      ],
      owner: sortOptions([
        ...(hasUnassignedOwner ? [{ value: NO_OWNER_FILTER, label: t("unassignedOwner") }] : []),
        ...[...owners].map(([value, label]) => ({ value, label })),
      ]),
      latestContact: [
        ...(hasNoContact
          ? [{ value: NO_CONTACT_FILTER, label: t("notContacted"), group: tableT("fieldContactResult") }]
          : []),
        ...CONTACT_OUTCOMES.filter((value) => contactOutcomes.has(value)).map((value) => ({
          value,
          label: t(`contactOutcome_${value}`),
          group: tableT("fieldContactResult"),
        })),
        ...[...contactTimes].map(([value, label]) => ({ value: `contact-time:${value}`, label, group: tableT("fieldTime") })),
        ...[...contactInterests].map((value) => ({ value: `interest:${value}`, label: value, group: tableT("fieldInterest") })),
        ...(hasWechatAdded ? [{ value: "wechat:true", label: t("wechatAddedShort"), group: tableT("fieldWechat") }] : []),
        ...[...invitations].map(([value, label]) => ({ value: `invitation:${value}`, label, group: tableT("fieldInvitation") })),
        ...[...contactNotes].map((value) => ({ value: `note:${value}`, label: value, group: tableT("fieldNote") })),
        ...(hasNoContactNote
          ? [{ value: "note:$empty", label: t("noContactNote"), group: tableT("fieldNote") }]
          : []),
        ...[...contactCounts].map((value) => ({
          value: `contact-count:${value}`,
          label: t("contactCount", { count: value }),
          group: tableT("fieldContactCount"),
        })),
      ],
      status: LEAD_STATUSES.map((value) => ({ value, label: t(`status_${value}`) })),
    };
  }, [acquisitionDateFormatter, dateTimeFormatter, leads, locale, t, tableT]);

  const setColumnFilter = (column: LeadTableColumn, value: string | undefined) => {
    setColumnFilters((current) => {
      const next = { ...current };
      if (value) next[column] = value;
      else delete next[column];
      return next;
    });
  };
  const clearColumn = (column: LeadTableColumn) => {
    setColumnFilter(column, undefined);
    setSort((current) => current?.column === column ? null : current);
  };
  const columnHeader = (column: LeadTableColumn, label: string) => (
    <DashboardTableColumnHeader
      label={label}
      labels={{
        menu: t("columnMenu", { column: label }),
        scope: t("columnMenuScope"),
        sortAscending: t("sortAscending"),
        sortDescending: t("sortDescending"),
        filter: t("filterColumn", { column: label }),
        allValues: t("allColumnValues"),
        clear: t("clearColumn"),
      }}
      filterValue={columnFilters[column]}
      filterOptions={columnOptions[column]}
      sortDirection={sort?.column === column ? sort.direction : undefined}
      onFilterChange={(value) => setColumnFilter(column, value)}
      onSortChange={(direction) => setSort(direction ? { column, direction } : null)}
      onClear={() => clearColumn(column)}
    />
  );

  return (
    <>
      <DashboardTableShell>
        <Table
          className="w-full min-w-[88rem] text-xs"
          containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto"
        >
          <TableHeader>
            <TableRow>
              {canAssign ? (
                <TableHead className="sticky top-0 z-20 h-8 w-9 bg-card px-2">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Checkbox
                          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                          disabled={visibleAssignableIds.length === 0 || assignmentPending}
                          onCheckedChange={(checked) => setVisibleSelection(visibleAssignableIds, checked === true)}
                          aria-label={t("selectPage")}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-72 leading-5">
                        {t("rangeSelectionHint")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableHead>
              ) : null}
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("seed", t("seed"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("interests", t("interests"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("acquisitionLocation", t("acquisitionLocation"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("acquiredAt", t("acquiredAt"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("owner", t("owner"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("latestContact", t("latestContact"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("status", t("status"))}</TableHead>
              {canManageIdentity ? <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{t("actions")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLeads.map((lead) => {
              const assignable = lead.status !== "invalid" && lead.status !== "converted";
              const sourceAttribution = [
                lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "",
                lead.acquisitionMethod,
                lead.sourceCount > 1 ? t("sourceCount", { count: lead.sourceCount }) : "",
              ].filter(Boolean).join(" · ");
              return (
                <TableRow key={lead.id} className={selected.has(lead.id) ? "bg-moon/20" : undefined}>
                  {canAssign ? (
                    <TableCell className="w-9 px-2 py-1.5">
                      <Checkbox
                        checked={selected.has(lead.id)}
                        disabled={!assignable || assignmentPending}
                        onClick={(event) => { extendRangeRef.current = event.shiftKey; }}
                        onCheckedChange={(checked) => {
                          toggleLead(
                            lead.id,
                            checked === true,
                            visibleAssignableIds,
                            extendRangeRef.current,
                          );
                          extendRangeRef.current = false;
                        }}
                        aria-label={t("selectLead", { name: lead.provisionalStudentName })}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="min-w-60 px-2 py-1.5">
                    <div className="flex items-baseline gap-2 whitespace-nowrap">
                      <span className="font-medium text-ink">{lead.provisionalStudentName}</span>
                      <span className="font-mono text-[11px] text-muted">{lead.phone}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-muted">
                      <span>{lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t(lead.status === "converted" ? "identityConfirmed" : "identityUnconfirmed")}</span>
                      {lead.sourceMarkedDuplicate ? <Badge variant="danger" className="px-1.5 py-0 text-[11px] font-normal leading-4">{t("sourceDuplicateShort")}</Badge> : null}
                    </div>
                    {lead.suggestedStudentName ? (
                      <p className="mt-0.5 text-[11px] leading-4 text-muted">{t("studentSuggestion", { name: lead.suggestedStudentName })}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-64 px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {lead.interests.length > 0
                        ? lead.interests.map((interest) => <Badge key={interest} variant="outline" className="px-1.5 py-0 text-[11px] font-normal leading-4">{interest}</Badge>)
                        : <span className="text-muted">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-60 max-w-80 px-2 py-1.5">
                    {lead.acquisitionLocation
                      ? <p className="truncate text-ink" title={lead.acquisitionLocation}>{lead.acquisitionLocation}</p>
                      : <Badge variant="danger" className="px-1.5 py-0 text-[11px] font-normal leading-4">{t("acquisitionLocationMissing")}</Badge>}
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-muted" title={sourceAttribution || undefined}>
                      {sourceAttribution || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-2 py-1.5">
                    {lead.acquiredAt
                      ? formatAt(lead.acquiredAt)
                      : <Badge variant="danger" className="px-1.5 py-0 text-[11px] font-normal leading-4">{t("acquisitionTimeMissing")}</Badge>}
                  </TableCell>
                  <TableCell className="px-2 py-1.5">{lead.ownerName || "—"}</TableCell>
                  <TableCell className="min-w-64 px-2 py-1.5">
                    {lead.lastContactAt && lead.lastContactOutcome ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-ink">{t(`contactOutcome_${lead.lastContactOutcome}`)}</span>
                          <span className="text-[11px] text-muted">{formatAt(lead.lastContactAt)}</span>
                          {lead.interestLevel ? <Badge variant="secondary" className="px-1.5 py-0 text-[11px] leading-4">{lead.interestLevel}</Badge> : null}
                          {lead.wechatAdded === true ? <Badge variant="outline" className="px-1.5 py-0 text-[11px] leading-4">{t("wechatAddedShort")}</Badge> : null}
                          {lead.activeInvitation ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[11px] leading-4">
                              {t(`invitationKind_${lead.activeInvitation.kind}`)} · {t(`invitationState_${lead.activeInvitation.state}`)}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 max-w-64 truncate text-[11px] leading-4 text-muted" title={lead.lastContactNote || undefined}>
                          {lead.lastContactNote || (lead.contactCount > 1 ? t("contactCount", { count: lead.contactCount }) : t("noContactNote"))}
                        </p>
                      </>
                    ) : <span className="text-muted">{t("notContacted")}</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    <Badge className="px-1.5 py-0 text-[11px] leading-4" variant={lead.status === "invalid" ? "danger" : lead.status === "converted" ? "secondary" : "outline"}>
                      {t(`status_${lead.status}`)}
                    </Badge>
                  </TableCell>
                  {canManageIdentity ? (
                    <TableCell className="whitespace-nowrap px-2 py-1.5">
                      <LeadIdentityControl lead={lead} />
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
            {visibleLeads.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={tableColumnCount}
                  className="h-32 px-4 text-center text-sm text-muted"
                >
                  {t("columnEmpty")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </>
  );
}
