import fs from "node:fs";
import { createEmptyCoursewareCompositionPage, type CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { createCoursewareInsertedNode } from "@/features/courseware-doc/courseware-inserted-node";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";
import { sudokuVariantPayloadSchema, type SudokuVariantPayload } from "@/features/games/sudoku/courseware-contract";
import { getSudokuVariant, type SudokuSize, type SudokuVariantId } from "@/features/games/sudoku/variant";
import { sudokuRulesValid, type SudokuVariantRules } from "@/features/games/sudoku/rules";
import { forcedSudokuCellValue } from "@/features/games/sudoku/logic";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

type Puzzle = { id:string; lessonId:string; role:"target"|"class"|"homework"; number:number; size:SudokuSize; puzzle:number[]; rules:SudokuVariantRules; targets?:Array<{index:number;value:number}>; method?:string; allowed:string[]; solution?:number[] };
type Lesson = { id:string; level:string; n:SudokuSize; number:number; title:string; focus:string; families?:string[]; allowed:string[] };
type Bank = { version:number; title:string; lessons:Lesson[]; puzzles:Puzzle[] };
export type NativeLesson = Lesson & {pages:Array<{title:string;kind:string;puzzleId?:string;doc:CoursewareCompositionPage}>};

const colors = { paper:"#fffdf7",ink:"#243d38",accent:"#a35a31" };
const familyNames:Record<string,string> = {classic:"标准数独",diagonal:"对角线数独",irregular:"锯齿数独",inequality:"不等号数独",parity:"奇偶数独",skyscraper:"摩天楼"};
const familyRule:Record<string,string> = {
  classic:"每行、每列、每宫\n1～N 各出现一次。",
  diagonal:"每行、每列、每宫不重复。\n两条虚线对角线也不重复。",
  irregular:"每行、每列不重复。\n粗线围出的每个宫\n也各含 1～N。",
  inequality:"保留行、列、宫规则。\n尖端朝小数，开口朝大数。\n没有符号的相邻格无需比较大小。",
  parity:"保留行、列、宫规则。\n圆圈填奇数；方框填偶数。\n没有标记的格子不限奇偶。",
  skyscraper:"每行每列填 1～4。\n边数是看到的楼数。\n高楼挡住后面的矮楼。\n这里没有宫规则。",
};
const methodPrompt:Record<string,string> = {
  box:"先选一个数字。\n在哪些宫还没出现？\n用同行、同列的数排除。\n哪个宫只剩一个位置？",
  line:"宫里都暂时找不到。\n先看空格少的行或列。\n它缺哪个数字？\n哪个位置能放这个数？",
  naked:"先看一个格子。\n行、列、宫排除了哪些数？\n还剩哪一个？\n请说出排除的依据。",
  locked:"一个数还落在两格中。\n它们同在一行或一列吗？\n这条线上哪里不能再填它？\n排除后，哪里能确定？",
};
const methodSummary:Record<string,string> = {
  B1:"一个数字，逐宫找。\n能继续，就继续找它；再换数。\n所有数字都停住，再看格子缺什么。\n同一格可能有不止一种解释。",
  M1:"选定数字 → 扫过所有宫。\n同一个数字能找的都找完，再换数。\n这一讲，宫内排除就能完成整题。",
  H1:"宫内排除：确定一个数的位置。\n同数字扫尽，再换数字；循环检查。\n填入新数后，原来卡住的宫可能有突破。",
  M2:"先把宫内排除做尽。\n再看空格少的行、列：一个数只剩哪一格？\n也可看一个格：只剩哪个数？\n有进展，马上重新逐宫扫描。",
  H2:"宫内都停住 → 比较行列。\n优先观察空格少的行列。\n一个数只剩一个位置，就能确定。\n填完，回到宫内排除。",
  M3:"宫中的候选位置同在一条线，\n这条线在宫外就不能再放这个数。\n反过来，行列内候选同在一宫，也能排除。\n先画范围，再排除，最后回到基础方法。",
  H3:"唯一余数：一个格，只剩一个数。\n区块：一组位置虽未定，也能排除别处。\n每次突破后，先回到同数字逐宫扫描。\n候选范围未找全，不能使用区块。",
};
function addText(doc:CoursewareCompositionPage,id:string,text:string,column:number,row:number,columnSpan:number,rowSpan:number,fontSize=28,color=colors.ink) {
  const node=createCoursewareInsertedNode("text",doc.overlay.nodes.length,doc.canvas,id);
  node.content={kind:"text",text};
  node.transform={...node.transform,x:column*80+16,y:row*80+14,width:columnSpan*80-32,height:rowSpan*80-28};
  node.style={...node.style,fontSize,color,fontWeight:row===0?600:400,lineHeight:1.5};
  doc.overlay.nodes.push(node);
  doc.layout.blocks.push({id:`tile-${id}`,type:"node",nodeId:id,placement:{column,row,columnSpan,rowSpan}});
}
function pageBase(title:string) {
  const doc=createEmptyCoursewareCompositionPage(); doc.canvas.backgroundColor=colors.paper;
  addText(doc,"heading",title,0,0,12,1,32); return doc;
}
function textPage(title:string,body:string,footer:string) {
  const doc=pageBase(title), long=body.split('\n').length>8;
  addText(doc,"body",body,1,long?1:2,10,long?7:5,long?24:36);
  addText(doc,"footer",footer,1,long?8:7,10,1,23,colors.accent); return doc;
}
export function puzzlePayload(p:Puzzle):SudokuVariantPayload {
  return sudokuVariantPayloadSchema.parse({kind:"authored-variant",variantId:`${p.rules.kind}-${p.size}x${p.size}`,puzzle:p.puzzle,rules:p.rules,
    goal:p.role==="target"?{kind:"teaching-target",targets:p.targets!.map(t=>({kind:"cell-value",...t}))}:{kind:"full-solution",requireUnique:true},
    display:{showCoordinates:true,allowCandidates:p.size!==4,allowAnswerReveal:true,showTeachingTools:true}});
}
function gamePage(title:string,payload:SudokuVariantPayload,prompt:string) {
  const doc=pageBase(title);
  const trusted=validateGameCoursewareContent("sudoku","sudoku-authored-v3",payload);
  if (!trusted.validation.publishable) throw Error(`${title}: ${trusted.validation.code}`);
  doc.layout.blocks.push({id:"sudoku",type:"game",placement:{column:0,row:1,columnSpan:9,rowSpan:8},game:{docVersion:"game-page-v1",canvas:{width:960,height:720,backgroundColor:null},gameId:"sudoku",contentVersion:"sudoku-authored-v3",...trusted}});
  addText(doc,"prompt",prompt,9,1,3,8,23);
  return doc;
}
function towersPage(heights:number[]) {
  const doc=pageBase("先搭一排楼，再换边看看");
  const cubes=heights.flatMap((height,i)=>Array.from({length:height},(_,y)=>({x:i*2,y,z:0})));
  const tool=createCubeCoursewareTool({name:`楼高 ${heights.join('、')}`,snapshot:cubeDraftSnapshot(createCubeSession(cubes),0)},"current",["orbit"]);
  doc.layout.blocks.push({id:"towers",type:"tool",tool,placement:{column:0,row:1,columnSpan:9,rowSpan:8}});
  addText(doc,"prompt",`楼高\n${heights.join('、')}\n\n先猜看到几栋。\n转到一端，降低视角；\n再换到另一端。\n\n数的是楼栋，\n不是积木块。`,9,1,3,8,23);
  return doc;
}
export function buildNativeCourse(previousAudit?:Array<{id:string;payloadHash:string}>):{title:string;lessons:NativeLesson[];nativeAudit:unknown[]} {
  const bank:Bank=JSON.parse(fs.readFileSync("content/courses/sudoku-2026/bank.json","utf8"));
  const nativeAudit:unknown[]=[];
  for (const p of bank.puzzles) {
    const payload=puzzlePayload(p), variant={...getSudokuVariant(payload.variantId)!,rules:payload.rules};
    if (!sudokuRulesValid(variant)) throw Error(`${p.id}: invalid native rules`);
    const checked=validateGameCoursewareContent("sudoku","sudoku-authored-v3",payload);
    if (!checked.validation.publishable) throw Error(`${p.id}: native validator ${checked.validation.code}`);
    const verifiedEarlier=previousAudit?.some(a=>a.id===p.id && a.payloadHash===checked.validation.payloadHash);
    if (!verifiedEarlier && p.role==="target") {
      const forced=p.puzzle.flatMap((v,i)=>v?[]:(()=>{const value=forcedSudokuCellValue(p.puzzle,i,variant);return value===null?[]:[{index:i,value}];})());
      if(JSON.stringify(forced)!==JSON.stringify(p.targets)) throw Error(`${p.id}: native forced-cell mismatch`);
    } else if (!verifiedEarlier) {
      const details=checked.validation.details as {puzzle:{solution:number[]}};
      if (JSON.stringify(details.puzzle.solution)!==JSON.stringify(p.solution)) throw Error(`${p.id}: independent solution mismatch`);
    }
    nativeAudit.push({id:p.id,variantId:payload.variantId,code:checked.validation.code,payloadHash:checked.validation.payloadHash});
  }
  const lessons=bank.lessons.map((lesson):NativeLesson=>{
    const puzzles=bank.puzzles.filter(p=>p.lessonId===lesson.id), targets=puzzles.filter(p=>p.role==="target");
    const pages:NativeLesson["pages"]=[];
    const push=(title:string,kind:string,doc:CoursewareCompositionPage,puzzleId?:string)=>pages.push({title,kind,puzzleId,doc:formalManualPageSchema.parse(doc)});
    push(`${lesson.level} ${lesson.number} · ${lesson.title}`,"opening",textPage(`${lesson.level}第 ${lesson.number} 讲 · ${lesson.title}`,`${lesson.focus}\n\n先探索  →  一起归纳  →  独立试一试`,"90 分钟 · 数独教学 2026版"));
    if (lesson.id==="B4") for (const h of [[1,2,3,4],[3,1,4,2]]) push(`楼高 ${h.join('、')}：两边分别看到几栋？`,"manipulative",towersPage(h));
    else {
      const first=targets[0], payload={...puzzlePayload(first),puzzle:Array(lesson.n**2).fill(0),goal:{kind:"teacher-led" as const},display:{showCoordinates:true,allowCandidates:false,allowAnswerReveal:false,showTeachingTools:true}};
      // Start standard method lessons with familiar rules. Variant rules are
      // discovered through the sparse annotated boards below.
      if (!lesson.families) {
        payload.rules={kind:"classic"}; payload.variantId=`classic-${lesson.n}x${lesson.n}` as SudokuVariantId;
        push("热身 · 规则由我们说清楚","warmup",gamePage("热身 · 规则由我们说清楚",payload,`试着在一行填数。\n哪些放法会冲突？\n\n${familyRule.classic}\n\n完整填满不是此页任务。`));
      }
    }
    const exploratory=new Set(lesson.families?lesson.families.flatMap(f=>targets.filter(p=>p.rules.kind===f).slice(0,lesson.families!.length===1?3:2).map(p=>p.id)):targets.slice(0,3).map(p=>p.id));
    const addTarget=(p:Puzzle,stage:string)=>push(`${stage} ${p.id} · ${familyNames[p.rules.kind]}`,"target",gamePage(`${stage} ${p.id} · 哪个空格能确定？`,puzzlePayload(p),`${p.rules.kind==='classic'?(stage==='探索'?'先自己观察。\n找到后，说出为什么。\n还有别的格能确定吗？':methodPrompt[p.method!]):familyRule[p.rules.kind]}\n\n这页只找确定的数。\n其余空格可以暂时留白。`),p.id);
    for(const p of targets.filter(p=>exploratory.has(p.id))) addTarget(p,"探索");
    const summary=lesson.families?lesson.families.map(f=>`${familyNames[f]}\n${familyRule[f]}`).join('\n\n'):methodSummary[lesson.id];
    push("一起归纳 · 刚才用了什么线索？","summary",textPage("一起归纳 · 刚才用了什么线索？",summary,"先让学生说；再用突出行、列、宫的工具整理依据。"));
    for(const p of targets.filter(p=>!exploratory.has(p.id))) addTarget(p,"练一练");
    push("休息 5 分钟","break",textPage("休息 5 分钟","起身活动，看看远处。\n回来后，完成属于自己的整题。","先想好：我准备按什么顺序找数？"));
    for(const p of puzzles.filter(p=>p.role==="class")) push(`完整挑战 ${p.id} · ${p.number===3?'10':'13'} 分钟`,"class",gamePage(`完整挑战 ${p.id} · ${familyNames[p.rules.kind]}`,puzzlePayload(p),`${p.number===3?'10':'13'} 分钟\n\n${p.rules.kind==='classic'?'同一数字逐宫找尽。\n全停住，再用本课方法。\n填完后重新扫描。':familyRule[p.rules.kind]}\n\n圈出一次突破。\n完成后向同伴解释。`),p.id);
    push("离开前 · 说清一次突破","reflection",textPage("离开前 · 说清一次突破","今天我用到的一条线索是……\n\n它能确定这个数，因为……\n\n我还想比较两种解法。","课后四题：每题圈出或标记一次本课方法，并写一句理由。"));
    for(const p of puzzles.filter(p=>p.role==="homework")) push(`课后 ${p.id} · ${familyNames[p.rules.kind]}`,"homework",gamePage(`课后 ${p.id} · ${familyNames[p.rules.kind]}`,puzzlePayload(p),`${familyRule[p.rules.kind]}\n\n先独立完成。\n圈出一次本课方法。\n写一句“因为……所以……”。\n\n遇到停滞，标记位置，\n留待下次一起讨论。`),p.id);
    return {...lesson,pages};
  });
  return {title:bank.title,lessons,nativeAudit};
}
