"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Crown, Maximize, Minus, Plus, UserPlus, X } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPage, DashboardCommandPanel, DashboardCommandActions, DashboardCommandState } from "./dashboard-page";
import { SCHOOL_ORGANIZATION_KINDS, SCHOOL_STAFF_RESERVE_REASONS, type SchoolStaffReserveReason, type SchoolBusinessRole, type SchoolCollaborationSettings as Settings, type SchoolOrganizationKind } from "./school-collaboration-contract";
import {
  ORG_NODE, ORG_ROLE_ORDER, changeCount, childrenOf, departmentOf, diffOrganization, draftFromSettings, layoutOrganization, lineage,
  orderedUnits, subtreeIds, unitPath, type OrgChanges, type OrgDraft, type OrgUnit,
} from "./school-organization-model";
import { schoolOrganizationMessages, type SchoolOrganizationMessages } from "./school-organization-messages";
import { saveSchoolOrganizationAction, setStaffReserveAction } from "./actions/school-organization";
import { StaffMembersPanel } from "./StaffMembersPanel";
import type { StaffMember, StaffRoleInfo } from "./staff";
import type { StaffImportBatchSummary } from "./actions/types";

type Staff = Settings["staff"][number];
type Selection = { kind: "person" | "unit"; id: string } | null;
type Drag =
  | { kind: "person"; id: string; from: string | null; sx: number; sy: number; moved: boolean }
  | { kind: "unit"; id: string; sx: number; sy: number; moved: boolean }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean };
type View = { x: number; y: number; k: number };

const DUTY_DOT: Record<SchoolBusinessRole, string> = { school_support: "bg-leaf-deep", assessment_teacher: "bg-crater", teacher: "bg-rose" };
const CHILD_KIND: Record<SchoolOrganizationKind, SchoolOrganizationKind> = { org: "dept", campus: "dept", dept: "group", group: "group" };

function DutyDots({ roles }: { roles: SchoolBusinessRole[] }) {
  return <span className="inline-flex shrink-0 gap-0.5" aria-hidden>{ORG_ROLE_ORDER.filter(role => roles.includes(role)).map(role =>
    <i key={role} className={cn("size-2 rounded-full", DUTY_DOT[role])} />)}</span>;
}

export type StaffAdministration = {
  members: StaffMember[]; roles: StaffRoleInfo[]; recentImportBatches: StaffImportBatchSummary[];
  selfId: string; isAdmin: boolean; canInviteStaff: boolean; canManageStaff: boolean;
};

