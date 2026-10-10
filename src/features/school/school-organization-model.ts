import type { SchoolBusinessRole, SchoolCollaborationSettings, SchoolOrganizationKind, SchoolStaffReserveReason } from "./school-collaboration-contract";

export type OrgUnit = { id: string; name: string; kind: SchoolOrganizationKind; parentId: string | null; sortOrder: number };
export type OrgMembership = { groupId: string; userId: string; lead: boolean };
export type OrgDraft = { units: OrgUnit[]; members: OrgMembership[]; roles: Record<string, SchoolBusinessRole[]>; reserve: Record<string, SchoolStaffReserveReason | null> };
export type OrgChanges = {
  units: Array<OrgUnit>;
  archive: string[];
  members: Array<OrgMembership & { active: boolean }>;
  roles: Array<{ userId: string; roles: SchoolBusinessRole[] }>;
  reserve: Array<{ userId: string; reason: SchoolStaffReserveReason | null }>;
};

export const ORG_ROLE_ORDER: SchoolBusinessRole[] = ["school_support", "assessment_teacher", "teacher"];
const sortRoles = (roles: SchoolBusinessRole[]) => [...roles].sort((a, b) => ORG_ROLE_ORDER.indexOf(a) - ORG_ROLE_ORDER.indexOf(b));

export function draftFromSettings(settings: SchoolCollaborationSettings): OrgDraft {
  return {
    units: settings.groups.map(({ id, name, kind, parentId, sortOrder }) => ({ id, name, kind, parentId, sortOrder })),
    members: settings.groups.flatMap(group => group.memberIds.map(userId => ({ groupId: group.id, userId, lead: group.leadIds.includes(userId) }))),
    roles: Object.fromEntries(settings.staff.map(staff => [staff.id, sortRoles(staff.roles.length ? staff.roles : staff.role ? [staff.role] : [])])),
    reserve: Object.fromEntries(settings.staff.map(staff => [staff.id, staff.reserve])),
  };
}

export function childrenOf(units: OrgUnit[], parentId: string | null) {
  return units.filter(unit => unit.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
}
/** 父级缺失时视为顶层，保证读取范围受限时组织树仍然完整显示。 */
export function rootsOf(units: OrgUnit[]) {
  const ids = new Set(units.map(unit => unit.id));
  return units.filter(unit => !unit.parentId || !ids.has(unit.parentId)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh"));
}
export function subtreeIds(units: OrgUnit[], id: string): string[] {
  return [id, ...childrenOf(units, id).flatMap(child => subtreeIds(units, child.id))];
}
export function lineage(units: OrgUnit[], id: string): OrgUnit[] {
  const byId = new Map(units.map(unit => [unit.id, unit])), out: OrgUnit[] = [];
  for (let unit = byId.get(id); unit && out.length < 64; unit = unit.parentId ? byId.get(unit.parentId) : undefined) out.push(unit);
  return out;
}
export function unitPath(units: OrgUnit[], id: string, separator = " / ") {
  return lineage(units, id).reverse().map(unit => unit.name).join(separator);
}
/** 部门归类：最近的部门；没有部门时归入所在顶层组织。 */
export function departmentOf(units: OrgUnit[], id: string) {
  const chain = lineage(units, id);
  return chain.find(unit => unit.kind === "dept") ?? chain.at(-1) ?? null;
}
/** 组织树显示顺序。 */
export function orderedUnits(units: OrgUnit[]) {
  const out: OrgUnit[] = [];
  const walk = (unit: OrgUnit) => { out.push(unit); childrenOf(units, unit.id).forEach(walk); };
  rootsOf(units).forEach(walk);
  return out;
}

export function diffOrganization(settings: SchoolCollaborationSettings, draft: OrgDraft): OrgChanges {
  const base = draftFromSettings(settings), baseUnits = new Map(base.units.map(unit => [unit.id, unit]));
  const units = draft.units.filter(unit => {
    const prior = baseUnits.get(unit.id);
    return !prior || prior.name !== unit.name.trim() || prior.kind !== unit.kind || prior.parentId !== unit.parentId || prior.sortOrder !== unit.sortOrder;
  }).map(unit => ({ ...unit, name: unit.name.trim() }));
  const draftIds = new Set(draft.units.map(unit => unit.id));
  const archive = base.units.filter(unit => !draftIds.has(unit.id)).map(unit => unit.id);
  const key = (row: OrgMembership) => `${row.groupId}:${row.userId}`;
  const before = new Map(base.members.map(row => [key(row), row])), after = new Map(draft.members.map(row => [key(row), row]));
  const members: OrgChanges["members"] = [];
  for (const [id, row] of after) { const prior = before.get(id); if (!prior || prior.lead !== row.lead) members.push({ ...row, active: true }); }
  for (const [id, row] of before) if (!after.has(id) && draftIds.has(row.groupId)) members.push({ ...row, lead: false, active: false });
  const roles = Object.entries(draft.roles).filter(([userId, value]) => sortRoles(base.roles[userId] ?? []).join() !== sortRoles(value).join())
    .map(([userId, value]) => ({ userId, roles: sortRoles(value) }));
  const fixed = new Set(settings.staff.filter(staff => staff.fixedTest).map(staff => staff.id));
  const reserve = Object.entries(draft.reserve).filter(([userId, reason]) => !fixed.has(userId) && (base.reserve[userId] ?? null) !== reason)
    .map(([userId, reason]) => ({ userId, reason }));
  return { units, archive, members, roles, reserve };
}
export const changeCount = (changes: OrgChanges) => changes.units.length + changes.archive.length + changes.members.length + changes.roles.length + changes.reserve.length;

/* 自动整理：自上而下的树形布局，尺寸与节点样式中的固定高度一致。 */
export const ORG_NODE = { width: 168, head: 40, pad: 5, row: 28, gapX: 20, gapY: 48 };
export const unitHeight = (memberCount: number) => ORG_NODE.head + ORG_NODE.pad * 2 + Math.max(1, memberCount) * ORG_NODE.row;
export type OrgLayout = Map<string, { x: number; y: number; h: number }>;

export function layoutOrganization(units: OrgUnit[], memberCount: (id: string) => number): OrgLayout {
  const layout: OrgLayout = new Map(), widths = new Map<string, number>();
  const width = (id: string): number => {
    const kids = childrenOf(units, id);
    const value = kids.length ? Math.max(ORG_NODE.width, kids.reduce((sum, kid) => sum + width(kid.id), 0) + ORG_NODE.gapX * (kids.length - 1)) : ORG_NODE.width;
    widths.set(id, value); return value;
  };
  const place = (id: string, x: number, y: number) => {
    const w = widths.get(id)!, h = unitHeight(memberCount(id)), kids = childrenOf(units, id);
    layout.set(id, { x: x + w / 2 - ORG_NODE.width / 2, y, h });
    const kidsWidth = kids.reduce((sum, kid) => sum + widths.get(kid.id)!, 0) + ORG_NODE.gapX * Math.max(0, kids.length - 1);
    let cx = x + (w - kidsWidth) / 2;
    for (const kid of kids) { place(kid.id, cx, y + h + ORG_NODE.gapY); cx += widths.get(kid.id)! + ORG_NODE.gapX; }
  };
  let x = 0;
  for (const root of rootsOf(units)) { width(root.id); place(root.id, x, 0); x += widths.get(root.id)! + ORG_NODE.gapX * 2; }
  return layout;
}
