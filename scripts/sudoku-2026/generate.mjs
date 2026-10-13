import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { makeSpec, rng, difficultyProfile } from '../lib/sudoku-curriculum.mjs';
import * as G from './generators.mjs';
import { LESSONS } from './lessons.mjs';

/** Methods a lesson may rely on anywhere: its own content plus what came before in the same level. */
export const TAUGHT = {
  B1: ['box', 'naked'], B2: ['box', 'naked', 'extra'], B3: ['box', 'naked', 'extra'], B4: ['line', 'naked', 'extra'],
  M1: ['box'], M2: ['box', 'line', 'naked'], M3: ['box', 'line', 'naked', 'locked'], M4: ['box', 'line', 'naked', 'extra'],
  H1: ['box'], H2: ['box', 'line'], H3: ['box', 'line', 'naked', 'locked'], H4: ['box', 'line', 'naked', 'extra'],
};
const GENERATOR_VERSION = 'sudoku-2026-v2.1';
const CACHE = '.tmp/sudoku-2026/bank-cache-v2';
const BY_SIZE = (n, values) => values[n];

function build(lesson, page, random) {
  const n = lesson.n, p = page.puzzle, spec = makeSpec(n);
  switch (p.gen) {
    case 'completed': return G.completedBoard(n, p.family, random);
    case 'fill': return G.fillInTarget(spec, random, { boxes: p.boxes });
    case 'box': return G.boxTarget(spec, random, { pattern: p.pattern, maxGivens: BY_SIZE(n, { 4: 4, 6: 8, 9: 12 }) });
    case 'chain': return G.chainTarget(spec, random, { minChain: BY_SIZE(n, { 4: 2, 6: 3, 9: 4 }), maxGivens: BY_SIZE(n, { 4: 6, 6: 12, 9: 24 }) });
    case 'scan': return G.scanTarget(spec, random, { min: BY_SIZE(n, { 4: 3, 6: 4, 9: 5 }), max: BY_SIZE(n, { 4: 6, 6: 8, 9: 10 }), minDigits: BY_SIZE(n, { 4: 2, 6: 3, 9: 3 }) });
    case 'naked': return G.nakedTarget(spec, random, { designated: !!p.designated, maxGivens: BY_SIZE(n, { 4: 3, 6: 8, 9: 12 }) });
    case 'line': return G.lineTarget(spec, random, { empties: p.empties, maxGivens: n + 5 });
    case 'midgame': {
      const full = G.fullPuzzle(n, 'classic', random, { allowed: ['box', 'line'], required: ['line'], givens: p.givens, firstLineReal: true, attempts: 600 });
      return { ...G.midGameTarget(spec, full, 'line'), source: { puzzle: full.puzzle, givens: full.profile.givens } };
    }
    case 'locked': return G.lockedTarget(spec, random, { rule: p.rule, follow: p.follow, maxGivens: BY_SIZE(n, { 6: 10, 9: 18 }) });
    case 'variant': return G.variantTarget(n, p.family, random, { kind: p.kind, allowed: lesson.allowed, maxGivens: BY_SIZE(n, { 4: 5, 6: 9, 9: 14 }), maxSteps: p.maxSteps ?? 3, single: p.single ?? true });
    case 'skyOpener': return G.skyOpener(random, { clue: p.clue });
    case 'full': return G.fullPuzzle(n, p.family ?? 'classic', random, {
      allowed: lesson.allowed, required: p.required ?? lesson.required ?? [], minRequired: lesson.minRequired ?? 1,
      givens: p.givens, maxBottleneck: p.maxBottleneck, minRule: p.minRule, clueShare: p.clueShare, realLine: lesson.realLine, attempts: 800,
    });
    default: throw new Error(`UNKNOWN_GENERATOR ${p.gen}`);
  }
}

