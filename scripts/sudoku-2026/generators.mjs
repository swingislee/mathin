import {
  makeSpec, standardRegions, solveExact, logicalSolve, forcedCells, candidates, hiddenMoves,
  explainSteps, difficultyProfile, shuffle, visible,
} from '../lib/sudoku-curriculum.mjs';

/** Page puzzles are built from a named pattern, then proved: the pattern is the lesson content. */
export function specFrom(n, rules) {
  switch (rules.kind) {
    case 'diagonal': return makeSpec(n, { diagonal: true });
    case 'window': return makeSpec(n, { windows: true });
    case 'irregular': return makeSpec(n, { regions: rules.regions });
    case 'inequality': return makeSpec(n, { inequalities: rules.lessThan });
    case 'parity': return makeSpec(n, { parity: rules.cells });
    case 'skyscraper': return makeSpec(n, { regions: null, sky: rules });
    default: return makeSpec(n);
  }
}
export const relaxedSpec = (n, kind) => makeSpec(n, kind === 'irregular' || kind === 'skyscraper' ? { regions: null } : {});

const BOX_NAMES = { 4: ['左上', '右上', '左下', '右下'], 6: ['左上', '右上', '左中', '右中', '左下', '右下'], 9: ['左上', '上中', '右上', '左中', '正中', '右中', '左下', '下中', '右下'] };
export const boxName = (n, b) => `${BOX_NAMES[n][b]}宫`;
export const lineName = (n, kind, i) => kind === 'row' ? `${String.fromCharCode(65 + i)} 行` : `第 ${i + 1} 列`;
export const unitName = (spec, kind, i, rules) => {
  if (kind === 'box') return rules?.kind === 'irregular' ? `含 ${cellLabel(spec.boxes[i][0], spec.n)} 的宫` : boxName(spec.n, i);
  if (kind === 'diagonal') return i ? '右上到左下的虚线' : '左上到右下的虚线';
  if (kind === 'window') return `${['左上', '右上', '左下', '右下'][i]}窗口`;
  return lineName(spec.n, kind, i);
};
export const cellLabel = (i, n) => `${String.fromCharCode(65 + Math.floor(i / n))}${i % n + 1}`;

const count = p => p.filter(Boolean).length;
const pick = (a, random) => a[Math.floor(random() * a.length)];
const randomSolution = (spec, random) => solveExact(Array(spec.n * spec.n).fill(0), spec, 1, random)[0];
function search(label, attempts, fn) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = fn(attempt);
    if (found) return { ...found, attempt };
  }
  throw new Error(`NO_${label}`);
}
const onlyForced = (p, spec, S, targets) => {
  const f = forcedCells(p, spec, S);
  return f.length === targets.length && targets.every(t => f.some(x => x.index === t));
};
/** Give back forced non-target cells (as the familiar “already filled” numbers) until only the target remains. */
function prefill(p, spec, S, t, protect, max, ok = () => true) {
  let q = [...p];
  for (let k = 0; k <= max; k++) {
    const f = forcedCells(q, spec, S);
    if (!f.some(x => x.index === t)) return null;
    if (f.length === 1) return q;
    const option = f.find(x => x.index !== t && !protect.has(x.index));
    if (!option) return null;
    q = [...q]; q[option.index] = option.value;
    if (!ok(q)) return null;
  }
  return null;
}

/** E0–E4: how the other cells of the box are closed — already filled, or crossed by lines of the digit. */
export function classifyBox(p, spec, t, d) {
  const [step] = explainSteps(p, spec, [{ method: 'box', index: t, value: d, unit: 'box', unitIndex: spec.regions[t] }]);
  const occupied = step.reasons.filter(r => r.kind === 'occupied').length;
  const lines = new Set(step.reasons.filter(r => r.by !== undefined).map(r => r.by)).size;
  const pattern = occupied === spec.n - 1 ? 'E0' : lines === 1 && occupied ? 'E1' : !occupied && lines >= 2 ? 'E2' : occupied && lines >= 2 ? 'E4' : 'E?';
  return { pattern, occupied, lines };
}

