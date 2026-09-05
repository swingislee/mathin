"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, ListFilter, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DashboardTableSortDirection = "asc" | "desc";

export interface DashboardTableFilterOption {
  value: string;
  label: string;
  group?: string;
}

export interface DashboardTableColumnHeaderLabels {
  menu?: string;
  scope?: string;
  sortAscending?: string;
  sortDescending?: string;
  clearSort?: string;
  filter?: string;
  allValues?: string;
  clear?: string;
  search?: string;
  noOptions?: string;
}

/** Shared shadcn column control for Dashboard data tables; business labels stay with the caller. */
export function DashboardTableColumnHeader({
  label,
  labels,
  filterValue,
  filterOptions,
  sortDirection,
  onFilterChange,
  onSortChange,
  onClear,
}: {
  label: string;
  labels?: DashboardTableColumnHeaderLabels;
  filterValue?: string;
  filterOptions: DashboardTableFilterOption[];
  sortDirection?: DashboardTableSortDirection;
  onFilterChange: (value: string | undefined) => void;
  onSortChange?: (direction: DashboardTableSortDirection | undefined) => void;
  onClear: () => void;
}) {
  const t = useTranslations("school.table");
  const [menuOpen, setMenuOpen] = useState(false);
  const active = Boolean(filterValue || sortDirection);
  const menuLabel = labels?.menu ?? t("menu", { column: label });
  const filterActionLabel = labels?.filter ?? t("filter", { column: label });
  const allValuesLabel = labels?.allValues ?? t("allValues");
  const showSearch = filterOptions.length > 8;
  const ungroupedOptions: DashboardTableFilterOption[] = [];
  const groupedOptions = new Map<string, DashboardTableFilterOption[]>();
  for (const option of filterOptions) {
    if (!option.group) {
      ungroupedOptions.push(option);
      continue;
    }
    const group = groupedOptions.get(option.group) ?? [];
    group.push(option);
    groupedOptions.set(option.group, group);
  }

  const chooseFilter = (value: string | undefined) => {
    onFilterChange(value);
    setMenuOpen(false);
  };
  const chooseSort = (direction: DashboardTableSortDirection | undefined) => {
    onSortChange?.(direction);
    setMenuOpen(false);
  };

  const renderFilterOption = (option: DashboardTableFilterOption) => (
    <CommandItem
      key={option.value}
      value={`${option.group ?? ""} ${option.label} ${option.value}`}
      onSelect={() => chooseFilter(option.value)}
    >
      <Check className={filterValue === option.value ? "text-leaf-deep" : "opacity-0"} />
      <span className="truncate">{option.label}</span>
    </CommandItem>
  );

  return (
    <div className="-ml-2 inline-flex max-w-full items-center">
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-w-0 gap-1 px-2 text-xs font-medium text-muted hover:text-ink"
            aria-label={menuLabel}
            title={filterActionLabel}
            data-dashboard-table-menu
            data-dashboard-table-filter
          >
            <span className="truncate">{label}</span>
            <ListFilter className={active ? "size-3.5 shrink-0 text-rose" : "size-3.5 shrink-0"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0" aria-label={menuLabel}>
          <Command>
            <div className="px-3 pb-2 pt-3">
              <p className="text-sm font-medium text-ink">{label}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{labels?.scope ?? t("scope")}</p>
            </div>
            {showSearch ? <CommandInput placeholder={labels?.search ?? t("search")} /> : null}
            <CommandList>
              <CommandEmpty>{labels?.noOptions ?? t("noOptions")}</CommandEmpty>
              {onSortChange ? (
                <CommandGroup heading={t("sort")}>
                  <CommandItem value={`default ${t("clearSort")}`} onSelect={() => chooseSort(undefined)}>
                    <Check className={sortDirection ? "opacity-0" : "text-leaf-deep"} />
                    <span>{labels?.clearSort ?? t("clearSort")}</span>
                  </CommandItem>
                  <CommandItem value={`ascending ${t("sortAscending")}`} onSelect={() => chooseSort("asc")}>
                    <ArrowUp />
                    <span>{labels?.sortAscending ?? t("sortAscending")}</span>
                    {sortDirection === "asc" ? <Check className="ml-auto text-leaf-deep" /> : null}
                  </CommandItem>
                  <CommandItem value={`descending ${t("sortDescending")}`} onSelect={() => chooseSort("desc")}>
                    <ArrowDown />
                    <span>{labels?.sortDescending ?? t("sortDescending")}</span>
                    {sortDirection === "desc" ? <Check className="ml-auto text-leaf-deep" /> : null}
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {onSortChange ? <CommandSeparator /> : null}
              <CommandGroup heading={t("filterValues")}>
                <CommandItem value={`all ${allValuesLabel}`} onSelect={() => chooseFilter(undefined)}>
                  <Check className={filterValue ? "opacity-0" : "text-leaf-deep"} />
                  <span>{allValuesLabel}</span>
                </CommandItem>
                {ungroupedOptions.map(renderFilterOption)}
              </CommandGroup>
              {[...groupedOptions.entries()].map(([group, options]) => (
                <CommandGroup key={group} heading={group}>
                  {options.map(renderFilterOption)}
                </CommandGroup>
              ))}
              {active ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={() => { onClear(); setMenuOpen(false); }}>
                      <RotateCcw />
                      <span>{labels?.clear ?? t("clearColumn")}</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
