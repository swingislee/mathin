import { z } from "zod";

/**
 * page-doc-v1 —— mathin 课件页文档的冻结 schema（P6-0 ④，docs/plan/16 §3 D1）。
 *
 * 由镜像项目的 page-render-v1（mofaxiao_courseware/src/render/model.ts）衍生：
 * - 去掉本地环境字段：resourceRefId（镜像本地自增 id）、libraryPath、availableLocally、
 *   sourceUrl/finalUrl/mime/byteCount/sha256/storageMode（运行时经 binding 解析，不入文档）；
 * - 资源引用一律改为 bindingKey（= Stage 23 usageKey，跨库稳定），含交互音频与画布背景；
 * - richText 内嵌图片占位由 asset://resource/<id> 改为 asset://binding/<bindingKey>；
 * - 去掉管线诊断字段（stats、warnings、canvas.sizeSource/inferred）；
 * - 溯源字段保留（sourceCoursewareId / sourcePageId / sourceSnapshotId /
 *   sourcePageDatabaseId / sourceContentHash——后者是「不做增量导出」拍板的反悔钩子，§10 第 5 项）。
 *
 * 冻结纪律：本 schema 全部 .strict()，导入时拒绝未知字段；任何结构演进必须升版本号
 * （page-doc-v2）并保留本文件可解析旧数据，不得原地改动。
 */

export const PAGE_DOC_VERSION = "page-doc-v1";

/** richText html 内嵌资源占位前缀，渲染时经 resolve 注入实际 URL */
export const ASSET_BINDING_URL_PREFIX = "asset://binding/";

const finite = z.number().finite();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const assetKindSchema = z.enum(["image", "video", "audio", "svg", "h5"]);

/** 节点上的资源引用：bindingPath 区分同节点多资源（如 richText 多内嵌图） */
export const docResourceBindingSchema = z
  .object({
    bindingKey: sha256Hex,
    bindingPath: z.string(),
    role: z.string(),
    kind: assetKindSchema,
  })
  .strict();

const cropSchema = z
  .object({ x: finite, y: finite, width: finite.positive(), height: finite.positive() })
  .strict();

const transformSchema = z
  .object({
    x: finite,
    y: finite,
    width: finite,
    height: finite,
    rotation: finite,
    scaleX: finite,
    scaleY: finite,
    anchorX: finite,
    anchorY: finite,
    opacity: finite,
    flipX: z.boolean(),
    flipY: z.boolean(),
    clip: z.boolean(),
  })
  .strict();

const styleSchema = z
  .object({
    objectFit: z.enum(["contain", "cover", "fill", "none"]),
    backgroundColor: z.string().nullable(),
    color: z.string().nullable(),
    borderColor: z.string().nullable(),
    borderWidth: finite,
    borderRadius: finite,
    fontFamily: z.string().nullable(),
    fontSize: finite.nullable(),
    fontWeight: z.union([z.string(), finite]).nullable(),
    lineHeight: finite.nullable(),
    letterSpacing: finite.nullable(),
    whiteSpace: z.enum(["normal", "pre", "pre-wrap", "nowrap"]).nullable(),
    textAlign: z.enum(["left", "center", "right", "justify"]).nullable(),
    overflow: z.enum(["visible", "hidden"]),
  })
  .strict();

const contentSchema = z
  .object({
    kind: z.enum(["text", "rich_text", "svg", "shape", "math_vertical", "table", "h5", "unsupported"]),
    text: z.string().optional(),
    html: z.string().optional(),
    svg: z.string().optional(),
    shapeType: z.string().optional(),
    rows: z.array(z.array(z.unknown())).optional(),
    sanitized: z.boolean().optional(),
    /** 仅 kind=h5：镜像判定的离线终态（offline / online_only / development_pending 等） */
    status: z.string().optional(),
    sourceType: z.string().optional(),
    summary: z.string().optional(),
  })
  .strict();

