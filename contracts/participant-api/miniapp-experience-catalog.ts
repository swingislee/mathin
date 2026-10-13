/** Authoring metadata: containment, data types and reusable rendering modules are separate contracts. */
import { experienceText as t, type ContentBlock, type ContentBlockKind, type ContentDocument, type ExperienceText } from "./miniapp-experience";

export type ContentDataType = "text" | "number" | "facts" | "table" | "evidence" | "series";
export type ContentSource = { path: string; name: ExperienceText; type: ContentDataType; scope: "report" | "service"; availability: "recorded" | "optional" };
const source = (path: string, zh: string, en: string, type: ContentDataType, scope: ContentSource["scope"] = "report", availability: ContentSource["availability"] = "recorded"): ContentSource => ({ path, name: t(zh, en), type, scope, availability });
export const contentSources: ContentSource[] = [
  source("report.context", "本次记录资料", "Record context", "facts"),
  source("report.summary", "观察与正文", "Observations", "text"),
  source("report.score", "记录分值", "Recorded score", "number"),
  source("report.totalScore", "满分", "Maximum score", "number"),
  source("report.scoreBreakdown", "得分与满分", "Score and maximum", "series"),
  source("report.assessmentBand", "表现等级", "Performance level", "text"),
  source("report.strengths", "优势表现", "Strengths", "text"),
  source("report.focusAreas", "关注方向", "Focus areas", "text"),
  source("report.recommendation", "后续建议", "Recommendations", "text"),
  source("report.recommendedClass", "后续服务建议", "Recommended service", "text"),
  source("report.validityText", "参考有效期", "Reference validity", "text"),
  source("report.dimensions", "分项观察表", "Observation table", "table", "report", "optional"),
  source("report.dimensionScores", "分项数值与满分", "Dimension scores and maxima", "series", "report", "optional"),
  source("report.scoreHistory", "同一量尺的历次结果", "Comparable historical results", "series", "report", "optional"),
  source("report.evidence", "观察证据", "Supporting evidence", "evidence", "report", "optional"),
  source("service.name", "服务名称", "Service name", "text", "service"),
  source("service.summary", "服务摘要", "Service summary", "text", "service"),
  source("service.durationMinutes", "服务时长", "Service duration", "number", "service"),
];
export const moduleGroups: { id: string; name: ExperienceText; kinds: ContentBlockKind[] }[] = [
  { id: "structure", name: t("结构与阅读", "Structure & reading"), kinds: ["heading", "divider", "paragraph", "image", "callout", "quote"] },
  { id: "information", name: t("信息组织", "Information"), kinds: ["facts", "bullets", "steps", "faq", "table"] },
  { id: "business", name: t("业务数据展示", "Business data"), kinds: ["services", "activities", "contacts", "accountRecords"] },
  { id: "report", name: t("报告与可视化", "Reports & charts"), kinds: ["chart", "metric", "scale", "evidence"] },
  { id: "interaction", name: t("交互入口", "Interaction"), kinds: ["action"] },
];
export const acceptedSourceTypes = (kind: ContentBlockKind): ContentDataType[] => {
  if (["paragraph", "callout", "quote", "metric", "scale"].includes(kind)) return ["text", "number"];
  if (["facts", "bullets", "steps", "faq"].includes(kind)) return ["facts", "evidence"];
  if (kind === "table") return ["table"];
  if (kind === "evidence") return ["evidence"];
  if (kind === "chart") return ["series"];
  return [];
};
export function availableContentSources(document: ContentDocument, kind?: ContentBlockKind): ContentSource[] {
  return contentSources.filter(s => s.scope === document.purpose && (!kind || acceptedSourceTypes(kind).includes(s.type)));
}
export function bindingIssue(document: ContentDocument, block: ContentBlock): "unknown" | "scope" | "type" | null {
  if (!("binding" in block) || !block.binding) return null;
  const definition = contentSources.find(s => s.path === block.binding);
  if (!definition) return "unknown";
  if (definition.scope !== document.purpose) return "scope";
  if (!acceptedSourceTypes(block.kind).includes(definition.type)) return "type";
  return null;
}