/** Words the page text may use; every placeholder in lessons.mjs must resolve from these. */
function wordsFor(lesson, spec, rules, made) {
  const n = lesson.n, m = made.meta ?? {}, w = {};
  if (m.digit) w.digit = m.digit;
  if (m.unit === 'box') w.box = G.unitName(spec, 'box', m.unitIndex, rules);
  if (m.unit === 'row' || m.unit === 'col') w.line = G.lineName(n, m.unit, m.unitIndex);
  if (m.unit === 'diagonal' || m.unit === 'window') w.region = G.unitName(spec, m.unit, m.unitIndex, rules);
  if (m.missing) w.missing = [...m.missing].sort((a, b) => a - b).join(' 和 ');
  if (m.cell !== undefined) w.cell = G.cellLabel(m.cell, n);
  if (m.locked?.length) {
    const l = m.locked[0];
    Object.assign(w, { ldigit: l.value, lsource: G.unitName(spec, l.unit, l.unitIndex, rules), ltarget: G.unitName(spec, l.targetUnit, l.targetUnitIndex, rules) });
  }
  const limit = made.trace?.find(s => s.rule === 'sky-limit');
  if (limit) w.clue = limit.clue;
  if (made.targets?.length) w.answer = made.targets.map(t => `${G.cellLabel(t.index, n)} = ${t.value}`).join('、');
  return w;
}

function record(lesson, page, made) {
  const n = lesson.n, rules = made.rules ?? { kind: 'classic' }, spec = G.specFrom(n, rules);
  const role = page.kind === 'full' ? page.role : page.kind === 'discover' ? 'discover' : 'target';
  const allowed = role === 'class' || role === 'homework' ? lesson.allowed : TAUGHT[lesson.id];
  const trace = role === 'class' || role === 'homework' ? made.trace : made.trace ?? [];
  return {
    id: `${lesson.id}-${page.key}`, lessonId: lesson.id, pageKey: page.key, role, size: n, family: rules.kind, rules,
    puzzle: made.puzzle, solution: made.solution, targets: made.targets, trace, allowed,
    required: page.puzzle.required ?? (role === 'class' || role === 'homework' ? lesson.required ?? [] : []),
    plan: page.puzzle, meta: made.meta ?? {}, words: wordsFor(lesson, spec, rules, made), source: made.source ?? null,
    givens: made.puzzle.filter(Boolean).length,
    profile: role === 'class' || role === 'homework' ? difficultyProfile(made.puzzle, spec, lesson.allowed, made.trace) : null,
  };
}

export function lessonRecords(lesson, lessonIndex) {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = [];
  for (const [pageIndex, page] of lesson.pages.entries()) {
    if (!page.puzzle) continue;
    const hash = createHash('sha256').update(JSON.stringify([GENERATOR_VERSION, lesson.allowed, lesson.required, lesson.minRequired, lesson.realLine, page.puzzle, page.puzzle.gen === 'midgame' ? 'real-line' : null])).digest('hex').slice(0, 16);
    const file = `${CACHE}/${lesson.id}-${page.key}.json`;
    // The cache keeps only what generation produced; records and page words are rebuilt each run.
    if (fs.existsSync(file)) {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      const made = cached.made ?? (({ puzzle, solution, targets, trace, meta, rules, source }) => ({ puzzle, solution, targets, trace, meta, rules, source }))(cached.record);
      if (cached.hash === hash) { out.push(record(lesson, page, made)); continue; }
    }
    const started = Date.now();
    const made = build(lesson, page, rng(20261014 + lessonIndex * 1000 + pageIndex * 17 + (page.puzzle.salt ?? 0) * 7919));
    const rec = record(lesson, page, made);
    fs.writeFileSync(file, JSON.stringify({ hash, made }));
    console.log(`${rec.id} ${rec.family} ${rec.role} givens ${rec.givens} ${rec.profile ? `bottleneck ${rec.profile.bottleneck}` : `targets ${rec.targets.length}`} ${Date.now() - started}ms`);
    out.push(rec);
  }
  return out;
}

function main() {
  const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const records = [];
  for (const [i, lesson] of LESSONS.entries()) {
    if (only.length && !only.includes(lesson.id)) continue;
    records.push(...lessonRecords(lesson, i));
    console.log(`Finished ${lesson.id}`);
  }
  if (only.length) return;
  const lessons = LESSONS.map(({ pages, schedule, ...lesson }) => lesson);
  // One puzzle per line keeps the bank small and readable in diffs.
  const head = JSON.stringify({ version: 2, generator: GENERATOR_VERSION, title: '数独教学 · 2026版', seed: 20261014, lessons }, null, 1).slice(0, -2);
  fs.writeFileSync('content/courses/sudoku-2026/bank.json', `${head},\n "puzzles": [\n${records.map(r => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`);
  console.log(`Saved ${records.length} puzzles`);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/generate.mjs')) main();
