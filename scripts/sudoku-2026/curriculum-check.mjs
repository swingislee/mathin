import assert from 'node:assert/strict';
import {logicalSolve} from '../lib/sudoku-curriculum.mjs';

// This policy comes from the agreed lesson sequence, not a puzzle's own labels.
const policy = {
  B1: {size:4,allowed:['box','naked'],full:['box'],drills:[...Array(6).fill('box'),'naked','naked']},
  B2: {size:4,allowed:['box','naked','extra'],families:['diagonal','irregular']},
  B3: {size:4,allowed:['box','naked','extra'],families:['inequality','parity']},
  B4: {size:4,allowed:['naked','extra'],families:['skyscraper']},
  M1: {size:6,allowed:['box'],drills:Array(8).fill('box')},
  M2: {size:6,allowed:['box','line','naked'],required:['line'],drills:[...Array(6).fill('line'),'naked','naked']},
  M3: {size:6,allowed:['box','line','naked','locked'],required:['locked'],drills:Array(8).fill('locked')},
  M4: {size:6,allowed:['box','line','naked','locked','extra'],families:['diagonal','irregular','inequality']},
  H1: {size:9,allowed:['box'],drills:Array(8).fill('box')},
  H2: {size:9,allowed:['box','line'],required:['line'],drills:Array(8).fill('line')},
  H3: {size:9,allowed:['box','line','naked','locked'],drills:[...Array(4).fill('naked'),...Array(4).fill('locked')]},
  H4: {size:9,allowed:['box','line','naked','locked','extra'],families:['diagonal','irregular','inequality']},
};

export function checkCurriculum(p, spec) {
  const lesson = policy[p.lessonId];
  assert(lesson, `${p.id}: unknown lesson`);
  assert.equal(p.size, lesson.size, `${p.id}: wrong grid size`);
  assert((lesson.families ?? ['classic']).includes(p.rules.kind), `${p.id}: unintroduced variant`);
  const allowed = p.role === 'target' ? lesson.allowed : lesson.full ?? lesson.allowed;
  assert(p.trace.every(step => allowed.includes(step.method)), `${p.id}: out-of-syllabus trace`);
  assert(lesson.families ? p.variantEssential === true : !p.variantEssential, `${p.id}: variant necessity must be checked`);
  if (p.role === 'target' && lesson.drills) {
    assert.equal(p.method, lesson.drills[p.number - 1], `${p.id}: wrong target method`);
    assert(p.trace.some(step => step.method === p.method), `${p.id}: target method missing`);
  }
  if (p.equivalent) assert(p.lessonId === 'B1' && p.role === 'target' && p.method === 'naked', `${p.id}: invalid equivalence exception`);
  const fullProof = {};
  if (p.role !== 'target') {
    assert(logicalSolve(p.puzzle,spec,allowed).solved, `${p.id}: cannot solve using this lesson's methods`);
    for (const method of lesson.required ?? []) {
      const without = logicalSolve(p.puzzle,spec,allowed.filter(m=>m!==method));
      assert(!without.solved, `${p.id}: lesson method ${method} is optional`);
      fullProof[method] = {necessary:true,remaining:without.grid.filter(v=>!v).length};
    }
    if (['M2','H2'].includes(p.lessonId)) assert(p.trace.filter(s=>s.method==='line').length>=2, `${p.id}: fewer than two line deductions`);
    if (p.lessonId === 'H3') {
      const earlier = logicalSolve(p.puzzle,spec,['box','line']);
      assert(!earlier.solved, `${p.id}: does not require naked singles or locked candidates`);
      fullProof.nakedOrLocked = {necessary:true,remaining:earlier.grid.filter(v=>!v).length};
    }
  }
  return {lessonMethods:allowed,necessaryMethods:fullProof};
}

