import assert from 'node:assert/strict';
import { makeSpec, solveExact, forcedCells, logicalSolve, explainSteps } from '../lib/sudoku-curriculum.mjs';
import { specFrom, relaxedSpec, classifyBox } from './generators.mjs';

/** L1 mathematics: what the board asks for is true in every legal completion. */
export function checkMathematics(p, spec) {
  if (p.role === 'discover') {
    assert(p.puzzle.every(Boolean), `${p.id}: discovery board must be complete`);
    assert.equal(solveExact(p.puzzle, spec, 2).length, 1, `${p.id}: completed board breaks its rules`);
    return { kind: 'completed-board' };
  }
  if (p.role !== 'target') {
    const solutions = solveExact(p.puzzle, spec, 2);
    assert.equal(solutions.length, 1, `${p.id}: full puzzle must be unique`);
    assert.deepEqual(solutions[0], p.solution, `${p.id}: stored solution differs`);
    return { kind: 'unique', solutions: 1 };
  }
  const forced = forcedCells(p.puzzle, spec, p.solution);
  for (const t of p.targets) assert(forced.some(f => f.index === t.index && f.value === t.value), `${p.id}: target ${t.index} is not forced`);
  const exact = ['E1', 'E2', 'E4', 'E6', 'L2', 'N1', 'K1', 'K2', 'K3', 'K4', 'S1', 'S2', 'L1'].includes(p.meta.pattern) || (p.meta.pattern?.startsWith('V-') && !p.meta.pattern.endsWith('-named'));
  if (exact) assert.equal(forced.length, p.targets.length, `${p.id}: other cells are also determined`);
  if (p.meta.pattern === 'E5') assert.equal(forced.filter(f => f.value === p.meta.digit).length, p.targets.length, `${p.id}: chain misses a forced digit`);
  return { kind: 'teaching-target', forced: forced.length, targets: p.targets.length };
}

/** L2 syllabus: only methods introduced by this lesson; lesson methods cannot be skipped. */
export function checkSyllabus(p, spec, taught) {
  for (const s of p.trace) assert(taught.includes(s.method), `${p.id}: ${s.method} is not taught in ${p.lessonId}`);
  if (p.role === 'class' || p.role === 'homework') {
    const solved = logicalSolve(p.puzzle, spec, p.allowed);
    assert(solved.solved, `${p.id}: lesson methods do not finish the puzzle`);
    assert.deepEqual(solved.steps, p.trace, `${p.id}: trace changed`);
    const necessity = {};
    for (const m of p.required) {
      const without = logicalSolve(p.puzzle, spec, p.allowed.filter(x => x !== m));
      assert(!without.solved, `${p.id}: ${m} can be skipped`);
      necessity[m] = without.grid.filter(v => !v).length;
    }
    if (p.lessonId === 'M2' || p.lessonId === 'H2') assert(p.trace.filter(s => s.method === 'line' && s.empty >= 2).length >= 2, `${p.id}: fewer than two real line deductions`);
    if (p.family !== 'classic') assert.equal(solveExact(p.puzzle, relaxedSpec(p.size, p.family), 2).length, 2, `${p.id}: variant rule is redundant`);
    return { necessity };
  }
  if (p.role === 'target' && p.meta.pattern?.startsWith('V-') && p.family !== 'skyscraper') {
    const relaxed = relaxedSpec(p.size, p.family);
    assert(!forcedCells(p.puzzle, relaxed, p.solution).some(f => f.index === p.targets[0].index), `${p.id}: target does not need the new rule`);
  }
  return {};
}