export function boxTarget(spec, random, { pattern, maxGivens }) {
  const n = spec.n;
  return search(`BOX_${pattern}_${n}`, 6000, () => {
    const S = randomSolution(spec, random), t = Math.floor(random() * n * n), d = S[t];
    const B = spec.boxes[spec.regions[t]], rt = Math.floor(t / n), ct = t % n;
    const rows = [...new Set(B.map(i => Math.floor(i / n)))].filter(r => r !== rt).map(r => ({ cover: B.filter(i => Math.floor(i / n) === r), cell: spec.rows[r].find(i => S[i] === d) }));
    const cols = [...new Set(B.map(i => i % n))].filter(c => c !== ct).map(c => ({ cover: B.filter(i => i % n === c), cell: spec.cols[c].find(i => S[i] === d) }));
    const lines = shuffle([...rows, ...cols], random);
    const chosen = pattern === 'E1' ? lines.slice(0, 1) : pattern === 'E2' ? lines : lines.length < 3 ? null : lines.slice(0, 2 + Math.floor(random() * (lines.length - 2)));
    if (!chosen) return null;
    const covered = new Set(chosen.flatMap(l => l.cover)), occupied = B.filter(i => i !== t && !covered.has(i));
    if ((pattern === 'E2') !== !occupied.length) return null;
    const p = Array(n * n).fill(0);
    for (const l of chosen) p[l.cell] = d;
    for (const i of occupied) p[i] = S[i];
    const done = prefill(p, spec, S, t, new Set(B), n === 4 ? 1 : 3);
    if (!done || count(done) > maxGivens) return null;
    const trace = logicalSolve(done, spec, ['box']).steps;
    if (trace.length !== 1 || trace[0].index !== t) return null;
    const cls = classifyBox(done, spec, t, d);
    if (cls.pattern !== pattern) return null;
    return { puzzle: done, solution: S, targets: [{ index: t, value: d }], trace, meta: { digit: d, unit: 'box', unitIndex: spec.regions[t], ...cls } };
  });
}

/** E0 warm-up: some boxes miss exactly one number. Other deductions on the board are not asked for. */
export function fillInTarget(spec, random, { boxes }) {
  const n = spec.n, S = randomSolution(spec, random), p = Array(n * n).fill(0), targets = [];
  for (const b of shuffle(spec.boxes.map((_, i) => i), random).slice(0, boxes)) {
    const B = spec.boxes[b], t = pick(B, random);
    for (const i of B) if (i !== t) p[i] = S[i];
    targets.push({ index: t, value: S[t] });
  }
  return { puzzle: p, solution: S, targets, trace: targets.map(t => ({ method: 'box', index: t.index, value: t.value, unit: 'box', unitIndex: spec.regions[t.index] })), meta: { pattern: 'E0' } };
}

/** E5: one digit placed box after box; later boxes open only after earlier ones are filled. */
export function chainTarget(spec, random, { minChain, maxGivens }) {
  const n = spec.n;
  return search(`CHAIN_${n}`, 30000, () => {
    const S = randomSolution(spec, random), d = 1 + Math.floor(random() * n);
    const own = shuffle(spec.boxes.map(B => B.find(i => S[i] === d)), random).slice(0, n === 4 ? 1 : n === 6 ? 1 + Math.floor(random() * 2) : 2 + Math.floor(random() * 2));
    const others = shuffle(S.map((v, i) => i).filter(i => S[i] !== d), random).slice(0, Math.floor(n * n * (0.12 + random() * 0.14)));
    let p = S.map((v, i) => own.includes(i) || others.includes(i) ? v : 0);
    const qualifies = q => {
      const chain = logicalSolve(q, spec, ['box'], { onlyDigit: d }).steps;
      if (chain.length < minChain) return null;
      const opened = hiddenMoves(q, candidates(q, spec), spec, ['box']).filter(m => m.value === d).length;
      if (opened >= chain.length) return null;
      const forced = forcedCells(q, spec, S).filter(f => f.value === d);
      return forced.length === chain.length ? chain : null;
    };
    if (!qualifies(p)) return null;
    for (const i of shuffle(others, random)) { const q = [...p]; q[i] = 0; if (qualifies(q)) p = q; }
    if (count(p) > maxGivens) return null;
    const chain = qualifies(p);
    return { puzzle: p, solution: S, targets: chain.map(s => ({ index: s.index, value: s.value })), trace: chain, meta: { digit: d, chain: chain.length, pattern: 'E5' } };
  });
}

