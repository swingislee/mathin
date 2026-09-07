import { coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { cubeCoursewareV2ToolSchema } from "@/features/tools/courseware/cube-structures-content";

export const FORMAL_MANUAL_PAGE_SOURCE = "mathin-manual" as const;

/** 通用空白组合页复用正式课的文字、图形、图片与 H5 绑定，并支持已登记的立方体组件。 */
export const formalManualPageSchema = coursewareCompositionPageSchema.superRefine((doc, context) => {
  if (doc.source !== null || doc.overlay.canvas.backgroundBindingKey !== null || doc.overlay.interactions.length
    || new TextEncoder().encode(JSON.stringify(doc)).byteLength > 750_000
    || doc.layout.blocks.some((block) => block.type !== "node"
      && (block.type !== "tool" || !cubeCoursewareV2ToolSchema.safeParse(block.tool).success))
    || doc.overlay.nodes.some((node) => {
      if (node.children.length) return true;
      if (["text", "rich_text", "shape"].includes(node.adapter)) return node.resources.length > 0;
      if (node.adapter !== "image" && node.adapter !== "h5") return true;
      const resource = node.resources[0];
      return node.resources.length !== 1 || resource.kind !== node.adapter
        || resource.role !== (node.adapter === "image" ? "image" : "entry")
        || resource.bindingPath !== (node.adapter === "image" ? "$.src" : "$.entry");
    })) {
    context.addIssue({ code: "custom", message: "Manual pages use page-local nodes and registered cube components" });
  }
});
