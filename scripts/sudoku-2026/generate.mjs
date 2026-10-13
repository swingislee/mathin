import fs from 'node:fs';
import { makeSpec, rng, shuffle, solveExact, logicalSolve, singleTarget, fullPuzzle, forcedCells, visible } from '../lib/sudoku-curriculum.mjs';

const directory = 'content/courses/sudoku-2026';
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync('.tmp/sudoku-2026/bank-cache', { recursive: true });
const classic = n => ({ kind: 'classic' });
export function specFrom(n, rules) {
  if (rules.kind === 'diagonal') return makeSpec(n, { diagonal: true });
  if (rules.kind === 'irregular') return makeSpec(n, { regions: rules.regions });
  if (rules.kind === 'inequality') return makeSpec(n, { inequalities: rules.lessThan });
  if (rules.kind === 'parity') return makeSpec(n, { parity: rules.cells });
  if (rules.kind === 'skyscraper') return makeSpec(n, { regions: null, sky: rules });
  return makeSpec(n);
}
const relaxedSpec = (n, kind) => makeSpec(n, kind === 'irregular' || kind === 'skyscraper' ? { regions: null } : {});
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
function irregular(n, random) {
  if (n === 9) {
    // Connected 4+5 / 5+4 stair regions. The cyclic Latin square with row
    // shift 4 witnesses satisfiability; reflection/transpose preserve it.
    const transpose = random() < 0.5, reflect = random() < 0.5;
    return { kind:'irregular', regions:Array.from({length:81},(_,i)=>{
      let r=Math.floor(i/9),c=i%9;
      if(transpose) [r,c]=[c,r]; if(reflect) c=8-c;
      return r===8?8:Math.floor(r/2)*2+(c<(r%2?5:4)?0:1);
    }) };
  }
  const base = makeSpec(n), regions = [...base.regions];
  // Swap boundary cells in equal numbers, retaining connected regions. A fresh
  // exact search checks the resulting jigsaw; no standard-box solution is assumed.
  for (let round = 0; round < 10000; round++) {
    const a = Math.floor(random() * n * n), b = Math.floor(random() * n * n);
    if (regions[a] === regions[b]) continue;
    [regions[a], regions[b]] = [regions[b], regions[a]];
    if (connected(regions, n) && solveExact(Array(n * n).fill(0), makeSpec(n, { regions }), 1).length) return { kind: 'irregular', regions };
    [regions[a], regions[b]] = [regions[b], regions[a]];
  }
  throw Error('JIGSAW_GENERATION');
}
function makeRules(n, family, random, sparse = false) {
  if (family === 'diagonal') return { kind: family };
  if (family === 'irregular') return irregular(n, random);
  const base = makeSpec(n, family === 'skyscraper' ? { regions: null } : {});
  const solution = solveExact(Array(n * n).fill(0), base, 1, random)[0];
  if (family === 'parity') return { kind: family, cells: solution.map(v => random() < (sparse ? 0.22 : 0.4) ? v % 2 ? 1 : 2 : 0) };
  if (family === 'inequality') {
    const edges = solution.flatMap((_, i) => [i % n < n - 1 ? i + 1 : -1, i + n < n * n ? i + n : -1].filter(j => j >= 0).map(j => solution[i] < solution[j] ? [i, j] : [j, i]));
    return { kind: family, lessThan: shuffle(edges, random).slice(0, sparse ? 1 + Math.floor(random() * 3) : n + Math.floor(random() * n)) };
  }
  if (family === 'skyscraper') {
    const rules = { kind: family, top: [], bottom: [], left: [], right: [] };
    for (let i = 0; i < n; i++) {
      const row = base.rows[i].map(j => solution[j]), col = base.cols[i].map(j => solution[j]);
      rules.left.push(visible(row)); rules.right.push(visible([...row].reverse()));
      rules.top.push(visible(col)); rules.bottom.push(visible([...col].reverse()));
    }
    if (sparse) {
      const entries = ['top','bottom','left','right'].flatMap(side => rules[side].map((v, i) => ({side, i, v})));
      const keep = new Set(shuffle(entries.filter(e => e.v !== 4), random).slice(0, 1 + Math.floor(random() * 3)).map(e => `${e.side}:${e.i}`));
      for (const side of ['top','bottom','left','right']) rules[side] = rules[side].map((v, i) => keep.has(`${side}:${i}`) ? v : 0);
    }
    return rules;
  }
  return classic(n);
}

