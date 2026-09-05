import {describe,it,expect} from 'vitest';
import {renewalHealthSignals,type RenewalHealthFacts} from '../src/features/school/renewal-health-contract';
const now=Date.parse('2026-09-05T00:00:00Z');
const base:RenewalHealthFacts={studentId:'demo',hasLearningAccount:false,lessons:[],checks:[],contacts:[],homework:[],videos:[]};
describe('renewal health evidence',()=>{
 it('does not turn missing tasks or accounts into disengagement',()=>{
   expect(renewalHealthSignals(base,now).every(row=>row.level==='unknown')).toBe(true);
   const homework=[{at:'2026-09-01',submitted:false,score:null}];
   expect(renewalHealthSignals({...base,homework},now).find(row=>row.key==='homework')?.level).toBe('unknown');
 });
 it('flags repeated independent mastery for human challenge review',()=>{
   const checks=Array.from({length:5},()=>({at:'2026-09-01',status:'independent'}));
   expect(renewalHealthSignals({...base,checks},now).find(row=>row.key==='challenge')?.level).toBe('attention');
   expect(renewalHealthSignals({...base,checks:checks.slice(0,1)},now).find(row=>row.key==='challenge')?.level).toBe('unknown');
 });
 it('requires enough scores in both windows before judging a trend',()=>{
   const homework=[...Array.from({length:3},()=>({at:'2026-09-01',submitted:true,score:50})),...Array.from({length:3},()=>({at:'2026-08-01',submitted:true,score:80}))];
   expect(renewalHealthSignals({...base,homework},now).find(row=>row.key==='trend')).toMatchObject({level:'attention',count:-30});
   expect(renewalHealthSignals({...base,homework:homework.slice(0,4)},now).find(row=>row.key==='trend')?.level).toBe('unknown');
 });
 it('excludes future lessons from communication thresholds',()=>{
   const lessons=[{id:'one',at:'2026-10-01',attendance:null},{id:'two',at:'2026-10-02',attendance:null}];
   expect(renewalHealthSignals({...base,lessons},now).find(row=>row.key==='communication')?.level).toBe('unknown');
 });
});
