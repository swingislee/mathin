/** Reproducible curriculum solver. Search proves uniqueness; the separate logical
 * solver certifies teaching methods. Search is never part of a student solution. */
export const METHOD_NAMES = { box: '宫内排除', line: '行列排除', naked: '唯一余数', locked: '区块', extra: '变形规则' };
export const pop = x => { let n = 0; for (; x; x &= x - 1) n++; return n; };
export const digits = mask => { const a = []; for (let d = 1; d <= 9; d++) if (mask & (1 << d)) a.push(d); return a; };
export const cellName = (i, n) => `${String.fromCharCode(65 + Math.floor(i / n))}${i % n + 1}`;
export function rng(seed = 20261013) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function shuffle(a, random) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** Windoku windows start at B2, B6, F2 and F6, matching the native renderer. */
export const WINDOW_ORIGINS = [[1, 1], [1, 5], [5, 1], [5, 5]];
export const standardRegions = n => {
  const br = n === 9 ? 3 : 2, bc = n / br;
  return Array.from({ length: n * n }, (_, i) => Math.floor(Math.floor(i / n) / br) * (n / bc) + Math.floor((i % n) / bc));
};
const RELATION_ORDER = ['row', 'col', 'box', 'diagonal', 'window'];

export function makeSpec(n, options = {}) {
  const br = n === 9 ? 3 : 2, bc = n / br;
  const regions = options.regions === null ? null : options.regions ?? standardRegions(n);
  const rows = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c));
  const cols = Array.from({ length: n }, (_, c) => rows.map(row => row[c]));
  const boxes = regions ? Array.from({ length: n }, (_, b) => regions.flatMap((v, i) => v === b ? [i] : [])) : [];
  if (boxes.some(b => b.length !== n)) throw new Error('BAD_REGIONS');
  const extras = [];
  if (options.diagonal) extras.push({ kind: 'diagonal', i: 0, cells: rows.map((r, i) => r[i]) }, { kind: 'diagonal', i: 1, cells: rows.map((r, i) => r[n - i - 1]) });
  if (options.windows) WINDOW_ORIGINS.forEach(([r0, c0], i) => extras.push({ kind: 'window', i, cells: Array.from({ length: 9 }, (_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + k % 3) }));
  const units = [...rows.map((cells, i) => ({ kind: 'row', i, cells })), ...cols.map((cells, i) => ({ kind: 'col', i, cells })), ...boxes.map((cells, i) => ({ kind: 'box', i, cells })), ...extras];
  const unitsOf = rows.flat().map(i => units.filter(u => u.cells.includes(i)));
  const peers = rows.flat().map(i => [...new Set(unitsOf[i].flatMap(u => u.cells).filter(j => j !== i))]);
  return { n, br, bc, regions, rows, cols, boxes, extras, units, unitsOf, peers, all: (1 << (n + 1)) - 2, inequalities: options.inequalities ?? [], parity: options.parity ?? Array(n * n).fill(0), sky: options.sky ?? null };
}

/** The first shared region in teaching order: row, column, box, then variant regions. */
export function relationOf(spec, a, b) {
  for (const kind of RELATION_ORDER) if (spec.unitsOf[a].some(u => u.kind === kind && u.cells.includes(b))) return kind;
  return null;
}

export function candidates(grid, spec, removed = []) {
  return grid.map((v, i) => {
    if (v) return 0;
    let used = removed[i] ?? 0;
    for (const j of spec.peers[i]) used |= 1 << grid[j];
    return spec.all & ~used;
  });
}
export function visible(line) { let high = 0, count = 0; for (const v of line) if (v > high) { high = v; count++; } return count; }
export function skyLines(spec) {
  if (!spec.sky) return [];
  return [...spec.rows.map((cells, i) => ({ cells, a: spec.sky.left[i], b: spec.sky.right[i], kind: 'row', i })), ...spec.cols.map((cells, i) => ({ cells, a: spec.sky.top[i], b: spec.sky.bottom[i], kind: 'col', i }))];
}
const SIDES = { row: ['left', 'right'], col: ['top', 'bottom'] };