export function SchoolOrganizationBoard({ initial, locale, staffAdmin }: { initial: Settings; locale: string; staffAdmin?: StaffAdministration }) {
  const m = schoolOrganizationMessages(locale), router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<OrgDraft>(() => draftFromSettings(initial));
  const [selection, setSelection] = useState<Selection>(null);
  const [mode, setMode] = useState<"board" | "roster">("board");
  const [query, setQuery] = useState("");
  const [hoverPerson, setHoverPerson] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string; hint: string } | null>(null);
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 0.9 });
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const [rosterView, setRosterView] = useState<"active" | "reserve">("active");
  const [onboarding, setOnboarding] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [pending, start] = useTransition();
  const canvasRef = useRef<HTMLDivElement>(null), dragRef = useRef<Drag | null>(null);
  const manage = settings.canManage;

  const staffById = useMemo(() => new Map(settings.staff.map(staff => [staff.id, staff])), [settings.staff]);
  const unitById = useMemo(() => new Map(draft.units.map(unit => [unit.id, unit])), [draft.units]);
  const baseGroups = useMemo(() => new Map(settings.groups.map(group => [group.id, group])), [settings.groups]);
  const membersOf = useCallback((id: string) => draft.members.filter(row => row.groupId === id), [draft.members]);
  const linksOf = useCallback((id: string) => draft.members.filter(row => row.userId === id && unitById.has(row.groupId)), [draft.members, unitById]);
  const memberCount = useCallback((id: string) => manage ? membersOf(id).length : 1, [manage, membersOf]);
  const layout = useMemo(() => layoutOrganization(draft.units, memberCount), [draft.units, memberCount]);
  const studentsUnder = useCallback((id: string) => subtreeIds(draft.units, id).reduce((sum, unit) => sum + (baseGroups.get(unit)?.studentCount ?? 0), 0), [draft.units, baseGroups]);
  const changes = useMemo(() => diffOrganization(settings, draft), [settings, draft]);
  const dirty = changeCount(changes) > 0;
  const rolesOf = useCallback((id: string) => draft.roles[id] ?? [], [draft.roles]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = m.unsavedLeave; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, m.unsavedLeave]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas || !layout.size) return;
    const boxes = [...layout.values()], rect = canvas.getBoundingClientRect();
    const minX = Math.min(...boxes.map(b => b.x)), minY = Math.min(...boxes.map(b => b.y));
    const maxX = Math.max(...boxes.map(b => b.x + ORG_NODE.width)), maxY = Math.max(...boxes.map(b => b.y + b.h));
    const k = Math.min(1.05, Math.max(0.35, Math.min((rect.width - 48) / (maxX - minX), (rect.height - 72) / (maxY - minY))));
    setView({ k, x: (rect.width - (maxX - minX) * k) / 2 - minX * k, y: 24 - minY * k });
  }, [layout]);
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && mode === "board") { fitted.current = true; fit(); } }, [fit, mode]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => setView(current => {
    const rect = canvasRef.current?.getBoundingClientRect(); const px = cx ?? (rect?.width ?? 0) / 2, py = cy ?? (rect?.height ?? 0) / 2;
    const k = Math.min(1.8, Math.max(0.3, current.k * factor));
    return { k, x: px - (px - current.x) * k / current.k, y: py - (py - current.y) * k / current.k };
  }), []);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
      else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [zoomAt, mode]);

  /* ---------- 草稿修改 ---------- */
  const update = (change: (current: OrgDraft) => OrgDraft) => { setStatus(""); setDraft(change); };
  const addMember = (userId: string, groupId: string, from: string | null) => update(current => {
    if (current.members.some(row => row.userId === userId && row.groupId === groupId)) return current;
    const kept = from ? current.members.filter(row => !(row.userId === userId && row.groupId === from)) : current.members;
    return { ...current, members: [...kept, { userId, groupId, lead: false }] };
  });
  const removeMember = (userId: string, groupId: string) => update(current => ({ ...current, members: current.members.filter(row => !(row.userId === userId && row.groupId === groupId)) }));
  const setLead = (userId: string, groupId: string, lead: boolean) => update(current => ({ ...current,
    members: current.members.map(row => row.userId === userId && row.groupId === groupId ? { ...row, lead } : row) }));
  const setRoles = (userId: string, roles: SchoolBusinessRole[]) => update(current => ({ ...current, roles: { ...current.roles, [userId]: roles } }));
  const patchUnit = (id: string, patch: Partial<OrgUnit>) => update(current => ({ ...current, units: current.units.map(unit => unit.id === id ? { ...unit, ...patch } : unit) }));
  const reparent = (id: string, parentId: string | null) => update(current => {
    if (parentId && subtreeIds(current.units, id).includes(parentId)) return current;
    const order = childrenOf(current.units, parentId).filter(unit => unit.id !== id).length;
    const units = current.units.map(unit => unit.id === id ? { ...unit, parentId, sortOrder: order } : unit);
    const prior = current.units.find(unit => unit.id === id)?.parentId ?? null;
    const renumber = new Map(childrenOf(units, prior).map((unit, index) => [unit.id, index]));
    return { ...current, units: units.map(unit => renumber.has(unit.id) ? { ...unit, sortOrder: renumber.get(unit.id)! } : unit) };
  });
  const moveSibling = (id: string, delta: number) => update(current => {
    const unit = current.units.find(row => row.id === id); if (!unit) return current;
    const siblings = childrenOf(current.units, unit.parentId), index = siblings.findIndex(row => row.id === id), target = index + delta;
    if (target < 0 || target >= siblings.length) return current;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    const order = new Map(siblings.map((row, i) => [row.id, i]));
    return { ...current, units: current.units.map(row => order.has(row.id) ? { ...row, sortOrder: order.get(row.id)! } : row) };
  });
  const addUnit = (parentId: string | null) => {
    const names = new Set(draft.units.map(unit => unit.name.trim()));
    let n = 1; while (names.has(m.newName(n))) n++;
    const parent = parentId ? unitById.get(parentId) : undefined, id = newId();
    update(current => ({ ...current, units: [...current.units, { id, name: m.newName(n), kind: parent ? CHILD_KIND[parent.kind] : "dept", parentId, sortOrder: childrenOf(current.units, parentId).length }] }));
    setSelection({ kind: "unit", id });
  };
  const archiveUnit = (id: string) => { update(current => ({ ...current, units: current.units.filter(unit => unit.id !== id) })); setSelection(null); };

  /* ---------- 拖拽 ---------- */
  const unitAt = (x: number, y: number, exclude?: string) => {
    for (const node of document.elementsFromPoint(x, y)) {
      const unit = (node as HTMLElement).closest?.("[data-org-unit]") as HTMLElement | null;
      if (unit && unit.dataset.orgUnit !== exclude) return unit.dataset.orgUnit ?? null;
    }
    return null;
  };
  const beginDrag = (event: ReactPointerEvent, drag: Drag) => {
    if (event.button !== 0) return;
    event.stopPropagation(); dragRef.current = drag;
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current; if (!drag) return;
      const dx = event.clientX - drag.sx, dy = event.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      if (drag.kind === "pan") { setView(current => ({ ...current, x: drag.ox + dx, y: drag.oy + dy })); return; }
      if (!manage) return;
      const staff = drag.kind === "person" ? staffById.get(drag.id) : undefined, unit = drag.kind === "unit" ? unitById.get(drag.id) : undefined;
      setGhost({ x: event.clientX, y: event.clientY, label: staff?.name ?? unit?.name ?? "",
        hint: drag.kind === "unit" ? m.parent : drag.from ? (event.altKey ? m.alsoTo : m.moveTo) : m.addTo });
      setDropTarget(unitAt(event.clientX, event.clientY, drag.kind === "unit" ? drag.id : undefined));
    };
    const up = (event: PointerEvent) => {
      const drag = dragRef.current; dragRef.current = null; setGhost(null); setDropTarget(null);
      if (!drag) return;
      if (!drag.moved) {
        if (drag.kind === "person") setSelection({ kind: "person", id: drag.id });
        else if (drag.kind === "unit") setSelection({ kind: "unit", id: drag.id });
        else setSelection(null);
        return;
      }
      if (!manage || drag.kind === "pan") return;
      const target = unitAt(event.clientX, event.clientY, drag.kind === "unit" ? drag.id : undefined);
      if (!target) return;
      if (drag.kind === "person") { if (target !== drag.from) { addMember(drag.id, target, event.altKey ? null : drag.from); setSelection({ kind: "person", id: drag.id }); } }
      else if (unitById.get(drag.id)?.parentId !== target) reparent(drag.id, target);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  });

  /* ---------- 保存 ---------- */
  const describe = useMemo(() => describeChanges(changes, settings, draft, m, studentsUnder), [changes, settings, draft, m, studentsUnder]);
  const save = () => start(async () => {
    const result = await saveSchoolOrganizationAction(changes);
    if (!result.ok) { setStatus(m.errors[result.code] ?? m.errors.UNKNOWN); setConfirming(false); return; }
    setSettings(result.data.settings); setDraft(draftFromSettings(result.data.settings)); setConfirming(false); setStatus(m.saved); router.refresh();
  });
  const discard = () => { setDraft(draftFromSettings(settings)); setSelection(null); setStatus(""); };

  const units = orderedUnits(draft.units);
  const active = settings.staff.filter(staff => !staff.reserve), reserved = settings.staff.filter(staff => staff.reserve);
  const people = active.filter(staff => !query.trim() || staff.name.includes(query.trim()));
  const setReserve = (userId: string, reason: SchoolStaffReserveReason | null) => start(async () => {
    const result = await setStaffReserveAction({ userId, reason });
    if (!result.ok) { setStatus(m.errors[result.code] ?? m.errors.UNKNOWN); return; }
    setSettings(result.data.settings); setStatus(reason ? m.reserveMoved : m.reserveRestored); router.refresh();
  });
  const traySections = (() => {
    const unassigned = people.filter(staff => !linksOf(staff.id).length);
    const buckets = new Map<string, { unit: OrgUnit; staff: Staff[] }>();
    for (const unit of units) {
      const dept = departmentOf(draft.units, unit.id); if (!dept || buckets.has(dept.id)) continue;
      buckets.set(dept.id, { unit: dept, staff: [] });
    }
    for (const staff of people) for (const row of linksOf(staff.id)) {
      const dept = departmentOf(draft.units, row.groupId); const bucket = dept && buckets.get(dept.id);
      if (bucket && !bucket.staff.includes(staff)) bucket.staff.push(staff);
    }
    return { unassigned, departments: [...buckets.values()].filter(bucket => bucket.staff.length) };
  })();

  const selectedStaff = selection?.kind === "person" ? staffById.get(selection.id) : undefined;
  const selectedUnit = selection?.kind === "unit" ? unitById.get(selection.id) : undefined;

  const trayPerson = (staff: Staff, key: string) => {
    const count = linksOf(staff.id).length, active = selection?.kind === "person" && selection.id === staff.id;
    return <button key={key} type="button" data-org-person={staff.id}
      className={cn("flex w-full touch-none select-none items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:bg-table-hover cursor-grab",
        active && "border-crater bg-table-selected")}
      onPointerDown={event => beginDrag(event, { kind: "person", id: staff.id, from: null, sx: event.clientX, sy: event.clientY, moved: false })}
      onPointerEnter={() => setHoverPerson(staff.id)} onPointerLeave={() => setHoverPerson(null)}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection({ kind: "person", id: staff.id }); } }}>
      <DutyDots roles={rolesOf(staff.id)} /><span className="min-w-0 flex-1 truncate">{staff.name}</span>
      {count ? <span className="shrink-0 text-[11px] text-muted">{count > 1 ? `${count}×` : null}</span> : <span className="shrink-0 text-[11px] text-rose">{m.unassigned}</span>}
    </button>;
  };

  /* ---------- 画板 ---------- */
  const edges = draft.units.flatMap(unit => {
    const parent = unit.parentId ? layout.get(unit.parentId) : undefined, self = layout.get(unit.id);
    if (!parent || !self) return [];
    const x1 = parent.x + ORG_NODE.width / 2, y1 = parent.y + parent.h, x2 = self.x + ORG_NODE.width / 2, y2 = self.y, my = y1 + (y2 - y1) / 2;
    return [<path key={unit.id} d={`M${x1},${y1} V${my} H${x2} V${y2}`} className="fill-none stroke-crater" strokeWidth={1.5} />];
  });
  const chipCenter = (groupId: string, userId: string) => {
    const box = layout.get(groupId); if (!box) return null;
    const index = sortedMembers(groupId).findIndex(row => row.userId === userId); if (index < 0) return null;
    return { x: box.x + ORG_NODE.width / 2, y: box.y + ORG_NODE.head + ORG_NODE.pad + index * ORG_NODE.row + ORG_NODE.row / 2 };
  };
  function sortedMembers(groupId: string) {
    return membersOf(groupId).sort((a, b) => Number(b.lead) - Number(a.lead) || (staffById.get(a.userId)?.name ?? "").localeCompare(staffById.get(b.userId)?.name ?? "", "zh"));
  }
  const twinLinks = hoverPerson ? linksOf(hoverPerson).map(row => chipCenter(row.groupId, hoverPerson)).filter(Boolean) as Array<{ x: number; y: number }> : [];

  const board = <div ref={canvasRef} data-org-canvas
    className="relative min-h-[26rem] touch-none overflow-hidden bg-paper [background-image:radial-gradient(var(--line)_1.2px,transparent_1.2px)] [background-size:22px_22px]"
    onPointerDown={event => { if (event.button === 0) dragRef.current = { kind: "pan", sx: event.clientX, sy: event.clientY, ox: view.x, oy: view.y, moved: false }; }}>
    <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
        {edges}
        {twinLinks.slice(1).map((point, index) => { const a = twinLinks[0], dx = (point.x - a.x) / 2;
          return <path key={index} d={`M${a.x},${a.y} C${a.x + dx},${a.y - 40} ${point.x - dx},${point.y - 40} ${point.x},${point.y}`}
            className="fill-none stroke-[var(--blue,#4C7BD9)]" strokeWidth={1.6} strokeDasharray="5 4" />; })}
      </svg>
      {draft.units.map(unit => {
        const box = layout.get(unit.id); if (!box) return null;
        const rows = manage ? sortedMembers(unit.id) : [], selected = selection?.kind === "unit" && selection.id === unit.id;
        const count = manage ? rows.length : baseGroups.get(unit.id)?.memberIds.length ?? 0;
        return <section key={unit.id} data-org-unit={unit.id} aria-label={`${unit.name} · ${m.kinds[unit.kind]} · ${count}`}
          className={cn("absolute rounded-[10px] border border-line bg-card shadow-sm transition-[left,top] duration-200 motion-reduce:transition-none",
            selected && "border-crater ring-2 ring-crater/35", dropTarget === unit.id && "border-[#4C7BD9] ring-[3px] ring-[#4C7BD9]/30")}
          style={{ left: box.x, top: box.y, width: ORG_NODE.width, height: box.h }}>
          <div role="button" tabIndex={0}
            className={cn("flex touch-none select-none items-center gap-2 rounded-t-[10px] border-b border-line px-2.5", manage ? "cursor-grab" : "cursor-pointer",
              unit.kind === "org" ? "bg-moon/45" : unit.kind === "dept" || unit.kind === "campus" ? "bg-moon/20" : "")}
            style={{ height: ORG_NODE.head }}
            onPointerDown={event => beginDrag(event, { kind: "unit", id: unit.id, sx: event.clientX, sy: event.clientY, moved: false })}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection({ kind: "unit", id: unit.id }); } }}>
            <span className="min-w-0 flex-1 truncate font-semibold">{unit.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{m.kinds[unit.kind]}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">{count}</span>
          </div>
          <div className="flex flex-col" style={{ padding: ORG_NODE.pad }}>
            {rows.map(row => { const staff = staffById.get(row.userId); if (!staff) return null;
              const twin = hoverPerson === row.userId && linksOf(row.userId).length > 1, active = selection?.kind === "person" && selection.id === row.userId;
              return <div key={row.userId} role="button" tabIndex={0} data-org-person={row.userId}
                className={cn("group flex cursor-grab touch-none select-none items-center gap-2 rounded-md px-2 text-sm hover:bg-table-hover",
                  twin && "bg-[#4C7BD9]/12", active && "bg-table-selected")}
                style={{ height: ORG_NODE.row }}
                onPointerDown={event => beginDrag(event, { kind: "person", id: row.userId, from: unit.id, sx: event.clientX, sy: event.clientY, moved: false })}
                onPointerEnter={() => setHoverPerson(row.userId)} onPointerLeave={() => setHoverPerson(null)}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection({ kind: "person", id: row.userId }); } }}>
                <DutyDots roles={rolesOf(row.userId)} /><span className="min-w-0 flex-1 truncate">{staff.name}</span>
                {linksOf(row.userId).length > 1 ? <span className="shrink-0 text-[10px] text-[#4C7BD9]" title={m.also}>{m.alsoShort}</span> : null}
                {row.lead ? <span className="shrink-0 rounded-[3px] border border-crater px-1 text-[10px] leading-4 text-crater">{m.lead}</span> : null}
                {!row.lead ? <button type="button" aria-label={m.setLead} title={m.setLead}
                  className="invisible shrink-0 rounded p-0.5 text-crater hover:bg-moon/40 focus-visible:visible group-hover:visible"
                  onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setLead(row.userId, unit.id, true); }}><Crown className="size-3.5" /></button> : null}
              </div>; })}
            {!rows.length ? <p className="px-2 text-xs leading-[30px] text-muted">{manage ? m.emptyUnit : m.memberTotal(count)}</p> : null}
          </div>
        </section>;
      })}
    </div>
    <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-3 rounded-md bg-card/90 px-2 py-1 text-xs text-muted" onPointerDown={event => event.stopPropagation()}>
      <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-leaf-deep" />{m.legendSupport}</span>
      <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-crater" />{m.legendAssessment}</span>
      <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-rose" />{m.legendTeacher}</span>
      <span className="text-[#4C7BD9]">┄ {m.legendTwin}</span>
    </div>
    <div className="absolute bottom-2.5 right-2.5 flex gap-1 rounded-lg border border-line bg-card p-0.5" onPointerDown={event => event.stopPropagation()}>
      <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={m.zoomOut} onClick={() => zoomAt(1 / 1.2)}><Minus className="size-4" /></Button>
      <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={m.fit} onClick={fit}><Maximize className="size-4" /></Button>
      <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={m.zoomIn} onClick={() => zoomAt(1.2)}><Plus className="size-4" /></Button>
    </div>
  </div>;

  const rosterIds = new Set((rosterView === "reserve" ? reserved : active).map(staff => staff.id));
  const rosterColumns = [
    { key: "duties", header: m.duties.split(" · ")[0], cell: (member: StaffMember) => rolesOf(member.userId).map(role => m.roles[role]).join("、") || "—" },
    { key: "units", header: m.units, cell: (member: StaffMember) => {
      const reserve = staffById.get(member.userId)?.reserve;
      return linksOf(member.userId).map(row => `${unitById.get(row.groupId)?.name}${row.lead ? `（${m.lead}）` : ""}`).join("、") || (reserve ? m.reasons[reserve] : m.unassigned);
    } },
  ];
  const roster = <div className="flex min-h-[26rem] flex-col overflow-hidden bg-card">
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div role="group" aria-label={m.roster} className="inline-flex rounded-lg bg-line/55 p-[3px]">
        {(["active", "reserve"] as const).map(value => <button key={value} type="button" aria-pressed={rosterView === value} onClick={() => setRosterView(value)}
          className={cn("rounded-md px-3 py-0.5 text-sm text-muted", rosterView === value && "bg-card text-ink shadow-sm")}>
          {value === "active" ? m.rosterActive : m.rosterReserve} <span className="tabular-nums">{value === "active" ? active.length : reserved.length}</span></button>)}
      </div>
      {rosterView === "reserve" ? <p className="text-xs text-muted">{m.reserveHint}</p> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {staffAdmin ? <StaffMembersPanel members={staffAdmin.members} roles={staffAdmin.roles} recentImportBatches={staffAdmin.recentImportBatches}
        selfId={staffAdmin.selfId} isAdmin={staffAdmin.isAdmin} canInviteStaff={staffAdmin.canInviteStaff} canManageStaff={staffAdmin.canManageStaff}
        visibleIds={rosterIds} extraColumns={rosterColumns} selectedId={selection?.kind === "person" ? selection.id : null}
        onSelect={id => setSelection({ kind: "person", id })} onboarding={{ open: onboarding, onOpenChange: setOnboarding, title: m.addStaff }} />
      : <Table><TableHeader><TableRow>
        <TableHead>{m.staffCount}</TableHead><TableHead>{m.jobs.split(" · ")[0]}</TableHead><TableHead>{m.duties.split(" · ")[0]}</TableHead><TableHead>{m.units}</TableHead>
      </TableRow></TableHeader><TableBody>{settings.staff.filter(staff => rosterIds.has(staff.id)).map(staff => <TableRow key={staff.id} className="cursor-pointer" data-state={selection?.id === staff.id ? "selected" : undefined}
        onClick={() => setSelection({ kind: "person", id: staff.id })}>
        <TableCell>{staff.name}</TableCell><TableCell>{staff.jobs.join("、") || "—"}</TableCell>
        <TableCell>{rolesOf(staff.id).map(role => m.roles[role]).join("、") || "—"}</TableCell>
        <TableCell className="whitespace-normal">{linksOf(staff.id).map(row => `${unitById.get(row.groupId)?.name}${row.lead ? `（${m.lead}）` : ""}`).join("、") || m.unassigned}</TableCell>
      </TableRow>)}</TableBody></Table>}
    </div>
  </div>;

  return <DashboardPage title={m.tab} density="compact"
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandState>
        <div role="group" aria-label={m.board} className="inline-flex rounded-lg bg-line/55 p-[3px]">
          {(["board", "roster"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
            className={cn("rounded-md px-3 py-1 text-sm text-muted", mode === value && "bg-card text-ink shadow-sm")}>{value === "board" ? m.board : m.roster}</button>)}
        </div>
      </DashboardCommandState>
      <DashboardCommandActions>
        {staffAdmin && (staffAdmin.canInviteStaff || staffAdmin.canManageStaff) ? <Button size="sm" variant="secondary" onClick={() => { setMode("roster"); setOnboarding(true); }}>
          <UserPlus className="size-4" />{m.addStaff}</Button> : null}
        {manage ? <>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => addUnit(selectedUnit?.id ?? null)}><Plus className="size-4" />{selectedUnit ? m.addChild : m.addUnit}</Button>
          {dirty ? <Button size="sm" variant="ghost" disabled={pending} onClick={discard}>{m.discard}</Button> : null}
          <Button size="sm" disabled={!dirty || pending} onClick={() => setConfirming(true)}>{m.save}{dirty ? <span className="tabular-nums">{changeCount(changes)}</span> : null}</Button>
        </> : null}
      </DashboardCommandActions>
    </DashboardCommandPanel>}>
    <p role="status" className="min-h-5 text-sm text-muted">{status}</p>
    <div className={cn("grid min-w-0 overflow-hidden rounded-[10px] border border-line bg-card",
      manage ? "@5xl/page:grid-cols-[13.5rem_minmax(0,1fr)_23rem]" : "@5xl/page:grid-cols-[minmax(0,1fr)_23rem]",
      "@5xl/page:h-[calc(100dvh-11rem)] @5xl/page:min-h-[34rem]")}>
      {manage ? <aside aria-label={m.staffTitle} className="flex min-h-0 flex-col gap-2 border-b border-line p-3 @5xl/page:border-b-0 @5xl/page:border-r">
        <p className="text-xs font-semibold tracking-wide text-muted">{m.staffTitle} · {m.dragHint}</p>
        <Input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={m.search} aria-label={m.search} className="h-8" />
        <div className="flex max-h-48 min-h-0 flex-col gap-1 overflow-auto @5xl/page:max-h-none">
          {traySections.unassigned.length ? <>
            <p className="w-full pt-1 text-xs text-rose">{m.unassigned} · {traySections.unassigned.length}</p>
            {traySections.unassigned.map(staff => trayPerson(staff, `u:${staff.id}`))}
          </> : null}
          {traySections.departments.map(bucket => <div key={bucket.unit.id} className="contents">
            <p className="w-full pt-2 text-xs text-muted">{bucket.unit.name} · {bucket.staff.length}</p>
            {bucket.staff.map(staff => trayPerson(staff, `${bucket.unit.id}:${staff.id}`))}
          </div>)}
        </div>
        {reserved.length ? <div className="mt-auto border-t border-line pt-2">
          <button type="button" aria-expanded={reserveOpen} onClick={() => setReserveOpen(value => !value)} className="flex w-full items-center justify-between text-xs text-muted">
            <span>{m.rosterReserve} · {reserved.length}</span><span aria-hidden>{reserveOpen ? "−" : "+"}</span></button>
          {reserveOpen ? <div className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-auto">{reserved.map(staff => <button key={staff.id} type="button"
            onClick={() => setSelection({ kind: "person", id: staff.id })}
            className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted hover:bg-table-hover", selection?.id === staff.id && "bg-table-selected text-ink")}>
            <span className="min-w-0 flex-1 truncate">{staff.name}</span><span className="shrink-0 text-[11px]">{m.reasons[staff.reserve!]}</span></button>)}</div> : null}
        </div> : null}
      </aside> : null}
      <div className="h-[60vh] min-h-0 min-w-0 @5xl/page:h-auto [&>*]:h-full">{mode === "board" ? board : roster}</div>
      <aside aria-live="polite" className="min-h-0 overflow-y-auto border-t border-line p-4 @5xl/page:border-l @5xl/page:border-t-0">
        {selectedStaff && manage ? <PersonCard key={selectedStaff.id} staff={selectedStaff} m={m} draft={draft} settings={settings} studentsUnder={studentsUnder}
          roles={rolesOf(selectedStaff.id)} onRoles={roles => setRoles(selectedStaff.id, roles)} onClose={() => setSelection(null)}
          onLead={(groupId, lead) => setLead(selectedStaff.id, groupId, lead)} onRemove={groupId => removeMember(selectedStaff.id, groupId)}
          onJoin={groupId => addMember(selectedStaff.id, groupId, null)} onOpenUnit={id => setSelection({ kind: "unit", id })}
          pending={pending} onReserve={reason => setReserve(selectedStaff.id, reason)} />
        : selectedUnit ? <UnitCard key={`${selectedUnit.id}:${selectedUnit.name}`} unit={selectedUnit} m={m} draft={draft} settings={settings} manage={manage} pending={pending}
          studentCount={studentsUnder(selectedUnit.id)} members={manage ? sortedMembers(selectedUnit.id) : []} staffById={staffById}
          onClose={() => setSelection(null)} onPatch={patch => patchUnit(selectedUnit.id, patch)} onParent={parentId => reparent(selectedUnit.id, parentId)}
          onMove={delta => moveSibling(selectedUnit.id, delta)} onAddChild={() => addUnit(selectedUnit.id)} onArchive={() => archiveUnit(selectedUnit.id)}
          onOpenPerson={id => setSelection({ kind: "person", id })} onLead={(userId, lead) => setLead(userId, selectedUnit.id, lead)} />
        : <Overview m={m} manage={manage} staff={active.length} units={draft.units.length}
          unassigned={active.filter(staff => !linksOf(staff.id).length).length} />}
      </aside>
    </div>
    {ghost ? <div className="pointer-events-none fixed z-50 rounded-md border border-crater bg-card px-2.5 py-1 text-sm shadow-sm" style={{ left: ghost.x + 12, top: ghost.y + 10 }}>
      {ghost.label}<span className="ml-1.5 text-xs text-muted">{ghost.hint}</span></div> : null}
    <Dialog open={confirming} onOpenChange={open => { if (!pending) setConfirming(open); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{m.saveTitle}</DialogTitle><DialogDescription>{m.saveHint}</DialogDescription></DialogHeader>
        <ul className="max-h-[50vh] overflow-y-auto border-t border-line">{describe.map((line, index) => <li key={index} className="border-b border-line py-2 text-sm leading-6">
          {line.text}{line.effect ? <span className="block text-xs text-muted">{line.effect}</span> : null}</li>)}</ul>
        <DialogFooter><Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>{m.keepEditing}</Button>
          <Button disabled={pending} onClick={save}>{pending ? m.saving : m.confirm}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </DashboardPage>;
}

function CardHeader({ title, subtitle, mark, round, onClose, closeLabel }: { title: string; subtitle: string; mark: string; round?: boolean; onClose: () => void; closeLabel: string }) {
  return <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
    <span className={cn("grid size-11 place-items-center bg-moon text-lg font-semibold text-ink", round ? "rounded-full" : "rounded-[10px]")} aria-hidden>{mark}</span>
    <div className="min-w-0"><p className="truncate text-lg font-semibold">{title}</p><p className="truncate text-xs text-muted">{subtitle}</p></div>
    <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={closeLabel} onClick={onClose}><X className="size-4" /></Button>
  </div>;
}
function Stats({ items }: { items: Array<[string, number]> }) {
  return <dl className="grid grid-cols-3 gap-2">{items.map(([label, value]) => <div key={label} className="rounded-lg border border-line px-2.5 py-2">
    <dd className="text-xl tabular-nums">{value}</dd><dt className="text-[11px] text-muted">{label}</dt></div>)}</dl>;
}
function Effects({ items }: { items: Array<{ text: string; tone?: "warn" | "muted" }> }) {
  return <ul className="flex flex-col gap-1.5">{items.map((item, index) => <li key={index} className={cn("flex gap-2 text-sm leading-6", item.tone === "warn" && "text-rose", item.tone === "muted" && "text-muted")}>
    <i className={cn("mt-[9px] size-1.5 shrink-0 rounded-full", item.tone === "warn" ? "bg-rose" : item.tone === "muted" ? "bg-line" : "bg-leaf-deep")} aria-hidden />{item.text}</li>)}</ul>;
}
const Field = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) =>
  <div className="flex flex-col gap-1.5">{htmlFor ? <Label htmlFor={htmlFor} className="text-xs text-muted">{label}</Label> : <p className="text-xs text-muted">{label}</p>}{children}</div>;

