"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Settings2, X } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardPage, DashboardCommandPanel, DashboardCommandActions, DashboardCommandFilters } from "./dashboard-page";
import {
  DEFAULT_LEAD_RULES, LEAD_FIELDS, LEAD_LANES, LEAD_LIGHTS, LEAD_LIGHT_DOT, LEAD_OPS, assessFacts, judgeLead, resolveLeadRules, supportFacts, teachFacts,
  type LeadBoard, type LeadCondition, type LeadGrain, type LeadFacts, type LeadLane, type LeadLight, type LeadRuleConfig, type LeadSubject,
} from "./lead-board-contract";
import { leadBoardMessages, type LeadBoardMessages } from "./lead-board-messages";
import { readLeadSubjectAction, saveLeadRulesAction } from "./actions/lead-board";

type Item = { lane: LeadLane; key: string; name: string; ownerId: string; cluster: string; clusterLabel: string; facts: LeadFacts; color: LeadLight; rule: number };
type Rules = Record<LeadLane, LeadRuleConfig>;
const SUPPORT_ORDER = ["first", "assess", "after", "enroll", "serve", "renew", "other"];
const STEP_ORDER = ["arrival", "record", "explain", "done"];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dotSize = (n: number) => n > 200 ? 7 : n > 120 ? 9 : n > 60 ? 11 : 13;

function savedRules(board: LeadBoard): Rules {
  return Object.fromEntries(LEAD_LANES.map(lane => [lane, resolveLeadRules(board, lane)])) as Rules;
}
function buildItems(board: LeadBoard, rules: Rules, m: LeadBoardMessages): Item[] {
  const judge = (lane: LeadLane, facts: LeadFacts) => judgeLead(rules[lane], facts);
  return [
    ...board.support.map(row => { const facts = supportFacts(row, rules.support), cluster = String(facts.cluster);
      return { lane: "support" as const, key: row.key, name: row.name, ownerId: row.ownerId, cluster, clusterLabel: m.clusters[cluster], facts, ...judge("support", facts) }; }),
    ...board.teach.map(row => { const facts = teachFacts(row, rules.teach);
      return { lane: "teach" as const, key: row.key, name: row.name, ownerId: row.ownerId, cluster: row.classId, clusterLabel: row.className, facts, ...judge("teach", facts) }; }),
    ...board.assess.map(row => { const facts = assessFacts(row);
      return { lane: "assess" as const, key: row.key, name: row.name, ownerId: row.ownerId, cluster: row.step, clusterLabel: m.steps[row.step], facts, ...judge("assess", facts) }; }),
  ];
}
function clusterRank(item: Item) {
  return item.lane === "support" ? SUPPORT_ORDER.indexOf(item.cluster) : item.lane === "assess" ? STEP_ORDER.indexOf(item.cluster) : 0;
}

