import { compareVoxelCoordinates, type VoxelCoordinate } from "../domain";
import {
  SPATIAL_GOLD_REVIEW_STATUS,
  spatialGoldCaseSetSchema,
  type SpatialGoldAssertion,
} from "./contracts";

type PaintHistogram = [number, number, number, number, number, number, number];

interface CandidateInput {
  readonly id: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly capability: "P1" | "P2" | "P3" | "P5";
  readonly problemFamily: "view" | "layer-count" | "hidden-count" | "paint" | "hollow" | "surface-volume";
  readonly termIds: readonly string[];
  readonly prompt: string;
  readonly misconception: string;
  readonly teacherPrompt: string;
  readonly cells: readonly VoxelCoordinate[];
  readonly expected: {
    readonly count: number;
    readonly frontVisible: number;
    readonly frontHidden: number;
    readonly surface: readonly [total: number, exterior: number, interior: number];
  };
  readonly extraAssertions?: readonly SpatialGoldAssertion[];
}

function cuboid(width: number, height: number, depth: number): VoxelCoordinate[] {
  const cells: VoxelCoordinate[] = [];
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) cells.push({ x, y, z });
    }
  }
  return cells;
}

function canonical(cells: readonly VoxelCoordinate[]): VoxelCoordinate[] {
  return [...cells].sort(compareVoxelCoordinates);
}

function without(cells: readonly VoxelCoordinate[], removedKeys: readonly string[]): VoxelCoordinate[] {
  const removed = new Set(removedKeys);
  return canonical(cells.filter((cell) => !removed.has(`${cell.x},${cell.y},${cell.z}`)));
}

function shell(size: number): VoxelCoordinate[] {
  return cuboid(size, size, size).filter(
    ({ x, y, z }) =>
      x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1,
  );
}

function layers(axis: "x" | "y" | "z", counts: readonly number[], start = 0): SpatialGoldAssertion {
  return {
    kind: "layer-counts",
    axis,
    expected: counts.map((count, index) => ({ coordinate: start + index, count })),
  };
}

function paint(
  paintedUnitFaces: number,
  histogram: PaintHistogram,
  exposure: "exterior-only" | "all-boundary" = "exterior-only",
): SpatialGoldAssertion {
  return {
    kind: "paint-histogram",
    exposure,
    directions: ["x-", "x+", "y-", "y+", "z-", "z+"],
    expected: { paintedUnitFaces, histogram },
  };
}

function candidate(input: CandidateInput) {
  const [totalUnitFaces, exteriorUnitFaces, interiorUnitFaces] = input.expected.surface;
  return {
    id: input.id,
    reviewStatus: SPATIAL_GOLD_REVIEW_STATUS,
    title: { zh: input.titleZh, en: input.titleEn },
    capability: input.capability,
    problemFamily: input.problemFamily,
    termIds: [...input.termIds],
    prompt: { zh: input.prompt },
    misconception: { zh: input.misconception },
    teacherPrompt: { zh: input.teacherPrompt },
    cells: canonical(input.cells),
    assertions: [
      { kind: "voxel-count" as const, expected: input.expected.count },
      {
        kind: "projection" as const,
        view: "front" as const,
        expected: {
          visibleVoxelCount: input.expected.frontVisible,
          hiddenVoxelCount: input.expected.frontHidden,
        },
      },
      {
        kind: "surface-area" as const,
        expected: { totalUnitFaces, exteriorUnitFaces, interiorUnitFaces },
      },
      ...(input.extraAssertions ?? []),
    ],
  };
}

const solid3 = cuboid(3, 3, 3);
const shell3 = shell(3);