/** L3 teaching design: the page shows the pattern it was written for, at the planned difficulty. */
export function checkDesign(p, spec) {
  const plan = p.plan, steps = explainSteps(p.puzzle, spec, p.trace);
  switch (plan.gen) {
    case 'box': {
      const cls = classifyBox(p.puzzle, spec, p.targets[0].index, p.targets[0].value);
      assert.equal(cls.pattern, plan.pattern, `${p.id}: box pattern ${cls.pattern} instead of ${plan.pattern}`);
      assert.equal(p.trace.length, 1); assert.equal(p.trace[0].method, 'box');
      return { pattern: cls.pattern, occupied: cls.occupied, lines: cls.lines };
    }
    case 'fill': return { pattern: 'E0', boxes: p.targets.length };
    case 'chain': {
      assert(p.trace.every(s => s.method === 'box' && s.value === p.meta.digit), `${p.id}: chain uses another digit`);
      assert(p.trace.length >= { 4: 2, 6: 3, 9: 4 }[p.size], `${p.id}: chain too short`);
      return { pattern: 'E5', chain: p.trace.length };
    }
    case 'scan': {
      assert(p.trace.every(s => s.method === 'box'), `${p.id}: scan must use box elimination only`);
      assert(!logicalSolve(p.puzzle, spec, ['box']).solved, `${p.id}: scan page should stop before the end`);
      return { pattern: 'E6', placements: p.trace.length, digits: new Set(p.trace.map(s => s.value)).size };
    }
    case 'line': case 'midgame': {
      const first = p.trace[0];
      assert.equal(first.method, 'line', `${p.id}: first step must be a line deduction`);
      assert.equal(logicalSolve(p.puzzle, spec, ['box']).steps.length, 0, `${p.id}: box elimination still advances`);
      const unit = spec.units.find(u => u.kind === first.unit && u.i === first.unitIndex), empties = unit.cells.filter(i => !p.puzzle[i]).length;
      if (plan.gen === 'line') assert(empties >= plan.empties[0] && empties <= plan.empties[1], `${p.id}: line has ${empties} empty cells`);
      if (plan.gen === 'line') assert(steps[0].reasons.some(r => r.kind !== 'occupied'), `${p.id}: line page is only the last empty cell`);
      if (plan.gen === 'midgame') for (const s of p.trace) assert(spec.units.find(u => u.kind === s.unit && u.i === s.unitIndex).cells.filter(i => !p.puzzle[i]).length >= 2, `${p.id}: a breakthrough is only the last empty cell`);
      return { pattern: p.meta.pattern, empties };
    }
    case 'naked': {
      const t = p.targets[0].index, units = spec.unitsOf[t].filter(u => ['row', 'col', 'box'].includes(u.kind));
      const filled = units.map(u => u.cells.filter(i => p.puzzle[i]).length);
      assert(Math.max(...filled) < p.size - 1, `${p.id}: one unit already shows the missing number`);
      assert(filled.filter(Boolean).length >= 2, `${p.id}: exclusions come from one unit only`);
      return { pattern: p.meta.pattern, filled };
    }
    case 'locked': {
      const locked = p.trace.filter(s => s.method === 'locked'), placed = p.trace.at(-1);
      assert(locked.length === 1 && locked[0].rule === plan.rule, `${p.id}: locked form differs`);
      assert(placed.method === 'naked' ? locked[0].removals.some(r => r.index === placed.index) : locked[0].value === placed.value, `${p.id}: locked step does not lead to the placement`);
      assert([plan.follow].flat().includes(placed.method), `${p.id}: follow-up is ${placed.method}`);
      assert.equal(logicalSolve(p.puzzle, spec, ['box', 'line', 'naked']).steps.length, 0, `${p.id}: basic methods already advance`);
      return { pattern: p.meta.pattern, rule: plan.rule, follow: placed.method };
    }
    case 'variant': {
      const place = steps.find(s => !s.removals);
      if (plan.kind === 'region') assert(place.rule === 'region' && place.reasons.some(r => r.kind !== 'occupied'), `${p.id}: not a region exclusion`);
      if (plan.kind === 'assist') assert(place.variantUse, `${p.id}: diagonal is not used`);
      if (plan.kind === 'mark') assert(steps.some(s => s.method === 'extra' && s.removals), `${p.id}: marks are not used`);
      if (plan.kind === 'sky-limit') assert(p.trace[0].rule === 'sky-limit' && !logicalSolve(p.puzzle, spec, p.allowed, { skipRules: ['sky-limit'] }).steps.some(s => !s.removals), `${p.id}: skyline limit is not needed`);
      if (plan.kind === 'sky') assert(steps.some(s => s.method === 'extra') && place.method !== 'extra', `${p.id}: skyline practice does not combine rules`);
      assert(p.trace.length <= (plan.maxSteps ?? 3), `${p.id}: too many reasoning steps`);
      return { pattern: p.meta.pattern, steps: p.trace.length };
    }
    case 'skyOpener': return { pattern: p.meta.pattern };
    case 'completed': return { pattern: 'R0' };
    case 'full': {
      const [lo, hi] = plan.givens;
      assert(p.givens >= lo && p.givens <= hi, `${p.id}: ${p.givens} givens outside ${lo}–${hi}`);
      if (plan.maxBottleneck !== undefined) assert(p.profile.bottleneck <= plan.maxBottleneck, `${p.id}: bottleneck ${p.profile.bottleneck}`);
      const ruleUse = steps.filter(s => s.variantUse).length;
      if (plan.minRule) assert(ruleUse >= plan.minRule, `${p.id}: new rule used ${ruleUse} times`);
      return { givens: p.givens, bottleneck: p.profile.bottleneck, steps: p.profile.steps, ruleUse };
    }
    default: assert.fail(`${p.id}: unknown generator ${plan.gen}`);
  }
}

