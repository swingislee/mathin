import type { Activity } from "./api-types";
import type { Locale } from "./locale";

export const stageGroups = [
  { id: "kindergarten", label: { zh: "幼儿园", en: "Kindergarten" }, stages: [
    { id: "k2", stageNumber: -1, label: { zh: "幼中班", en: "K2" } },
    { id: "k3", stageNumber: 0, label: { zh: "幼大班", en: "K3" } },
  ] },
  { id: "primary", label: { zh: "小学", en: "Primary school" }, stages: [
    { id: "g1", stageNumber: 1, label: { zh: "一年级", en: "Grade 1" } },
    { id: "g2", stageNumber: 2, label: { zh: "二年级", en: "Grade 2" } },
    { id: "g3", stageNumber: 3, label: { zh: "三年级", en: "Grade 3" } },
    { id: "g4", stageNumber: 4, label: { zh: "四年级", en: "Grade 4" } },
    { id: "g5", stageNumber: 5, label: { zh: "五年级", en: "Grade 5" } },
    { id: "g6", stageNumber: 6, label: { zh: "六年级", en: "Grade 6" } },
  ] },
  { id: "secondary", label: { zh: "初中", en: "Middle school" }, stages: [
    { id: "g7", stageNumber: 7, label: { zh: "初一", en: "Grade 7" } },
    { id: "g8", stageNumber: 8, label: { zh: "初二", en: "Grade 8" } },
    { id: "g9", stageNumber: 9, label: { zh: "初三", en: "Grade 9" } },
  ] },
  { id: "high", label: { zh: "高中", en: "High school" }, stages: [
    { id: "g10", stageNumber: 10, label: { zh: "高一", en: "Grade 10" } },
    { id: "g11", stageNumber: 11, label: { zh: "高二", en: "Grade 11" } },
    { id: "g12", stageNumber: 12, label: { zh: "高三", en: "Grade 12" } },
  ] },
];

export const topics = [
  { id: "math", label: { zh: "数学思维", en: "Mathematical thinking" } },
  { id: "english", label: { zh: "英语", en: "English" } },
];
const stages = stageGroups.reduce((all, group) => all.concat(group.stages), [] as typeof stageGroups[0]["stages"]);
const preferenceKey = "gezhi.discovery.filters.v1";

export function participantStageLabel(stageNumber: number | null | undefined, locale: Locale) {
  return stages.find(item => item.stageNumber === stageNumber)?.label[locale] || "";
}

export function normalizeFilters(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    stage: stages.some(item => item.id === input.stage) ? String(input.stage) : "",
    topic: topics.some(item => item.id === input.topic) ? String(input.topic) : "",
  };
}
export function readCatalogFilters() { return normalizeFilters(wx.getStorageSync(preferenceKey)); }
export function saveCatalogFilters(value: { stage: string; topic: string }) { wx.setStorageSync(preferenceKey, normalizeFilters(value)); }
export function catalogLabels(stage: string, topic: string, locale: Locale) {
  return {
    stageLabel: stages.find(item => item.id === stage)?.label[locale] || "",
    topicLabel: topics.find(item => item.id === topic)?.label[locale] || "",
    stageGroups: stageGroups.map(group => ({ id: group.id, label: group.label[locale], stages: group.stages.map(item => ({ id: item.id, label: item.label[locale] })) })),
    topics: topics.map(item => ({ id: item.id, label: item.label[locale] })),
  };
}
export function filterCatalog(rows: Activity[], stage: string, topic: string, now = Date.now()) {
  const stageNumber = stages.find(item => item.id === stage)?.stageNumber;
  return rows.filter(row => Date.parse(row.startsAt) > now
    // NULL 表示年级待核对；空数组才表示不限年级。
    && (stageNumber === undefined || (Array.isArray(row.targetStages) && (!row.targetStages.length || row.targetStages.includes(stageNumber))))
    && (!topic || row.topic === topic))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