function Overview({ m, manage, staff, units, unassigned }: { m: SchoolOrganizationMessages; manage: boolean; staff: number; units: number; unassigned: number }) {
  return <div className="flex flex-col gap-4">
    <p className="text-xs font-semibold tracking-wide text-muted">{m.howTitle}</p>
    {manage ? <ol className="list-decimal space-y-1 pl-5 text-sm leading-6">{m.how.map(line => <li key={line}>{line}</li>)}</ol> : <p className="text-sm leading-6">{m.readOnly}</p>}
    {manage ? <Stats items={[[m.staffCount, staff], [m.unitCount, units], [m.unassignedCount, unassigned]]} /> : null}
  </div>;
}

function PersonCard({ staff, m, draft, settings, roles, studentsUnder, onRoles, onClose, onLead, onRemove, onJoin, onOpenUnit, pending, onReserve }: {
  pending: boolean; onReserve: (reason: SchoolStaffReserveReason | null) => void;
  staff: Staff; m: SchoolOrganizationMessages; draft: OrgDraft; settings: Settings; roles: SchoolBusinessRole[]; studentsUnder: (id: string) => number;
  onRoles: (roles: SchoolBusinessRole[]) => void; onClose: () => void; onLead: (groupId: string, lead: boolean) => void;
  onRemove: (groupId: string) => void; onJoin: (groupId: string) => void; onOpenUnit: (id: string) => void;
}) {
  const [multi, setMulti] = useState(roles.length > 1);
  const links = draft.members.filter(row => row.userId === staff.id && draft.units.some(unit => unit.id === row.groupId));
  const unitName = (id: string) => draft.units.find(unit => unit.id === id)?.name ?? "";
  const perms = [staff.canFollowUp ? m.permFollowUp : null, staff.canReview ? m.permReview : null].filter(Boolean) as string[];
  const effects: Array<{ text: string; tone?: "warn" | "muted" }> = [{ text: m.jobGrants(perms) }];
  for (const role of roles) {
    effects.push({ text: `${m.roles[role]}：${m.dutyGrants[role]}` });
    if (role === "school_support" && !staff.canFollowUp) effects.push({ text: m.needsFollowup, tone: "warn" });
    if (role !== "school_support" && !staff.canReview) effects.push({ text: m.needsReview, tone: "warn" });
  }
  for (const row of links) {
    const n = studentsUnder(row.groupId);
    effects.push({ text: n ? m.seesStudents(unitName(row.groupId), n) : m.seesUnit(unitName(row.groupId)) });
    if (row.lead) effects.push({ text: m.leads(unitName(row.groupId)) });
  }
  if (roles.some(role => role !== "school_support")) {
    const scope = new Set(links.flatMap(row => lineage(draft.units, row.groupId).map(unit => unit.id)));
    for (const rule of settings.rules) if (rule.groupIds.some(id => scope.has(id))) effects.push({ text: m.rule(rule.label || m.ruleKind(rule.kind)) });
  }
  if (!links.length) effects.push({ text: m.noUnit, tone: "warn" });
  const toggle = (role: SchoolBusinessRole) => {
    const on = roles.includes(role);
    onRoles(on ? roles.filter(item => item !== role) : multi ? [...roles, role] : [role]);
  };
  const joinable = orderedUnits(draft.units).filter(unit => !links.some(row => row.groupId === unit.id));
  return <div className="flex flex-col gap-4">
    <CardHeader round mark={staff.name.slice(-1)} title={staff.name} closeLabel={m.close} onClose={onClose}
      subtitle={[staff.jobs.join("、") || m.noJob, links.map(row => unitName(row.groupId)).join("、") || m.unassigned].join(" · ")} />
    <Stats items={[[m.studentLoad, staff.studentCount], [m.classLoad, staff.classCount], [m.assessmentLoad, staff.upcomingAssessmentCount]]} />
    <Field label={m.jobs}><div className="flex flex-wrap items-center gap-1.5">
      {staff.jobs.length ? staff.jobs.map(job => <span key={job} className="rounded-full border border-line px-2.5 py-0.5 text-sm">{job}</span>) : <span className="text-sm text-muted">{m.noJob}</span>}
      <Link href="/dashboard/staff" className="text-xs text-muted underline-offset-2 hover:underline">{m.jobsLink}</Link></div></Field>
    <Field label={m.duties}>
      <div className="flex flex-wrap gap-1.5">{ORG_ROLE_ORDER.map(role => {
        const on = roles.includes(role), blocked = role === "school_support" && !staff.canFollowUp && !on;
        return <button key={role} type="button" aria-pressed={on} disabled={blocked} title={blocked ? m.needsFollowup : undefined} onClick={() => toggle(role)}
          className={cn("inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-45",
            on && "border-crater bg-table-selected")}><i className={cn("size-2 rounded-full", DUTY_DOT[role])} aria-hidden />{m.roles[role]}</button>; })}</div>
      <label className="flex items-center gap-2 text-xs text-muted"><Switch checked={multi} onCheckedChange={value => { setMulti(value); if (!value && roles.length > 1) onRoles(roles.slice(0, 1)); }} />{m.multiDuty}</label>
    </Field>
    <Field label={m.units}>
      <div className="flex flex-col border-t border-line">{links.map(row => <div key={row.groupId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-line py-1.5">
        <button type="button" className="min-w-0 text-left" onClick={() => onOpenUnit(row.groupId)}>
          <span className="block truncate text-sm">{unitName(row.groupId)}</span><span className="block truncate text-[11px] text-muted">{unitPath(draft.units, row.groupId)}</span></button>
        <Button size="sm" variant="secondary" className={cn("h-7 px-2 text-xs", row.lead && "border-crater text-crater")} aria-pressed={row.lead} onClick={() => onLead(row.groupId, !row.lead)}>{row.lead ? m.lead : m.member}</Button>
        <Button size="sm" variant="ghost" className="size-7 p-0" aria-label={`${m.remove} ${unitName(row.groupId)}`} onClick={() => onRemove(row.groupId)}><X className="size-4" /></Button>
      </div>)}</div>
      {joinable.length ? <Select value="" onValueChange={onJoin}><SelectTrigger aria-label={m.join} className="h-8"><SelectValue placeholder={m.join} /></SelectTrigger>
        <SelectContent>{joinable.map(unit => <SelectItem key={unit.id} value={unit.id}>{unitPath(draft.units, unit.id)}</SelectItem>)}</SelectContent></Select> : null}
    </Field>
    <Field label={m.effects}><Effects items={effects} /></Field>
    <Field label={m.rosterReserve}>
      {staff.fixedTest ? <p className="text-sm text-muted">{m.fixedTest}</p>
      : staff.reserve ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>{m.reasons[staff.reserve]}</span>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => onReserve(null)}>{m.restore}</Button></div>
      : links.length ? <p className="text-xs text-muted">{m.reserveBlocked}</p>
      : <Select value="" onValueChange={value => onReserve(value as SchoolStaffReserveReason)}><SelectTrigger aria-label={m.moveToReserve} className="h-8"><SelectValue placeholder={m.moveToReserve} /></SelectTrigger>
        <SelectContent>{SCHOOL_STAFF_RESERVE_REASONS.filter(reason => reason !== "test").map(reason => <SelectItem key={reason} value={reason}>{m.reasons[reason]}</SelectItem>)}</SelectContent></Select>}
    </Field>
  </div>;
}