const SIDE_ORDER = { left: ['rows', false], right: ['rows', true], top: ['cols', false], bottom: ['cols', true] };
/** Replay every stated reason from scratch, without the solver that produced it. */
export function replayReasons(p, spec) {
  const n = p.size, grid = [...p.puzzle], eliminated = grid.map(() => new Set()), all = Array.from({ length: n }, (_, i) => i + 1);
  const candidates = i => grid[i] ? [grid[i]] : all.filter(d => !eliminated[i].has(d) && !spec.peers[i].some(j => grid[j] === d));
  const places = (cells, d) => cells.filter(i => !grid[i] && candidates(i).includes(d));
  for (const [k, step] of p.trace.entries()) {
    const fail = m => `${p.id} step ${k + 1}: ${m}`;
    if (!step.removals && (step.method === 'box' || step.method === 'line' || step.rule === 'region')) {
      const unit = spec.units.find(u => u.kind === step.unit && u.i === step.unitIndex);
      assert(unit && !unit.cells.some(i => grid[i] === step.value), fail('digit already in unit'));
      assert.deepEqual(places(unit.cells, step.value), [step.index], fail('digit has other positions'));
    } else if (step.method === 'naked') {
      assert.deepEqual(candidates(step.index), [step.value], fail('cell has other candidates'));
    } else if (step.method === 'locked') {
      const source = spec.units.find(u => u.kind === step.unit && u.i === step.unitIndex), target = spec.units.find(u => u.kind === step.targetUnit && u.i === step.targetUnitIndex);
      const spots = places(source.cells, step.value);
      assert(spots.length >= 2 && spots.every(i => target.cells.includes(i)), fail('candidates are not locked'));
      for (const r of step.removals) assert(target.cells.includes(r.index) && !source.cells.includes(r.index), fail('removal outside intersection'));
    } else if (step.rule === 'parity') {
      for (const r of step.removals) assert(r.digits.every(d => d % 2 !== spec.parity[r.index] % 2), fail('parity allows this value'));
    } else if (step.rule === 'inequality') {
      const [a, b] = step.cells;
      assert(spec.inequalities.some(([x, y]) => x === a && y === b), fail('no such inequality'));
      for (const r of step.removals) for (const d of r.digits) assert(r.index === a ? !candidates(b).some(v => d < v) : !candidates(a).some(v => v < d), fail('inequality still supports value'));
    } else if (step.rule?.startsWith('sky-')) {
      const [group, reverse] = SIDE_ORDER[step.side], line = spec[group][step.unitIndex], ordered = reverse ? [...line].reverse() : line;
      assert.equal(spec.sky[step.side][step.unitIndex], step.clue, fail('wrong clue'));
      if (step.rule === 'sky-one') assert(step.clue === 1 && ordered[0] === step.index && step.value === n, fail('clue 1 means the tallest is first'));
      if (step.rule === 'sky-full') assert(step.clue === n && step.value === ordered.indexOf(step.index) + 1, fail('clue n means ascending'));
      if (step.rule === 'sky-limit') for (const r of step.removals) {
        const k = ordered.indexOf(r.index);
        assert(k >= 0 && k < step.clue - 1 && r.digits.every(d => d > n - step.clue + 1 + k), fail('height is not too tall'));
      }
    } else assert.fail(fail(`unknown step ${step.method}/${step.rule}`));
    if (step.removals) for (const r of step.removals) {
      for (const d of r.digits) { assert(candidates(r.index).includes(d), fail('nothing to remove')); eliminated[r.index].add(d); }
      assert(candidates(r.index).length, fail('removal empties a cell'));
    } else {
      assert(!grid[step.index] && candidates(step.index).includes(step.value), fail('invalid placement'));
      if (p.solution) assert.equal(step.value, p.solution[step.index], fail('placement differs from the solution'));
      grid[step.index] = step.value;
    }
  }
  return { steps: p.trace.length };
}

export function specOf(p) { return p.family === 'classic' ? makeSpec(p.size) : specFrom(p.size, p.rules); }