/** Variant deductions a child can state: odd/even marks, one comparison, and three skyline rules. */
export function extraReductions(grid, masks, spec) {
  const placements = [], removals = [], n = spec.n;
  const cm = i => grid[i] ? 1 << grid[i] : masks[i];
  for (let i = 0; i < grid.length; i++) if (!grid[i] && spec.parity[i]) {
    const ds = digits(masks[i]).filter(d => d % 2 !== spec.parity[i] % 2);
    if (ds.length) removals.push({ method: 'extra', rule: 'parity', cells: [i], parity: spec.parity[i], removals: [{ index: i, digits: ds }] });
  }
  for (const [a, b] of spec.inequalities) {
    const da = digits(cm(a)), db = digits(cm(b));
    const ea = da.filter(v => !db.some(w => v < w));
    const eb = db.filter(v => !da.some(w => w < v));
    const r = [...(!grid[a] && ea.length ? [{ index: a, digits: ea }] : []), ...(!grid[b] && eb.length ? [{ index: b, digits: eb }] : [])];
    if (r.length) removals.push({ method: 'extra', rule: 'inequality', cells: [a, b], removals: r });
  }
  for (const line of skyLines(spec)) for (const [clue, cells, side] of [[line.a, line.cells, SIDES[line.kind][0]], [line.b, [...line.cells].reverse(), SIDES[line.kind][1]]]) {
    if (!clue) continue;
    const base = { method: 'extra', unit: line.kind, unitIndex: line.i, side, clue };
    if (clue === 1) {
      if (!grid[cells[0]] && masks[cells[0]] & 1 << n) placements.push({ ...base, rule: 'sky-one', index: cells[0], value: n });
    } else if (clue === n) {
      const k = cells.findIndex(i => !grid[i]);
      if (k >= 0 && masks[cells[k]] & 1 << (k + 1)) placements.push({ ...base, rule: 'sky-full', index: cells[k], value: k + 1 });
    } else {
      const r = [];
      for (let k = 0; k < clue - 1; k++) {
        const max = n - clue + 1 + k, ds = grid[cells[k]] ? [] : digits(masks[cells[k]]).filter(d => d > max);
        if (ds.length) r.push({ index: cells[k], digits: ds });
      }
      if (r.length) removals.push({ ...base, rule: 'sky-limit', removals: r });
    }
  }
  return [...placements, ...removals];
}

const METHOD_OF_KIND = { box: 'box', row: 'line', col: 'line', diagonal: 'extra', window: 'extra' };
export function hiddenMoves(grid, masks, spec, kinds) {
  const out = [];
  for (let d = 1; d <= spec.n; d++) for (const u of spec.units) {
    if (!kinds.includes(u.kind) || u.cells.some(i => grid[i] === d)) continue;
    const spots = u.cells.filter(i => masks[i] & 1 << d);
    if (spots.length === 1) out.push({ method: METHOD_OF_KIND[u.kind], ...(u.kind === 'diagonal' || u.kind === 'window' ? { rule: 'region' } : {}), index: spots[0], value: d, unit: u.kind, unitIndex: u.i, empty: u.cells.filter(i => !grid[i]).length });
  }
  return out;
}

/** Pointing (a box points along a line) is taught before claiming; `rule` restricts one form. */
export function lockedMoves(grid, masks, spec, rule = null) {
  const out = [];
  for (let d = 1; d <= spec.n; d++) for (const a of spec.units) {
    if (!['row', 'col', 'box'].includes(a.kind) || a.cells.some(i => grid[i] === d)) continue;
    const kind = a.kind === 'box' ? 'pointing' : 'claiming';
    if (rule && rule !== kind) continue;
    const spots = a.cells.filter(i => masks[i] & 1 << d);
    if (spots.length < 2) continue;
    for (const b of spec.units) {
      if ((a.kind === 'box') === (b.kind === 'box') || !['row', 'col', 'box'].includes(b.kind)) continue;
      if (!spots.every(i => b.cells.includes(i))) continue;
      const removals = b.cells.filter(i => !a.cells.includes(i) && masks[i] & 1 << d).map(index => ({ index, digits: [d] }));
      if (removals.length) out.push({ method: 'locked', rule: kind, value: d, unit: a.kind, unitIndex: a.i, targetUnit: b.kind, targetUnitIndex: b.i, cells: spots, removals });
    }
  }
  return out.sort((x, y) => (x.rule === 'pointing' ? 0 : 1) - (y.rule === 'pointing' ? 0 : 1));
}

/**
 * Teaching order: one digit through every box, then the next digit; variant regions;
 * the emptiest row or column; one cell's last candidate; variant rules; locked candidates.
 * `onlyDigit` replays only the box scan of one digit for chain pages.
 */