export const SPATIAL_VOXEL_GOLD_CANDIDATES = spatialGoldCaseSetSchema.parse([
  candidate({
    id: "voxel.01.single",
    titleZh: "一个单位正方体",
    titleEn: "One unit cube",
    capability: "P1",
    problemFamily: "view",
    termIds: ["solid-figures"],
    prompt: "从不同方向观察一个单位正方体。",
    misconception: "把透视图中的三个可见面当成三个正方体。",
    teacherPrompt: "先说物体数量，再说看到的面数。",
    cells: [{ x: 0, y: 0, z: 0 }],
    expected: { count: 1, frontVisible: 1, frontHidden: 0, surface: [6, 6, 0] },
    extraAssertions: [paint(6, [0, 0, 0, 0, 0, 0, 1])],
  }),
  candidate({
    id: "voxel.02.pair-width",
    titleZh: "横排两个正方体",
    titleEn: "Two cubes in a row",
    capability: "P1",
    problemFamily: "view",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "观察横排的两个正方体。",
    misconception: "忽略两个正方体接触后消失的两个面。",
    teacherPrompt: "比较拼接前后的表面。",
    cells: cuboid(2, 1, 1),
    expected: { count: 2, frontVisible: 2, frontHidden: 0, surface: [10, 10, 0] },
    extraAssertions: [paint(10, [0, 0, 0, 0, 0, 2, 0])],
  }),
  candidate({
    id: "voxel.03.pair-depth",
    titleZh: "前后叠放两个正方体",
    titleEn: "Two cubes in depth",
    capability: "P1",
    problemFamily: "hidden-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "正面只看到一个方格，实际有几个正方体？",
    misconception: "把投影格数直接当成立体数量。",
    teacherPrompt: "转到上面观察被遮住的正方体。",
    cells: cuboid(1, 1, 2),
    expected: { count: 2, frontVisible: 1, frontHidden: 1, surface: [10, 10, 0] },
    extraAssertions: [{ kind: "component-count", expected: 1 }],
  }),
  candidate({
    id: "voxel.04.tower-three",
    titleZh: "三层高塔",
    titleEn: "A three-cube tower",
    capability: "P2",
    problemFamily: "layer-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "逐层数出竖直高塔中的正方体。",
    misconception: "只按底面占地数正方体。",
    teacherPrompt: "沿 Y 轴逐层显示。",
    cells: cuboid(1, 3, 1),
    expected: { count: 3, frontVisible: 3, frontHidden: 0, surface: [14, 14, 0] },
    extraAssertions: [layers("y", [1, 1, 1]), paint(14, [0, 0, 0, 0, 1, 2, 0])],
  }),
  candidate({
    id: "voxel.05.corner-three",
    titleZh: "L 形三个正方体",
    titleEn: "Three cubes in an L shape",
    capability: "P2",
    problemFamily: "layer-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "按上下两层数出 L 形模型。",
    misconception: "把拐角处重复计算。",
    teacherPrompt: "先数底层，再数上层。",
    cells: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    expected: { count: 3, frontVisible: 3, frontHidden: 0, surface: [14, 14, 0] },
    extraAssertions: [layers("y", [2, 1]), paint(14, [0, 0, 0, 0, 1, 2, 0])],
  }),
  candidate({
    id: "voxel.06.square-layer",
    titleZh: "二乘二单层方阵",
    titleEn: "A two-by-two layer",
    capability: "P2",
    problemFamily: "hidden-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "正面看到两个方格，解释为什么有四个正方体。",
    misconception: "忽略前后方向的遮挡。",
    teacherPrompt: "切换上视图验证占地。",
    cells: cuboid(2, 1, 2),
    expected: { count: 4, frontVisible: 2, frontHidden: 2, surface: [16, 16, 0] },
    extraAssertions: [layers("y", [4]), paint(16, [0, 0, 0, 0, 4, 0, 0])],
  }),
  candidate({
    id: "voxel.07.cube-two",
    titleZh: "二乘二乘二正方体",
    titleEn: "A two-by-two-by-two cube",
    capability: "P3",
    problemFamily: "paint",
    termIds: ["rectangular-prism-and-cube", "surface-area"],
    prompt: "给大正方体外表面染色，分类小正方体。",
    misconception: "把内部接触面也算作染色面。",
    teacherPrompt: "先判断每个角块露出几个面。",
    cells: cuboid(2, 2, 2),
    expected: { count: 8, frontVisible: 4, frontHidden: 4, surface: [24, 24, 0] },
    extraAssertions: [layers("y", [4, 4]), paint(24, [0, 0, 0, 8, 0, 0, 0])],
  }),
  candidate({
    id: "voxel.08.cuboid-three-two-one",
    titleZh: "三乘二乘一长方体",
    titleEn: "A three-by-two-by-one cuboid",
    capability: "P5",
    problemFamily: "surface-volume",
    termIds: ["rectangular-prism-and-cube", "surface-area", "volume-and-capacity"],
    prompt: "计算长方体的体积和表面积。",
    misconception: "只计算正面和背面。",
    teacherPrompt: "按三组相对面组织算式。",
    cells: cuboid(3, 2, 1),
    expected: { count: 6, frontVisible: 6, frontHidden: 0, surface: [22, 22, 0] },
    extraAssertions: [layers("y", [3, 3]), paint(22, [0, 0, 0, 2, 4, 0, 0])],
  }),
  candidate({
    id: "voxel.09.cuboid-two-two-three",
    titleZh: "二乘二乘三长方体",
    titleEn: "A two-by-two-by-three cuboid",
    capability: "P5",
    problemFamily: "surface-volume",
    termIds: ["rectangular-prism-and-cube", "surface-area", "volume-and-capacity"],
    prompt: "比较体积、投影格数和表面积。",
    misconception: "把正面投影的四格当作总体积。",
    teacherPrompt: "沿深度方向显示三列。",
    cells: cuboid(2, 2, 3),
    expected: { count: 12, frontVisible: 4, frontHidden: 8, surface: [32, 32, 0] },
    extraAssertions: [layers("y", [6, 6]), paint(32, [0, 0, 4, 8, 0, 0, 0])],
  }),
  candidate({
    id: "voxel.10.cuboid-two-three-four",
    titleZh: "二乘三乘四长方体",
    titleEn: "A two-by-three-by-four cuboid",
    capability: "P5",
    problemFamily: "surface-volume",
    termIds: ["rectangular-prism-and-cube", "surface-area", "volume-and-capacity"],
    prompt: "用分层和公式分别验证体积二十四。",
    misconception: "长宽高对应错误。",
    teacherPrompt: "先逐层数八个，再连接乘法公式。",
    cells: cuboid(2, 3, 4),
    expected: { count: 24, frontVisible: 6, frontHidden: 18, surface: [52, 52, 0] },
    extraAssertions: [layers("y", [8, 8, 8]), paint(52, [0, 4, 12, 8, 0, 0, 0])],
  }),
  candidate({
    id: "voxel.11.staircase-six",
    titleZh: "三级阶梯",
    titleEn: "A three-step staircase",
    capability: "P2",
    problemFamily: "layer-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "按三层数出阶梯中的正方体。",
    misconception: "每层都按底层三个计算。",
    teacherPrompt: "比较三层的数量变化。",
    cells: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 2, y: 2, z: 0 },
    ],
    expected: { count: 6, frontVisible: 6, frontHidden: 0, surface: [24, 24, 0] },
    extraAssertions: [layers("y", [3, 2, 1]), { kind: "component-count", expected: 1 }],
  }),
  candidate({
    id: "voxel.12.depth-towers",
    titleZh: "前后两列高塔",
    titleEn: "Two towers with depth",
    capability: "P2",
    problemFamily: "hidden-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "从正面判断被遮住的正方体数量。",
    misconception: "每个投影位置只算一个正方体。",
    teacherPrompt: "显示每条视线上的堆叠数量。",
    cells: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ],
    expected: { count: 5, frontVisible: 2, frontHidden: 3, surface: [20, 20, 0] },
    extraAssertions: [{ kind: "component-count", expected: 1 }],
  }),
  candidate({
    id: "voxel.13.bridge-five",
    titleZh: "五块小桥",
    titleEn: "A five-cube bridge",
    capability: "P2",
    problemFamily: "layer-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "分别数桥墩层和桥面层。",
    misconception: "把桥面下的空位当作正方体。",
    teacherPrompt: "隐藏上层，检查下层中间是否有块。",
    cells: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 1, z: 0 },
    ],
    expected: { count: 5, frontVisible: 5, frontHidden: 0, surface: [22, 22, 0] },
    extraAssertions: [layers("y", [2, 3]), { kind: "component-count", expected: 1 }],
  }),
  candidate({
    id: "voxel.14.disconnected-pair",
    titleZh: "分开的两个正方体",
    titleEn: "Two disconnected cubes",
    capability: "P1",
    problemFamily: "view",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "判断两个正方体是否连接。",
    misconception: "透视位置接近就认为两个物体相接。",
    teacherPrompt: "打开网格检查中间坐标。",
    cells: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    expected: { count: 2, frontVisible: 2, frontHidden: 0, surface: [12, 12, 0] },
    extraAssertions: [{ kind: "component-count", expected: 2 }],
  }),
  candidate({
    id: "voxel.15.solid-three",
    titleZh: "三乘三乘三实心正方体",
    titleEn: "A solid three-by-three-by-three cube",
    capability: "P3",
    problemFamily: "paint",
    termIds: ["rectangular-prism-and-cube", "surface-area", "volume-and-capacity"],
    prompt: "外表面染色后，按染色面数分类二十七个小正方体。",
    misconception: "漏掉内部完全没有染色的一块。",
    teacherPrompt: "按内部、面心、棱上、顶点四类整理。",
    cells: solid3,
    expected: { count: 27, frontVisible: 9, frontHidden: 18, surface: [54, 54, 0] },
    extraAssertions: [layers("y", [9, 9, 9]), paint(54, [1, 6, 12, 8, 0, 0, 0])],
  }),
  candidate({
    id: "voxel.16.sealed-shell",
    titleZh: "三乘三乘三封闭空心壳",
    titleEn: "A sealed three-by-three-by-three shell",
    capability: "P3",
    problemFamily: "hollow",
    termIds: ["surface-area", "volume-and-capacity"],
    prompt: "区分外表面、内表面和空腔体积。",
    misconception: "只减去中心体积，却忘记新增内表面。",
    teacherPrompt: "先封闭观察，再打开剖层验证中心空腔。",
    cells: shell3,
    expected: { count: 26, frontVisible: 9, frontHidden: 17, surface: [60, 54, 6] },
    extraAssertions: [
      { kind: "cavity-volumes", expected: [1] },
      paint(54, [0, 6, 12, 8, 0, 0, 0]),
      paint(60, [0, 0, 18, 8, 0, 0, 0], "all-boundary"),
    ],
  }),
  candidate({
    id: "voxel.17.opened-shell",
    titleZh: "开口的空心壳",
    titleEn: "An opened hollow shell",
    capability: "P3",
    problemFamily: "hollow",
    termIds: ["surface-area", "volume-and-capacity"],
    prompt: "移去顶部中心块后，判断空腔是否仍然封闭。",
    misconception: "仍把与外界连通的空间记作封闭空腔。",
    teacherPrompt: "沿开口追踪空气能否到达中心。",
    cells: without(shell3, ["1,2,1"]),
    expected: { count: 25, frontVisible: 9, frontHidden: 16, surface: [62, 62, 0] },
    extraAssertions: [{ kind: "cavity-volumes", expected: [] }],
  }),
  candidate({
    id: "voxel.18.top-dent",
    titleZh: "实心正方体顶部挖一块",
    titleEn: "A top dent in a solid cube",
    capability: "P3",
    problemFamily: "hollow",
    termIds: ["surface-area", "volume-and-capacity"],
    prompt: "从实心三阶正方体顶部挖去中心块，比较表面积。",
    misconception: "认为少一个正方体，表面积一定减少六。",
    teacherPrompt: "数清消失的一面和新露出的五面。",
    cells: without(solid3, ["1,2,1"]),
    expected: { count: 26, frontVisible: 9, frontHidden: 17, surface: [58, 58, 0] },
    extraAssertions: [{ kind: "cavity-volumes", expected: [] }],
  }),
  candidate({
    id: "voxel.19.through-tunnel",
    titleZh: "贯穿正方体的方孔",
    titleEn: "A tunnel through a cube",
    capability: "P3",
    problemFamily: "hollow",
    termIds: ["surface-area", "volume-and-capacity"],
    prompt: "挖去贯穿前后的中央一列，计算新表面积。",
    misconception: "只减去前后两个开口，不计算通道内壁。",
    teacherPrompt: "把通道内壁展开成四条三格长方形。",
    cells: without(solid3, ["1,1,0", "1,1,1", "1,1,2"]),
    expected: { count: 24, frontVisible: 8, frontHidden: 16, surface: [64, 64, 0] },
    extraAssertions: [layers("y", [9, 6, 9]), { kind: "cavity-volumes", expected: [] }],
  }),
  candidate({
    id: "voxel.20.layered-pyramid",
    titleZh: "九四一分层台阶体",
    titleEn: "A nine-four-one layered solid",
    capability: "P2",
    problemFamily: "layer-count",
    termIds: ["solid-figures", "views-of-objects"],
    prompt: "按九、四、一三层计算正方体总数。",
    misconception: "把每层边长直接相加。",
    teacherPrompt: "逐层显示并写出九加四加一。",
    cells: [
      ...cuboid(3, 1, 3),
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 2, z: 0 },
    ],
    expected: { count: 14, frontVisible: 6, frontHidden: 8, surface: [42, 42, 0] },
    extraAssertions: [layers("y", [9, 4, 1]), { kind: "component-count", expected: 1 }],
  }),
]);
