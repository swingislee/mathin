"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDashboardPreference } from "./DashboardPreferenceScope";
import { dashboardFieldMessages } from "./dashboard-field-messages";
import {
  dashboardFieldEnabled, dashboardFieldFacets, EMPTY_DASHBOARD_FIELD_QUERY, filterAndSortDashboardFields,
  normalizeDashboardFieldQuery, type DashboardFieldDefinitions, type DashboardFieldFacet, type DashboardFieldFilter, type DashboardFieldQuery, type DashboardFieldSort,
} from "./dashboard-table-field-contract";
import type { DashboardDateContext } from "./dashboard-table-date-contract";
import type { DashboardFieldControl, DashboardTableFieldHeaderProps } from "./DashboardTableFieldMenu";

export function useDashboardFieldView<Row, Column extends string>({ rows, fields, columns, context, persistenceKey, migrate, server, sourceSort, initialQuery, onQueryChange }: {
  rows: readonly Row[];
  fields: DashboardFieldDefinitions<Row>;
  columns: Record<Column, readonly string[]>;
  context: DashboardDateContext;
  persistenceKey?: string;
  migrate?: (value: unknown) => DashboardFieldQuery;
  initialQuery?: DashboardFieldQuery;
  /** 本地字段变化可同步上游统计范围及分页。 */
  onQueryChange?: (query: DashboardFieldQuery) => void;
  /** 后端已经给出的默认顺序只展示方向，客户端不再执行一次相同排序。 */
  sourceSort?: DashboardFieldSort;
  server?: { query: DashboardFieldQuery; facets: Record<string, DashboardFieldFacet>; onChange: (query: DashboardFieldQuery) => void };
}) {
  const preference = useDashboardPreference(persistenceKey);
  const [local, setLocal] = useState<DashboardFieldQuery>(initialQuery ?? EMPTY_DASHBOARD_FIELD_QUERY);
  const acceptedMigration = useRef<string | null>(null);
  const saved = useMemo(() => {
    if (!preference.raw) return null;
    try {
      const value: unknown = JSON.parse(preference.raw);
      const legacy = Boolean(value && typeof value === "object" && (!("version" in value) || value.version !== 2));
      return { query: normalizeDashboardFieldQuery(fields, legacy && migrate ? migrate(value) : value), legacy };
    } catch { return { query: EMPTY_DASHBOARD_FIELD_QUERY, legacy: true }; }
  }, [fields, migrate, preference.raw]);
  const query = useMemo(() => server?.query ?? saved?.query ?? normalizeDashboardFieldQuery(fields, local), [server?.query, saved, fields, local]);
  useEffect(() => {
    if (!preference.ready || !saved?.legacy || acceptedMigration.current === preference.raw) return;
    acceptedMigration.current = preference.raw;
    preference.save(saved.query);
    toast.info(dashboardFieldMessages(context.locale).migrated);
  }, [context.locale, preference, saved]);
  const serverFacets = server?.facets;
  const visibleRows = useMemo(() => serverFacets ? [...rows] : filterAndSortDashboardFields(rows, fields,
    sourceSort && query.sort?.field === sourceSort.field && query.sort.direction === sourceSort.direction ? { ...query, sort: null } : query,
    context.locale, context.timeZone), [serverFacets, rows, fields, query, sourceSort, context.locale, context.timeZone]);
  const facets = useMemo(() => serverFacets ?? dashboardFieldFacets(rows, fields, query.filters, context.locale, context.timeZone), [serverFacets, rows, fields, query.filters, context.locale, context.timeZone]);
  const update = (next: DashboardFieldQuery) => {
    const normalized = normalizeDashboardFieldQuery(fields, next);
    setLocal(normalized);
    preference.save(normalized);
    server?.onChange(normalized);
    onQueryChange?.(normalized);
  };
  const setFilter = (id: string, filter: DashboardFieldFilter | undefined) => {
    const filters = { ...query.filters };
    if (filter) filters[id] = filter;
    else delete filters[id];
    let sort = query.sort;
    // 切换量尺后清除依赖它的原分条件，避免把旧试卷条件带到另一张卷。
    if (JSON.stringify(filters[id]) !== JSON.stringify(query.filters[id])) for (const [dependentId, definition] of Object.entries(fields)) {
      if (definition.requiresSingleValue !== id) continue;
      delete filters[dependentId];
      if (sort?.field === dependentId) sort = null;
    }
    update({ version: 2, filters, sort });
  };
  const controls = (ids: readonly string[]): DashboardFieldControl[] => ids.map(id => {
    const field = fields[id];
    return {
      id, label: field.label, hint: field.hint, kind: field.kind, filter: query.filters[id],
      sortable: field.sortable !== false, disabled: !dashboardFieldEnabled(field, query.filters),
      sortDirection: (query.sort ?? sourceSort)?.field === id ? (query.sort ?? sourceSort)?.direction : undefined,
      options: facets[id]?.options ?? [], days: facets[id]?.days ?? [],
      multiple: field.kind === "enum" ? field.multiple !== false : undefined,
      step: field.kind === "number" ? field.step : undefined,
      onFilterChange: filter => setFilter(id, filter),
      onSortChange: direction => update({ ...query, sort: direction ? { field: id, direction } : null }),
    };
  });
  return {
    visibleRows, filters: query.filters, sort: query.sort, setFilter,
    columnProps: (column: Column): Omit<DashboardTableFieldHeaderProps, "label"> => ({
      fields: controls(columns[column]), context,
      onClearColumn: () => update({ version: 2, filters: Object.fromEntries(Object.entries(query.filters).filter(([id]) => !columns[column].includes(id))),
        sort: query.sort && columns[column].includes(query.sort.field) ? null : query.sort }),
      onClearAll: () => update(EMPTY_DASHBOARD_FIELD_QUERY),
    }),
  };
}
