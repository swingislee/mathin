import "server-only";

import { z } from "zod";
import type { TeacherMicrocourseBrowserCatalogEntry, TeacherMicrocourseQuickPreview } from "./teacher-microcourse-library";
import type { TeacherMicrocourseConfiguration, TeacherMicrocourseCourseScope } from "./teacher-microcourse-scenes";

export type TeacherMicrocourseBrowseMode = "scene" | "grade" | "term" | "class";
export type TeacherMicrocourseBrowserSort = "recent" | "name" | "lectures";

export interface TeacherMicrocourseBrowserQuery {
  browse: TeacherMicrocourseBrowseMode;
  node?: string;
  course?: string;
  q?: string;
  searchAll: boolean;
  gradeIds: string[];
  termIds: string[];
  classSystemIds: string[];
  classTypeIds: string[];
  sort: TeacherMicrocourseBrowserSort;
  page: number;
}

export interface TeacherMicrocourseDirectoryNode {
  id: string;
  label: string;
  count: number;
  depth: 0 | 1 | 2;
  parentId: string | null;
}

export interface TeacherMicrocourseBrowserCourse {
  id: string;
  title: string;
  authorName: string;
  updatedAt: string;
  lectureCount: number;
  releasedLectureCount: number;
  branchCount: number;
  ready: boolean;
  gradeLabel: string;
  termLabel: string;
  classLabel: string;
  sceneNames: string[];
  scope: TeacherMicrocourseCourseScope;
  previewLoaded: boolean;
  preview: TeacherMicrocourseQuickPreview;
}

export interface TeacherMicrocourseBrowserModel {
  query: TeacherMicrocourseBrowserQuery;
  directory: TeacherMicrocourseDirectoryNode[];
  courses: TeacherMicrocourseBrowserCourse[];
  selectedCourseId: string | null;
  totalCount: number;
  pageCount: number;
  pageSize: number;
}

const uuid = z.uuid();
const PAGE_SIZE = 30;
const emptyScope = (courseId: string): TeacherMicrocourseCourseScope => ({
  courseId,
  sceneIds: [],
  gradeIds: [],
  termIds: [],
  classSystemIds: [],
  classTypeIds: [],
  hasLegacyScope: false,
});
const emptyPreview = (entry: TeacherMicrocourseBrowserCatalogEntry): TeacherMicrocourseQuickPreview => ({
  courseId: entry.id,
  updatedAt: entry.updatedAt,
  branchCount: 0,
  lectures: entry.lectureTitles.map((name, index) => ({
    id: `${entry.id}:${index + 1}`,
    no: index + 1,
    name,
    objectives: "",
    status: "draft",
    currentReleaseId: null,
    releaseNo: null,
    pageCount: 0,
    cacheKey: `draft:${entry.id}:${index + 1}`,
  })),
});

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseIds(value: string | undefined) {
  if (!value) return [];
  return [...new Set(value.split(",").filter((item) => uuid.safeParse(item).success))].slice(0, 100);
}

