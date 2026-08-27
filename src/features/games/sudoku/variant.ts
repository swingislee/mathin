import type { Difficulty } from "../types";

/**
 * 数独题型的唯一注册入口。新增题型前必须先阅读同目录 `AGENTS.md`。
 *
 * 当前 4×4 / 6×6 / 9×9 都属于 classic family；未来对角线、杀手或不规则宫
 * 必须使用稳定 variant id，并通过 runtimeId / rendererId 接入，不得新建平行 gameId。
 */
export const SUDOKU_SIZES = [4, 6, 9] as const;

export type SudokuSize = (typeof SUDOKU_SIZES)[number];
export type SudokuVariantSurface = "public" | "courseware" | "courseware-authored";
export type SudokuSeedEncoding = "legacy" | "size-v1" | "variant-v2";

export interface SudokuVariantDefinitionShape {
  /** 永久稳定的题型标识；发布后不可改名或复用。 */
  id: string;
  /** 用于产品分组，不参与协议解析。 */
  family: string;
  size: SudokuSize;
  /** 当前 renderer 的宫形与候选数微网格。 */
  boxRows: number;
  boxColumns: number;
  /** 规则/生成/求解适配器 ID；新增值必须在 logic.ts 注册实现。 */
  runtimeId: string;
  /** 棋盘表现适配器 ID；新增值必须在 SudokuBoard.tsx 注册实现。 */
  rendererId: string;
  /** 旧协议只用于 classic；未来变形题型统一使用 variant-v2。 */
  seedEncoding: SudokuSeedEncoding;
  seedToken?: string;
  /** `games` 命名空间下的双语消息 key。 */
  messageKey: string;
  selectableIn: readonly SudokuVariantSurface[];
  ranked: boolean;
  givens: Readonly<Record<Difficulty, number>>;
}

export const SUDOKU_VARIANTS = [
  {
    id: "classic-4x4",
    family: "classic",
    size: 4,
    boxRows: 2,
    boxColumns: 2,
    runtimeId: "classic-latin-v1",
    rendererId: "classic-grid-v1",
    seedEncoding: "size-v1",
    seedToken: "4",
    messageKey: "sudokuVariants.classic-4x4",
    selectableIn: ["public", "courseware", "courseware-authored"],
    ranked: false,
    givens: { easy: 10, medium: 8, hard: 6 },
  },
  {
    id: "classic-6x6",
    family: "classic",
    size: 6,
    boxRows: 2,
    boxColumns: 3,
    runtimeId: "classic-latin-v1",
    rendererId: "classic-grid-v1",
    seedEncoding: "size-v1",
    seedToken: "6",
    messageKey: "sudokuVariants.classic-6x6",
    selectableIn: ["public", "courseware", "courseware-authored"],
    ranked: false,
    givens: { easy: 24, medium: 20, hard: 16 },
  },
  {
    id: "classic-9x9",
    family: "classic",
    size: 9,
    boxRows: 3,
    boxColumns: 3,
    runtimeId: "classic-latin-v1",
    rendererId: "classic-grid-v1",
    seedEncoding: "legacy",
    messageKey: "sudokuVariants.classic-9x9",
    selectableIn: ["public", "courseware", "courseware-authored"],
    ranked: true,
    givens: { easy: 40, medium: 32, hard: 26 },
  },
] as const satisfies readonly SudokuVariantDefinitionShape[];

export type SudokuVariantId = (typeof SUDOKU_VARIANTS)[number]["id"];
export type SudokuRuntimeId = (typeof SUDOKU_VARIANTS)[number]["runtimeId"];
export type SudokuRendererId = (typeof SUDOKU_VARIANTS)[number]["rendererId"];
export type SudokuVariantDefinition = SudokuVariantDefinitionShape & { id: SudokuVariantId };
export type SudokuVariantReference = SudokuVariantDefinition | SudokuVariantId;