export function logicalSolve(puzzle, spec, allowed = ['box', 'line', 'naked', 'locked', 'extra'], { limit = 4000, lockedRule = null, onlyDigit = null, skipRules = [] } = {}) {
  const grid = [...puzzle], removed = Array(grid.length).fill(0), steps = [];
  let digit = onlyDigit ?? 1;
  while (grid.includes(0) && steps.length < limit) {
    const masks = candidates(grid, spec, removed);
    if (grid.some((v, i) => !v && !masks[i])) return { solved: false, contradiction: true, grid, steps, masks };
    let move;
    if (allowed.includes('box')) {
      const hs = hiddenMoves(grid, masks, spec, ['box']).filter(m => !onlyDigit || m.value === onlyDigit);
      for (let k = 0; k < spec.n && !move; k++) { const d = ((digit + k - 1) % spec.n) + 1; move = hs.find(s => s.value === d); }
    }
    if (!onlyDigit) {
      if (!move && allowed.includes('extra')) move = hiddenMoves(grid, masks, spec, ['diagonal', 'window'])[0];
      if (!move && allowed.includes('line')) move = hiddenMoves(grid, masks, spec, ['row', 'col']).sort((a, b) => a.empty - b.empty || a.value - b.value || a.index - b.index)[0];
      if (!move && allowed.includes('naked')) {
        const index = masks.findIndex(m => pop(m) === 1);
        if (index >= 0) move = { method: 'naked', index, value: digits(masks[index])[0], excluded: digits(spec.all & ~masks[index]) };
      }
      if (!move && allowed.includes('extra')) move = extraReductions(grid, masks, spec).find(m => !skipRules.includes(m.rule));
      if (!move && allowed.includes('locked')) move = lockedMoves(grid, masks, spec, lockedRule)[0];
    }
    if (!move) break;
    steps.push(move);
    if (move.removals) for (const r of move.removals) for (const d of r.digits) removed[r.index] |= 1 << d;
    else grid[move.index] = move.value;
    // Exhaust this digit in boxes before considering the next digit. After any
    // fallback deduction return immediately to a full box scan.
    digit = onlyDigit ?? (move.method === 'box' ? move.value : 1);
  }
  return { solved: !grid.includes(0), grid, steps, masks: candidates(grid, spec, removed) };
}

/** Why each competing position or candidate is excluded, for teacher answers and rule-use checks. */
export function explainSteps(puzzle, spec, steps) {
  const grid = [...puzzle], removed = Array(grid.length).fill(0), removedBy = grid.map(() => ({}));
  const blocker = (index, d) => {
    if (grid[index]) return { cell: index, kind: 'occupied', value: grid[index] };
    for (const kind of RELATION_ORDER) {
      const j = spec.peers[index].find(p => grid[p] === d && relationOf(spec, index, p) === kind);
      if (j !== undefined) return { cell: index, kind, by: j };
    }
    return { cell: index, kind: 'removed', rule: removedBy[index][d] ?? null };
  };
  return steps.map(step => {
    let reasons = [];
    if (step.method === 'naked') reasons = step.excluded.map(d => ({ digit: d, ...blocker(step.index, d) }));
    else if (!step.removals && ['box', 'line'].includes(step.method) || step.rule === 'region') {
      const unit = spec.units.find(u => u.kind === step.unit && u.i === step.unitIndex);
      reasons = unit.cells.filter(i => i !== step.index).map(i => blocker(i, step.value));
    }
    const variantUse = reasons.some(r => r.kind === 'diagonal' || r.kind === 'window' || (r.kind === 'removed' && r.rule && r.rule !== 'locked'))
      || step.method === 'extra';
    if (step.removals) for (const r of step.removals) for (const d of r.digits) { removed[r.index] |= 1 << d; removedBy[r.index][d] ??= step.method === 'locked' ? 'locked' : step.rule; }
    else grid[step.index] = step.value;
    return { ...step, reasons, variantUse };
  });
}