export function variantTarget(n, family, random) {
  if (family === 'irregular' && n === 9) {
    for (let trial=0; trial<100; trial++) {
      const rules=makeRules(n,family,random,true), spec=specFrom(n,rules);
      const result=singleTarget(spec,random,'box');
      const box=spec.regions[result.targets[0].index], original=makeSpec(n);
      if (spec.boxes[box].every(i=>original.regions[i]===box)) continue;
      if (forcedCells(result.puzzle,relaxedSpec(n,family)).some(t=>t.index===result.targets[0].index)) continue;
      return {...result,rules,allowed:['box','line','naked','extra'],required:[],variantEssential:true};
    }
    throw Error('NO_JIGSAW_TARGET');
  }
  for (let trial = 0; trial < 20000; trial++) {
    const rules = makeRules(n, family, random, true), spec = specFrom(n, rules);
    const solution = solveExact(Array(n * n).fill(0), spec, 1, random)[0];
    if (!solution) continue;
    const positions = shuffle(solution.map((_, i) => i), random).slice(0, family === 'skyscraper' ? Math.floor(random() * 3) : 2 + Math.floor(random() * (n + 3)));
    let puzzle = solution.map((v, i) => positions.includes(i) ? v : 0);
    const allowed = n === 4 ? ['box', 'naked', 'extra'] : ['box', 'line', 'naked', 'extra'];
    const qualifies = p => {
      const trace = logicalSolve(p, spec, allowed);
      if (trace.steps.filter(s => !s.removals).length !== 1) return false;
      const forced = forcedCells(p, spec);
      if (forced.length !== 1) return false;
      return !forcedCells(p, relaxedSpec(n, family)).some(t => t.index === forced[0].index);
    };
    if (!qualifies(puzzle)) continue;
    for (const i of shuffle(positions, random)) {
      const p = [...puzzle]; p[i] = 0;
      if (qualifies(p)) puzzle = p;
    }
    return { rules, puzzle, targets: forcedCells(puzzle, spec), trace: logicalSolve(puzzle, spec, allowed).steps, givens: puzzle.filter(Boolean).length, allowed, required: [], variantEssential: true };
  }
  throw Error(`NO_VARIANT_TARGET_${n}_${family}`);
}

function variantFull(n, family, random, allowed) {
  for (let trial = 0; trial < 200; trial++) {
    const rules = makeRules(n, family, random), spec = specFrom(n, rules);
    const full = fullPuzzle(spec, random, allowed, [], { attempts: 100, maxGivens: Math.ceil(n * n * 0.62) });
    if (solveExact(full.puzzle, relaxedSpec(n, family), 2).length !== 2) continue;
    return { ...full, rules, allowed, required: [], variantEssential: true };
  }
  throw Error(`NO_VARIANT_FULL_${n}_${family}`);
}

export const LESSONS = [
  { id:'B1',level:'初阶',n:4,number:1,title:'一个数字找到底',focus:'宫内排除＋唯一余数',drills:['box','box','box','box','box','box','naked','naked'],allowed:['box'],required:[] },
  { id:'B2',level:'初阶',n:4,number:2,title:'斜线与会转弯的宫',focus:'对角线＋锯齿',families:['diagonal','irregular'],allowed:['box','naked','extra'] },
  { id:'B3',level:'初阶',n:4,number:3,title:'符号会告诉我们什么',focus:'不等号＋奇偶',families:['inequality','parity'],allowed:['box','naked','extra'] },
  { id:'B4',level:'初阶',n:4,number:4,title:'站在街边看高楼',focus:'摩天楼',families:['skyscraper'],allowed:['naked','extra'] },
  { id:'M1',level:'中阶',n:6,number:1,title:'六宫里的数字侦探',focus:'宫内排除',drills:Array(8).fill('box'),allowed:['box'],required:[] },
  { id:'M2',level:'中阶',n:6,number:2,title:'宫里停住，看看行列',focus:'行列排除为主，唯一余数为辅',drills:[...Array(6).fill('line'),'naked','naked'],allowed:['box','line','naked'],required:['line'] },
  { id:'M3',level:'中阶',n:6,number:3,title:'两格未定，也能排除',focus:'区块',drills:Array(8).fill('locked'),allowed:['box','line','naked','locked'],required:['locked'] },
  { id:'M4',level:'中阶',n:6,number:4,title:'给六宫加一条规则',focus:'对角线＋锯齿＋不等号',families:['diagonal','irregular','inequality'],allowed:['box','line','naked','locked','extra'] },
  { id:'H1',level:'高阶',n:9,number:1,title:'九宫也能有序寻找',focus:'宫内排除',drills:Array(8).fill('box'),allowed:['box'],required:[] },
  { id:'H2',level:'高阶',n:9,number:2,title:'从空格少的行列突破',focus:'行列排除',drills:Array(8).fill('line'),allowed:['box','line'],required:['line'] },
  { id:'H3',level:'高阶',n:9,number:3,title:'一个格子与一组位置',focus:'唯一余数＋区块',drills:[...Array(4).fill('naked'),...Array(4).fill('locked')],allowed:['box','line','naked','locked'],required:['naked-or-locked'] },
  { id:'H4',level:'高阶',n:9,number:4,title:'九宫规则实验室',focus:'对角线＋锯齿＋不等号',families:['diagonal','irregular','inequality'],allowed:['box','line','naked','locked','extra'] },
];