/** E6: scan 1→n; box elimination finds several digits and then stops on a partial board. */
export function scanTarget(spec, random, { min, max, minDigits }) {
  const n = spec.n;
  return search(`SCAN_${n}`, 30000, () => {
    const S = randomSolution(spec, random);
    const p = S.map(v => random() < (n === 4 ? 0.3 : n === 6 ? 0.32 : 0.33) ? v : 0);
    const r = logicalSolve(p, spec, ['box']);
    if (r.solved || r.steps.length < min || r.steps.length > max || new Set(r.steps.map(s => s.value)).size < minDigits) return null;
    if (!onlyForced(p, spec, S, r.steps.map(s => s.index))) return null;
    return { puzzle: p, solution: S, targets: r.steps.map(s => ({ index: s.index, value: s.value })), trace: r.steps, meta: { pattern: 'E6', digits: [...new Set(r.steps.map(s => s.value))] } };
  });
}

/** L1/L2: a row or column with few empty cells; the digit is kept out of the other empties by columns or boxes. */
export function lineTarget(spec, random, { empties, maxGivens }) {
  const n = spec.n;
  return search(`LINE_${n}_${empties}`, 12000, () => {
    const S = randomSolution(spec, random), t = Math.floor(random() * n * n), d = S[t];
    const kind = random() < 0.5 ? 'row' : 'col', index = kind === 'row' ? Math.floor(t / n) : t % n;
    const L = kind === 'row' ? spec.rows[index] : spec.cols[index];
    const m = empties[0] + Math.floor(random() * (empties[1] - empties[0] + 1));
    const E = shuffle(L.filter(i => i !== t), random).slice(0, m - 1);
    const p = Array(n * n).fill(0);
    for (const i of L) if (i !== t && !E.includes(i)) p[i] = S[i];
    for (const e of E) {
      const cross = kind === 'row' ? spec.cols[e % n] : spec.rows[Math.floor(e / n)];
      const options = [cross.find(i => S[i] === d), ...(spec.regions[e] !== spec.regions[t] ? [spec.boxes[spec.regions[e]].find(i => S[i] === d)] : [])];
      p[pick(options, random)] = d;
    }
    const noBox = q => logicalSolve(q, spec, ['box']).steps.length === 0;
    if (!noBox(p)) return null;
    // With two empty cells the second one follows at once, so an L1 page asks for both.
    const pair = m === 2 ? E[0] : null;
    const done = pair === null ? prefill(p, spec, S, t, new Set(L), 3, noBox) : onlyForced(p, spec, S, [t, pair]) ? p : null;
    if (!done || count(done) > maxGivens) return null;
    const trace = logicalSolve(done, spec, ['box', 'line']).steps;
    if (trace.length !== (pair === null ? 1 : 2) || trace[0].index !== t || trace[0].method !== 'line' || trace[0].unit !== kind || trace[0].unitIndex !== index) return null;
    const targets = [{ index: t, value: d }, ...(pair === null ? [] : [{ index: pair, value: S[pair] }])];
    return { puzzle: done, solution: S, targets, trace, meta: { digit: d, unit: kind, unitIndex: index, missing: targets.map(x => x.value), empties: L.filter(i => !done[i]).length, pattern: m === 2 ? 'L1' : 'L2' } };
  });
}

/** L3 / mid-game: the real position of a full puzzle when box elimination has stopped. */
export function midGameTarget(spec, full, method = 'line') {
  const grid = [...full.puzzle];
  for (const s of full.trace) {
    if (s.method === method && !s.removals) break;
    if (s.removals) throw new Error('MIDGAME_REMOVAL_BEFORE_TARGET');
    grid[s.index] = s.value;
  }
  const masks = candidates(grid, spec);
  if (hiddenMoves(grid, masks, spec, ['box']).length) throw new Error('MIDGAME_BOX_AVAILABLE');
  const moves = method === 'line' ? hiddenMoves(grid, masks, spec, ['row', 'col']) : [];
  const unique = [...new Map(moves.map(m => [m.index, m])).values()];
  if (!unique.length) throw new Error('MIDGAME_WITHOUT_LINE_MOVE');
  return { puzzle: grid, solution: full.solution, targets: unique.map(m => ({ index: m.index, value: m.value })), trace: unique, meta: { pattern: 'L3', placedBefore: count(grid) - count(full.puzzle), lines: [...new Set(moves.map(m => `${m.unit}:${m.unitIndex}`))] } };
}