function UnitCard({ unit, m, draft, settings, manage, pending, studentCount, members, staffById, onClose, onPatch, onParent, onMove, onAddChild, onArchive, onOpenPerson, onLead }: {
  onLead: (userId: string, lead: boolean) => void;
  unit: OrgUnit; m: SchoolOrganizationMessages; draft: OrgDraft; settings: Settings; manage: boolean; pending: boolean; studentCount: number;
  members: OrgDraft["members"]; staffById: Map<string, Staff>; onClose: () => void; onPatch: (patch: Partial<OrgUnit>) => void;
  onParent: (parentId: string | null) => void; onMove: (delta: number) => void; onAddChild: () => void; onArchive: () => void; onOpenPerson: (id: string) => void;
}) {
  const [name, setName] = useState(unit.name);
  const siblings = childrenOf(draft.units, unit.parentId), index = siblings.findIndex(row => row.id === unit.id);
  const descendants = new Set(subtreeIds(draft.units, unit.id));
  const parents = orderedUnits(draft.units).filter(row => !descendants.has(row.id));
  const taken = draft.units.some(row => row.id !== unit.id && row.name.trim() === name.trim());
  const base = settings.groups.find(group => group.id === unit.id);
  const rules = settings.rules.filter(rule => rule.groupIds.includes(unit.id));
  const archivable = !members.length && !childrenOf(draft.units, unit.id).length && !(base?.studentCount) && !rules.length;
  const commitName = () => { const value = name.trim(); if (value && !taken && value !== unit.name) onPatch({ name: value }); else if (!value) setName(unit.name); };
  const parent = unit.parentId ? draft.units.find(row => row.id === unit.parentId) : undefined;
  return <div className="flex flex-col gap-4">
    <CardHeader mark={unit.name.slice(0, 1)} title={unit.name} closeLabel={m.close} onClose={onClose}
      subtitle={`${m.kinds[unit.kind]} · ${parent ? parent.name : m.topLevel}`} />
    <Stats items={[[m.directMembers, manage ? members.length : base?.memberIds.length ?? 0], [m.subUnits, descendants.size - 1], [m.unitStudents, studentCount]]} />
    {manage ? <>
      <Field label={m.name} htmlFor="org-unit-name"><Input id="org-unit-name" value={name} maxLength={80} disabled={pending} aria-invalid={taken}
        onChange={event => setName(event.target.value)} onBlur={commitName} onKeyDown={event => { if (event.key === "Enter") commitName(); }} />
        {taken ? <p className="text-xs text-rose">{m.nameTaken}</p> : null}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.kind}><Select value={unit.kind} onValueChange={value => onPatch({ kind: value as SchoolOrganizationKind })}>
          <SelectTrigger className="h-8" aria-label={m.kind}><SelectValue /></SelectTrigger>
          <SelectContent>{SCHOOL_ORGANIZATION_KINDS.map(kind => <SelectItem key={kind} value={kind}>{m.kinds[kind]}</SelectItem>)}</SelectContent></Select></Field>
        <Field label={m.parent}><Select value={unit.parentId ?? "none"} onValueChange={value => onParent(value === "none" ? null : value)}>
          <SelectTrigger className="h-8" aria-label={m.parent}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">{m.topLevel}</SelectItem>
            {parents.map(row => <SelectItem key={row.id} value={row.id}>{unitPath(draft.units, row.id)}</SelectItem>)}</SelectContent></Select></Field>
      </div>
      <Field label={m.order(index + 1, siblings.length)}><div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={index <= 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" />{m.moveEarlier}</Button>
        <Button size="sm" variant="secondary" disabled={index >= siblings.length - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" />{m.moveLater}</Button></div></Field>
      {members.length ? <Field label={m.directMembers}><div className="flex flex-col border-t border-line">{members.map(row => <div key={row.userId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-line py-1">
        <button type="button" className="min-w-0 truncate text-left text-sm hover:underline" onClick={() => onOpenPerson(row.userId)}>{staffById.get(row.userId)?.name}</button>
        <Button size="sm" variant="secondary" aria-pressed={row.lead} className={cn("h-7 gap-1 px-2 text-xs", row.lead && "border-crater text-crater")} onClick={() => onLead(row.userId, !row.lead)}>
          <Crown className="size-3.5" />{row.lead ? m.lead : m.setLead}</Button></div>)}</div></Field> : null}
    </> : null}
    <Field label={m.unitGrants}><Effects items={[
      { text: studentCount ? m.unitSees(studentCount) : m.unitStructure },
      { text: m.unitFilters },
      ...rules.map(rule => ({ text: m.rule(rule.label || m.ruleKind(rule.kind)) })),
      ...(manage && !members.some(row => row.lead) ? [{ text: m.noLead, tone: "muted" as const }] : []),
    ]} /></Field>
    {manage ? <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={onAddChild}><Plus className="size-4" />{m.addChild}</Button>
        <Button size="sm" variant="ghost" disabled={!archivable} onClick={onArchive}>{m.archive}</Button></div>
      {!archivable ? <p className="text-xs text-muted">{m.archiveBlocked}</p> : null}
    </div> : null}
  </div>;
}

function describeChanges(changes: OrgChanges, settings: Settings, draft: OrgDraft, m: SchoolOrganizationMessages, studentsUnder: (id: string) => number) {
  const lines: Array<{ text: string; effect?: string }> = [], d = m.describe;
  const base = new Map(settings.groups.map(group => [group.id, group]));
  const name = (id: string | null) => id ? draft.units.find(unit => unit.id === id)?.name ?? base.get(id)?.name ?? "" : null;
  const person = (id: string) => settings.staff.find(staff => staff.id === id)?.name ?? "";
  const rulesFor = (id: string) => settings.rules.filter(rule => rule.groupIds.some(group => lineage(draft.units, id).some(unit => unit.id === group)));
  const reordered = new Set<string>();
  for (const unit of changes.units) {
    const prior = base.get(unit.id);
    if (!prior) { lines.push({ text: d.created(unit.name, name(unit.parentId)) }); continue; }
    if (prior.name !== unit.name) lines.push({ text: d.renamed(prior.name, unit.name), effect: d.structureOnly });
    if (prior.parentId !== unit.parentId) {
      const rules = rulesFor(unit.id);
      lines.push({ text: d.moved(unit.name, name(unit.parentId)), effect: rules.length ? d.rulesFollow(rules.map(rule => rule.label || m.ruleKind(rule.kind)).join("、")) : d.structureOnly });
    }
    if (prior.kind !== unit.kind) lines.push({ text: d.kind(unit.name, m.kinds[unit.kind]), effect: d.displayOnly });
    if (prior.sortOrder !== unit.sortOrder && prior.parentId === unit.parentId && prior.name === unit.name && prior.kind === unit.kind) reordered.add(unit.parentId ?? "");
  }
  for (const parent of reordered) lines.push({ text: d.reordered(name(parent || null) ?? m.topLevel), effect: d.displayOnly });
  for (const id of changes.archive) lines.push({ text: d.archived(base.get(id)?.name ?? "") });
  for (const row of changes.members) {
    const unit = name(row.groupId) ?? "", n = studentsUnder(row.groupId), existed = base.get(row.groupId)?.memberIds.includes(row.userId);
    if (!row.active) lines.push({ text: d.left(person(row.userId), unit), effect: n ? d.loseAccess(unit, n) : d.structureOnly });
    else if (existed) lines.push({ text: d.lead(person(row.userId), unit, row.lead) });
    else lines.push({ text: d.joined(person(row.userId), unit, row.lead), effect: n ? d.gainAccess(unit, n) : undefined });
  }
  for (const row of changes.roles) {
    const labels = row.roles.map(role => m.roles[role]).join("、");
    lines.push({ text: d.roles(person(row.userId), labels), effect: row.roles.length ? row.roles.map(role => m.dutyGrants[role]).join("；") : d.roleKept });
  }
  return lines;
}