/** Independent exact constraint search, not the pedagogical deduction engine. */
export function solveExact(puzzle, spec, cap = 2, random = null) {
  const grid = [...puzzle], solutions = [], sky = skyLines(spec);
  for (let i = 0; i < grid.length; i++) if (grid[i] && spec.peers[i].some(j => grid[j] === grid[i])) return solutions;
  function validExtra() {
    if (grid.some((v, i) => v && spec.parity[i] && v % 2 !== spec.parity[i] % 2)) return false;
    for (const [a, b] of spec.inequalities) if (grid[a] && grid[b] && grid[a] >= grid[b]) return false;
    for (const l of sky) {
      const values = l.cells.map(i => grid[i]);
      if (values.every(Boolean) && ((l.a && visible(values) !== l.a) || (l.b && visible([...values].reverse()) !== l.b))) return false;
    }
    return true;
  }
  function visit() {
    if (!validExtra()) return;
    let best = -1, mask = 0, fewest = 100;
    const masks = Array(grid.length).fill(0);
    for (let i = 0; i < grid.length; i++) if (!grid[i]) {
      let used = 0; for (const j of spec.peers[i]) used |= 1 << grid[j];
      let m = spec.all & ~used;
      if (spec.parity[i]) for (let d = 1; d <= spec.n; d++) if (d % 2 !== spec.parity[i] % 2) m &= ~(1 << d);
      for (const [a, b] of spec.inequalities) {
        if (a === i && grid[b]) m &= (1 << grid[b]) - 2;
        if (b === i && grid[a]) m &= spec.all & ~((1 << (grid[a] + 1)) - 1);
      }
      masks[i] = m;
      const count = pop(m); if (!count) return;
      if (count < fewest) { best = i; mask = m; fewest = count; }
    }
    if (best < 0) { solutions.push([...grid]); return; }
    let choices = digits(mask).map(d => [best, d]);
    for (const u of spec.units) {
      const used = u.cells.reduce((m, i) => m | 1 << grid[i], 0);
      for (const d of digits(spec.all & ~used)) {
        const cells = u.cells.filter(i => masks[i] & 1 << d);
        if (!cells.length) return;
        if (cells.length < fewest) { fewest = cells.length; choices = cells.map(i => [i, d]); }
      }
    }
    if (random) choices = shuffle(choices, random);
    for (const [i, d] of choices) { grid[i] = d; visit(); grid[i] = 0; if (solutions.length >= cap) break; }
  }
  visit(); return solutions;
}

export function forcedCells(puzzle, spec, solution = null) {
  solution ??= solveExact(puzzle, spec, 1)[0];
  if (!solution) throw new Error('UNSATISFIABLE');
  const masks = candidates(puzzle, spec), forced = [];
  for (let i = 0; i < puzzle.length; i++) if (!puzzle[i]) {
    let forcedHere = true;
    for (const d of digits(masks[i])) if (d !== solution[i]) {
      const trial = [...puzzle]; trial[i] = d;
      if (solveExact(trial, spec, 1).length) { forcedHere = false; break; }
    }
    if (forcedHere) forced.push({ index: i, value: solution[i] });
  }
  return forced;
}

/** Steps where only one placement is available to a student using the allowed methods. */
export function difficultyProfile(puzzle, spec, allowed, trace) {
  const grid = [...puzzle], removed = Array(grid.length).fill(0), available = [];
  for (const s of trace) {
    if (!s.removals) {
      const masks = candidates(grid, spec, removed), cells = new Set();
      if (allowed.includes('box')) for (const m of hiddenMoves(grid, masks, spec, ['box'])) cells.add(m.index);
      if (allowed.includes('extra')) for (const m of [...hiddenMoves(grid, masks, spec, ['diagonal', 'window']), ...extraReductions(grid, masks, spec).filter(m => !m.removals)]) cells.add(m.index);
      if (allowed.includes('line')) for (const m of hiddenMoves(grid, masks, spec, ['row', 'col'])) cells.add(m.index);
      if (allowed.includes('naked')) masks.forEach((m, i) => { if (!grid[i] && pop(m) === 1) cells.add(i); });
      available.push(Math.max(1, cells.size));
      grid[s.index] = s.value;
    } else for (const r of s.removals) for (const d of r.digits) removed[r.index] |= 1 << d;
  }
  const counts = {};
  for (const s of trace) { const key = s.rule ? `${s.method}/${s.rule}` : s.method; counts[key] = (counts[key] ?? 0) + 1; }
  return { givens: puzzle.filter(Boolean).length, steps: trace.length, placements: available.length, bottleneck: available.filter(a => a <= 1).length, meanAvailable: +(available.reduce((a, b) => a + b, 0) / Math.max(1, available.length)).toFixed(2), counts, available };
}
