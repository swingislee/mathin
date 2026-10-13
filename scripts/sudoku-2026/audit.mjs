import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LESSONS } from './lessons.mjs';
import { TAUGHT } from './generate.mjs';
import { checkMathematics, checkSyllabus, checkDesign, replayReasons, specOf } from './curriculum-check.mjs';

const bank = JSON.parse(fs.readFileSync('content/courses/sudoku-2026/bank.json', 'utf8'));
const results = [], seen = new Map(), failures = [];
for (const p of bank.puzzles) {
  const identity = JSON.stringify([p.size, p.puzzle, p.rules]);
  const reuse = seen.get(identity);
  try {
    assert(!reuse, `${p.id} duplicates ${reuse}`);
    seen.set(identity, p.id);
    const spec = specOf(p);
    results.push({ id: p.id, lessonId: p.lessonId, role: p.role, family: p.family, givens: p.givens, mathematics: checkMathematics(p, spec), syllabus: checkSyllabus(p, spec, TAUGHT[p.lessonId]), design: checkDesign(p, spec), replay: replayReasons(p, spec) });
  } catch (error) { failures.push(error.message); }
}

// Course-level design: difficulty goes down the page order, locked forms are both taught,
// and student-facing words carry no internal ids or template letters.
for (const lesson of LESSONS) {
  const ps = bank.puzzles.filter(p => p.lessonId === lesson.id);
  for (const role of ['class', 'homework']) {
    const byFamily = new Map();
    for (const p of ps.filter(p => p.role === role)) byFamily.set(p.family, [...byFamily.get(p.family) ?? [], p]);
    for (const [family, list] of byFamily) for (let i = 1; i < list.length; i++) {
      if (list[i].givens > list[i - 1].givens) failures.push(`${lesson.id} ${role} ${family}: ${list[i].id} has more givens than ${list[i - 1].id}`);
    }
  }
  // Two pages of one lesson must not ask the same question on the same numbers.
  const asked = new Map();
  for (const p of ps.filter(p => p.role === 'target')) {
    const key = JSON.stringify([p.puzzle, p.targets]), other = asked.get(key);
    if (other) failures.push(`${p.id} repeats ${other}`); else asked.set(key, p.id);
  }
  const student = lesson.pages.flatMap(page => [page.heading, page.prompt, page.name, page.body, page.tip, page.sub, page.goal, page.tag].filter(Boolean));
  for (const text of student) if (/\b[BMH]\d-|～N|\bN 格|1～N/.test(text)) failures.push(`${lesson.id}: student text leaks an internal mark: ${text}`);
}
const lockedRules = id => new Set(bank.puzzles.filter(p => p.lessonId === id && p.plan.gen === 'locked').map(p => p.plan.rule));
for (const id of ['M3', 'H3']) if (!['pointing', 'claiming'].every(r => lockedRules(id).has(r))) failures.push(`${id}: both locked forms are required`);

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
const report = {
  version: 3, checkedAt: new Date().toISOString(),
  bankSha256: createHash('sha256').update(fs.readFileSync('content/courses/sudoku-2026/bank.json')).digest('hex'),
  scope: 'L1 mathematics (uniqueness, forced targets, completed rule boards); L2 syllabus (taught methods only, required methods cannot be skipped, variant rules essential); L3 design (pattern of every page, difficulty band and order, rule use, locked coverage, student text); every reason replayed independently.',
  counts: {
    lessons: LESSONS.length, puzzles: results.length,
    discover: results.filter(r => r.role === 'discover').length, targets: results.filter(r => r.role === 'target').length,
    class: results.filter(r => r.role === 'class').length, homework: results.filter(r => r.role === 'homework').length,
    reasonSteps: results.reduce((n, r) => n + r.replay.steps, 0),
  },
  results,
};
fs.writeFileSync('content/courses/sudoku-2026/method-audit.json', `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify(report.counts));