/** 兼容旧调用名；新代码应使用 SudokuVariantDefinition。 */
export type SudokuSpec = SudokuVariantDefinition;

export const DEFAULT_SUDOKU_VARIANT_ID: SudokuVariantId = "classic-9x9";

const SUDOKU_VARIANT_SEED_V1_PATTERN = /^sudoku-v1:(4|6|9):(.*)$/u;
const SUDOKU_VARIANT_SEED_V2_PATTERN = /^sudoku-v2:([a-z0-9][a-z0-9-]*):(.*)$/u;
const SUDOKU_VARIANT_SEED_V1_PREFIX = "sudoku-v1:";
const SUDOKU_VARIANT_SEED_V2_PREFIX = "sudoku-v2:";

export interface ParsedSudokuVariantSeed {
  variantId: SudokuVariantId;
  size: SudokuSize;
  baseSeed: string;
  protocol: "legacy" | "v1" | "v2";
}

export function isSudokuSize(value: unknown): value is SudokuSize {
  return SUDOKU_SIZES.some((size) => size === value);
}

export function isSudokuVariantId(value: unknown): value is SudokuVariantId {
  return typeof value === "string" && SUDOKU_VARIANTS.some((variant) => variant.id === value);
}

export function getSudokuVariant(id: string): SudokuVariantDefinition | undefined {
  return SUDOKU_VARIANTS.find((variant) => variant.id === id);
}

export function resolveSudokuVariant(reference: SudokuVariantReference): SudokuVariantDefinition {
  if (typeof reference !== "string") return reference;
  const variant = getSudokuVariant(reference);
  if (!variant) throw new Error(`Unknown Sudoku variant: ${reference}`);
  return variant;
}

export function sudokuVariantsForSurface(surface: SudokuVariantSurface): readonly SudokuVariantDefinition[] {
  return SUDOKU_VARIANTS.filter((variant) => (
    (variant.selectableIn as readonly SudokuVariantSurface[]).includes(surface)
  ));
}

/** 仅用于 classic 尺寸兼容；同尺寸变形题型不得通过尺寸反推。 */
export function sudokuVariantForSize(size: SudokuSize): SudokuVariantDefinition {
  const variant = SUDOKU_VARIANTS.find((item) => item.family === "classic" && item.size === size);
  if (!variant) throw new Error(`Missing classic Sudoku variant for size ${size}`);
  return variant;
}

export function sudokuVariantForCellCount(cellCount: number): SudokuVariantDefinition | null {
  const size = Math.sqrt(cellCount);
  return isSudokuSize(size) ? sudokuVariantForSize(size) : null;
}

export function sudokuVariantForGrid(grid: readonly number[]): SudokuVariantDefinition | null {
  return sudokuVariantForCellCount(grid.length);
}

export function sudokuSpecForSize(size: SudokuSize): SudokuSpec {
  return sudokuVariantForSize(size);
}

export function sudokuSpecForCellCount(cellCount: number): SudokuSpec | null {
  return sudokuVariantForCellCount(cellCount);
}

export function sudokuSpecForGrid(grid: readonly number[]): SudokuSpec | null {
  return sudokuVariantForGrid(grid);
}

/**
 * 严格解析题型协议。未加前缀的所有旧 seed 永久解释为 classic-9x9；
 * 已声明但未知/畸形的 sudoku-v1/v2 seed 返回 null，调用方必须 fail closed。
 */