export type DocNode = {
  id: string;
  nodePath: string;
  sourceType: string;
  sourceResourceId: string | null;
  adapter: string;
  name: string | null;
  supported: boolean;
  visible: boolean;
  interactive: boolean;
  zIndex: number;
  order: number;
  crop: z.infer<typeof cropSchema> | null;
  transform: z.infer<typeof transformSchema>;
  style: z.infer<typeof styleSchema>;
  content: z.infer<typeof contentSchema> | null;
  resources: z.infer<typeof docResourceBindingSchema>[];
  children: DocNode[];
};

export const docNodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z
    .object({
      id: z.string(),
      nodePath: z.string(),
      sourceType: z.string(),
      sourceResourceId: z.string().nullable(),
      adapter: z.string(),
      name: z.string().nullable(),
      supported: z.boolean(),
      /**
       * 初始可见性。注意 render-v1 语义：enter 交互的目标节点初始隐藏
       * （visible=false），由交互调度器显示——渲染器漏掉这条会提前泄露答案。
       */
      visible: z.boolean(),
      interactive: z.boolean(),
      zIndex: finite,
      order: z.number().int(),
      crop: cropSchema.nullable(),
      transform: transformSchema,
      style: styleSchema,
      content: contentSchema.nullable(),
      resources: z.array(docResourceBindingSchema),
      children: z.array(docNodeSchema),
    })
    .strict(),
);

export const docInteractionSchema = z
  .object({
    trigger: z.enum(["auto", "click", "same", "follow"]),
    triggerScope: z.enum(["node", "page", "auto"]),
    triggerResourceId: z.string().nullable(),
    targetResourceId: z.string(),
    action: z.enum(["enter", "exit", "emphasize", "path"]),
    animation: z.string(),
    delay: finite.nonnegative(),
    duration: finite.nonnegative(),
    loop: z.number().int().nonnegative(),
    /** path 动画点位与节点 transform 共用页面坐标系——任何几何变换必须同步作用于 points */
    path: z.object({ type: z.string(), points: z.array(finite) }).strict().nullable(),
    audioBindingKey: sha256Hex.nullable(),
    audioName: z.string().nullable(),
    step: z.number().int().nonnegative(),
  })
  .strict();

export const pageDocSchema = z
  .object({
    docVersion: z.literal(PAGE_DOC_VERSION),
    /** 溯源（只读元数据，教研编辑不改动） */
    sourceCoursewareId: z.string(),
    sourcePageId: z.string().nullable(),
    sourcePageDatabaseId: z.number().int().positive(),
    sourceSnapshotId: z.number().int().positive(),
    /** 该页源 JSON 规范化后的 sha256，增量对账反悔钩子（doc 16 §10 第 5 项） */
    sourceContentHash: sha256Hex,
    canvas: z
      .object({
        width: finite.positive(),
        height: finite.positive(),
        backgroundColor: z.string().nullable(),
        backgroundBindingKey: sha256Hex.nullable(),
      })
      .strict(),
    nodes: z.array(docNodeSchema),
    interactions: z.array(docInteractionSchema),
  })
  .strict();

export type PageDoc = z.infer<typeof pageDocSchema>;
export type DocResourceBinding = z.infer<typeof docResourceBindingSchema>;
export type DocInteraction = z.infer<typeof docInteractionSchema>;

/** 遍历整页 doc 收集全部资源引用（节点 + 交互音频 + 画布背景），供预载/冻结物化/对账使用 */
export function collectBindingKeys(doc: PageDoc): Map<string, { role: string; kind: string }> {
  const found = new Map<string, { role: string; kind: string }>();
  if (doc.canvas.backgroundBindingKey) {
    found.set(doc.canvas.backgroundBindingKey, { role: "background", kind: "image" });
  }
  const walk = (node: DocNode) => {
    for (const resource of node.resources) {
      found.set(resource.bindingKey, { role: resource.role, kind: resource.kind });
    }
    node.children.forEach(walk);
  };
  doc.nodes.forEach(walk);
  for (const interaction of doc.interactions) {
    if (interaction.audioBindingKey) {
      found.set(interaction.audioBindingKey, { role: "audio", kind: "audio" });
    }
  }
  return found;
}
