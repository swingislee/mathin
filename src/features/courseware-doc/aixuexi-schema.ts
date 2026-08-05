import { z } from "zod";

/**
 * 爱学习离线成品页的 Mathin 适配文档。
 *
 * 它只把镜像侧 resourceRefId 改成跨库稳定 bindingKey，并冻结 Stage 51
 * 已验证的布局/互动语义；不会把爱学习节点伪装成 E 系列 page-doc-v1。
 */
export const AIXUEXI_PAGE_DOC_VERSION = "aixuexi-page-doc-v1";
export const AIXUEXI_PAGE_ADAPTER = "aixuexi-page-v1";

const finite = z.number().finite();
const bindingKey = z.string().regex(/^[0-9a-f]{64}$/);

const aixuexiNodeSchema = z.object({
  id: z.string(),
  sourcePath: z.string(),
  sourceType: z.string(),
  kind: z.enum([
    "background",
    "widget_html",
    "itv_video",
    "question_stem",
    "question_answer",
    "question_analysis",
    "inline_question",
  ]),
  title: z.string(),
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
  zIndex: finite,
  rotation: finite,
  known: z.boolean(),
  html: z.string().nullable(),
  resourceBindingKey: bindingKey.nullable(),
  resourceBindingKeys: z.array(bindingKey),
  warnings: z.array(z.string()),
}).strict();

const aixuexiItvWidgetSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "text", "submit", "videoFrameTimer"]),
  name: z.string(),
  x: finite,
  y: finite,
  width: finite.positive(),
  height: finite.positive(),
  zIndex: finite,
  rotation: finite,
  opacity: finite,
  groupId: z.string().nullable(),
  html: z.string().nullable(),
  resourceBindingKey: bindingKey.nullable(),
  /** 源站选项的三态素材；缺哪一态就回退到本地描边反馈。 */
  stateBindingKeys: z.object({
    selected: bindingKey.nullable(),
    right: bindingKey.nullable(),
    wrong: bindingKey.nullable(),
  }).strict(),
  known: z.boolean(),
  warnings: z.array(z.string()),
}).strict();

const aixuexiItvGroupSchema = z.object({
  id: z.string(),
  type: z.enum(["stem", "choice"]),
  name: z.string(),
  widgetIds: z.array(z.string()),
  isAnswer: z.boolean().nullable(),
}).strict();

const aixuexiItvEventSchema = z.object({
  eventIndex: z.number().int().nonnegative(),
  positionSeconds: finite.nonnegative(),
  pause: z.boolean(),
  screenMode: z.string().nullable(),
  interactTimeSeconds: finite.nonnegative().nullable(),
  topicCode: z.string().nullable(),
  gameId: z.string().nullable(),
  gameType: z.string(),
  title: z.string(),
  judgeType: z.string(),
  stage: z.object({
    width: finite.positive(),
    height: finite.positive(),
    safeAreaOffsets: z.object({
      top: finite,
      right: finite,
      bottom: finite,
      left: finite,
    }).strict(),
    widgets: z.array(aixuexiItvWidgetSchema),
    groups: z.array(aixuexiItvGroupSchema),
  }).strict(),
  previewBindingKey: bindingKey.nullable(),
  /** 节点触发时视频停在的定帧图，用来遮住 video 元素的实际解码帧。 */
  pauseFrameBindingKey: bindingKey.nullable(),
  warnings: z.array(z.string()),
}).strict();

