import fs from 'node:fs';
import {makeSpec,solveExact,logicalSolve,hiddenMoves,candidates} from '../lib/sudoku-curriculum.mjs';
const spec=makeSpec(4), canonical=solveExact([1,2,3,4,...Array(12).fill(0)],spec,1000);
const seen=new Set(); let unique=0, boxOnly=0, boxNaked=0, lineAdvantage=0, first=null;
for(const sol of canonical) for(let bits=0;bits<65536;bits++) {
  const p=sol.map((v,i)=>bits & 1<<i ? v : 0), key=p.join('');
  if(seen.has(key))continue; seen.add(key);
  const b=logicalSolve(p,spec,['box']);
  if(b.solved){unique++;boxOnly++;boxNaked++;continue;}
  const bn=logicalSolve(p,spec,['box','naked']);
  if(bn.solved){unique++;boxNaked++;continue;}
  if(hiddenMoves(bn.grid,bn.masks,spec,['row','col']).length){lineAdvantage++;first??={p,after:bn.grid};}
  if(solveExact(p,spec,2).length===1)unique++;
}
const report={canonicalSolutions:canonical.length,validPartialRepresentatives:seen.size,unique,boxOnly,boxNaked,lineAdvantage,first};
fs.writeFileSync('content/courses/sudoku-2026/four-exhaustive.json',JSON.stringify(report,null,2)); console.log(report);