/** Replay the stated reasons directly, without calling the trace-producing solver. */
export function checkTraceReasons(p, spec) {
  const grid=[...p.puzzle], eliminated=grid.map(()=>new Set()), digits=Array.from({length:p.size},(_,i)=>i+1);
  const permitted=p.equivalent?['naked']:p.allowed;
  let nextDigit=1;
  const candidates=index=>grid[index]?[grid[index]]:digits.filter(d=>!eliminated[index].has(d)&&!spec.peers[index].some(j=>grid[j]===d));
  const places=(unit,d)=>unit.cells.filter(i=>!grid[i]&&candidates(i).includes(d));
  const hidden=kinds=>spec.units.filter(u=>kinds.includes(u.kind)).flatMap(u=>digits.flatMap(d=>{
    if(u.cells.some(i=>grid[i]===d)) return [];
    const cells=places(u,d);
    return cells.length===1?[{unit:u,value:d,index:cells[0],empty:u.cells.filter(i=>!grid[i]).length}]:[];
  }));
  const visibility=values=>values.reduce((state,value)=>({max:Math.max(state.max,value),count:state.count+Number(value>state.max)}),{max:0,count:0}).count;
  for (const [index,step] of p.trace.entries()) {
    const fail=message=>`${p.id} step ${index+1}: ${message}`;
    assert(permitted.includes(step.method),fail('method not allowed'));
    const boxes=permitted.includes('box')?hidden(['box']):[];
    const lines=permitted.includes('line')?hidden(['row','col']):[];
    if(step.method==='box') {
      let preferred;
      for(let offset=0;offset<p.size&&!preferred;offset++) preferred=boxes.find(m=>m.value===(nextDigit+offset-1)%p.size+1);
      assert(preferred&&preferred.value===step.value,fail('switches digits before exhausting box deductions'));
    } else assert.equal(boxes.length,0,fail('uses another method before box deductions are exhausted'));
    if(!['box','line'].includes(step.method)) assert.equal(lines.length,0,fail('skips an available line deduction'));
    if(['box','line'].includes(step.method)||(!step.removals&&step.method==='extra')) {
      const kind=step.method==='box'?'box':step.method==='extra'?'diagonal':step.unit;
      assert((step.method!=='line'||['row','col'].includes(kind)),fail('invalid line'));
      const unit=spec.units.find(u=>u.kind===kind&&u.i===step.unitIndex);
      assert(unit&&!unit.cells.some(i=>grid[i]===step.value),fail('digit already in unit'));
      assert.deepEqual(places(unit,step.value),[step.index],fail('digit has other possible positions'));
      if(step.method==='line') assert.equal(unit.cells.filter(i=>!grid[i]).length,Math.min(...lines.map(m=>m.empty)),fail('does not prioritize the least-empty lines'));
    } else if(step.method==='naked') {
      assert.deepEqual(candidates(step.index),[step.value],fail('cell has another candidate'));
    } else if(step.method==='locked') {
      const source=spec.units.find(u=>u.kind===step.unit&&u.i===step.unitIndex);
      const target=spec.units.find(u=>u.kind===step.targetUnit&&u.i===step.targetUnitIndex);
      assert(source&&target&&(source.kind==='box')!==(target.kind==='box'),fail('not a box/line intersection'));
      const spots=places(source,step.value);
      assert(spots.length>=2&&spots.every(i=>target.cells.includes(i)),fail('candidate positions are not locked'));
      assert.deepEqual(step.cells,spots,fail('incomplete source candidate set'));
      for(const r of step.removals) assert(target.cells.includes(r.index)&&!source.cells.includes(r.index)&&r.digits.every(d=>d===step.value),fail('removal outside locked intersection'));
    } else if(step.rule==='parity') {
      for(const r of step.removals) assert(spec.parity[r.index]&&r.digits.every(d=>d%2!==spec.parity[r.index]%2),fail('parity does not exclude this value'));
    } else if(step.rule==='inequality') {
      const [a,b]=step.cells;
      assert(spec.inequalities.some(([x,y])=>x===a&&y===b),fail('inequality is absent'));
      for(const r of step.removals) for(const d of r.digits) assert(
        r.index===a?!candidates(b).some(v=>d<v):r.index===b&&!candidates(a).some(v=>v<d),fail('inequality still supports the removed value'));
    } else if(step.rule==='visibility') {
      const unit=step.unit==='row'?spec.rows[step.unitIndex]:spec.cols[step.unitIndex];
      const clues=step.unit==='row'?[spec.sky.left[step.unitIndex],spec.sky.right[step.unitIndex]]:[spec.sky.top[step.unitIndex],spec.sky.bottom[step.unitIndex]];
      assert.deepEqual(step.clues,clues,fail('wrong visibility clues'));
      const arrangements=[];
      const extend=line=>{
        if(line.length===p.size) {
          if((!clues[0]||visibility(line)===clues[0])&&(!clues[1]||visibility([...line].reverse())===clues[1])) arrangements.push(line);
        } else for(const d of candidates(unit[line.length])) if(!line.includes(d)) extend([...line,d]);
      };
      extend([]);
      assert(arrangements.length>0&&arrangements.length===step.arrangements,fail('wrong set of possible building arrangements'));
      for(const r of step.removals) assert(unit.includes(r.index)&&r.digits.every(d=>arrangements.every(a=>a[unit.indexOf(r.index)]!==d)),fail('a valid arrangement supports the removed height'));
    } else assert.fail(fail('unknown deduction'));
    if(step.removals) for(const r of step.removals) {
      assert(!grid[r.index]&&r.digits.length>0&&r.digits.every(d=>candidates(r.index).includes(d)),fail('removal has no candidate to remove'));
      for(const d of r.digits) eliminated[r.index].add(d);
      assert(candidates(r.index).length,fail('removal empties a cell'));
    } else {
      assert(!grid[step.index]&&candidates(step.index).includes(step.value),fail('invalid placement'));
      grid[step.index]=step.value;
    }
    nextDigit=step.method==='box'?step.value:1;
  }
  return {steps:p.trace.length,methodReasons:true,boxDigitPriority:permitted.includes('box')?true:null,leastEmptyLinePriority:permitted.includes('line')?true:null};
}
