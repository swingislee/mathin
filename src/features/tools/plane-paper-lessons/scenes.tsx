import type { PlanarPoint as Point, PlanarState } from "../planar-kit/contract";
import { HeightMark } from "../planar-kit/geometry";
import { textFor, type PlanarAction, type PlanarDrawingApi, type PlanarField, type PlanarMaterial, type PlanarOperation, type PlanarSceneDefinition, type PlanarText } from "../planar-kit/types";
import { constructionBounds, constructionMeasurements, constructionObject, constructionObjects } from "../plane-construction/model";
import { planePaperScene as base } from "../plane-paper/scenes";
import {
  AREA_LESSON_KINDS, add, bounds, defaultLesson, groupWorld, lessonFromObject, lessonRecipe, mean, pieceWorld, rotate, scale, subtract,
  type AreaLessonGroup, type AreaLessonKind, type LessonArrangement,
} from "./geometry";
import {
  AREA_LESSON_SCENE, AREA_LESSON_UNIT as unit, addAreaLesson, alternateAreaLessonBase, areaLessonGroup, areaLessonGroups,
  areaLessonMeasures, areaLessonSelection, arrangeAreaLesson, changeFreePaper, createAreaLessonGeometry, createAreaLessonState,
  cutAreaLesson, dragAreaLesson, duplicateAreaLesson, freePaperFrame, freePaperState, interpolateAreaLesson,
  interpolateAreaLessonTransform, isValidAreaLessonState, parseAreaLessonTarget, releaseAreaLesson, removeAreaLesson,
  resetAreaLesson, setAreaLessonField, setAreaLessonFlag, startAreaLesson, tapAreaLesson, toggleAreaLessonFill,
  toggleAreaLessonLock, transformAreaLessonPiece,
} from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const coordinates = (points: readonly Point[]) => points.map((point) => `${point.x},${point.y}`).join(" ");
const colors = ["var(--leaf)", "var(--moon)", "var(--cheek)", "var(--crater)"];
const labels: Record<AreaLessonKind, PlanarText> = {
  14: t("平行四边形剪拼", "Parallelogram dissection"), 15: t("两个三角形拼摆", "Pair of triangles"),
  16: t("两个梯形拼摆", "Pair of trapezoids"), 17: t("缺角图形分割与补形", "Split and complete a notched shape"),
  46: t("三份等面积分割", "Three equal-area pieces"), 58: t("同框四片重排", "Four pieces in one frame"),
};
const hasSelection = (state: PlanarState) => !!areaLessonGroup(state) || !!constructionObject(state);
const number = (value: number) => Number(value.toFixed(3)).toString();
const areaNumber = (value: number) => number(value / (unit * unit));
const matches = (state: PlanarState, kind: AreaLessonKind) => areaLessonGroup(state)?.kind === kind;
const activeRecipe = (state: PlanarState) => { const group = areaLessonGroup(state); return group ? lessonRecipe(group) : null; };

