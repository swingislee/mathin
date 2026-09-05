"use client";

import { ChevronLeft, ChevronRight, ListChecks, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRouter } from "@/i18n/navigation";
import { DashboardCommandActions, DashboardCommandFilters } from "./dashboard-page";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { DashboardSearch } from "./DashboardSearch";
import { useCommunicationWorkSelection } from "./CommunicationWorkSelection";
import { createCommunicationWorklistAction } from "./communication-workday-actions";
import { communicationDayBounds, type CommunicationWorkbenchOptions, type CommunicationWorkday, type CommunicationWorklist } from "./communication-workday-contract";

export function CommunicationWorkToolbar({ options, scope, canViewAll, canManage, workday, worklist, worklists, pageKeys, count, today, query = "" }: {
  options: CommunicationWorkbenchOptions; scope: string; canViewAll: boolean; canManage: boolean;
  workday?: CommunicationWorkday; worklist?: CommunicationWorklist | null; worklists: CommunicationWorklist[];
  pageKeys: string[]; count: number; today: string; query?: string;
}) {
  const t = useTranslations("school.communicationWorkday");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selection = useCommunicationWorkSelection();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const actionable = new Set(pageKeys);
  const selectedKeys = [...selection.selectedKeys].filter((key) => actionable.has(key));
  const keys = selectedKeys.length ? selectedKeys : (selection.visibleKeys ?? pageKeys).filter((key) => actionable.has(key)).slice(0, 20);
  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page"); next.delete("lead"); next.delete("status");
    for (const [key, value] of Object.entries(patch)) { if (value) next.set(key, value); else next.delete(key); }
    startTransition(() => router.replace(`/dashboard/followups/communication?${next}`));
  };
  const shiftDay = (offset: number) => {
    const next = new Date(`${options.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + offset);
    navigate({ date: next.toISOString().slice(0, 10) });
  };
  const create = () => {
    setError("");
    startTransition(async () => {
      const result = await createCommunicationWorklistAction({ name: name.trim() || t("defaultName", { date }), date, keys });
      if (!result.ok) { setError(t("createFailed")); return; }
      selection.clear(); setCreateOpen(false);
      router.replace(`/dashboard/followups/communication?view=worklist&worklist=${result.data.id}&date=${date}&scope=mine&pageSize=20`);
    });
  };
  const recordedPeople = new Set(workday?.events.map((event) => event.key)).size;
  const completed = worklist?.items.filter((item) => item.completedAt).length ?? 0;
  return <>
    <DashboardCommandFilters>
      <FollowupChoice value={options.view} label={t("viewLabel")} disabled={pending} className="w-32 shrink-0"
        options={(["day", "records", "unscheduled", "all", ...(worklist ? ["worklist"] : [])] as const).map((value) => ({ value, label: value === "worklist" ? t("view_worklist") : t(`view_${value}`) }))}
        onValueChange={(view) => navigate({ view, worklist: view === "worklist" ? worklist?.id ?? null : null, q: null })} />
      {options.view === "day" || options.view === "records" ? <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={t("previousDay")} disabled={pending} onClick={() => shiftDay(-1)}><ChevronLeft className="size-4" /></Button>
        <Input type="date" value={options.date} aria-label={t("date")} className="h-8 w-36 text-xs" disabled={pending} onChange={(event) => { try { communicationDayBounds(event.target.value); navigate({ date: event.target.value }); } catch { /* 等待完整日期。 */ } }} />
        <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={t("nextDay")} disabled={pending} onClick={() => shiftDay(1)}><ChevronRight className="size-4" /></Button>
        {options.date !== today ? <Button variant="ghost" size="sm" onClick={() => navigate({ date: today })}>{t("today")}</Button> : null}
      </div> : null}
      {canViewAll ? <FollowupChoice value={scope} label={t("scope")} disabled={pending || options.view === "worklist"} options={[{ value: "mine", label: t("mine") }, { value: "all", label: t("team") }]} onValueChange={(value) => navigate({ scope: value })} /> : null}
      <span className="max-w-72 truncate text-xs tabular-nums text-muted" title={worklist?.name}>{worklist ? t("progress", { name: worklist.name, completed, total: worklist.items.length }) : options.view === "records" || options.view === "day" ? t("dayCount", { count, recorded: recordedPeople }) : t("count", { count })}</span>
      <DashboardSearch value={search} onChange={(event) => setSearch(event.target.value)} onSearch={() => navigate({ q: search.trim() || null })} aria-label={t("search")} placeholder={t("search")} />
    </DashboardCommandFilters>
    <DashboardCommandActions>
      {worklists.length ? <Popover><PopoverTrigger asChild><Button type="button" variant="secondary" size="sm"><ListChecks className="size-4" />{t("resume")}</Button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2"><div className="max-h-72 overflow-y-auto">{worklists.map((list) => <Button key={list.id} type="button" variant="ghost" className="h-auto w-full justify-between gap-3 rounded-lg px-3 py-2 text-left" disabled={pending} onClick={() => navigate({ view: "worklist", worklist: list.id, date: list.date, scope: "mine", q: null })}>
          <span className="min-w-0"><span className="block truncate text-sm">{list.name}</span><span className="block text-xs text-muted">{list.date}</span></span><span className="shrink-0 text-xs tabular-nums text-muted">{list.items.filter((item) => item.completedAt).length}/{list.items.length}</span>
        </Button>)}</div></PopoverContent></Popover> : null}
      {canManage && options.view !== "worklist" ? <Popover open={createOpen} onOpenChange={setCreateOpen}><PopoverTrigger asChild><Button type="button" size="sm" disabled={!keys.length || pending}><Play className="size-4" />{selectedKeys.length ? t("startSelected", { count: keys.length }) : t("startRound")}</Button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3">
          <p className="text-xs text-muted">{t(selectedKeys.length ? "selectedCount" : "pageBatchCount", { count: keys.length })}</p>
          <label className="block space-y-1 text-xs text-muted"><span>{t("worklistName")}</span><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={t("defaultName", { date })} className="h-9" /></label>
          <label className="block space-y-1 text-xs text-muted"><span>{t("workDate")}</span><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9" /></label>
          {error ? <p role="alert" className="text-xs text-rose">{error}</p> : null}
          <Button type="button" className="w-full" size="sm" onClick={create} disabled={pending || !date || !keys.length}>{t("create")}</Button>
        </PopoverContent></Popover> : null}
      {options.view === "day" && count === 0 && canManage ? <Button variant="secondary" size="sm" onClick={() => navigate({ view: "unscheduled", q: null })}>{t("chooseBacklog")}</Button> : null}
    </DashboardCommandActions>
  </>;
}