/** N1: the n−1 other digits sit around one cell, spread over at least two of its row, column and box. */
export function nakedTarget(spec, random, { designated = false, maxGivens = 99 }) {
  const n = spec.n;
  return search(`NAKED_${n}`, 12000, () => {
    const S = randomSolution(spec, random), t = Math.floor(random() * n * n), v = S[t], p = Array(n * n).fill(0);
    for (let x = 1; x <= n; x++) if (x !== v) p[pick(spec.peers[t].filter(j => S[j] === x), random)] = x;
    const inUnit = kind => spec.unitsOf[t].find(u => u.kind === kind).cells.filter(i => p[i]).length;
    const spread = ['row', 'col', 'box'].map(inUnit);
    if (Math.max(...spread) >= n - 1 || spread.filter(Boolean).length < 2) return null;
    const meta = { cell: t, spread: Object.fromEntries(['row', 'col', 'box'].map((k, i) => [k, spread[i]])), pattern: designated ? 'N0' : 'N1' };
    if (designated) return { puzzle: p, solution: S, targets: [{ index: t, value: v }], trace: [{ method: 'naked', index: t, value: v, excluded: [...Array(n).keys()].map(k => k + 1).filter(x => x !== v) }], meta };
    const quiet = q => logicalSolve(q, spec, ['box', 'line']).steps.length === 0;
    if (!quiet(p)) return null;
    const done = prefill(p, spec, S, t, new Set([t]), 3, quiet);
    if (!done || count(done) > maxGivens) return null;
    const trace = logicalSolve(done, spec, ['box', 'line', 'naked']).steps;
    if (trace.length !== 1 || trace[0].index !== t || trace[0].method !== 'naked') return null;
    return { puzzle: done, solution: S, targets: [{ index: t, value: v }], trace, meta };
  });
}

/** K1–K4: a pointing or claiming pair/triple, then exactly one placement by the named basic method. */
export function lockedTarget(spec, random, { rule, follow: followed, maxGivens }) {
  const follow = [followed].flat();
  const n = spec.n, allowed = ['box', 'line', 'naked', 'locked'];
  return search(`LOCKED_${n}_${rule}_${follow}`, 120000, () => {
    const S = randomSolution(spec, random), density = 0.18 + random() * 0.2;
    let p = S.map(v => random() < density ? v : 0);
    const shape = q => {
      if (logicalSolve(q, spec, ['box', 'line', 'naked']).steps.length) return null;
      const r = logicalSolve(q, spec, allowed, { lockedRule: rule });
      // Exactly one locked step, and it must be the reason for the placement that follows.
      const [lock, place] = r.steps;
      if (!lock || lock.method !== 'locked' || !place || place.removals || !follow.includes(place.method)) return null;
      const relevant = place.method === 'naked' ? lock.removals.some(x => x.index === place.index) : lock.value === place.value;
      return relevant ? [lock, place] : null;
    };
    const first = shape(p);
    if (!first) return null;
    const t = first.at(-1).index;
    if (!onlyForced(p, spec, S, [t])) return null;
    for (const i of shuffle(p.flatMap((v, i) => v ? [i] : []), random)) {
      const q = [...p]; q[i] = 0;
      const s = shape(q);
      if (s && s.at(-1).index === t && onlyForced(q, spec, S, [t])) p = q;
    }
    if (count(p) > maxGivens) return null;
    const trace = shape(p);
    const placed = trace.at(-1).method;
    return { puzzle: p, solution: S, targets: [{ index: t, value: S[t] }], trace, meta: { pattern: placed === 'naked' ? 'K4' : rule === 'claiming' ? 'K3' : placed === 'box' ? 'K1' : 'K2', rule, follow: placed, locked: trace.filter(s => s.method === 'locked').map(({ value, unit, unitIndex, targetUnit, targetUnitIndex, cells }) => ({ value, unit, unitIndex, targetUnit, targetUnitIndex, cells })) } };
  });
}

