import { z } from "zod";
import type { SudokuVariantDefinition } from "./variant";

const indexes = z.array(z.number().int().nonnegative()).max(81);
const clues = z.array(z.number().int().min(0).max(9)).max(9);

/** Rules are immutable lesson content, never copied from the classroom mirror. */
export const sudokuVariantRulesSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("classic") }).strict(),
  z.object({ kind: z.literal("diagonal") }).strict(),
  z.object({ kind: z.literal("irregular"), regions: indexes }).strict(),
  z.object({ kind: z.literal("inequality"), lessThan: z.array(z.tuple([
    z.number().int().nonnegative(), z.number().int().nonnegative(),
  ])).max(144) }).strict(),
  z.object({ kind: z.literal("parity"), cells: z.array(z.number().int().min(0).max(2)).max(81) }).strict(),
  z.object({ kind: z.literal("skyscraper"), top: clues, bottom: clues, left: clues, right: clues }).strict(),
]);
export type SudokuVariantRules = z.infer<typeof sudokuVariantRulesSchema>;

export function defaultSudokuRules(variant: SudokuVariantDefinition): SudokuVariantRules {
  const n = variant.size;
  switch (variant.family) {
    case "diagonal": return { kind: "diagonal" };
    case "irregular": return { kind: "irregular", regions: Array.from({ length: n * n }, (_, i) =>
      Math.floor(i / n / variant.boxRows) * (n / variant.boxColumns) + Math.floor(i % n / variant.boxColumns)) };
    case "inequality": return { kind: "inequality", lessThan: [] };
    case "parity": return { kind: "parity", cells: new Array(n * n).fill(0) };
    case "skyscraper": return { kind: "skyscraper", top: new Array(n).fill(0), bottom: new Array(n).fill(0), left: new Array(n).fill(0), right: new Array(n).fill(0) };
    default: return { kind: "classic" };
  }
}

export function sudokuRules(variant: SudokuVariantDefinition): SudokuVariantRules {
  return variant.rules ?? defaultSudokuRules(variant);
}

/** Drafts may contain unfinished regions. Such drafts save, but cannot be played/published. */
export function sudokuRulesValid(variant: SudokuVariantDefinition): boolean {
  const rules = sudokuRules(variant), n = variant.size, count = n * n;
  if (rules.kind !== variant.family) return false;
  switch (rules.kind) {
    case "irregular": {
      if (rules.regions.length !== count || rules.regions.some((r) => r < 0 || r >= n)) return false;
      for (let region = 0; region < n; region++) {
        const cells = rules.regions.flatMap((r, i) => r === region ? [i] : []);
        if (cells.length !== n) return false;
        const seen = new Set([cells[0]]), pending = [cells[0]];
        while (pending.length) {
          const i = pending.pop()!;
          for (const j of cells) if (!seen.has(j) && Math.abs(Math.floor(i / n) - Math.floor(j / n)) + Math.abs(i % n - j % n) === 1) {
            seen.add(j); pending.push(j);
          }
        }
        if (seen.size !== n) return false;
      }
      return true;
    }
    case "inequality": {
      const edges = new Set<string>();
      return rules.lessThan.every(([a, b]) => {
        const key = [a, b].sort((x, y) => x - y).join(":");
        if (a >= count || b >= count || Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs(a % n - b % n) !== 1 || edges.has(key)) return false;
        edges.add(key); return true;
      });
    }
    case "parity": return rules.cells.length === count;
    case "skyscraper": return n === 4 && [rules.top, rules.bottom, rules.left, rules.right].every((a) => a.length === n && a.every((v) => v <= n));
    default: return true;
  }
}

export function sudokuRegionAt(variant: SudokuVariantDefinition, index: number): number {
  const rules = sudokuRules(variant), n = variant.size;
  if (rules.kind === "skyscraper") return -1;
  if (rules.kind === "irregular") return rules.regions[index] ?? -1;
  return Math.floor(index / n / variant.boxRows) * (n / variant.boxColumns) + Math.floor(index % n / variant.boxColumns);
}

export function sudokuRuleUnits(variant: SudokuVariantDefinition): number[][] {
  const n = variant.size, rules = sudokuRules(variant);
  const units = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c));
  units.push(...Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => r * n + c)));
  if (rules.kind !== "skyscraper") for (let b = 0; b < n; b++) units.push(Array.from({ length: n * n }, (_, i) => i).filter((i) => sudokuRegionAt(variant, i) === b));
  if (rules.kind === "diagonal") units.push(Array.from({ length: n }, (_, i) => i * n + i), Array.from({ length: n }, (_, i) => i * n + n - 1 - i));
  return units;
}
