"use client";

import { useMemo, useState } from "react";
import { useDashboardPreference } from "./DashboardPreferenceScope";
import type {
  DashboardTableFilterOption,
  DashboardTableSortDirection,
} from "./DashboardTableColumnHeader";

export type DashboardTableSortValue = string | number | boolean | null | undefined;

export interface DashboardTableColumnDefinition<Row> {
  filterValues: (
    row: Row,
  ) => DashboardTableFilterOption | readonly DashboardTableFilterOption[] | null | undefined;
  sortValue: (row: Row) => DashboardTableSortValue;
}

export type DashboardTableFilters<Column extends string> = Partial<Record<Column, string>>;

export interface DashboardTableSort<Column extends string> {
  column: Column;
  direction: DashboardTableSortDirection;
}

function valuesFor<Row>(
  definition: DashboardTableColumnDefinition<Row>,
  row: Row,
): readonly DashboardTableFilterOption[] {
  const value = definition.filterValues(row);
  if (!value) return [];
  return "value" in value ? [value] : value;
}

export function dashboardTableFilterOptions<Row, Column extends string>(
  rows: readonly Row[],
  columns: Record<Column, DashboardTableColumnDefinition<Row>>,
  locale: string,
): Record<Column, DashboardTableFilterOption[]> {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return Object.fromEntries(Object.entries(columns).map(([column, untypedDefinition]) => {
    const definition = untypedDefinition as DashboardTableColumnDefinition<Row>;
    const options = new Map<string, DashboardTableFilterOption>();
    const groupOrder = new Map<string, number>();
    for (const row of rows) {
      for (const option of valuesFor(definition, row)) {
        const group = option.group ?? "";
        if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size);
        options.set(option.value, option);
      }
    }
    return [column, [...options.values()].sort((left, right) => {
      const groupDifference = (groupOrder.get(left.group ?? "") ?? 0) - (groupOrder.get(right.group ?? "") ?? 0);
      return groupDifference || collator.compare(left.label, right.label);
    })];
  })) as Record<Column, DashboardTableFilterOption[]>;
}

function compareValues(
  left: DashboardTableSortValue,
  right: DashboardTableSortValue,
  collator: Intl.Collator,
): number {
  if (left === right) return 0;
  if (left === null || left === undefined || left === "") return 1;
  if (right === null || right === undefined || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return collator.compare(String(left), String(right));
}

export function filterAndSortDashboardRows<Row, Column extends string>(
  rows: readonly Row[],
  columns: Record<Column, DashboardTableColumnDefinition<Row>>,
  filters: DashboardTableFilters<Column>,
  sort: DashboardTableSort<Column> | null,
  locale: string,
): Row[] {
  const filtered = rows.filter((row) => Object.entries(filters).every(([untypedColumn, selected]) => {
    if (!selected) return true;
    const column = untypedColumn as Column;
    return valuesFor(columns[column], row).some((option) => option.value === selected);
  }));
  if (!sort) return filtered;

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const definition = columns[sort.column];
  const direction = sort.direction === "asc" ? 1 : -1;
  return filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = definition.sortValue(left.row);
      const rightValue = definition.sortValue(right.row);
      const leftMissing = leftValue === null || leftValue === undefined || leftValue === "";
      const rightMissing = rightValue === null || rightValue === undefined || rightValue === "";
      // Missing values remain at the end in both directions.
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      const compared = compareValues(leftValue, rightValue, collator);
      return compared * direction || left.index - right.index;
    })
    .map(({ row }) => row);
}

export function useDashboardTableView<Row, Column extends string>({
  rows,
  columns,
  locale,
  initialFilters,
  persistenceKey,
}: {
  rows: readonly Row[];
  columns: Record<Column, DashboardTableColumnDefinition<Row>>;
  locale: string;
  initialFilters?: DashboardTableFilters<Column>;
  persistenceKey?: string;
}) {
  const [localFilters, setFilters] = useState<DashboardTableFilters<Column>>(() => ({ ...initialFilters }));
  const [localSort, setSort] = useState<DashboardTableSort<Column> | null>(null);
  const initialSignature = initialFilters === undefined ? null : JSON.stringify(initialFilters);
  const [acceptedInitial, setAcceptedInitial] = useState<string | null>(null);
  const preference = useDashboardPreference(persistenceKey);
  const saved = useMemo(() => {
    try {
      if (!preference.raw) return null;
      const value = JSON.parse(preference.raw);
      if (!value || typeof value !== "object" || !value.filters || typeof value.filters !== "object") return null;
      const filters = Object.fromEntries(Object.entries(value.filters).filter(([column, selected]) =>
        Object.hasOwn(columns, column) && typeof selected === "string")) as DashboardTableFilters<Column>;
      const sort = value.sort && Object.hasOwn(columns, value.sort.column) && ["asc", "desc"].includes(value.sort.direction)
        ? value.sort as DashboardTableSort<Column> : null;
      return { filters, sort };
    } catch { return null; }
  }, [columns, preference.raw]);
  const hasExplicitFilters = initialFilters !== undefined && acceptedInitial !== initialSignature;
  const filters = hasExplicitFilters ? initialFilters : saved?.filters ?? localFilters;
  const sort = hasExplicitFilters ? null : saved ? saved.sort : localSort;
  const filterOptions = useMemo(
    () => dashboardTableFilterOptions(rows, columns, locale),
    [columns, locale, rows],
  );
  const visibleRows = useMemo(
    () => filterAndSortDashboardRows(rows, columns, filters, sort, locale),
    [columns, filters, locale, rows, sort],
  );

  const setFilter = (column: Column, value: string | undefined) => {
    setAcceptedInitial(initialSignature);
    const next = { ...filters };
    if (value) next[column] = value;
    else delete next[column];
    setFilters(next);
    preference.save({ filters: next, sort });
  };
  const clearColumn = (column: Column) => {
    setAcceptedInitial(initialSignature);
    const next = { ...filters };
    delete next[column];
    const nextSort = sort?.column === column ? null : sort;
    setFilters(next);
    setSort(nextSort);
    preference.save({ filters: next, sort: nextSort });
  };

  return {
    visibleRows,
    filters,
    sort,
    hasFilters: Object.keys(filters).length > 0,
    setFilter,
    columnProps: (column: Column) => ({
      filterValue: filters[column],
      filterOptions: filterOptions[column],
      sortDirection: sort?.column === column ? sort.direction : undefined,
      onFilterChange: (value: string | undefined) => setFilter(column, value),
      onSortChange: (direction: DashboardTableSortDirection | undefined) => {
        setAcceptedInitial(initialSignature);
        const next = direction ? { column, direction } : null;
        setSort(next);
        preference.save({ filters, sort: next });
      },
      onClear: () => clearColumn(column),
    }),
  };
}
