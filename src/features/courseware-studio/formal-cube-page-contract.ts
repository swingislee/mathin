import { coursewareCompositionPageSchema, createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { cubeCoursewareV2ToolSchema, type CubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { spatialTeachingToolSchema } from "@/features/tools/courseware/spatial-teaching-content";

export const FORMAL_CUBE_PAGE_SOURCE = "mathin-formal-cube" as const;

/** 正式课首批只接入自包含工具、文字与形状；资源及来源页沿用各自编辑入口。 */
export const formalCubePageSchema = coursewareCompositionPageSchema.superRefine((doc, context) => {
  if (new TextEncoder().encode(JSON.stringify(doc)).byteLength > 750_000 || doc.source !== null
    || doc.overlay.canvas.backgroundBindingKey !== null || doc.overlay.interactions.length
    || doc.overlay.nodes.some((node) => !["text", "rich_text", "shape"].includes(node.adapter)
      || node.resources.length > 0 || node.children.length > 0)
    || doc.layout.blocks.some((block) => block.type !== "node"
      && (block.type !== "tool" || !(cubeCoursewareV2ToolSchema.safeParse(block.tool).success || spatialTeachingToolSchema.safeParse(block.tool).success)))) {
    context.addIssue({ code: "custom", message: "Formal spatial pages contain registered self-contained spatial tools, text and shapes only" });
  }
});

export function createFormalCubePage(tool: CubeCoursewareTool) {
  const doc = createEmptyCoursewareCompositionPage();
  doc.layout.blocks.push({ id: "cube-1", type: "tool", tool: cubeCoursewareV2ToolSchema.parse(tool),
    placement: { column: 0, row: 0, columnSpan: 12, rowSpan: 9 } });
  return formalCubePageSchema.parse(doc);
}

export interface FormalCubePageSummary { pageDocId: string; title: string; pageNo: number; sourceCoursewareId?: string }
export interface FormalWorkspacePageSummary extends FormalCubePageSummary {
  composition: boolean; nativeAvailable: boolean; adaptedAvailable: boolean;
}

/** 已发布目录维持原索引，新草稿只追加一次；立方体页始终通过稳定 ID 打开。 */
export function formalCubeDirectory<T extends { pageDocId: string; title: string }>(released: readonly T[], cubes: readonly FormalCubePageSummary[], currentPages?: readonly FormalWorkspacePageSummary[]) {
  if (currentPages) {
    const releaseIndexes = new Map(released.map((page, index) => [page.pageDocId, index + 1]));
    return [...currentPages].sort((a, b) => a.pageNo - b.pageNo).map((page) => ({
      pageDocId: page.pageDocId, title: page.title, releasePage: releaseIndexes.get(page.pageDocId) ?? null, cube: page.composition,
    }));
  }
  const cubeIds = new Set(cubes.map((page) => page.pageDocId));
  const titles = new Map(cubes.map((page) => [page.pageDocId, page.title]));
  const entries = released.map((page, index) => ({ pageDocId: page.pageDocId,
    title: titles.get(page.pageDocId) ?? page.title, releasePage: index + 1, cube: cubeIds.has(page.pageDocId) }));
  const ids = new Set(entries.map((page) => page.pageDocId));
  return [...entries, ...cubes.filter((page) => !ids.has(page.pageDocId)).map((page) => ({
    pageDocId: page.pageDocId, title: page.title, releasePage: null, cube: true,
  }))];
}