export function parseTeacherMicrocourseBrowserQuery(input: Record<string, string | string[] | undefined>): TeacherMicrocourseBrowserQuery {
  const browse = first(input.browse);
  const sort = first(input.sort);
  const page = Number(first(input.page));
  const course = first(input.course);
  return {
    browse: browse === "grade" || browse === "term" || browse === "class" ? browse : "scene",
    node: first(input.node)?.trim().slice(0, 100) || undefined,
    course: course && uuid.safeParse(course).success ? course : undefined,
    q: first(input.q)?.trim().slice(0, 80) || undefined,
    searchAll: first(input.searchAll) === "1",
    gradeIds: parseIds(first(input.grades)),
    termIds: parseIds(first(input.terms)),
    classSystemIds: parseIds(first(input.systems)),
    classTypeIds: parseIds(first(input.classTypes)),
    sort: sort === "name" || sort === "lectures" ? sort : "recent",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

function intersects(left: string[], right: string[]) {
  return left.some((item) => right.includes(item));
}

function matchesApplicability(scope: TeacherMicrocourseCourseScope, query: TeacherMicrocourseBrowserQuery, configuration: TeacherMicrocourseConfiguration) {
  if (query.gradeIds.length && scope.gradeIds.length && !intersects(scope.gradeIds, query.gradeIds)) return false;
  if (query.termIds.length && scope.termIds.length && !intersects(scope.termIds, query.termIds)) return false;
  if (query.classSystemIds.length && (scope.classSystemIds.length || scope.classTypeIds.length)) {
    const matchingTypeIds = configuration.classSystems
      .filter((system) => query.classSystemIds.includes(system.id))
      .flatMap((system) => system.classTypes.map((item) => item.id));
    if (!intersects(scope.classSystemIds, query.classSystemIds) && !intersects(scope.classTypeIds, matchingTypeIds)) return false;
  }
  if (query.classTypeIds.length && (scope.classSystemIds.length || scope.classTypeIds.length)) {
    const matchingSystemIds = configuration.classSystems
      .filter((system) => system.classTypes.some((item) => query.classTypeIds.includes(item.id)))
      .map((system) => system.id);
    if (!intersects(scope.classTypeIds, query.classTypeIds) && !intersects(scope.classSystemIds, matchingSystemIds)) return false;
  }
  return true;
}

function matchesNode(scope: TeacherMicrocourseCourseScope, node: string | undefined, configuration: TeacherMicrocourseConfiguration) {
  if (!node) return true;
  const [kind, id] = node.split(":", 2);
  if (kind === "unclassified") return scope.sceneIds.length === 0;
  if (kind === "universal-grade") return scope.gradeIds.length === 0;
  if (kind === "universal-term") return scope.termIds.length === 0;
  if (kind === "universal-class") return scope.classSystemIds.length === 0 && scope.classTypeIds.length === 0;
  if (kind === "scene-root") {
    const root = configuration.roots.find((item) => item.id === id);
    return Boolean(root && intersects(scope.sceneIds, root.scenes.map((scene) => scene.id)));
  }
  if (kind === "scene") {
    const root = configuration.roots.find((item) => item.scenes.some((scene) => scene.id === id));
    const descendants = root?.scenes.filter((scene) => scene.id === id || scene.parentId === id).map((scene) => scene.id) ?? [];
    return intersects(scope.sceneIds, descendants);
  }
  if (kind === "grade-stage") {
    return intersects(scope.gradeIds, configuration.grades.filter((grade) => grade.stageId === id).map((grade) => grade.id));
  }
  if (kind === "grade") return scope.gradeIds.includes(id);
  if (kind === "term") return scope.termIds.includes(id);
  if (kind === "class-system") {
    const system = configuration.classSystems.find((item) => item.id === id);
    return scope.classSystemIds.includes(id) || Boolean(system && intersects(scope.classTypeIds, system.classTypes.map((item) => item.id)));
  }
  if (kind === "class-type") {
    const system = configuration.classSystems.find((item) => item.classTypes.some((type) => type.id === id));
    return scope.classTypeIds.includes(id) || Boolean(system && scope.classSystemIds.includes(system.id));
  }
  return true;
}

function directoryForMode(mode: TeacherMicrocourseBrowseMode, configuration: TeacherMicrocourseConfiguration, scopes: TeacherMicrocourseCourseScope[], locale: string) {
  const label = (item: { nameZh: string; nameEn: string }) => locale === "zh" ? item.nameZh : item.nameEn;
  const count = (predicate: (scope: TeacherMicrocourseCourseScope) => boolean) => scopes.filter(predicate).length;
  const nodes: TeacherMicrocourseDirectoryNode[] = [];
  if (mode === "scene") {
    for (const root of configuration.roots.filter((item) => item.enabled)) {
      const framework = configuration.frameworkItems.find((item) => item.code === root.frameworkItemCode);
      const sceneIds = root.scenes.map((scene) => scene.id);
      nodes.push({ id: `scene-root:${root.id}`, label: framework ? (locale === "zh" ? framework.labelZh : framework.labelEn) : root.frameworkItemCode, count: count((scope) => intersects(scope.sceneIds, sceneIds)), depth: 0, parentId: null });
      for (const scene of root.scenes.filter((item) => item.status === "active")) nodes.push({ id: `scene:${scene.id}`, label: scene.name, count: count((scope) => intersects(scope.sceneIds, [scene.id, ...root.scenes.filter((child) => child.parentId === scene.id).map((child) => child.id)])), depth: scene.parentId ? 2 : 1, parentId: scene.parentId ? `scene:${scene.parentId}` : `scene-root:${root.id}` });
    }
    nodes.push({ id: "unclassified:all", label: locale === "zh" ? "未归类" : "Unclassified", count: count((scope) => scope.sceneIds.length === 0), depth: 0, parentId: null });
  } else if (mode === "grade") {
    for (const stage of configuration.gradeStages.filter((item) => item.active)) {
      const gradeIds = configuration.grades.filter((grade) => grade.active && grade.stageId === stage.id).map((grade) => grade.id);
      nodes.push({ id: `grade-stage:${stage.id}`, label: label(stage), count: count((scope) => intersects(scope.gradeIds, gradeIds)), depth: 0, parentId: null });
      for (const grade of configuration.grades.filter((item) => item.active && item.stageId === stage.id)) nodes.push({ id: `grade:${grade.id}`, label: label(grade), count: count((scope) => scope.gradeIds.includes(grade.id)), depth: 1, parentId: `grade-stage:${stage.id}` });
    }
    nodes.push({ id: "universal-grade:all", label: locale === "zh" ? "通用年级" : "All grades", count: count((scope) => scope.gradeIds.length === 0), depth: 0, parentId: null });
  } else if (mode === "term") {
    for (const term of configuration.terms.filter((item) => item.active)) nodes.push({ id: `term:${term.id}`, label: label(term), count: count((scope) => scope.termIds.includes(term.id)), depth: 0, parentId: null });
    nodes.push({ id: "universal-term:all", label: locale === "zh" ? "通用学期" : "All terms", count: count((scope) => scope.termIds.length === 0), depth: 0, parentId: null });
  } else {
    for (const system of configuration.classSystems.filter((item) => item.active)) {
      const typeIds = system.classTypes.filter((item) => item.active).map((item) => item.id);
      nodes.push({ id: `class-system:${system.id}`, label: label(system), count: count((scope) => scope.classSystemIds.includes(system.id) || intersects(scope.classTypeIds, typeIds)), depth: 0, parentId: null });
      for (const type of system.classTypes.filter((item) => item.active)) nodes.push({ id: `class-type:${type.id}`, label: label(type), count: count((scope) => scope.classTypeIds.includes(type.id) || scope.classSystemIds.includes(system.id)), depth: 1, parentId: `class-system:${system.id}` });
    }
    nodes.push({ id: "universal-class:all", label: locale === "zh" ? "通用班型" : "All class types", count: count((scope) => scope.classSystemIds.length === 0 && scope.classTypeIds.length === 0), depth: 0, parentId: null });
  }
  return nodes;
}

function scopeLabels(scope: TeacherMicrocourseCourseScope, configuration: TeacherMicrocourseConfiguration, locale: string) {
  const universal = locale === "zh" ? "通用" : "Universal";
  const label = (item: { nameZh: string; nameEn: string }) => locale === "zh" ? item.nameZh : item.nameEn;
  const grades = configuration.grades.filter((item) => scope.gradeIds.includes(item.id)).map(label);
  const terms = configuration.terms.filter((item) => scope.termIds.includes(item.id)).map(label);
  const systems = configuration.classSystems.filter((item) => scope.classSystemIds.includes(item.id)).map(label);
  const types = configuration.classSystems.flatMap((system) => system.classTypes).filter((item) => scope.classTypeIds.includes(item.id)).map(label);
  const scenes = configuration.roots.flatMap((root) => root.scenes).filter((scene) => scope.sceneIds.includes(scene.id)).map((scene) => scene.name);
  return {
    gradeLabel: grades.length ? grades.join(locale === "zh" ? "、" : ", ") : universal,
    termLabel: terms.length ? terms.join(locale === "zh" ? "、" : ", ") : universal,
    classLabel: [...systems, ...types].length ? [...systems, ...types].join(locale === "zh" ? "、" : ", ") : universal,
    sceneNames: scenes,
  };
}

export function buildTeacherMicrocourseBrowserModel({ entries, scopes, previews, configuration, query, locale }: {
  entries: TeacherMicrocourseBrowserCatalogEntry[];
  scopes: TeacherMicrocourseCourseScope[];
  previews: TeacherMicrocourseQuickPreview[];
  configuration: TeacherMicrocourseConfiguration;
  query: TeacherMicrocourseBrowserQuery;
  locale: string;
}): TeacherMicrocourseBrowserModel {
  const scopeMap = new Map(scopes.map((scope) => [scope.courseId, scope]));
  const previewMap = new Map(previews.map((preview) => [preview.courseId, preview]));
  const allScopes = entries.map((entry) => scopeMap.get(entry.id) ?? emptyScope(entry.id));
  const directory = directoryForMode(query.browse, configuration, allScopes, locale);
  const normalizedQuery = query.q?.toLocaleLowerCase();
  let filtered = entries.filter((entry) => {
    const scope = scopeMap.get(entry.id) ?? emptyScope(entry.id);
    if (!matchesApplicability(scope, query, configuration)) return false;
    if (!query.searchAll && !matchesNode(scope, query.node, configuration)) return false;
    if (normalizedQuery) {
      const preview = previewMap.get(entry.id);
      const previewText = preview?.lectures.map((lecture) => `${lecture.name} ${lecture.objectives}`).join(" ") ?? "";
      if (!`${entry.title} ${entry.searchText} ${previewText}`.toLocaleLowerCase().includes(normalizedQuery)) return false;
    }
    return true;
  });
  filtered = [...filtered].sort((left, right) => {
    if (query.sort === "name") return left.title.localeCompare(right.title, locale);
    if (query.sort === "lectures") return right.lectureCount - left.lectureCount || left.title.localeCompare(right.title, locale);
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.title.localeCompare(right.title, locale);
  });
  const totalCount = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const pageEntries = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const courses = pageEntries.map((entry): TeacherMicrocourseBrowserCourse => {
    const scope = scopeMap.get(entry.id) ?? emptyScope(entry.id);
    const loadedPreview = previewMap.get(entry.id);
    const preview = loadedPreview ?? emptyPreview(entry);
    return {
      id: entry.id,
      title: entry.title,
      authorName: entry.authorName,
      updatedAt: preview.updatedAt,
      lectureCount: entry.lectureCount,
      releasedLectureCount: entry.releasedLectureCount,
      branchCount: preview.branchCount,
      ready: entry.lectureCount > 0 && entry.releasedLectureCount === entry.lectureCount,
      ...scopeLabels(scope, configuration, locale),
      scope,
      previewLoaded: Boolean(loadedPreview),
      preview,
    };
  });
  const selectedCourseId = query.course && courses.some((course) => course.id === query.course)
    ? query.course
    : courses[0]?.id ?? null;
  return { query: { ...query, page }, directory, courses, selectedCourseId, totalCount, pageCount, pageSize: PAGE_SIZE };
}