export function parseSudokuVariantSeed(seed: string): ParsedSudokuVariantSeed | null {
  const v1 = SUDOKU_VARIANT_SEED_V1_PATTERN.exec(seed);
  if (v1) {
    if (!v1[2]) return null;
    const size = Number(v1[1]);
    if (!isSudokuSize(size)) return null;
    const variant = sudokuVariantForSize(size);
    return { variantId: variant.id, size: variant.size, baseSeed: v1[2], protocol: "v1" };
  }

  const v2 = SUDOKU_VARIANT_SEED_V2_PATTERN.exec(seed);
  if (v2) {
    if (!v2[2]) return null;
    const variant = getSudokuVariant(v2[1]);
    if (!variant || variant.seedEncoding !== "variant-v2") return null;
    return { variantId: variant.id, size: variant.size, baseSeed: v2[2], protocol: "v2" };
  }

  if (seed.startsWith(SUDOKU_VARIANT_SEED_V1_PREFIX) || seed.startsWith(SUDOKU_VARIANT_SEED_V2_PREFIX)) {
    return null;
  }

  const variant = sudokuVariantForSize(9);
  return { variantId: variant.id, size: variant.size, baseSeed: seed, protocol: "legacy" };
}

export function sudokuVariantFromSeed(seed: string): SudokuVariantDefinition | null {
  const parsed = parseSudokuVariantSeed(seed);
  return parsed ? getSudokuVariant(parsed.variantId) ?? null : null;
}

export function sudokuVariantIdFromSeed(seed: string): SudokuVariantId | null {
  return parseSudokuVariantSeed(seed)?.variantId ?? null;
}

/** 旧尺寸 API 的兼容解析结果；新代码使用 parseSudokuVariantSeed。 */
export function parseSudokuSeed(seed: string): { size: SudokuSize; baseSeed: string } {
  const parsed = parseSudokuVariantSeed(seed);
  return parsed
    ? { size: parsed.size, baseSeed: parsed.baseSeed }
    : { size: 9, baseSeed: seed };
}

export function sudokuSizeFromSeed(seed: string): SudokuSize {
  return parseSudokuVariantSeed(seed)?.size ?? 9;
}

export function sudokuSeedForVariant(seed: string, variantId: SudokuVariantId): string {
  const variant = resolveSudokuVariant(variantId);
  const baseSeed = parseSudokuVariantSeed(seed)?.baseSeed ?? seed;
  switch (variant.seedEncoding) {
    case "legacy":
      return baseSeed;
    case "size-v1":
      return `${SUDOKU_VARIANT_SEED_V1_PREFIX}${variant.seedToken}:${baseSeed}`;
    case "variant-v2":
      return `${SUDOKU_VARIANT_SEED_V2_PREFIX}${variant.id}:${baseSeed}`;
  }
}

/** 旧尺寸 API 的兼容编码入口；新界面与新题型使用 sudokuSeedForVariant。 */
export function sudokuSeedForSize(seed: string, size: SudokuSize): string {
  return sudokuSeedForVariant(seed, sudokuVariantForSize(size).id);
}

/** 注册表结构审计；合同测试必须断言返回空数组。 */
export function sudokuVariantRegistryIssues(): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const seedTokens = new Set<string>();
  for (const registeredVariant of SUDOKU_VARIANTS) {
    const variant: SudokuVariantDefinitionShape = registeredVariant;
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(variant.id)) issues.push(`${variant.id}: invalid id`);
    if (ids.has(variant.id)) issues.push(`${variant.id}: duplicate id`);
    ids.add(variant.id);
    if (variant.boxRows * variant.boxColumns !== variant.size) issues.push(`${variant.id}: invalid box shape`);
    if (variant.selectableIn.length === 0) issues.push(`${variant.id}: no selectable surface`);
    if (variant.seedEncoding === "size-v1") {
      if (!variant.seedToken) issues.push(`${variant.id}: missing v1 seed token`);
      else if (seedTokens.has(variant.seedToken)) issues.push(`${variant.id}: duplicate v1 seed token`);
      else seedTokens.add(variant.seedToken);
    }
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const givens = variant.givens[difficulty];
      if (!Number.isInteger(givens) || givens < 1 || givens >= variant.size * variant.size) {
        issues.push(`${variant.id}: invalid ${difficulty} givens`);
      }
    }
  }
  return issues;
}
