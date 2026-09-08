"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableHead, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { STAFF_OVERVIEW_METRICS, type StaffOverviewGrain } from "./staff-overview-contract";
import type { OverviewDetailQuery, OverviewDetailResult } from "./staff-overview-drilldown-contract";
import { readOverviewDetail } from "./staff-overview-drilldown-actions";
import { overviewDetailMessages } from "./staff-overview-drilldown-messages";

type Selection = { query: OverviewDetailQuery; title: string };
const DetailContext = createContext<((selection: Selection) => void) | null>(null);
const interactive = "cursor-pointer transition-colors hover:bg-moon/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-crater";

export function OverviewDetailTrigger({ query, title, children, className, ...props }: Selection & ComponentProps<"button">) {
  const open = useContext(DetailContext);
  return <button {...props} type="button" title={title} className={cn("text-left", interactive, className)}
    onClick={event => { event.stopPropagation(); open?.({ query, title }); }}>{children}</button>;
}

export function OverviewDetailRow({ query, title, children, className, ...props }: Selection & ComponentProps<"tr">) {
  const open = useContext(DetailContext);
  return <TableRow {...props} className={cn("border-b border-line", interactive, className)} tabIndex={0} aria-label={title}
    onClick={() => open?.({ query, title })} onKeyDown={event => {
      if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open?.({ query, title }); }
    }}>{children}</TableRow>;
}

