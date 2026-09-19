import { z } from "zod";
import { STUDENT_STAGE_TABS, type StudentStage, type StudentStageRow } from "./student-stage-contract";

export const DIRECTORY_GROUPINGS = ["classroom", "grade", "owner", "group", "none"] as const;
export type DirectoryGrouping = typeof DIRECTORY_GROUPINGS[number];
export interface StudentDirectoryFilters {
  scope: "all" | "mine" | "group" | "unassigned"; q: string; stage: StudentStage | "all";
  groupBy: DirectoryGrouping; group: string; page: number; pageSize: 20 | 50 | 100;
}
export interface DirectoryGroup { id: string; name: string }
export interface StudentDirectoryCard {
  id: string; name: string; grade: number | null; gradeText: string; phoneTail: string;
  stage: StudentStage; detail: string; groups: DirectoryGroup[]; canContact: boolean;
  assessment: { band: string | null; score: number | null; at: string | null } | null;
}
export interface StudentDirectoryData {
  students: StudentDirectoryCard[]; count: number; page: number; totalPages: number; pageSize: 20 | 50 | 100;
  groups: Array<DirectoryGroup & { count: number }>; counts: Partial<Record<StudentStage, number>>;
}
type Query = Record<string, string | string[] | undefined>;
export function parseStudentDirectoryFilters(raw: Query, defaultScope: "all" | "mine" = "mine"): StudentDirectoryFilters {
  const pick = (key: string) => Array.isArray(raw[key]) ? raw[key][0] : raw[key];
  const scope = pick("scope"), stage = pick("stage"), groupBy = pick("groupBy"), size = Number(pick("pageSize")), page = Number(pick("page"));
  return { scope: scope === "all" || scope === "mine" || scope === "group" || scope === "unassigned" ? scope : defaultScope,
    stage: STUDENT_STAGE_TABS.includes(stage as StudentStage) ? stage as StudentStage : "all",
    groupBy: DIRECTORY_GROUPINGS.includes(groupBy as DirectoryGrouping) ? groupBy as DirectoryGrouping : "classroom",
    group: (pick("group") ?? "").slice(0, 100), q: (pick("q") ?? "").trim().slice(0, 80),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1, pageSize: size === 20 || size === 50 ? size : 100 };
}
export function studentDirectoryHref(filters: StudentDirectoryFilters, change: Partial<StudentDirectoryFilters> = {}) {
  const next = { ...filters, ...change };
  const query = new URLSearchParams({ scope: next.scope, groupBy: next.groupBy });
  if (next.q) query.set("q", next.q);
  if (next.stage !== "all") query.set("stage", next.stage);
  if (next.group) query.set("group", next.group);
  if (next.page > 1) query.set("page", String(next.page));
  if (next.pageSize !== 100) query.set("pageSize", String(next.pageSize));
  return `/dashboard/students?${query}`;
}
export function directoryReturnHref(raw: string | undefined) {
  if (!raw || !/^\/dashboard\/students(?:\?|$)/.test(raw)) return "/dashboard/students";
  return studentDirectoryHref(parseStudentDirectoryFilters(Object.fromEntries(new URLSearchParams(raw.split("?")[1]))));
}
export const directorySelectionSchema = z.array(z.string().uuid()).min(1).max(100).transform(ids => [...new Set(ids)]);
export function directoryContactHref(ids: string[], returnHref: string) {
  const selected = directorySelectionSchema.parse(ids);
  return `/dashboard/communication?${new URLSearchParams({ students: selected.join(","), returnTo: directoryReturnHref(returnHref) })}`;
}
export function toStudentDirectoryCard(row: StudentStageRow & { directoryGroups: DirectoryGroup[] }): StudentDirectoryCard | null {
  if (!row.studentId) return null;
  const assessed = row.assessmentSource !== "class_band" && Boolean(row.assessmentRecordId || row.assessmentAt || row.assessmentSource === "assessment");
  return { id: row.studentId, name: row.name, grade: row.grade, gradeText: row.gradeText,
    phoneTail: row.phone.replace(/\D/g, "").slice(-4), stage: row.stage, detail: row.detail, groups: row.directoryGroups,
    canContact: row.canWrite, assessment: assessed ? { band: row.assessmentBand, score: row.score, at: row.assessmentAt } : null };
}
export function groupDirectoryCards(students: StudentDirectoryCard[], group: string, locale: string) {
  const sections = new Map<string, DirectoryGroup & { students: StudentDirectoryCard[] }>();
  for (const student of students) for (const item of student.groups) {
    if (group && item.id !== group) continue;
    if (!sections.has(item.id)) sections.set(item.id, { ...item, students: [] });
    sections.get(item.id)!.students.push(student);
  }
  return [...sections.values()].sort((a, b) => a.id === "unassigned" ? 1 : b.id === "unassigned" ? -1 : a.name.localeCompare(b.name, locale, { numeric: true }));
}
