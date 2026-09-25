import { z } from "zod";
import { createEmptyCoursewareCompositionPage, type CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { createCoursewareInsertedNode } from "@/features/courseware-doc/courseware-inserted-node";
import { addCoursewareCompositionNode } from "@/features/courseware-doc/composition-page-layout";

/** 分组是有顺序的目录；每道题只属于一个组，未分组题目保留原顺序。 */
export const questionGroupSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(60), questionIds: z.array(z.string().uuid()).max(200),
});
export const questionGroupsSchema = z.array(questionGroupSchema).max(60).superRefine((groups, ctx) => {
  for (const values of [groups.map(g => g.id), groups.map(g => g.name), groups.flatMap(g => g.questionIds)]) {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: "Duplicate group or question" });
  }
});
export type QuestionGroup = z.infer<typeof questionGroupSchema>;
export const questionGroupStateSchema = z.object({ version: z.number().int().nonnegative(), groups: questionGroupsSchema });
export type QuestionGroupState = z.infer<typeof questionGroupStateSchema>;

export function orderedQuestionIds(ids: string[], groups: QuestionGroup[]) {
  const known = new Set(ids);
  const grouped = groups.flatMap(group => group.questionIds.filter(id => known.has(id)));
  const assigned = new Set(grouped);
  return [...grouped, ...ids.filter(id => !assigned.has(id))];
}

export function questionCompositionFromText(text: string): CoursewareCompositionPage {
  const doc = createEmptyCoursewareCompositionPage();
  if (!text) return doc;
  const node = createCoursewareInsertedNode("text", 1, doc.canvas);
  node.content = { kind: "text", text };
  return addCoursewareCompositionNode(doc, node, { columnSpan: 12, rowSpan: 3 });
}

export function questionCompositionText(doc: CoursewareCompositionPage) {
  return doc.overlay.nodes.flatMap(node => {
    if (node.content?.kind === "text") return [node.content.text ?? ""];
    if (node.content?.kind === "rich_text") return [(node.content.html ?? "").replace(/<[^>]*>/g, "")];
    return [];
  }).join("\n").slice(0, 10000);
}

/** 仅存稳定 bindingKey，签名 URL 不进入题目或历史副本。 */
export function interactiveBindingKeys(value: unknown): string[] {
  const keys = new Set<string>();
  function visit(item: unknown) {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, child] of Object.entries(item)) {
      if (key === "bindingKey" && typeof child === "string") keys.add(child);
      else visit(child);
    }
  }
  visit(value);
  return [...keys];
}