function connected(regions, n) {
  for (let r = 0; r < n; r++) {
    const cells = regions.flatMap((v, i) => v === r ? [i] : []), seen = new Set([cells[0]]), todo = [cells[0]];
    while (todo.length) {
      const a = todo.pop();
      for (const b of cells) if (!seen.has(b) && Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs(a % n - b % n) === 1) { seen.add(b); todo.push(b); }
    }
    if (cells.length !== n || seen.size !== n) return false;
  }
  return true;
}
/** 9×9 stairs: connected 4+5 / 5+4 regions. The cyclic square (4r + c) is a witness solution,
 * so a random digit relabelling gives a solution without a long random search. */
function stairLayout(random) {
  const transpose = random() < 0.5, reflect = random() < 0.5, relabel = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random);
  const at = i => { let r = Math.floor(i / 9), c = i % 9; if (transpose) [r, c] = [c, r]; if (reflect) c = 8 - c; return [r, c]; };
  return {
    regions: Array.from({ length: 81 }, (_, i) => { const [r, c] = at(i); return r === 8 ? 8 : Math.floor(r / 2) * 2 + (c < (r % 2 ? 5 : 4) ? 0 : 1); }),
    witness: Array.from({ length: 81 }, (_, i) => { const [r, c] = at(i); return relabel[(4 * r + c) % 9]; }),
  };
}
function irregularRegions(n, random) {
  if (n === 9) return stairLayout(random).regions;
  const regions = standardRegions(n);
  for (let round = 0, swaps = 0; round < 20000 && swaps < 2 + n; round++) {
    const a = Math.floor(random() * n * n), b = Math.floor(random() * n * n);
    if (regions[a] === regions[b]) continue;
    [regions[a], regions[b]] = [regions[b], regions[a]];
    if (connected(regions, n) && solveExact(Array(n * n).fill(0), makeSpec(n, { regions }), 1).length) swaps++;
    else [regions[a], regions[b]] = [regions[b], regions[a]];
  }
  return regions;
}

/** Rules and one solution they were written from; marks never contradict that solution. */
export function makeVariant(n, family, random, { marks = 'full', clueShare = 1 } = {}) {
  if (family === 'classic' || family === 'diagonal' || family === 'window') {
    const rules = { kind: family }, spec = specFrom(n, rules);
    return { rules, spec, S: randomSolution(spec, random) };
  }
  if (family === 'irregular' && n === 9) {
    const { regions, witness } = stairLayout(random), rules = { kind: family, regions }, spec = specFrom(n, rules);
    if (solveExact(witness, spec, 2).length !== 1) throw new Error('STAIR_WITNESS_INVALID');
    return { rules, spec, S: witness };
  }
  if (family === 'irregular') {
    const rules = { kind: family, regions: irregularRegions(n, random) }, spec = specFrom(n, rules);
    return { rules, spec, S: randomSolution(spec, random) };
  }
  const base = makeSpec(n, family === 'skyscraper' ? { regions: null } : {}), S = randomSolution(base, random);
  let rules;
  if (family === 'parity') rules = { kind: family, cells: S.map(v => random() < (marks === 'sparse' ? 0.22 : marks === 'show' ? 0.45 : 0.4) ? v % 2 ? 1 : 2 : 0) };
  if (family === 'inequality') {
    const edges = S.flatMap((_, i) => [i % n < n - 1 ? i + 1 : -1, i + n < n * n ? i + n : -1].filter(j => j >= 0).map(j => S[i] < S[j] ? [i, j] : [j, i]));
    const k = marks === 'sparse' ? 1 + Math.floor(random() * 3) : marks === 'show' ? n + 2 : n + Math.floor(random() * n);
    rules = { kind: family, lessThan: shuffle(edges, random).slice(0, k) };
  }
  if (family === 'skyscraper') {
    rules = { kind: family, top: [], bottom: [], left: [], right: [] };
    for (let i = 0; i < n; i++) {
      const row = base.rows[i].map(j => S[j]), col = base.cols[i].map(j => S[j]);
      rules.left.push(visible(row)); rules.right.push(visible([...row].reverse()));
      rules.top.push(visible(col)); rules.bottom.push(visible([...col].reverse()));
    }
    if (clueShare < 1) {
      const entries = shuffle(['top', 'bottom', 'left', 'right'].flatMap(side => rules[side].map((v, i) => `${side}:${i}`)), random);
      const keep = new Set(entries.slice(0, Math.round(entries.length * clueShare)));
      for (const side of ['top', 'bottom', 'left', 'right']) rules[side] = rules[side].map((v, i) => keep.has(`${side}:${i}`) ? v : 0);
    }
  }
  return { rules, spec: specFrom(n, rules), S };
}

