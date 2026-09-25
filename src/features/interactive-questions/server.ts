import "server-only";
import sanitizeHtml from "sanitize-html";
import { coursewareCompositionPageSchema, type CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { gamePageDocSchema } from "@/features/courseware-doc/game-page-schema";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";
import { gameCoursewareContractsForSurface } from "@/features/games/courseware/registry";
import { toolCoursewareContractsForSurface } from "@/features/tools/courseware/registry";

/** 保存和读取均经此边界，数据库直接写入的富文本也不能绕过渲染消毒。 */
export function trustedQuestionComposition(value: CoursewareCompositionPage): CoursewareCompositionPage {
  const doc = structuredClone(value);
  if (doc.source || doc.overlay.canvas.backgroundBindingKey || doc.overlay.interactions.length) throw new Error("VALIDATION");
  for (const node of doc.overlay.nodes) {
    if (!["text", "rich_text", "shape", "image", "h5"].includes(node.adapter) || node.children.length) throw new Error("VALIDATION");
    if (node.content?.kind === "rich_text") {
      node.content.html = sanitizeHtml(node.content.html ?? "", {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, "span"],
        allowedAttributes: { span: ["class"] }, allowedClasses: { span: ["math-tex"] }, allowedSchemes: [],
      });
      node.content.sanitized = true;
    }
    if (node.content?.svg) node.content.svg = "";
  }
  doc.layout.blocks = doc.layout.blocks.map(block => {
    if (block.type === "h5") throw new Error("VALIDATION");
    if (block.type === "tool" && !toolCoursewareContractsForSurface("microcourse").some(c => c.toolId === block.tool.toolId && c.contentVersion === block.tool.contentVersion)) throw new Error("VALIDATION");
    if (block.type !== "game") return block;
    if (!gameCoursewareContractsForSurface("microcourse").some(c => c.gameId === block.game.gameId && c.contentVersion === block.game.contentVersion)) throw new Error("VALIDATION");
    const trusted = validateGameCoursewareContent(block.game.gameId, block.game.contentVersion, block.game.payload);
    return { ...block, game: gamePageDocSchema.parse({ ...block.game, payload: trusted.payload, validation: trusted.validation }) };
  });
  return coursewareCompositionPageSchema.parse(doc);
}