function wrapFreeAction(action: PlanarAction): PlanarAction {
  const lessonChange = action.id === "construction-duplicate" ? duplicateAreaLesson : action.id === "construction-remove" ? removeAreaLesson : null;
  return {
    ...action,
    disabled: (state, context) => {
      if (areaLessonGroup(state) && lessonChange) return lessonChange(state) === state;
      if (areaLessonGroup(state) && ["construction-edit", "construction-insert-vertex", "construction-remove-vertex"].includes(action.id)) return true;
      return action.disabled?.(freePaperState(state), context) ?? false;
    },
    run: (state, context) => areaLessonGroup(state) && lessonChange ? lessonChange(state) : changeFreePaper(state, (free) => action.run(free, context), true),
    active: action.active ? (state) => action.active!(freePaperState(state)) : undefined,
    interpolate: action.interpolate ? (from, to, progress) => progress <= 0 ? from : progress >= 1 ? to : freePaperFrame(from, action.interpolate!(freePaperState(from), freePaperState(to), progress), progress) : undefined,
  };
}
function wrapFreeOperation(operation: PlanarOperation): PlanarOperation {
  return {
    ...operation,
    fields: operation.fields?.map((field) => ({ ...field, disabled: (state) => !hasSelection(state) || !!areaLessonGroup(state) && operation.id === "reflect" })),
    actions: operation.actions?.map((action) => {
      const transform = action.id === "construction-translate" ? "translate" : action.id === "construction-rotate" ? "rotate" : null;
      const wrapped = wrapFreeAction(action);
      return {
        ...wrapped,
        disabled: (state, context) => areaLessonGroup(state) ? !transform || transformAreaLessonPiece(state, transform) === state : wrapped.disabled!(state, context),
        run: (state, context) => areaLessonGroup(state) && transform ? transformAreaLessonPiece(state, transform) : wrapped.run(state, context),
        interpolate: (from, to, progress) => areaLessonGroup(from) && transform ? interpolateAreaLessonTransform(from, to, progress, transform) : wrapped.interpolate?.(from, to, progress) ?? to,
      };
    }),
  };
}
function field(kind: AreaLessonKind, key: string, label: PlanarText, min: number, max: number, step = 0.1, factor = unit): PlanarField {
  return { key, label, min, max, step, read: (state) => {
    const group = areaLessonGroup(state); return group?.kind === kind ? Number(group[key.slice(6).replace(/^./, (letter) => letter.toLowerCase()) as keyof AreaLessonGroup]) / factor : 0;
  }, disabled: (state) => !matches(state, kind) || key === "lessonFraction" && kind === 46 && !!areaLessonGroup(state)?.locked };
}
function groupAction(kind: AreaLessonKind, id: string, icon: PlanarAction["icon"], label: PlanarText, run: (state: PlanarState) => PlanarState, animation?: "cut" | "move" | "sequence"): PlanarAction {
  return {
    id, icon, label, run, disabled: (state) => !matches(state, kind) || run(state) === state,
    duration: animation === "sequence" ? 2600 : animation ? 1500 : undefined,
    interpolate: animation ? (from, to, progress) => interpolateAreaLesson(from, to, progress, animation === "cut", animation === "sequence") : undefined,
  };
}
const arrange = (arrangement: LessonArrangement) => (state: PlanarState) => arrangeAreaLesson(state, arrangement);
const lessonOperations: PlanarOperation[] = AREA_LESSON_KINDS.map((kind) => {
  const dimensions = [field(kind, "lessonBase", t(kind === 58 ? "直角边 a（u）" : "底边（u）", kind === 58 ? "Leg a (u)" : "Base (u)"), 0.4, 700 / unit),
    field(kind, "lessonHeight", t(kind === 58 ? "直角边 b（u）" : "垂直高度（u）", kind === 58 ? "Leg b (u)" : "Perpendicular height (u)"), 0.4, 20)];
  if ([14, 15, 16].includes(kind)) dimensions.push(field(kind, "lessonShear", t("顶边／顶点水平偏移（u）", "Top horizontal offset (u)"), -700 / unit, 700 / unit));
  if (kind === 16) dimensions.push(field(kind, "lessonTop", t("上底（u）", "Top base (u)"), 0.4, 700 / unit));
  if (kind === 17 || kind === 46) dimensions.push(field(kind, "lessonFraction", t(kind === 17 ? "缺角内点横向位置（%）" : "斜切线顶端距右边（%）", kind === 17 ? "Notch horizontal position (%)" : "Cut start distance from right (%)"), 1, 99, 1, 0.01));
  if (kind === 17) dimensions.push(field(kind, "lessonNotch", t("缺角内点纵向位置（%）", "Notch vertical position (%)"), 1, 99, 1, 0.01), {
    ...field(kind, "lessonAxis", t("分割方向", "Partition direction"), 0, 1, 1, 1), options: [{ value: 0, label: t("横向分割", "Horizontal") }, { value: 1, label: t("纵向分割", "Vertical") }],
  });
  const actions: PlanarAction[] = [{
    id: `lesson-${kind}-start`, icon: "group", label: t("使用当前纸片", "Use current paper"),
    run: (state, context) => startAreaLesson(state, kind, context.selected), disabled: (state, context) => startAreaLesson(state, kind, context.selected) === state,
  }];
  if (kind === 14) actions.push(groupAction(kind, "lesson-14-base", "edge", t("换相邻边作底", "Use adjacent side as base"), alternateAreaLessonBase));
  if (kind !== 58) actions.push(groupAction(kind, `lesson-${kind}-cut`, kind === 15 || kind === 16 ? "duplicate" : "cut",
    kind === 15 || kind === 16 ? t("复制一张相同纸片", "Copy the same paper") : kind === 14 ? t("沿下一条高剪开", "Cut along the next altitude") : t("按当前分割线剪开", "Cut along current partition"), cutAreaLesson, "cut"));
  if ([14, 15, 16].includes(kind)) actions.push(groupAction(kind, `lesson-${kind}-arrange`, "play", t("播放拼摆", "Play rearrangement"), arrange("arrange"), "move"));
  if (kind === 17) actions.push({ ...groupAction(kind, "lesson-17-fill", "add", t("放入／取走补形纸片", "Add or remove the complement"), toggleAreaLessonFill), active: (state) => matches(state, 17) && !!areaLessonGroup(state)?.fill });
  if (kind === 46) actions.push({ ...groupAction(kind, "lesson-46-lock", "dimensions", t("保持三份等面积", "Keep three equal areas"), toggleAreaLessonLock), active: (state) => matches(state, 46) && !!areaLessonGroup(state)?.locked });
  if (kind === 58) actions.push(groupAction(kind, "lesson-58-central", "play", t("重排：中央一块余白", "Rearrange: one central space"), arrange("central"), "sequence"), groupAction(kind, "lesson-58-two-squares", "play", t("重排：两块余白", "Rearrange: two spaces"), arrange("two-squares"), "sequence"));
  else actions.push(groupAction(kind, `lesson-${kind}-separate`, "separate", t("把各片分开观察", "Separate the pieces"), arrange("separate"), "move"));
  actions.push(groupAction(kind, `lesson-${kind}-reset`, "reset", t("恢复这组起点", "Restore this group's starting point"), resetAreaLesson));
  return { id: `lesson-${kind}`, icon: kind === 58 ? "paperLayout" : "cut", label: labels[kind], fields: dimensions, actions };
});
const lessonMaterials: PlanarMaterial[] = AREA_LESSON_KINDS.map((kind) => {
  const group = defaultLesson(kind), recipe = lessonRecipe(group), box = bounds([...recipe.source, ...recipe.frame]);
  return {
    id: `lesson-material-${kind}`, label: labels[kind], group: t("课堂剪拼材料", "Classroom dissection materials"),
    preview: <svg viewBox={`${box.minX - 15} ${box.minY - 15} ${box.width + 30} ${box.height + 30}`} width="76" height="66" aria-hidden="true" focusable="false">
      {kind === 58 && <polygon points={coordinates(recipe.frame)} fill="none" stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      {recipe.pieces.map((piece, index) => <polygon key={index} points={coordinates(pieceWorld({ ...group, origin: { x: 0, y: 0 } }, piece, index))} fill={colors[index % 4]} fillOpacity="0.7" stroke="var(--ink)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />)}
    </svg>,
    add: (state) => addAreaLesson(state, kind), disabled: (state) => addAreaLesson(state, kind) === state,
  };
});

function Caption({ at, text, small = false }: { at: Point; text: string; small?: boolean }) {
  return <text x={at.x} y={at.y} textAnchor="middle" fontSize={small ? 14 : 16} fill="var(--ink)" stroke="var(--paper)" strokeWidth="5" paintOrder="stroke" pointerEvents="none">{text}</text>;
}
function Handle({ target, at, api, label }: { target: string; at: Point; api: PlanarDrawingApi; label: PlanarText }) {
  return <g {...api.bind(target, textFor(label, api.locale))} data-area-lesson-handle={target} style={{ cursor: "grab" }}>
    <circle cx={at.x} cy={at.y} r="17" fill="transparent" />
    <rect x={at.x - 5} y={at.y - 5} width="10" height="10" rx="2" fill="var(--paper)" stroke="var(--rose)" strokeWidth="2" pointerEvents="none" />
  </g>;
}
function GroupDrawing({ state, group, api }: { state: PlanarState; group: AreaLessonGroup; api: PlanarDrawingApi }) {
  const recipe = lessonRecipe(group), selected = api.selected ? parseAreaLessonTarget(api.selected) : null;
  const chosen = selected?.id === group.id, editing = chosen && api.operation === `lesson-${group.kind}`;
  const source = recipe.source.map((point) => groupWorld(group, point)), frame = recipe.frame.map((point) => groupWorld(group, point));
  const polygons = recipe.pieces.map((piece, index) => pieceWorld(group, piece, index));
  const box = bounds([...source, ...frame, ...polygons.flat()]), values = state.flags.lessonValues ? areaLessonMeasures(group) : null;
  const showGuides = state.flags.lessonGuides || editing || chosen && Object.hasOwn(state.params, "lessonCutFrame");
  const old = state.flags.ghost && api.ghostState ? areaLessonGroup(api.ghostState, group.id) : null;
  const cuttingProgress = chosen ? state.params.lessonCutFrame : undefined;
  return <g data-area-lesson-group={group.id} data-area-lesson-kind={group.kind}>
    {(state.flags.lessonGuides || group.kind === 58) && <polygon data-area-lesson-frame={group.id} points={coordinates(frame)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray={group.kind === 58 ? undefined : "6 5"} pointerEvents="none" />}
    {state.flags.lessonGuides && <polygon data-area-lesson-source={group.id} points={coordinates(source)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 5" pointerEvents="none" />}
    {old && JSON.stringify(old) !== JSON.stringify(group) && lessonRecipe(old).pieces.map((piece, index) => <polygon key={`old-${index}`} data-area-lesson-ghost={index} points={coordinates(pieceWorld(old, piece, index))} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="4 5" pointerEvents="none" />)}
    {polygons.map((polygon, index) => {
      const piece = recipe.pieces[index], target = `lesson.${group.id}.${index}`, center = mean(polygon);
      return <g key={target} data-area-lesson-piece={target}>
        <polygon {...api.bind(target, textFor(t(`第 ${index + 1} 片${piece.added ? "（补入）" : ""}`, `Piece ${index + 1}${piece.added ? " (added)" : ""}`), api.locale))} points={coordinates(polygon)} fill={colors[index % 4]} fillOpacity={piece.added ? 0.42 : 0.7} stroke="var(--ink)" strokeWidth="2.3" strokeLinejoin="round" style={{ cursor: "grab" }} />
        {chosen && selected.piece === index && <polygon points={coordinates(polygon)} fill="none" stroke="var(--rose)" strokeWidth="1.6" strokeDasharray="5 4" pointerEvents="none" />}
        {state.flags.names && <Caption at={add(center, { x: 0, y: values ? -12 : 0 })} text={textFor(piece.added ? t("补入纸片", "Added paper") : t(`纸片 ${index + 1}`, `Piece ${index + 1}`), api.locale)} />}
        {values && <Caption at={add(center, { x: 0, y: state.flags.names ? 12 : 0 })} text={`${areaNumber(values.areas[index])} u²`} small />}
      </g>;
    })}
    {showGuides && recipe.cuttingLines.map(([a, b], index) => {
      const next = group.kind === 14 ? index === group.cuts : !group.cuts;
      const pose = next ? group.poses[group.kind === 14 ? group.cuts : 0] : null;
      const current = (point: Point) => groupWorld(group, pose ? add(rotate(point, pose.angle), pose.offset) : point);
      const start = current(a), end = current(b);
      const tracer = next && cuttingProgress !== undefined ? group.kind === 46 ? Math.max(0, Math.min(1, cuttingProgress * 2 - index)) : cuttingProgress : 0;
      const at = add(start, scale(subtract(end, start), tracer));
      return <g key={index} pointerEvents="none" data-area-lesson-cut-line={index}>
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--rose)" strokeWidth="1.5" strokeDasharray="5 5" />
        {tracer > 0 && <line x1={start.x} y1={start.y} x2={at.x} y2={at.y} stroke="var(--rose)" strokeWidth="3" />}
      </g>;
    })}
    {showGuides && [14, 15, 16].includes(group.kind) && <HeightMark vertex={groupWorld(group, { x: group.shear, y: group.height })} baseA={source[0]} baseB={source[1]} label={api.locale === "en" ? "h" : "高"} />}
    {editing && <Handle target={`lesson-group.${group.id}`} at={group.origin} api={api} label={t("搬动整组材料与外框", "Move the whole group and its frame")} />}
    {editing && group.kind === 17 && <Handle target={`lesson-notch.${group.id}`} at={groupWorld(group, { x: group.base * group.fraction, y: group.height * group.notch })} api={api} label={t("调整缺角位置", "Adjust the notch")} />}
    {editing && group.kind === 46 && !group.locked && <Handle target={`lesson-cut.${group.id}`} at={groupWorld(group, { x: group.base * (1 - group.fraction), y: 0 })} api={api} label={t("拖动斜切线，观察面积变化", "Move the cut and observe the areas")} />}
    {values && <g data-area-lesson-values={group.id}>
      <Caption at={{ x: (box.minX + box.maxX) / 2, y: box.maxY + 27 }} text={api.locale === "en" ? `Original ${areaNumber(values.source)} u² · Pieces ${areaNumber(values.total)} u²${values.added ? ` · Added ${areaNumber(values.added)} u²` : ""}` : `原图 ${areaNumber(values.source)} u² · 纸片合计 ${areaNumber(values.total)} u²${values.added ? ` · 补入 ${areaNumber(values.added)} u²` : ""}`} small />
      {group.kind === 58 && <Caption at={{ x: (box.minX + box.maxX) / 2, y: box.maxY + 49 }} text={api.locale === "en" ? `Frame ${areaNumber(values.frame)} u² · Uncovered now ${areaNumber(values.remaining)} u²` : `外框 ${areaNumber(values.frame)} u² · 当前余白 ${areaNumber(values.remaining)} u²`} small />}
    </g>}
  </g>;
}

const pieceFields: PlanarField[] = [
  { key: "lessonPieceX", label: t("当前纸片中心 X（u）", "Piece center X (u)"), min: -1000 / unit, max: 2000 / unit },
  { key: "lessonPieceY", label: t("当前纸片中心 Y（u）", "Piece center Y (u)"), min: -1000 / unit, max: 1720 / unit },
  { key: "lessonPieceAngle", label: t("当前纸片方向（°）", "Piece orientation (°)"), min: -36000, max: 36000 },
].map((item) => ({ ...item, step: 0.1, disabled: (state) => !areaLessonGroup(state), read: (state) => {
  const group = areaLessonGroup(state), index = state.params.lessonPiece; if (!group) return 0;
  if (item.key === "lessonPieceAngle") return group.angle + group.flip * group.poses[index].angle;
  const center = mean(pieceWorld(group, lessonRecipe(group).pieces[index], index)); return (item.key === "lessonPieceX" ? center.x : center.y) / unit;
} }));
const convertedFreeFields = base.fields?.map((item) => item.key === "width" || item.key === "height" ? {
  ...item, label: t(`${item.label.zh}（u）`, `${item.label.en} (u)`), min: item.min / unit, max: item.max / unit, step: 0.1,
  read: (state: PlanarState) => item.read!(freePaperState(state)) / unit,
} : item);

export const planeAreaLessonScene: PlanarSceneDefinition = {
  ...base, id: AREA_LESSON_SCENE,
  title: t("剪拼与面积转化", "Paper dissection and area"),
  description: t("在同一张画布画纸片、自由剪拼，或给当前材料开启课堂操作。各片可分别拖动、旋转；解组后可继续用剪刀和编辑点。辅助线与面积按需显示。", "Draw and cut freely in one workspace, or attach a classroom operation to current paper. Move and rotate each piece; release a group to cut and edit its pieces freely. Show guides and areas when needed."),
  create: createAreaLessonState, isExact: isValidAreaLessonState,
  fields: [...convertedFreeFields ?? [], ...pieceFields],
  actions: [
    ...base.actions!.filter((action) => action.id !== "construction-measures").map(wrapFreeAction),
    { id: "lesson-guides", icon: "labels", label: t("显示原图与辅助线", "Show original outlines and guides"), active: (state) => state.flags.lessonGuides, run: (state) => setAreaLessonFlag(state, "lessonGuides") },
    { id: "lesson-values", icon: "measure", label: t("显示长度与面积", "Show lengths and areas"), active: (state) => state.flags.lessonValues, run: (state) => setAreaLessonFlag(state, "lessonValues") },
    { id: "lesson-release", icon: "ungroup", label: t("解组为自由纸片", "Release as free paper"), disabled: (state) => !areaLessonGroup(state) || releaseAreaLesson(state) === state, run: releaseAreaLesson },
  ],
  materials: [...base.materials!.map((material) => ({ ...material, add: (state: PlanarState) => changeFreePaper(state, material.add), disabled: (state: PlanarState) => changeFreePaper(state, material.add) === state })), ...lessonMaterials],
  operations: [...base.operations!.map(wrapFreeOperation), ...lessonOperations],
  construction: {
    ...base.construction!, create: createAreaLessonGeometry,
    tools: base.construction!.tools.map((tool) => ({ ...tool, disabled: tool.disabled ? (state: PlanarState) => tool.disabled!(freePaperState(state)) : undefined })),
    preview: (tool, draft, state) => base.construction!.preview(tool, draft, state ? freePaperState(state) : undefined),
  },
  setField: (state, key, value) => setAreaLessonField(state, key, ["width", "height", "lessonBase", "lessonHeight", "lessonTop", "lessonShear", "lessonPieceX", "lessonPieceY"].includes(key) ? value * unit : key === "lessonFraction" || key === "lessonNotch" ? value / 100 : value),
  setFlag: (state, key, value) => key.startsWith("lesson") ? setAreaLessonFlag(state, key, value) : changeFreePaper(state, (free) => base.setFlag!(free, key, value), true),
  tap: (state, target) => target.startsWith("lesson") ? tapAreaLesson(state, target) : changeFreePaper(state, (free) => base.tap!(free, target), ["pivot", "axis", "axis-handle"].includes(target)),
  drag: (state, target, point, delta, context) => target.startsWith("lesson") ? dragAreaLesson(state, target, point, delta) : changeFreePaper(state, (free) => base.drag!(free, target, point, delta, context), ["pivot", "axis", "axis-handle"].includes(target)),
  selectionAfterChange: areaLessonSelection,
  contextActions: (state, selected) => {
    const parsed = selected ? parseAreaLessonTarget(selected) : null, group = parsed ? areaLessonGroup(state, parsed.id) : null;
    if (group && parsed) return { bounds: bounds(pieceWorld(group, lessonRecipe(group).pieces[parsed.piece], parsed.piece)), items: [
      { kind: "operation", id: `lesson-${group.kind}` }, { kind: "operation", id: "move" }, { kind: "operation", id: "rotate" },
      { kind: "action", id: "lesson-release" }, { kind: "action", id: "construction-duplicate" }, { kind: "action", id: "construction-remove" },
    ] };
    const object = constructionObject(state); if (!object || !selected) return null;
    return { bounds: constructionBounds(object), items: [
      { kind: "operation", id: "cut" }, ...AREA_LESSON_KINDS.filter((kind) => lessonFromObject(object, kind)).map((kind) => ({ kind: "operation" as const, id: `lesson-${kind}` })),
      { kind: "action", id: "construction-duplicate" }, { kind: "action", id: "construction-remove" },
    ] };
  },
  draw: (state, api) => <>
    {base.draw({ ...freePaperState(state), flags: { ...freePaperState(state).flags, measures: false } }, { ...api, ghostState: api.ghostState ? freePaperState(api.ghostState) : undefined })}
    {state.flags.lessonValues && constructionObjects(state).map((object) => {
      const measure = constructionMeasurements(object), box = constructionBounds(object);
      return <Caption key={object.id} at={{ x: object.center.x, y: box.maxY + 27 }} text={api.locale === "en" ? `Perimeter ${number(measure.perimeter / unit)} u · Area ${areaNumber(measure.area)} u²` : `周长 ${number(measure.perimeter / unit)} u · 面积 ${areaNumber(measure.area)} u²`} small />;
    })}
    {areaLessonGroups(state).map((group) => <GroupDrawing key={group.id} state={state} group={group} api={api} />)}
  </>,
  summary: (state, locale) => {
    const groups = areaLessonGroups(state), pieces = constructionObjects(state).length + groups.reduce((sum, group) => sum + group.poses.length, 0);
    const recipe = activeRecipe(state), group = areaLessonGroup(state), cutStatus = group?.kind === 14 && recipe && recipe.requiredCuts > group.cuts ? locale === "en" ? ` · ${recipe.requiredCuts - group.cuts} cut(s) left` : ` · 还可沿高剪 ${recipe.requiredCuts - group.cuts} 刀` : "";
    return (locale === "en" ? `${pieces} paper pieces · ${groups.length} classroom groups` : `${pieces} 张纸片 · ${groups.length} 组课堂材料`) + cutStatus;
  },
};
