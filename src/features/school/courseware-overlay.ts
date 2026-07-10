import { z } from "zod";

// ---------------------------------------------------------------------------
// 课件页结构与 src/features/classroom/types.ts 的 CoursewarePage 同构（08-§3.6），
// 但 school feature 不与 classroom feature 互相 import（10-§6），故在此独立声明。
// ---------------------------------------------------------------------------

const pageBase = { id: z.string().uuid(), title: z.string().min(1).max(100) };

export const coursewareTemplatePageSchema = z.discriminatedUnion("type", [
  z.object({ ...pageBase, type: z.literal("image"), path: z.string().min(1).max(500) }),
  z.object({ ...pageBase, type: z.literal("video"), path: z.string().min(1).max(500) }),
  z.object({
    ...pageBase,
    type: z.literal("game"),
    gameId: z.string().min(1).max(50),
    difficulty: z.enum(["easy", "medium", "hard"]),
    seed: z.string().min(1).max(100),
  }),
  z.object({ ...pageBase, type: z.literal("board") }),
]);

export type CoursewareTemplatePage = z.infer<typeof coursewareTemplatePageSchema>;

export const courseware_template_array_schema = z.array(coursewareTemplatePageSchema).max(200);

const overlaySlotSchema = z.union([
  z.object({ ref: z.string().uuid() }).strict(),
  z.object({ page: coursewareTemplatePageSchema }).strict(),
]);

export type OverlaySlot = z.infer<typeof overlaySlotSchema>;

export const overlayArraySchema = z.array(overlaySlotSchema).max(400);

export function isOverlayRef(slot: OverlaySlot): slot is { ref: string } {
  return "ref" in slot;
}

/**
 * 自愈：失效引用（模板页已被删除）静默丢弃、重复引用只保留首次出现；
 * 模板新增的页（overlay 中无 ref）按模板顺序插回其模板前驱页之后。
 * 输出恒为「模板 id 集合的一个排列」，天然禁止删页——不会抛错。
 */
export function healOverlay(template: CoursewareTemplatePage[], overlay: OverlaySlot[]): OverlaySlot[] {
  const templateIds = template.map((page) => page.id);
  const templateIdSet = new Set(templateIds);
  const seenRefs = new Set<string>();
  const working: OverlaySlot[] = [];

  for (const slot of overlay) {
    if (isOverlayRef(slot)) {
      if (!templateIdSet.has(slot.ref) || seenRefs.has(slot.ref)) continue;
      seenRefs.add(slot.ref);
      working.push(slot);
    } else {
      working.push(slot);
    }
  }

  let lastPos = -1;
  for (const id of templateIds) {
    const idx = working.findIndex((slot) => isOverlayRef(slot) && slot.ref === id);
    if (idx >= 0) {
      lastPos = idx;
    } else {
      const insertAt = lastPos + 1;
      working.splice(insertAt, 0, { ref: id });
      lastPos = insertAt;
    }
  }

  return working;
}

/** 按 overlay 顺序展开为有效页数组（ref → 模板页对象，page → 原样）；用于候课预载与开课冻结。 */
export function resolveCourseware(template: CoursewareTemplatePage[], overlay: OverlaySlot[]): CoursewareTemplatePage[] {
  const healed = healOverlay(template, overlay);
  const byId = new Map(template.map((page) => [page.id, page]));
  return healed.map((slot) => (isOverlayRef(slot) ? byId.get(slot.ref)! : slot.page));
}

/** 建班时的初始覆盖层：模板页的全 ref 序列，不拷贝内容。 */
export function initialOverlayFromTemplate(template: CoursewareTemplatePage[]): OverlaySlot[] {
  return template.map((page) => ({ ref: page.id }));
}

/**
 * 服务端保存 overlay 前的校验+自愈：形状不对（非法页字段/超限）整体拒绝；
 * 形状合法则自愈为模板一致的排列后返回，供直接持久化。
 */
export function parseOverlayForSave(template: CoursewareTemplatePage[], raw: unknown): OverlaySlot[] {
  const parsed = overlayArraySchema.safeParse(raw);
  if (!parsed.success) throw new Error("INVALID_OVERLAY");
  return healOverlay(template, parsed.data);
}