function shiftAnchor(from: string, grain: LeadGrain, delta: number) {
  // 时间段起点是机构时区的零点；加半天后按 UTC 取日期，任何时区都落在同一天。
  const day = new Date(new Date(from).getTime() + 12 * 3600 * 1000);
  if (grain === "week") day.setUTCDate(day.getUTCDate() + delta * 7); else day.setUTCMonth(day.getUTCMonth() + delta, 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
}
function periodLabel(period: LeadBoard["period"], locale: string) {
  const start = new Date(period.from), end = new Date(new Date(period.to).getTime() - 1);
  if (period.grain === "month") return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(start);
  const day = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
  return `${day.format(start)} – ${day.format(end)}`;
}

export function LeadBoardWorkspace({ initial, locale }: { initial: LeadBoard; locale: string }) {
  const m = leadBoardMessages(locale), router = useRouter();
  const [board, setBoard] = useState(initial);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [editLane, setEditLane] = useState<LeadLane>("support");
  const [only, setOnly] = useState<LeadLight | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ lane: LeadLane; key: string; ownerId: string } | null>(null);
  const [records, setRecords] = useState<Record<string, LeadSubject | "error">>({});
  const [status, setStatus] = useState("");
  const [pending, start] = useTransition();
  const rules = draft ?? savedRules(board);
  const go = (next: { unit?: string; grain?: LeadGrain; date?: string | null }) => {
    const query = new URLSearchParams({ unit: next.unit ?? board.unitId ?? "", grain: next.grain ?? board.period.grain });
    const date = next.date === undefined ? (board.period.isCurrent ? null : shiftAnchor(board.period.from, board.period.grain, 0)) : next.date;
    if (date) query.set("date", date);
    router.push(`/dashboard/lead-board?${query.toString()}`);
  };
  const items = useMemo(() => buildItems(board, rules, m), [board, rules, m]);
  const unitName = (id: string) => board.units.find(unit => unit.id === id)?.name ?? "";
  const unitLabel = (id: string) => {
    const byId = new Map(board.units.map(unit => [unit.id, unit])), names: string[] = [];
    for (let unit = byId.get(id); unit && names.length < 16; unit = unit.parentId ? byId.get(unit.parentId) : undefined) names.unshift(unit.name);
    return names.join(" / ");
  };

  const select = (item: Item) => {
    setSelected({ lane: item.lane, key: item.key, ownerId: item.ownerId });
    if (records[item.key] || !board.unitId) return;
    const unitId = board.unitId;
    start(async () => {
      const result = await readLeadSubjectAction({ unitId, key: item.key });
      setRecords(current => ({ ...current, [item.key]: result.ok ? result.data : "error" }));
    });
  };
  const saveRules = (config: LeadRuleConfig | null) => {
    if (!board.unitId) return;
    const unitId = board.unitId;
    start(async () => {
      const result = await saveLeadRulesAction({ unitId, lane: editLane, config });
      if (!result.ok) { setStatus(m.saveFailed); return; }
      const next = { ...board, rules: result.data.rules };
      setBoard(next); setDraft(current => current ? { ...current, [editLane]: resolveLeadRules(next, editLane) } : current); setStatus(m.saved);
    });
  };

  if (!board.unitId) return <DashboardPage title={m.title} density="compact"><p className="py-10 text-center text-sm text-muted">{m.noUnits}</p></DashboardPage>;

  const counts = Object.fromEntries(LEAD_LIGHTS.map(light => [light, items.filter(item => item.color === light).length])) as Record<LeadLight, number>;
  const selectedItem = selected ? items.find(item => item.lane === selected.lane && item.key === selected.key && item.ownerId === selected.ownerId) : undefined;

  return <DashboardPage title={m.title} density="compact" description={m.info}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandFilters>
        <Select value={board.unitId} onValueChange={value => go({ unit: value })}>
          <SelectTrigger aria-label={m.unit} className="h-8 min-w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{board.units.map(unit => <SelectItem key={unit.id} value={unit.id}>{unitLabel(unit.id)}</SelectItem>)}</SelectContent>
        </Select>
        <div role="group" aria-label={m.grains.week} className="inline-flex rounded-lg bg-line/55 p-[3px]">
          {(["week", "month"] as const).map(grain => <button key={grain} type="button" aria-pressed={board.period.grain === grain} onClick={() => go({ grain, date: null })}
            className={cn("rounded-md px-3 py-0.5 text-sm text-muted", board.period.grain === grain && "bg-card text-ink shadow-sm")}>{m.grains[grain]}</button>)}
        </div>
        <div className="inline-flex items-center gap-0.5">
          <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={m.previous} onClick={() => go({ date: shiftAnchor(board.period.from, board.period.grain, -1) })}><ChevronLeft className="size-4" /></Button>
          <span className="min-w-28 text-center text-sm tabular-nums">{periodLabel(board.period, locale)}</span>
          <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={m.next} disabled={board.period.isCurrent} onClick={() => go({ date: shiftAnchor(board.period.from, board.period.grain, 1) })}><ChevronRight className="size-4" /></Button>
          {!board.period.isCurrent ? <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => go({ date: null })}>{m.current[board.period.grain]}</Button> : null}
        </div>
      </DashboardCommandFilters>
      <DashboardCommandActions>
        {board.canManageRules ? <Button size="sm" variant={draft ? "primary" : "secondary"} onClick={() => setDraft(current => current ? null : clone(savedRules(board)))}>
          <Settings2 className="size-4" />{draft ? m.done : m.settings}</Button> : null}
      </DashboardCommandActions>
    </DashboardCommandPanel>}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>{m.whole}</span>
      {LEAD_LIGHTS.map(light => <button key={light} type="button" aria-pressed={only === light} onClick={() => setOnly(current => current === light ? null : light)}
        className={cn("inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5", only === light && "border-crater bg-table-selected text-ink")}>
        <i className={cn("size-2.5 rounded-full", LEAD_LIGHT_DOT[light])} aria-hidden />{m.lights[light]}<span className="tabular-nums text-ink">{counts[light]}</span></button>)}
      <span role="status" className="ml-auto">{status}</span>
    </div>
    <div className="grid min-w-0 overflow-hidden rounded-[10px] border border-line bg-card @5xl/page:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0">
        {!board.members.length ? <p className="p-8 text-center text-sm text-muted">{m.noMembers}</p> : null}
        {board.members.map(member => {
          const mine = items.filter(item => item.ownerId === member.id), size = dotSize(mine.length), columns = size < 10 ? 14 : 10;
          const lanes = LEAD_LANES.filter(lane => mine.some(item => item.lane === lane));
          return <section key={member.id} className="grid border-b border-line last:border-b-0 @3xl/page:grid-cols-[9.5rem_minmax(0,1fr)]">
            <div className="flex flex-col gap-1.5 border-b border-dashed border-line px-3 py-2.5 @3xl/page:border-b-0 @3xl/page:border-r @3xl/page:border-solid">
              <p className="font-semibold">{member.name}{member.lead ? <span className="ml-1.5 rounded-[3px] border border-crater px-1 text-[10px] text-crater">{m.lead}</span> : null}</p>
              <p className="text-[11px] leading-5 text-muted">{unitName(member.unitId)}<br />{m.students(new Set(mine.map(item => item.key)).size)}<br />{m.week(member.weekContacts, member.weekEffective)}</p>
              {mine.length ? <div className="flex h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>{LEAD_LIGHTS.map(light => {
                const n = mine.filter(item => item.color === light).length;
                return n ? <i key={light} className={LEAD_LIGHT_DOT[light]} style={{ width: `${n / mine.length * 100}%` }} /> : null; })}</div> : null}
            </div>
            <div className="min-w-0">
              {!lanes.length ? <p className="px-3 py-3 text-xs text-muted">{m.noStudents}</p> : null}
              {lanes.map(lane => {
                const laneItems = mine.filter(item => item.lane === lane).sort((a, b) => clusterRank(a) - clusterRank(b) || a.clusterLabel.localeCompare(b.clusterLabel, "zh"));
                const clusters = [...new Map(laneItems.map(item => [item.cluster, item.clusterLabel])).entries()];
                return <div key={lane} className="grid grid-cols-[3.2rem_minmax(0,1fr)] gap-2 border-b border-dashed border-line px-3 py-2 last:border-b-0">
                  <span className="pt-px text-xs text-muted">{m.lanes[lane]}</span>
                  <div className={cn("flex min-w-0 flex-wrap gap-y-2", lane === "teach" ? "gap-x-2.5" : "gap-x-4")}>{clusters.map(([cluster, label]) => {
                    const dots = laneItems.filter(item => item.cluster === cluster);
                    return <div key={cluster} className="flex min-w-0 flex-col gap-1">
                      {lane === "teach" ? <span className="w-fit rounded-full bg-line/60 px-1.5 text-[10px] tabular-nums text-muted" title={m.classStudents(label, dots.length)}>{dots.length}</span>
                        : <span className="whitespace-nowrap text-[11px] text-muted">{label} <span className="tabular-nums">{dots.length}</span></span>}
                      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(columns, dots.length)}, ${size}px)` }}>
                        {dots.map(item => { const active = selected?.key === item.key && selected.lane === item.lane && selected.ownerId === item.ownerId;
                          return <button key={`${item.lane}:${item.key}`} type="button" title={`${item.name} · ${label} · ${m.lightShort[item.color]}`}
                            aria-label={`${item.name} · ${label} · ${m.lights[item.color]}`} aria-pressed={active}
                            className={cn("rounded-full", LEAD_LIGHT_DOT[item.color], only && item.color !== only && "opacity-15",
                              hover === item.key && "ring-2 ring-[#4C7BD9] ring-offset-1 ring-offset-card", active && "outline outline-2 outline-offset-1 outline-ink")}
                            style={{ width: size, height: size }} onPointerEnter={() => setHover(item.key)} onPointerLeave={() => setHover(null)}
                            onClick={() => select(item)} />; })}
                      </div>
                    </div>; })}</div>
                </div>; })}
            </div>
          </section>; })}
      </div>
      <aside aria-live="polite" className="min-w-0 border-t border-line p-4 @5xl/page:max-h-[calc(100dvh-12rem)] @5xl/page:overflow-y-auto @5xl/page:border-l @5xl/page:border-t-0">
        {draft ? <RuleEditor m={m} lane={editLane} onLane={setEditLane} config={draft[editLane]} pending={pending}
          source={board.rules[editLane] ? m.inherited(unitName(board.rules[editLane].unitId)) : m.defaults}
          onChange={config => setDraft(current => current ? { ...current, [editLane]: config } : current)}
          onSave={() => saveRules(draft[editLane])} onReset={() => setDraft(current => current ? { ...current, [editLane]: clone(DEFAULT_LEAD_RULES[editLane]) } : current)}
          onDiscard={() => setDraft(current => current ? { ...current, [editLane]: resolveLeadRules(board, editLane) } : current)} />
        : selectedItem ? <SubjectPanel m={m} item={selectedItem} rules={rules} board={board} items={items} record={records[selectedItem.key]} onClose={() => setSelected(null)} />
        : <div className="flex flex-col gap-3"><p className="text-xs font-semibold tracking-wide text-muted">{m.howTitle}</p>
            <ul className="space-y-2 text-sm leading-6">{m.how.map(line => <li key={line}>{line}</li>)}</ul></div>}
      </aside>
    </div>
  </DashboardPage>;
}

function conditionText(m: LeadBoardMessages, lane: LeadLane, [field, op, value]: LeadCondition) {
  const def = LEAD_FIELDS[lane].find(item => item.key === field);
  const shown = def?.type === "bool" ? (value ? m.yes : m.no) : def?.type === "enum" ? optionLabel(m, field, String(value)) : `${value}${def?.unit ? m.units[def.unit] : ""}`;
  return `${m.fields[field] ?? field} ${m.ops[op]} ${shown}`;
}
function optionLabel(m: LeadBoardMessages, field: string, value: string) {
  return field === "label" ? m.labels[value] ?? value : field === "cluster" ? m.clusters[value] ?? value : field === "step" ? m.steps[value] ?? value : field === "lastResult" ? m.results[value] ?? value : value;
}
function factText(m: LeadBoardMessages, lane: LeadLane, key: string, value: LeadFacts[string]) {
  const def = LEAD_FIELDS[lane].find(item => item.key === key);
  if (value === null || value === undefined) return m.empty;
  if (typeof value === "boolean") return value ? m.yes : m.no;
  if (def?.type === "enum") return optionLabel(m, key, String(value));
  return `${value}${def?.unit ? ` ${m.units[def.unit]}` : ""}`;
}

function SubjectPanel({ m, item, rules, board, items, record, onClose }: {
  m: LeadBoardMessages; item: Item; rules: Rules; board: LeadBoard; items: Item[]; record: LeadSubject | "error" | undefined; onClose: () => void;
}) {
  const owner = board.members.find(member => member.id === item.ownerId)?.name ?? "";
  const rule = rules[item.lane].rules[item.rule];
  const why = rule ? m.why(item.rule + 1, rule.all.map(condition => conditionText(m, item.lane, condition)).join(m.and) || m.allCases, m.lightShort[item.color]) : m.whyElse(m.lightShort[item.color]);
  const others = items.filter(other => other.key === item.key && other !== item);
  const studentId = item.key.startsWith("student:") ? item.key.slice(8) : null;
  return <div className="flex flex-col gap-3">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
      <div className="min-w-0"><p className="truncate text-base font-semibold">{item.name || "—"}</p>
        <p className="truncate text-xs text-muted">{m.owner} {owner} · {m.lanes[item.lane]} · {item.clusterLabel}</p></div>
      <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={m.done} onClick={onClose}><X className="size-4" /></Button>
    </div>
    <p className="rounded-md bg-moon/25 px-2.5 py-1.5 text-xs leading-5"><i className={cn("mr-1.5 inline-block size-2.5 rounded-full align-[-1px]", LEAD_LIGHT_DOT[item.color])} />{why}</p>
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-2 text-sm">
      {LEAD_FIELDS[item.lane].map(field => <div key={field.key} className="contents"><dt className="text-muted">{m.fields[field.key]}</dt><dd className="tabular-nums">{factText(m, item.lane, field.key, item.facts[field.key])}</dd></div>)}
    </dl>
    {others.length ? <div><p className="mb-1 text-xs text-muted">{m.otherMembers}</p><ul className="border-t border-line">{others.map(other => <li key={`${other.lane}:${other.ownerId}`} className="flex items-center gap-2 border-b border-line py-1.5 text-sm">
      <i className={cn("size-2.5 rounded-full", LEAD_LIGHT_DOT[other.color])} aria-hidden />{board.members.find(member => member.id === other.ownerId)?.name} · {m.lanes[other.lane]} · {other.clusterLabel}</li>)}</ul></div> : null}
    <div><p className="mb-1 text-xs text-muted">{m.records}</p>
      {record === undefined ? <p className="text-sm text-muted">{m.loading}</p> : record === "error" ? <p className="text-sm text-rose">{m.loadFailed}</p>
        : !record.records.length ? <p className="text-sm text-muted">{m.noRecords}</p>
        : <ul className="border-t border-line">{record.records.map((row, index) => <li key={index} className="border-b border-line py-2">
          <p className="text-xs text-muted">{new Date(row.at).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {m.results[row.outcome ?? "none"] ?? row.outcome} · {row.by}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6">{row.note || m.empty}</p></li>)}</ul>}
    </div>
    {studentId ? <Link href={`/dashboard/students/${studentId}`} className="text-sm underline-offset-2 hover:underline">{m.open360}</Link> : null}
  </div>;
}

function RuleEditor({ m, lane, onLane, config, source, pending, onChange, onSave, onReset, onDiscard }: {
  m: LeadBoardMessages; lane: LeadLane; onLane: (lane: LeadLane) => void; config: LeadRuleConfig; source: string; pending: boolean;
  onChange: (config: LeadRuleConfig) => void; onSave: () => void; onReset: () => void; onDiscard: () => void;
}) {
  const fields = LEAD_FIELDS[lane];
  const update = (change: (next: LeadRuleConfig) => void) => { const next = clone(config); change(next); onChange(next); };
  const defaultCondition = (key: string): LeadCondition => {
    const def = fields.find(field => field.key === key)!;
    return [key, LEAD_OPS[def.type][0], def.type === "num" ? 0 : def.type === "bool" ? true : def.options![0]];
  };
  const cadenceKeys = Object.keys(DEFAULT_LEAD_RULES[lane].cadence);
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-1">{LEAD_LANES.map(item => <button key={item} type="button" aria-pressed={item === lane} onClick={() => onLane(item)}
      className={cn("rounded-full border border-line bg-paper px-3 py-0.5 text-sm", item === lane && "border-crater bg-table-selected")}>{m.lanes[item]}</button>)}</div>
    <p className="text-xs leading-5 text-muted">{m.editorHint}<br />{source}</p>
    {cadenceKeys.length ? <div className="rounded-lg border border-line p-2.5">
      <p className="mb-1.5 text-xs text-muted">{lane === "teach" ? m.teachCadence : m.cadence}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">{cadenceKeys.map(key => <label key={key} className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{lane === "teach" ? m.labels[key] ?? key : m.clusters[key]}</span>
        <Input type="number" min={0} max={365} className="h-7 w-16 px-1.5 text-right" value={config.cadence[key] ?? 0}
          onChange={event => update(next => { next.cadence[key] = Math.max(0, Math.min(365, Math.round(Number(event.target.value) || 0))); })} /></label>)}</div>
    </div> : null}
    {config.rules.map((rule, index) => <div key={index} className="flex flex-col gap-1.5 rounded-lg border border-line bg-moon/15 p-2">
      <div className="flex items-center gap-1 text-xs text-muted">
        <i className={cn("size-2.5 rounded-full", LEAD_LIGHT_DOT[rule.color])} aria-hidden />{m.ruleN(index + 1)}<span className="flex-1" />
        <Button size="sm" variant="ghost" className="size-6 p-0" aria-label={m.moveUp} disabled={index === 0} onClick={() => update(next => { [next.rules[index - 1], next.rules[index]] = [next.rules[index], next.rules[index - 1]]; })}><ArrowUp className="size-3.5" /></Button>
        <Button size="sm" variant="ghost" className="size-6 p-0" aria-label={m.moveDown} disabled={index === config.rules.length - 1} onClick={() => update(next => { [next.rules[index + 1], next.rules[index]] = [next.rules[index], next.rules[index + 1]]; })}><ArrowDown className="size-3.5" /></Button>
        <Button size="sm" variant="ghost" className="size-6 p-0" aria-label={m.remove} onClick={() => update(next => { next.rules.splice(index, 1); })}><X className="size-3.5" /></Button>
      </div>
      {rule.all.map((condition, ci) => { const def = fields.find(field => field.key === condition[0]) ?? fields[0];
        return <div key={ci} className="flex flex-wrap items-center gap-1 text-sm">
          <span className="w-7 text-[11px] text-muted">{ci ? m.andShort : m.when}</span>
          <NativeSelect value={condition[0]} label={m.fields[condition[0]]} onChange={value => update(next => { next.rules[index].all[ci] = defaultCondition(value); })}
            options={fields.map(field => [field.key, m.fields[field.key]])} />
          <NativeSelect value={condition[1]} label={m.ops[condition[1]]} onChange={value => update(next => { next.rules[index].all[ci][1] = value as LeadCondition[1]; })}
            options={LEAD_OPS[def.type].map(op => [op, m.ops[op]])} />
          {def.type === "num" ? <span className="inline-flex items-center gap-1"><Input type="number" className="h-7 w-16 px-1.5" value={Number(condition[2])}
            onChange={event => update(next => { next.rules[index].all[ci][2] = Number(event.target.value) || 0; })} /><span className="text-[11px] text-muted">{def.unit ? m.units[def.unit] : ""}</span></span>
          : <NativeSelect value={String(condition[2])} label={String(condition[2])} onChange={value => update(next => { next.rules[index].all[ci][2] = def.type === "bool" ? value === "true" : value; })}
            options={def.type === "bool" ? [["true", m.yes], ["false", m.no]] : def.options!.map(option => [option, optionLabel(m, def.key, option)])} />}
          <Button size="sm" variant="ghost" className="size-6 p-0" aria-label={m.remove} onClick={() => update(next => { next.rules[index].all.splice(ci, 1); })}><X className="size-3.5" /></Button>
        </div>; })}
      {!rule.all.length ? <p className="text-sm text-muted">{m.allCases}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={rule.all.length >= 6} onClick={() => update(next => { next.rules[index].all.push(defaultCondition(fields[0].key)); })}><Plus className="size-3.5" />{m.addCondition}</Button>
        <span className="flex-1" /><span className="text-[11px] text-muted">{m.show}</span><LightPicker m={m} value={rule.color} onChange={color => update(next => { next.rules[index].color = color; })} />
      </div>
    </div>)}
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-2 text-sm text-muted">{m.otherwise}<span className="flex-1" />
      <LightPicker m={m} value={config.else} onChange={color => update(next => { next.else = color; })} /></div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={config.rules.length >= 30} onClick={() => update(next => { next.rules.push({ color: "yellow", all: [] }); })}><Plus className="size-4" />{m.addRule}</Button>
      <Button size="sm" variant="ghost" onClick={onReset}>{m.reset}</Button>
      <Button size="sm" variant="ghost" onClick={onDiscard}>{m.discard}</Button>
      <Button size="sm" disabled={pending} onClick={onSave}>{pending ? m.saving : m.save}</Button>
    </div>
  </div>;
}

function NativeSelect({ value, label, options, onChange }: { value: string; label: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="h-7 w-auto gap-1 px-2 text-sm"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select>;
}
function LightPicker({ m, value, onChange }: { m: LeadBoardMessages; value: LeadLight; onChange: (value: LeadLight) => void }) {
  return <span className="inline-flex gap-1">{LEAD_LIGHTS.map(light => <button key={light} type="button" aria-pressed={value === light} aria-label={m.lights[light]} title={m.lights[light]}
    onClick={() => onChange(light)} className={cn("size-[18px] rounded-full border-2 border-transparent", LEAD_LIGHT_DOT[light], value === light && "border-ink")} />)}</span>;
}