/** Completed board for discovering a rule; the teacher leads and nothing is judged. */
export function completedBoard(n, family, random) {
  const { rules, spec, S } = makeVariant(n, family, random, { marks: 'show' });
  if (solveExact(S, spec, 2).length !== 1) throw new Error('COMPLETED_BOARD_INVALID');
  return { puzzle: S, solution: S, rules, targets: [], trace: [], meta: { pattern: 'R0' } };
}

/** Variant discovery pages. `kind` names what the new rule must visibly do on the page. */
export function variantTarget(n, family, random, { kind, allowed, maxGivens, maxSteps = 3, single = true }) {
  return search(`VARIANT_${n}_${family}_${kind}`, 40000, () => {
    const { rules, spec, S } = makeVariant(n, family, random, { marks: 'sparse', clueShare: family === 'skyscraper' ? 0.12 + random() * 0.25 : 1 });
    const relaxed = relaxedSpec(n, family), standard = makeSpec(n).boxes;
    const k = family === 'skyscraper' ? Math.floor(random() * 3) : 1 + Math.floor(random() * (n === 4 ? 4 : n + 2));
    let p = S.map(() => 0);
    for (const i of shuffle(S.map((_, i) => i), random).slice(0, k)) p[i] = S[i];
    const shape = q => {
      // The page is about the first placement; cells forced after it are given back below.
      const r = logicalSolve(q, spec, kind === 'region' ? ['extra'] : allowed), first = r.steps.findIndex(s => !s.removals), upto = r.steps.slice(0, first + 1);
      if (first < 0 || upto.length > maxSteps) return null;
      const steps = explainSteps(q, spec, upto), place = steps.at(-1);
      if (kind === 'region' && (place.rule !== 'region' || place.reasons.every(x => x.kind === 'occupied'))) return null;
      if (kind === 'assist' && !(place.variantUse && place.rule !== 'region')) return null;
      if (kind === 'jigsaw' && standard.some(B => B.every(i => spec.regions[i] === spec.regions[place.index]))) return null;
      if (kind === 'mark' && !steps.some(s => s.method === 'extra' && s.removals)) return null;
      if (kind === 'sky-limit' && (r.steps[0].rule !== 'sky-limit' || place.method === 'extra' || logicalSolve(q, spec, allowed, { skipRules: ['sky-limit'] }).steps.some(s => !s.removals))) return null;
      // Practice combines: a skyline rule first, then the row or column gives the number.
      if (kind === 'sky' && (!steps.some(s => s.method === 'extra') || place.method === 'extra')) return null;
      return upto;
    };
    if (!shape(p)) return null;
    const t = shape(p).find(s => !s.removals).index;
    const same = q => { const s = shape(q); return s && s.find(x => !x.removals).index === t && !forcedCells(q, relaxed, S).some(f => f.index === t); };
    // A named page (“this line still misses d”) may leave other cells determined; others must stand alone.
    const ok = q => same(q) && (!single || onlyForced(q, spec, S, [t]));
    if (!same(p)) return null;
    // Cells forced alongside the target are given back as ordinary numbers (outside the target's region).
    const unit = explainSteps(p, spec, shape(p)).find(x => !x.removals), region = spec.units.find(u => u.kind === unit.unit && u.i === unit.unitIndex)?.cells ?? [t];
    if (!ok(p) && single) p = prefill(p, spec, S, t, new Set(region), n === 4 ? 2 : 3, same);
    if (!p || !ok(p)) return null;
    for (const i of shuffle(p.flatMap((v, i) => v ? [i] : []), random)) { const q = [...p]; q[i] = 0; if (ok(q)) p = q; }
    if (count(p) > maxGivens) return null;
    const trace = shape(p), place = explainSteps(p, spec, trace).find(s => !s.removals);
    return { puzzle: p, solution: S, rules, targets: [{ index: t, value: S[t] }], trace, meta: { pattern: single ? `V-${kind}` : `V-${kind}-named`, digit: S[t], unit: place.unit, unitIndex: place.unitIndex } };
  });
}

