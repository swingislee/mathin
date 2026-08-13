import { z } from "zod";

/**
 * 爱学习离线成品页的 Mathin 适配文档。
 *
 * 它只把镜像侧 resourceRefId 改成跨库稳定 bindingKey，并冻结 projection v31
 * 的源舞台、运行时、动画与互动语义；不会把爱学习节点伪装成 E 系列 page-doc-v1。
 */
export const AIXUEXI_PAGE_DOC_VERSION = "aixuexi-page-doc-v1";
export const AIXUEXI_PAGE_ADAPTER = "aixuexi-page-v1";

const finite = z.number().finite();
const bindingKey = z.string().regex(/^[0-9a-f]{64}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const bindingMap = z.record(z.string(), bindingKey);

const aixuexiAnimationSchema = z.object({
  group: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  effect: z.string(),
  phase: z.enum(["enter", "exit", "stress"]),
  showType: z.enum(["click", "after", "together"]),
  duration: finite.nonnegative(),
  delay: finite.nonnegative(),
}).strict();

const sourceEvidenceSchema = z.object({
  key: z.string().optional(),
  resourceRefId: z.number().int().positive().optional(),
  objectSha256: hash,
}).loose();

const nativeGameBaseSchema = z.object({
  adapterVersion: z.number().int().positive(),
  sourceMode: z.string(),
  sourceEvidence: z.array(sourceEvidenceSchema),
  surface: z.string(),
  assets: bindingMap,
}).loose();

const aixuexiNodeSchema = z.object({
  id: z.string(),
  sourcePath: z.string(),
  sourceType: z.string(),
  kind: z.enum([
    "background",
    "widget_html",
    "itv_video",
    "video",
    "lottie",
    "embedded_h5",
    "true_or_false_game",
    "topic_classification_game",
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
  transform: z.string(),
  transformOrigin: z.string(),
  known: z.boolean(),
  html: z.string().nullable(),
  resourceBindingKey: bindingKey.nullable(),
  resourceBindingKeys: z.array(bindingKey),
  revealStep: z.number().int().nonnegative(),
  animations: z.array(aixuexiAnimationSchema),
  questionTkRuntime: z.object({
    kit: z.string(),
    evidencePath: z.string(),
    questionType: z.number().int().nullable(),
    hasAnalysis: z.boolean(),
  }).strict().nullable(),
  embeddedH5: z.object({
    packageHash: hash,
    entryPackagePath: z.string().min(1),
    intrinsicViewport: z.object({ width: finite.positive(), height: finite.positive() }).strict(),
    presentationMode: z.enum(["wide_crop", "letterbox_4_3"]),
    bindingKey,
  }).strict().nullable(),
  trueOrFalse: nativeGameBaseSchema.extend({
    questionId: z.string(),
    contentHtml: z.string(),
    options: z.array(z.object({ html: z.string(), answer: z.boolean() }).strict()),
    difficulties: z.record(z.string(), z.object({
      label: z.string(),
      readyTime: finite.nonnegative(),
      intervalTime: finite.nonnegative(),
      existTime: finite.nonnegative(),
      speed: finite.nonnegative(),
    }).strict()),
  }).nullable(),
  topicClassification: nativeGameBaseSchema.extend({
    slideClass: z.string(),
    backgroundResourceRefId: z.number().int().positive().nullable(),
    backgroundBindingKey: bindingKey.nullable(),
    stageHtml: z.string(),
    items: z.array(z.object({ widgetIndex: z.number().int().nonnegative(), key: z.string(), type: z.string() }).strict()),
    topics: z.array(z.object({ key: z.string(), name: z.string(), optionKeys: z.array(z.string()) }).strict()),
  }).nullable(),
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
  projectionVersion: z.literal(31),
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
  /** 普通页为 1200×900；来源原生游戏为 1920×1080。 */
  canvas: z.object({
    width: z.union([z.literal(1200), z.literal(1920)]),
    height: z.union([z.literal(900), z.literal(1080)]),
    widgetOffsetX: finite,
    slideClass: z.string(),
    backgroundBindingKey: bindingKey.nullable(),
  }).strict().refine(
    (value) => value.width === 1200 && value.height === 900 || value.width === 1920 && value.height === 1080,
    "unsupported Aixuexi canvas pair",
  ),
  playerStage: z.object({
    width: z.literal(1920),
    height: z.literal(1080),
    presentationScale: z.literal(0.625),
    offsetX: finite,
    offsetY: finite,
    backgroundSize: z.string(),
    backgroundPosition: z.string(),
    backgroundRepeat: z.string(),
    backgroundColor: z.string().nullable(),
    contentPadding: z.object({ top: finite, right: finite, bottom: finite, left: finite }).strict(),
  }).strict(),
  /** 源播放器到 1200×675 的最终呈现规则。 */
  presentation: z.object({
    width: z.literal(1200),
    height: z.literal(675),
    contentScale: z.union([z.literal(0.75), z.literal(0.625)]),
    offsetX: finite,
    offsetY: finite,
  }).strict(),
  sourceRuntime: z.object({
    runtimeBindingKey: bindingKey,
    slideStylesheetPath: z.literal("slide-runtime.css"),
    itvStylesheetPath: z.literal("itv-runtime.css"),
    lottieRuntimePath: z.literal("lottie.min.js").nullable(),
    lottieRuntimeSha256: hash.nullable(),
    questionImageSizing: z.object({
      adapterVersion: z.literal(2),
      sourceMode: z.literal("captured_player_module"),
      semanticSha256: hash,
      sourceModuleId: z.number().int().positive(),
      sourceExportName: z.string(),
      sourceModuleSha256: hash,
      sourceImageAttribute: z.literal("data-aix-source-src"),
      jqueryRuntimePath: z.string().min(1),
      jquerySha256: hash,
      executionRuntimePath: z.string().min(1),
      executionRuntimeSha256: hash,
      executionPatchVersion: z.number().int().positive(),
      sourceEvidence: z.array(z.object({
        normalizedUrl: z.string().url(),
        objectSha256: hash,
        bodyWitnessSha256: hash,
      }).strict()).min(1),
    }).loose().nullable(),
    questionImageSizingInput: z.object({ imgs: z.record(z.string(), z.object({
      width: finite.positive().optional(),
      height: finite.positive().optional(),
      marginLeft: finite.optional(),
      marginTop: finite.optional(),
    }).strict()) }).strict(),
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
    widgetReveal: z.object({ steps: z.number().int().nonnegative() }).strict(),
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
  fourByThree: z.object({
    mode: z.enum(["source-master", "source-player-compat"]),
    reasons: z.array(z.enum(["wide_canvas", "source_animation", "embedded_h5", "native_game"])),
  }).strict(),
  warnings: z.array(z.string()),
}).strict();

export type AixuexiPageDoc = z.infer<typeof aixuexiPageDocSchema>;
export type AixuexiItvEvent = z.infer<typeof aixuexiItvEventSchema>;
export type AixuexiItvWidget = z.infer<typeof aixuexiItvWidgetSchema>;

export function collectAixuexiBindingKeys(doc: AixuexiPageDoc): Set<string> {
  const keys = new Set<string>();
  if (doc.canvas.backgroundBindingKey) keys.add(doc.canvas.backgroundBindingKey);
  keys.add(doc.sourceRuntime.runtimeBindingKey);
  for (const node of doc.nodes) {
    for (const key of node.resourceBindingKeys) keys.add(key);
    if (node.resourceBindingKey) keys.add(node.resourceBindingKey);
    if (node.embeddedH5) keys.add(node.embeddedH5.bindingKey);
    for (const key of Object.values(node.trueOrFalse?.assets ?? {})) keys.add(key);
    if (node.topicClassification?.backgroundBindingKey) keys.add(node.topicClassification.backgroundBindingKey);
    for (const key of Object.values(node.topicClassification?.assets ?? {})) keys.add(key);
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
