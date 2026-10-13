import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {specFrom} from './generate.mjs';
import {makeSpec,solveExact,logicalSolve,forcedCells} from '../lib/sudoku-curriculum.mjs';
import {checkCurriculum,checkTraceReasons} from './curriculum-check.mjs';

const bank=JSON.parse(fs.readFileSync('content/courses/sudoku-2026/bank.json','utf8'));
const results=[],seen=new Map();
for(const p of bank.puzzles) {
  const identity=JSON.stringify([p.size,p.puzzle,p.rules]);
  assert(!seen.has(identity),`${p.id} duplicates ${seen.get(identity)}`); seen.set(identity,p.id);
  const spec=specFrom(p.size,p.rules), allowed=p.equivalent?['naked']:p.allowed;
  const curriculum=checkCurriculum(p,spec),reasonReplay=checkTraceReasons(p,spec);
  const solutions=solveExact(p.puzzle,spec,2),logical=logicalSolve(p.puzzle,spec,allowed);
  assert(solutions.length,`${p.id}: no solution`);
  assert.deepEqual(logical.steps,p.trace,`${p.id}: trace has changed`);
  assert(!logical.contradiction,`${p.id}: contradictory deduction`);
  const counts=Object.fromEntries(['box','line','naked','locked','extra'].map(m=>[m,p.trace.filter(s=>s.method===m).length]));
  const audit={id:p.id,lessonId:p.lessonId,role:p.role,variant:p.rules.kind,givens:p.givens,solutionCountCappedAt2:solutions.length,allowed,counts,required:p.required,curriculum,reasonReplay,necessity:{},target:null};
  if(p.role==='target') {
    assert.equal(solutions.length,2,`${p.id}: a teaching fragment must remain incomplete`);
    const forced=forcedCells(p.puzzle,spec);
    assert.equal(forced.length,1,`${p.id}: more/less than one forced cell`);
    assert.deepEqual(forced,p.targets);
    assert.equal(logical.steps.filter(s=>!s.removals).length,1);
    audit.target=forced[0];
    if(p.rules.kind==='classic'&&!p.equivalent) {
      const earlier=allowed.filter(m=>m!==p.method);
      const stopped=logicalSolve(p.puzzle,spec,earlier);
      assert.equal(stopped.steps.length,0,`${p.id}: earlier methods already advance`);
      audit.necessity[p.method]={earlierMethods:earlier,progressWithoutNewMethod:0};
    }
    if(p.equivalent) audit.equivalentMethodNote='标准四宫同一确定格也可用宫内排除解释；本题练习从一个格子看唯一余数，不宣称必须使用它。';
  } else {
    assert.equal(solutions.length,1,`${p.id}: full puzzle must be unique`);
    assert(logical.solved,`${p.id}: out-of-syllabus method needed`);
    assert.deepEqual(logical.grid,solutions[0]);
    assert.deepEqual(p.solution,solutions[0]);
    for(const method of p.required) {
      const stopped=logicalSolve(p.puzzle,spec,allowed.filter(m=>m!==method));
      assert(!stopped.solved,`${p.id}: ${method} is unnecessary`);
      const remaining=stopped.grid.filter(v=>!v).length;
      audit.necessity[method]={remaining,grid:stopped.grid};
    }
    if(['M2','H2'].includes(p.lessonId)) assert(counts.line>=2,`${p.id}: needs multiple line steps`);
  }
  for(const step of p.trace) {
    assert(allowed.includes(step.method),`${p.id}: unintroduced method ${step.method}`);
    if(step.removals) for(const removal of step.removals) for(const d of removal.digits) assert(!solutions.some(s=>s[removal.index]===d),`${p.id}: removed a true solution digit`);
    else assert(solutions.every(s=>s[step.index]===step.value),`${p.id}: placement not forced`);
  }
  if(p.variantEssential) {
    const relaxed=makeSpec(p.size,['irregular','skyscraper'].includes(p.rules.kind)?{regions:null}:{});
    if(p.role==='target') assert(!forcedCells(p.puzzle,relaxed).some(t=>t.index===p.targets[0].index),`${p.id}: target does not need its variant rule`);
    else assert.equal(solveExact(p.puzzle,relaxed,2).length,2,`${p.id}: extra rule is redundant`);
    audit.variantEssential=true;
  }
  results.push(audit);
}
for(const lesson of bank.lessons) {
  const ps=bank.puzzles.filter(p=>p.lessonId===lesson.id);
  assert.equal(ps.filter(p=>p.role==='class').length,3);
  assert.equal(ps.filter(p=>p.role==='homework').length,4);
  assert(ps.filter(p=>p.role==='target').length>=8);
}
const report={version:2,checkedAt:new Date().toISOString(),bankSha256:createHash('sha256').update(fs.readFileSync('content/courses/sudoku-2026/bank.json')).digest('hex'),
  scope:'All authored puzzles: agreed curriculum policy, independently replayed method reasons and deduction order, exact solution counts, forced cells, method withdrawal and variant-rule withdrawal. Classroom timing and feel require teacher acceptance.',
  counts:{lessons:bank.lessons.length,puzzles:results.length,targets:results.filter(p=>p.role==='target').length,class:results.filter(p=>p.role==='class').length,homework:results.filter(p=>p.role==='homework').length},results};
fs.writeFileSync('content/courses/sudoku-2026/method-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