/** Skyline openers: one clue 1, or one clue n that fixes a whole line. */
export function skyOpener(random, { clue }) {
  const n = 4, side = pick(['top', 'bottom', 'left', 'right'], random), line = Math.floor(random() * n);
  const rules = { kind: 'skyscraper', top: Array(n).fill(0), bottom: Array(n).fill(0), left: Array(n).fill(0), right: Array(n).fill(0) };
  rules[side][line] = clue;
  const spec = specFrom(n, rules), from = side === 'top' || side === 'left';
  const cells = side === 'top' || side === 'bottom' ? spec.cols[line] : spec.rows[line], ordered = from ? cells : [...cells].reverse();
  const targets = clue === 1 ? [{ index: ordered[0], value: n }] : ordered.map((index, k) => ({ index, value: k + 1 }));
  const S = solveExact(Array(n * n).fill(0), spec, 1, random)[0], p = Array(n * n).fill(0);
  if (!onlyForced(p, spec, S, targets.map(t => t.index))) throw new Error('SKY_OPENER');
  return { puzzle: p, solution: S, rules, targets, trace: logicalSolve(p, spec, ['line', 'naked', 'extra']).steps.slice(0, targets.length), meta: { pattern: clue === 1 ? 'S1' : 'S2', side, line } };
}

/**
 * Whole puzzle in a difficulty band: reduce to a minimal puzzle that still needs the lesson
 * method, then give clues back while that need survives, until the band is reached.
 */
export function fullPuzzle(n, family, random, o) {
  const relaxed = family === 'classic' ? null : relaxedSpec(n, family);
  for (let attempt = 0; attempt < (o.attempts ?? 400); attempt++) {
    const { rules, spec, S } = makeVariant(n, family, random, { marks: o.marks ?? 'full', clueShare: o.clueShare ?? 1 });
    const check = q => {
      const tr = logicalSolve(q, spec, o.allowed);
      if (!tr.solved) return null;
      for (const m of o.required ?? []) {
        if (tr.steps.filter(s => s.method === m).length < (o.minRequired ?? 1)) return null;
        if (logicalSolve(q, spec, o.allowed.filter(x => x !== m)).solved) return null;
      }
      if (o.anyOf && logicalSolve(q, spec, o.allowed.filter(x => !o.anyOf.includes(x))).solved) return null;
      // A real line deduction excludes cells; a row with one empty cell left is only a fill-in.
      if (o.realLine && tr.steps.filter(s => s.method === 'line' && s.empty >= 2).length < (o.minRequired ?? 1)) return null;
      if (o.firstLineReal && !(tr.steps.find(s => s.method === 'line')?.empty >= 2)) return null;
      if (relaxed && solveExact(q, relaxed, 2).length < 2) return null;
      if (o.minRule && explainSteps(q, spec, tr.steps).filter(s => s.variantUse).length < o.minRule) return null;
      return tr;
    };
    let p = [...S];
    for (const i of shuffle(S.map((_, i) => i), random)) { const s = p[i]; p[i] = 0; if (!logicalSolve(p, spec, o.allowed).solved) p[i] = s; }
    if (!check(p) || count(p) > o.givens[1]) continue;
    const goal = o.givens[0] + Math.floor(random() * (o.givens[1] - o.givens[0] + 1));
    for (const i of shuffle(p.flatMap((v, i) => v ? [] : [i]), random)) {
      if (count(p) >= goal) break;
      const q = [...p]; q[i] = S[i];
      if (check(q)) p = q;
    }
    if (count(p) < o.givens[0]) continue;
    const tr = check(p), profile = difficultyProfile(p, spec, o.allowed, tr.steps);
    if (profile.bottleneck > (o.maxBottleneck ?? Infinity)) continue;
    if (solveExact(p, spec, 2).length !== 1) throw new Error('LOGIC_UNIQUENESS_MISMATCH');
    return { puzzle: p, solution: S, rules, trace: tr.steps, profile, attempt };
  }
  throw new Error(`NO_FULL_${n}_${family}_${JSON.stringify(o.givens)}`);
}