function main() {
const records = [];
for (const [lessonIndex, lesson] of LESSONS.entries()) {
  const drillCount = lesson.drills?.length ?? (lesson.families.length === 3 ? 9 : 8);
  for (let j = 0; j < drillCount + 7; j++) {
    const role = j < drillCount ? 'target' : j < drillCount + 3 ? 'class' : 'homework';
    const number = role === 'target' ? j + 1 : role === 'class' ? j - drillCount + 1 : j - drillCount - 2;
    const id = `${lesson.id}-${{ target:'T',class:'C',homework:'H' }[role]}${number}`;
    const cache = `.tmp/sudoku-2026/bank-cache/${id}.json`;
    if (fs.existsSync(cache)) {
      const cached = JSON.parse(fs.readFileSync(cache,'utf8'));
      if (lesson.n === 4 && lesson.families && cached.allowed.includes('line')) {
        const allowed = cached.allowed.filter(m => m !== 'line' && (lesson.id !== 'B4' || m !== 'box'));
        const trace = logicalSolve(cached.puzzle, specFrom(4,cached.rules), allowed);
        if (role === 'target' ? trace.steps.filter(s=>!s.removals).length === 1 : trace.solved) {
          cached.allowed=allowed; cached.trace=trace.steps;
          fs.writeFileSync(cache,JSON.stringify(cached)); records.push(cached); continue;
        }
      } else { records.push(cached); continue; }
    }
    const random = rng(20261013 + lessonIndex * 1000 + j * 11);
    let item;
    if (lesson.families) {
      const family = role === 'target' ? lesson.families[Math.floor(j / (drillCount / lesson.families.length))] : lesson.families[(j - drillCount) % lesson.families.length];
      item = role === 'target' ? variantTarget(lesson.n, family, random) : variantFull(lesson.n, family, random, lesson.allowed);
    } else if (role === 'target') {
      const method = lesson.drills[j];
      item = { ...singleTarget(makeSpec(lesson.n), random, method, { allowEquivalent: lesson.n === 4 && method === 'naked' }), rules: classic(lesson.n), allowed: method === 'box' ? ['box'] : method === 'line' ? ['box','line'] : method === 'naked' ? ['box','line','naked'] : ['box','line','naked','locked'], required: [method] };
    } else {
      const required = lesson.id === 'H3' ? ((j - drillCount) % 3 === 0 ? ['naked','locked'] : [(j - drillCount) % 3 === 1 ? 'naked' : 'locked']) : lesson.required;
      item = { ...fullPuzzle(makeSpec(lesson.n), random, lesson.allowed, required, { attempts: 30000, minSteps: lesson.id === 'H2' || lesson.id === 'M2' ? 2 : 1 }), rules: classic(lesson.n), allowed: lesson.allowed, required };
    }
    const record = { id, lessonId:lesson.id, role, number, size:lesson.n, ...item };
    fs.writeFileSync(cache,JSON.stringify(record)); records.push(record);
    console.log(`${id} ${record.rules.kind} ${record.givens} clues ${record.trace.length} steps`);
  }
  console.log(`Finished ${lesson.id}`);
}
fs.writeFileSync(`${directory}/bank.json`, JSON.stringify({version:1,title:'数独教学 · 2026版',seed:20261013,lessons:LESSONS,puzzles:records},null,2)+'\n');
console.log(`Saved ${records.length} puzzles`);
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/generate.mjs')) main();