export const aixuexiPageDocSchema = z.object({
  docVersion: z.literal(AIXUEXI_PAGE_DOC_VERSION),
  adapter: z.literal(AIXUEXI_PAGE_ADAPTER),
  projectionVersion: z.literal(11),
  source: z.object({
    sourceSystem: z.literal("aixuexi_bsk"),
    packageKey: z.string().min(1),
    coursewareId: z.string().min(1),
    pageDatabaseId: z.number().int().positive(),
    sourceSnapshotId: z.number().int().positive(),
    sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
    pageName: z.string(),
    groupName: z.string().nullable(),
  }).strict(),
  /** 内容母版：1200×900 正好 4:3，坐标与源站 1:1，不做纵向压缩。 */
  canvas: z.object({
    width: z.literal(1200),
    height: z.literal(900),
    widgetOffsetX: finite,
    backgroundBindingKey: bindingKey.nullable(),
  }).strict(),
  /** 源播放器把母版 contain 进 16:9 画框的规则；16:9 轨据此还原源站所见。 */
  presentation: z.object({
    width: z.literal(1200),
    height: z.literal(675),
    contentScale: z.literal(0.75),
    offsetX: z.literal(150),
    offsetY: finite,
  }).strict(),
  behaviors: z.object({
    splitQuestionScroll: z.object({
      top: finite,
      height: finite,
      contentHeight: finite,
    }).strict().nullable(),
    singleQuestionScroll: z.object({
      top: finite,
      height: finite,
      clampWidth: finite,
    }).strict().nullable(),
    stagedReveal: z.object({
      underlineCount: z.number().int().nonnegative(),
      summaryWidgetCount: z.number().int().nonnegative(),
    }).strict(),
    shapeTextFit: z.object({ minFontSize: finite.positive() }).strict().nullable(),
  }).strict(),
  sourceKind: z.enum(["slide_widgets", "question_data", "inline_question"]),
  nodes: z.array(aixuexiNodeSchema),
  topicInteraction: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("offline"),
      topicId: z.string(),
      entryKind: z.string(),
      bindingKey,
    }).strict(),
    z.object({
      // 来源 HAR 未捕获该题目的 queryTopic 响应，没有离线包可发布。
      status: z.literal("capture_required"),
      topicId: z.string(),
      entryKind: z.string(),
      bindingKey: z.null(),
    }).strict(),
  ]).nullable(),
  itvInteraction: z.object({
    schemaVersion: z.literal(1),
    projectionVersion: z.literal(4),
    status: z.literal("offline"),
    name: z.string(),
    version: z.string().nullable(),
    durationSeconds: finite.nonnegative(),
    videoBindingKey: bindingKey,
    posterBindingKey: bindingKey.nullable(),
    lastFrameBindingKey: bindingKey.nullable(),
    eventCount: z.number().int().nonnegative(),
    events: z.array(aixuexiItvEventSchema),
    warnings: z.array(z.string()),
  }).strict().nullable(),
  behavior: z.object({
    advanceOnCanvasClick: z.boolean(),
  }).strict(),
  warnings: z.array(z.string()),
}).strict();

export type AixuexiPageDoc = z.infer<typeof aixuexiPageDocSchema>;
export type AixuexiItvEvent = z.infer<typeof aixuexiItvEventSchema>;
export type AixuexiItvWidget = z.infer<typeof aixuexiItvWidgetSchema>;

export function collectAixuexiBindingKeys(doc: AixuexiPageDoc): Set<string> {
  const keys = new Set<string>();
  if (doc.canvas.backgroundBindingKey) keys.add(doc.canvas.backgroundBindingKey);
  for (const node of doc.nodes) {
    for (const key of node.resourceBindingKeys) keys.add(key);
    if (node.resourceBindingKey) keys.add(node.resourceBindingKey);
  }
  if (doc.topicInteraction?.bindingKey) keys.add(doc.topicInteraction.bindingKey);
  if (doc.itvInteraction) {
    keys.add(doc.itvInteraction.videoBindingKey);
    if (doc.itvInteraction.posterBindingKey) keys.add(doc.itvInteraction.posterBindingKey);
    if (doc.itvInteraction.lastFrameBindingKey) keys.add(doc.itvInteraction.lastFrameBindingKey);
    for (const event of doc.itvInteraction.events) {
      if (event.previewBindingKey) keys.add(event.previewBindingKey);
      if (event.pauseFrameBindingKey) keys.add(event.pauseFrameBindingKey);
      for (const widget of event.stage.widgets) {
        if (widget.resourceBindingKey) keys.add(widget.resourceBindingKey);
        for (const stateKey of Object.values(widget.stateBindingKeys)) {
          if (stateKey) keys.add(stateKey);
        }
      }
    }
  }
  return keys;
}

export function isAixuexiPageDoc(doc: { docVersion?: string }): doc is AixuexiPageDoc {
  return doc.docVersion === AIXUEXI_PAGE_DOC_VERSION;
}
