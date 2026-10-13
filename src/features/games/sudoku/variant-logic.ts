import type { SudokuVariantRuntime } from "./logic";
import { sudokuRules, sudokuRulesValid, sudokuRuleUnits } from "./rules";
import type { SudokuVariantDefinition } from "./variant";

const permutations4: number[][] = [];
function permute(prefix: number[], remaining: number[]) {
  if (!remaining.length) permutations4.push(prefix);
  for (const v of remaining) permute([...prefix, v], remaining.filter((x) => x !== v));
}
permute([], [1, 2, 3, 4]);
function visible(values: number[]) {
  let max = 0, count = 0;
  for (const v of values) if (v > max) { max = v; count++; }
  return count;
}

function candidatesFor(values: number[], variant: SudokuVariantDefinition, units: number[][]): number[][] | null {
  const n = variant.size, rules = sudokuRules(variant);
  if (values.length !== n * n || values.some((v) => !Number.isInteger(v) || v < 0 || v > n)) return null;
  const candidates = values.map((v) => v ? [v] : Array.from({ length: n }, (_, d) => d + 1));
  for (const unit of units) {
    const givens = unit.map((i) => values[i]).filter(Boolean);
    if (new Set(givens).size !== givens.length) return null;
    for (const i of unit) if (!values[i]) candidates[i] = candidates[i].filter((d) => !givens.includes(d));
  }
  if (rules.kind === "parity") for (let i = 0; i < n * n; i++) {
    if (rules.cells[i]) candidates[i] = candidates[i].filter((d) => d % 2 === (rules.cells[i] === 1 ? 1 : 0));
  }
  let changed = true;
  while (changed) {
    changed = false;
    const restrict = (i: number, allowed: number[]) => {
      const next = candidates[i].filter((d) => allowed.includes(d));
      if (next.length !== candidates[i].length) { changed = true; candidates[i] = next; }
    };
    if (rules.kind === "inequality") for (const [a, b] of rules.lessThan) {
      restrict(a, candidates[a].filter((d) => candidates[b].some((e) => d < e)));
      restrict(b, candidates[b].filter((d) => candidates[a].some((e) => e < d)));
    }
    if (rules.kind === "skyscraper") for (let k = 0; k < n * 2; k++) {
      const row = k < n, at = k % n;
      const line = Array.from({ length: n }, (_, j) => row ? at * n + j : j * n + at);
      const start = row ? rules.left[at] : rules.top[at], end = row ? rules.right[at] : rules.bottom[at];
      const possible = permutations4.filter((p) => (!start || visible(p) === start) && (!end || visible([...p].reverse()) === end) && line.every((i, j) => candidates[i].includes(p[j])));
      if (!possible.length) return null;
      line.forEach((i, j) => restrict(i, possible.map((p) => p[j])));
    }
    if (candidates.some((c) => !c.length)) return null;
  }
  return candidates;
}

function search(values: number[], variant: SudokuVariantDefinition, limit: number): { count: number; solution: number[] | null } {
  const result = { count: 0, solution: null as number[] | null };
  if (!Number.isInteger(limit) || limit < 1 || !sudokuRulesValid(variant)) return result;
  const grid = [...values], units = sudokuRuleUnits(variant), n = variant.size;
  const visit = () => {
    const candidates = candidatesFor(grid, variant, units);
    if (!candidates) return;
    let choices: Array<[number, number]> | undefined;
    for (let i = 0; i < grid.length; i++) if (!grid[i] && (!choices || candidates[i].length < choices.length)) choices = candidates[i].map((d) => [i, d]);
    if (!choices) { result.count++; result.solution ??= [...grid]; return; }
    for (const unit of units) for (let d = 1; d <= n; d++) {
      if (unit.some((i) => grid[i] === d)) continue;
      const places = unit.filter((i) => !grid[i] && candidates[i].includes(d));
      if (!places.length) return;
      if (places.length < choices.length) choices = places.map((i) => [i, d]);
    }
    for (const [i, d] of choices) {
      grid[i] = d; visit(); grid[i] = 0;
      if (result.count >= limit) return;
    }
  };
  visit(); return result;
}

export const VARIANT_LATIN_RUNTIME: SudokuVariantRuntime = {
  createPuzzle: () => { throw new Error("Authored Sudoku variants require their saved rules and puzzle"); },
  isValidPartial: (values, variant) => sudokuRulesValid(variant) && candidatesFor(values, variant, sudokuRuleUnits(variant)) !== null,
  solve: (values, variant) => search(values, variant, 1).solution,
  countSolutions: (values, limit, variant) => search(values, variant, limit).count,
  isSolved: (values, variant) => values.every((v) => v > 0) && sudokuRulesValid(variant) && candidatesFor(values, variant, sudokuRuleUnits(variant)) !== null,
  isValuePossible: (puzzle, values, index, digit, variant) => {
    if (puzzle.length !== variant.size ** 2 || values.length !== puzzle.length || !Number.isInteger(index) || index < 0 || index >= puzzle.length || !Number.isInteger(digit) || digit < 1 || digit > variant.size || puzzle[index] || !puzzle.every((v, i) => !v || v === values[i])) return false;
    const grid = [...values]; grid[index] = digit;
    return search(grid, variant, 1).count > 0;
  },
};
