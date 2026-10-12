import type { Activity } from "./api-types";
import type { Locale } from "./locale";
import { configuration } from "./miniapp-configuration";
import { miniappText } from "./miniapp-settings";

export function catalogStageGroups(includeHidden = false) {
  return configuration().stages.map(g => ({ ...g, stages: g.stages.filter(s => includeHidden || s.visible) })).filter(g => g.stages.length);
}
export function catalogStages(includeHidden = false) { return catalogStageGroups(includeHidden).reduce((all, group) => all.concat(group.stages), [] as ReturnType<typeof catalogStageGroups>[0]["stages"]); }
const preferenceKey = "gezhi.discovery.filters.v1";
export function participantStageLabel(stageNumber: number | null | undefined, locale: Locale) {
  const stage = catalogStages(true).find(item => item.stageNumber === stageNumber); return stage ? miniappText(stage.label, locale) : "";
}
export function normalizeFilters(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { stage: catalogStages().some(item => item.id === input.stage) ? String(input.stage) : "",
    topic: typeof input.topic === "string" && input.topic.length <= 80 ? input.topic.trim() : "" };
}
export function readCatalogFilters() { return normalizeFilters(wx.getStorageSync(preferenceKey)); }
export function saveCatalogFilters(value: { stage: string; topic: string }) { wx.setStorageSync(preferenceKey, normalizeFilters(value)); }
export function catalogLabels(stage: string, topic: string, locale: Locale, topics: { id: string; label: string }[] = []) {
  const selected = catalogStages(true).find(item => item.id === stage);
  return { stageLabel: selected ? miniappText(selected.label, locale) : "", topicLabel: topics.find(item => item.id === topic)?.label || "",
    stageGroups: catalogStageGroups().map(group => ({ id: group.id, label: miniappText(group.label, locale), stages: group.stages.map(item => ({ id: item.id, label: miniappText(item.label, locale) })) })), topics };
}
export function filterCatalog(rows: Activity[], stage: string, topic: string, now = Date.now()) {
  const stageNumber = catalogStages().find(item => item.id === stage)?.stageNumber;
  return rows.filter(row => Date.parse(row.startsAt) > now
    && (stageNumber === undefined || (Array.isArray(row.targetStages) && (!row.targetStages.length || row.targetStages.includes(stageNumber))))
    && (!topic || row.topic === topic)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
