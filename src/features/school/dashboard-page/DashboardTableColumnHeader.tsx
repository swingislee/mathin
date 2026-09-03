"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const ALL_VALUES = "$all";

export type DashboardTableSortDirection = "asc" | "desc";

export interface DashboardTableFilterOption {
  value: string;
  label: string;
}

export interface DashboardTableColumnHeaderLabels {
  menu: string;
  scope: string;
  sortAscending: string;
  sortDescending: string;
  filter: string;
  allValues: string;
  clear: string;
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
  labels: DashboardTableColumnHeaderLabels;
  filterValue?: string;
  filterOptions: DashboardTableFilterOption[];
  sortDirection?: DashboardTableSortDirection;
  onFilterChange: (value: string | undefined) => void;
  onSortChange: (direction: DashboardTableSortDirection) => void;
  onClear: () => void;
}) {
  const active = Boolean(filterValue || sortDirection);
  const SortIcon = sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 gap-1 px-2 text-xs font-medium text-muted hover:text-ink"
          aria-label={labels.menu}
        >
          <span>{label}</span>
          <ListFilter className={active && filterValue ? "size-3.5 text-rose" : "size-3.5"} />
          <SortIcon className={active && sortDirection ? "size-3.5 text-rose" : "size-3.5"} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-3 p-3">
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-xs text-muted">{labels.scope}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={sortDirection === "asc" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 justify-start px-2 text-xs"
            onClick={() => onSortChange("asc")}
          >
            <ArrowUp className="size-3.5" />{labels.sortAscending}
          </Button>
          <Button
            type="button"
            variant={sortDirection === "desc" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 justify-start px-2 text-xs"
            onClick={() => onSortChange("desc")}
          >
            <ArrowDown className="size-3.5" />{labels.sortDescending}
          </Button>
        </div>
        <Separator />
        <Select
          value={filterValue ?? ALL_VALUES}
          onValueChange={(value) => onFilterChange(value === ALL_VALUES ? undefined : value)}
        >
          <SelectTrigger className="h-8 w-full text-xs" aria-label={labels.filter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUES}>{labels.allValues}</SelectItem>
            {filterOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start px-2 text-xs"
          disabled={!active}
          onClick={onClear}
        >
          <RotateCcw className="size-3.5" />{labels.clear}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