export function StaffOverviewDrilldown({ children, grain, date, generatedAt, selectedSupportIds }: {
  children: ReactNode; grain: StaffOverviewGrain; date: string; generatedAt: string; selectedSupportIds: string[];
}) {
  const locale = useLocale();
  const m = overviewDetailMessages(locale);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [result, setResult] = useState<OverviewDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [request, setRequest] = useState<{ next: Selection; term: string; page: number; size: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const label = (key: string) => m[key as keyof typeof m] ?? key;
  function load(next: Selection, term = "", page = 0, size = pageSize) {
    setSelection(next); setLoading(true); setFailed(false); setResult(null); setAppliedSearch(term);
    setRequest({ next, term, page, size });
  }
  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    void readOverviewDetail({ grain, date, generatedAt, selectedSupportIds, query: request.next.query, search: request.term, page: request.page, pageSize: request.size })
      .then(data => { if (!cancelled) setResult(data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request, grain, date, generatedAt, selectedSupportIds]);
  const isPeriod = selection && !["pending", "capacity"].includes(selection.query.kind);
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: result?.timeZone ?? "Asia/Shanghai" }).format(new Date(value));
  const range = result?.range.split("/");
  return <DetailContext.Provider value={next => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearch(""); void load(next);
  }}>
    {children}
    <Dialog open={selection !== null} onOpenChange={open => { if (!open) { setRequest(null); setSelection(null); } }}>
      <DialogContent className="flex h-[min(85dvh,760px)] max-w-4xl flex-col gap-4 p-4 sm:p-6" showCloseButton={false}
        onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
        <DialogClose asChild><Button variant="ghost" size="sm" className="absolute right-3 top-3 size-8 p-0" aria-label={m.close}><X className="size-4" /></Button></DialogClose>
        <div className="pr-12"><DialogTitle>{selection?.query.kind === "business" ? label(selection.query.metric ?? "detail") : selection?.title}</DialogTitle><DialogDescription>{m.detail}</DialogDescription></div>
        {selection && <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {isPeriod ? (["current", "previous"] as const).map(period => <Button variant="ghost" key={period} type="button" aria-pressed={(selection.query.period ?? "current") === period}
              className={cn("rounded-md border border-line px-3 py-1.5", (selection.query.period ?? "current") === period && "bg-moon/30 text-ink")}
              onClick={() => void load({ ...selection, query: { ...selection.query, period } }, appliedSearch)}>{m[period]}</Button>) : <span>{m.currentState}</span>}
            {range && <span className="text-muted">{formatDate(range[0])}{range[1] ? ` – ${formatDate(new Date(Date.parse(range[1]) - 1).toISOString())}` : ""}</span>}
          </div>
          {(selection.query.kind === "business" || selection.query.kind === "support") && <div className="flex flex-wrap gap-1">
            {STAFF_OVERVIEW_METRICS.map(metric => <Button variant="ghost" key={metric} type="button" aria-pressed={selection.query.metric === metric}
              className={cn("rounded-md px-2 py-1 text-xs", selection.query.metric === metric ? "bg-moon/30 text-ink" : "text-muted hover:bg-moon/15")}
              onClick={() => void load({ ...selection, query: { ...selection.query, metric } }, appliedSearch)}>{label(metric)}</Button>)}
          </div>}
          {selection.query.kind === "capacity" && <p className="text-xs leading-5 text-muted">{m.capacityNote}</p>}
          {selection.query.metric === "conversion" && <p className="text-xs leading-5 text-muted">{m.conversionNote}</p>}
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void load(selection, search); }}>
            <Input className="min-w-0 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} placeholder={m.search} aria-label={m.search} />
            <Button variant="ghost" className="rounded-md border border-line px-3 text-sm" type="submit">{m.apply}</Button>
          </form>
          <div aria-live="polite" role="status" className="text-xs text-muted">{loading ? m.loading : failed ? m.error : result?.available === false ? m.unavailable : result ? `${result.filteredTotal} / ${result.total} ${m.records}` : ""}</div>
          {failed && <Button variant="ghost" className="self-start rounded-md border border-line px-3 py-1.5 text-sm" onClick={() => void load(selection, appliedSearch)}>{m.retry}</Button>}
          {result?.available && <>
              <Table containerClassName="min-h-0 flex-1 overflow-auto rounded-lg border border-line" className="w-full text-left text-xs"><TableHeader className="sticky top-0 bg-paper"><TableRow>
                <TableHead className="p-3">{m.name}</TableHead><TableHead className="p-3">{m.date}</TableHead><TableHead className="p-3">{m.person}</TableHead>
              </TableRow></TableHeader><TableBody>{result.records.map(row => <TableRow key={row.id} className="border-t border-line align-top">
                <TableCell className="p-3"><div className="font-medium text-ink">{row.href ? <Link href={row.href} className="underline decoration-line underline-offset-4 hover:text-rose" title={m.open}>{row.name || m.unnamed}</Link> : row.name || m.unnamed}</div>
                  {row.values?.map((item, index) => <div key={index} className="mt-1 text-[11px] text-muted">{label(item.label)}: {item.label === "enrollmentOutcome" ? label(item.value) : item.value}</div>)}
                </TableCell><TableCell className="whitespace-nowrap p-3 text-muted">{row.at ? formatDate(row.at) : "—"}</TableCell><TableCell className="p-3 text-muted">{row.person || "—"}</TableCell>
              </TableRow>)}{result.records.length === 0 && <TableRow><TableCell colSpan={3} className="p-8 text-center text-sm text-muted">{appliedSearch ? m.noMatch : m.empty}</TableCell></TableRow>}</TableBody></Table>
            <Pagination aria-label={m.detail}><PaginationContent className="w-full justify-between text-xs"><PaginationItem>
              <Button variant="ghost" disabled={result.page === 0} className="rounded border border-line px-3 py-2 disabled:opacity-40" onClick={() => void load(selection, appliedSearch, result.page - 1)}>{m.previousPage}</Button>
              </PaginationItem><PaginationItem className="flex items-center gap-2"><span>{result.page + 1} / {Math.max(1, Math.ceil(result.filteredTotal / pageSize))}</span>
                <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); void load(selection, appliedSearch, 0, Number(value)); }}>
                  <SelectTrigger className="h-8 w-auto" aria-label={m.pageSize}><SelectValue /></SelectTrigger>
                  <SelectContent>{[25, 50, 100].map(size => <SelectItem key={size} value={String(size)}>{size} {m.perPage}</SelectItem>)}</SelectContent>
                </Select>
              </PaginationItem><PaginationItem>
              <Button variant="ghost" disabled={(result.page + 1) * pageSize >= result.filteredTotal} className="rounded border border-line px-3 py-2 disabled:opacity-40" onClick={() => void load(selection, appliedSearch, result.page + 1)}>{m.nextPage}</Button>
            </PaginationItem></PaginationContent></Pagination>
          </>}
        </>}
      </DialogContent>
    </Dialog>
  </DetailContext.Provider>;
}
