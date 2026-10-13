/** Reproducible curriculum solver. Search proves uniqueness; the separate logical
 * solver certifies teaching methods. Search is never part of a student solution. */
export const METHOD_NAMES = { box: '宫内排除', line: '行列排除', naked: '唯一余数', locked: '区块', extra: '变形规则' };
export const pop = x => { let n = 0; for (; x; x &= x - 1) n++; return n; };
export const digits = mask => { const a = []; for (let d = 1; d <= 9; d++) if (mask & (1 << d)) a.push(d); return a; };
export const cellName = (i, n) => `r${Math.floor(i / n) + 1}c${i % n + 1}`;
export function rng(seed = 20261013) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function shuffle(a, random) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function makeSpec(n, options = {}) {
  const br = n === 9 ? 3 : 2, bc = n / br;
  const regions = options.regions === null ? null : options.regions ?? Array.from({ length: n * n }, (_, i) => Math.floor(Math.floor(i / n) / br) * br + Math.floor((i % n) / bc));
  const rows = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c));
  const cols = Array.from({ length: n }, (_, c) => rows.map(row => row[c]));
  const boxes = regions ? Array.from({ length: n }, (_, b) => regions.flatMap((v, i) => v === b ? [i] : [])) : [];
  if (boxes.some(b => b.length !== n)) throw new Error('BAD_REGIONS');
  const extras = options.diagonal ? [rows.map((r, i) => r[i]), rows.map((r, i) => r[n - i - 1])] : [];
  const units = [...rows.map((cells, i) => ({ kind: 'row', i, cells })), ...cols.map((cells, i) => ({ kind: 'col', i, cells })), ...boxes.map((cells, i) => ({ kind: 'box', i, cells })), ...extras.map((cells, i) => ({ kind: 'diagonal', i, cells }))];
  const peers = rows.flat().map(i => [...new Set(units.filter(u => u.cells.includes(i)).flatMap(u => u.cells).filter(j => j !== i))]);
  return { n, br, bc, regions, rows, cols, boxes, extras, units, peers, all: (1 << (n + 1)) - 2, inequalities: options.inequalities ?? [], parity: options.parity ?? Array(n * n).fill(0), sky: options.sky ?? null };
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
const permutationCache = new Map();
export function permutations(n) {
  if (permutationCache.has(n)) return permutationCache.get(n);
  const out = [];
  const walk = a => { if (a.length === n) out.push(a); else for (let d = 1; d <= n; d++) if (!a.includes(d)) walk([...a, d]); };
  walk([]); permutationCache.set(n, out); return out;
}
export function skyLines(spec) {
  if (!spec.sky) return [];
  return [...spec.rows.map((cells, i) => ({ cells, a: spec.sky.left[i], b: spec.sky.right[i], kind: 'row', i })), ...spec.cols.map((cells, i) => ({ cells, a: spec.sky.top[i], b: spec.sky.bottom[i], kind: 'col', i }))];
}
export function extraReductions(grid, masks, spec) {
  const changes = [];
  const cm = i => grid[i] ? 1 << grid[i] : masks[i];
  for (let i = 0; i < grid.length; i++) if (!grid[i] && spec.parity[i]) {
    const ds = digits(masks[i]).filter(d => d % 2 !== spec.parity[i] % 2);
    if (ds.length) changes.push({ method: 'extra', rule: 'parity', cells: [i], parity: spec.parity[i], removals: [{ index: i, digits: ds }] });
  }
  for (const [a, b] of spec.inequalities) {
    const da = digits(cm(a)), db = digits(cm(b));
    const ea = da.filter(v => !db.some(w => v < w));
    const eb = db.filter(v => !da.some(w => w < v));
    const removals = [...(!grid[a] && ea.length ? [{ index: a, digits: ea }] : []), ...(!grid[b] && eb.length ? [{ index: b, digits: eb }] : [])];
    if (removals.length) changes.push({ method: 'extra', rule: 'inequality', cells: [a, b], removals });
  }
  for (const line of skyLines(spec)) {
    if (!line.a && !line.b) continue;
    const possible = permutations(spec.n).filter(p => (!line.a || visible(p) === line.a) && (!line.b || visible([...p].reverse()) === line.b) && p.every((v, k) => cm(line.cells[k]) & 1 << v));
    const removals = line.cells.flatMap((index, k) => {
      if (grid[index]) return [];
      const keep = possible.reduce((m, p) => m | 1 << p[k], 0);
      const ds = digits(masks[index] & ~keep);
      return ds.length ? [{ index, digits: ds }] : [];
    });
    if (removals.length) changes.push({ method: 'extra', rule: 'visibility', unit: line.kind, unitIndex: line.i, clues: [line.a, line.b], arrangements: possible.length, removals });
  }
  return changes;
}
export function hiddenMoves(grid, masks, spec, kinds) {
  const out = [];
  for (let d = 1; d <= spec.n; d++) for (const u of spec.units) {
    if (!kinds.includes(u.kind) || u.cells.some(i => grid[i] === d)) continue;
    const spots = u.cells.filter(i => masks[i] & 1 << d);
    if (spots.length === 1) out.push({ method: u.kind === 'box' ? 'box' : u.kind === 'diagonal' ? 'extra' : 'line', index: spots[0], value: d, unit: u.kind, unitIndex: u.i, empty: u.cells.filter(i => !grid[i]).length });
  }
  return out;
}
export function lockedMoves(grid, masks, spec) {
  const out = [];
  for (let d = 1; d <= spec.n; d++) for (const a of spec.units) {
    if (!['row', 'col', 'box'].includes(a.kind) || a.cells.some(i => grid[i] === d)) continue;
    const spots = a.cells.filter(i => masks[i] & 1 << d);
    if (spots.length < 2) continue;
    for (const b of spec.units) {
      if ((a.kind === 'box') === (b.kind === 'box') || b.kind === 'diagonal') continue;
      if (!spots.every(i => b.cells.includes(i))) continue;
      const removals = b.cells.filter(i => !a.cells.includes(i) && masks[i] & 1 << d).map(index => ({ index, digits: [d] }));
      if (removals.length) out.push({ method: 'locked', rule: a.kind === 'box' ? 'pointing' : 'claiming', value: d, unit: a.kind, unitIndex: a.i, targetUnit: b.kind, targetUnitIndex: b.i, cells: spots, removals });
    }
  }
  return out;
}
export function logicalSolve(puzzle, spec, allowed = ['box', 'line', 'naked', 'locked', 'extra'], limit = 2000) {
  const grid = [...puzzle], removed = Array(grid.length).fill(0), steps = [];
  let digit = 1;
  while (grid.includes(0) && steps.length < limit) {
    const masks = candidates(grid, spec, removed);
    if (grid.some((v, i) => !v && !masks[i])) return { solved: false, contradiction: true, grid, steps, masks };
    let move;
    if (allowed.includes('box')) {
      const hs = hiddenMoves(grid, masks, spec, ['box']);
      for (let k = 0; k < spec.n && !move; k++) { const d = ((digit + k - 1) % spec.n) + 1; move = hs.find(s => s.value === d); }
    }
    if (!move && allowed.includes('line')) move = hiddenMoves(grid, masks, spec, ['row', 'col']).sort((a, b) => a.empty - b.empty || a.value - b.value || a.index - b.index)[0];
    if (!move && allowed.includes('naked')) {
      const index = masks.findIndex(m => pop(m) === 1);
      if (index >= 0) move = { method: 'naked', index, value: digits(masks[index])[0], excluded: digits(spec.all & ~masks[index]) };
    }
    if (!move && allowed.includes('locked')) move = lockedMoves(grid, masks, spec)[0];
    if (!move && allowed.includes('extra')) move = hiddenMoves(grid, masks, spec, ['diagonal'])[0] ?? extraReductions(grid, masks, spec)[0];
    if (!move) return { solved: false, grid, steps, masks };
    steps.push(move);
    if (move.removals) for (const r of move.removals) for (const d of r.digits) removed[r.index] |= 1 << d;
    else grid[move.index] = move.value;
    // Exhaust this digit in boxes before considering the next digit. After any
    // fallback deduction return immediately to a full box scan.
    digit = move.method === 'box' ? move.value : 1;
  }
  return { solved: !grid.includes(0), grid, steps, masks: candidates(grid, spec, removed) };
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

export function forcedCells(puzzle, spec) {
  const solution = solveExact(puzzle, spec, 1)[0];
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

export function fullPuzzle(spec, random, allowed, required = [], { attempts = 5000, maxGivens = Math.floor(spec.n * spec.n * 0.53), minGivens = 0, minSteps = 1 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const solution = solveExact(Array(spec.n * spec.n).fill(0), spec, 1, random)[0];
    if (!solution) throw new Error('SPEC_UNSATISFIABLE');
    const puzzle = [...solution];
    for (const index of shuffle(puzzle.map((_, i) => i), random)) {
      if (puzzle.filter(Boolean).length <= minGivens) break;
      const saved = puzzle[index]; puzzle[index] = 0;
      if (!logicalSolve(puzzle, spec, allowed).solved) puzzle[index] = saved;
    }
    if (puzzle.filter(Boolean).length > maxGivens) continue;
    const trace = logicalSolve(puzzle, spec, allowed);
    if (!required.every(m => trace.steps.filter(s => s.method === m).length >= minSteps)) continue;
    // Necessity is stronger than merely occurring on one trace: exhaust every
    // earlier strategy with the required strategy removed and require a stall.
    if (!required.every(m => !logicalSolve(puzzle, spec, allowed.filter(x => x !== m)).solved)) continue;
    if (solveExact(puzzle, spec, 2).length !== 1) throw new Error('LOGIC_UNIQUENESS_MISMATCH');
    return { puzzle, solution, trace: trace.steps, givens: puzzle.filter(Boolean).length, attempt };
  }
  throw new Error(`NO_PUZZLE_${spec.n}_${allowed}_${required}`);
}

export function singleTarget(spec, random, method, { attempts = 50000, allowEquivalent = false } = {}) {
  const earlier = method === 'box' ? [] : method === 'line' ? ['box'] : method === 'naked' ? ['box', 'line'] : ['box', 'line', 'naked'];
  const allowed = [...new Set([...earlier, method])];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const sol = solveExact(Array(spec.n * spec.n).fill(0), spec, 1, random)[0];
    const target = Math.floor(random() * sol.length);
    let pool;
    if (method === 'naked') pool = shuffle(spec.peers[target], random);
    else if (method === 'box' || method === 'line') {
      const unit = method === 'box' ? spec.boxes[spec.regions[target]] : (random() < 0.5 ? spec.rows[Math.floor(target / spec.n)] : spec.cols[target % spec.n]);
      pool = shuffle([...new Set([...unit.filter(i => i !== target), ...sol.flatMap((d, i) => d === sol[target] && i !== target ? [i] : [])])], random);
    } else pool = shuffle(sol.map((_, i) => i), random);
    const count = method === 'locked' ? Math.floor(sol.length * (0.23 + 0.18 * random())) : Math.max(2, Math.floor(pool.length * (0.35 + 0.6 * random())));
    let p = sol.map((d, i) => pool.slice(0, count).includes(i) ? d : 0);
    const result = logicalSolve(p, spec, allowEquivalent ? [method] : allowed);
    const placements = result.steps.filter(s => !s.removals);
    if (placements.length !== 1 || !result.steps.some(s => s.method === method)) continue;
    if (!allowEquivalent && logicalSolve(p, spec, earlier).steps.length) continue;
    const forced = forcedCells(p, spec);
    if (forced.length !== 1) continue;
    // Delete unnecessary clues, preserving exactly one forced cell and the lesson method.
    for (const i of shuffle(p.flatMap((v, i) => v ? [i] : []), random)) {
      const trial = [...p]; trial[i] = 0;
      const r = logicalSolve(trial, spec, allowEquivalent ? [method] : allowed);
      if (r.steps.filter(s => !s.removals).length !== 1 || !r.steps.some(s => s.method === method)) continue;
      if (!allowEquivalent && logicalSolve(trial, spec, earlier).steps.length) continue;
      if (forcedCells(trial, spec).length === 1) p = trial;
    }
    const trace = logicalSolve(p, spec, allowEquivalent ? [method] : allowed).steps;
    return { puzzle: p, targets: forcedCells(p, spec), trace, givens: p.filter(Boolean).length, attempt, method, equivalent: allowEquivalent };
  }
  throw new Error(`NO_SINGLE_TARGET_${spec.n}_${method}`);
}
