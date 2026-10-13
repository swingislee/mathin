import fs from 'node:fs';
import { specFrom } from './generate.mjs';

const dir='content/courses/sudoku-2026';
const bank=JSON.parse(fs.readFileSync(`${dir}/bank.json`,'utf8'));
const audit=JSON.parse(fs.readFileSync(`${dir}/method-audit.json`,'utf8'));
const names={box:'宫内排除',line:'行列排除',naked:'唯一余数',locked:'区块',extra:'附加规则排除'};
const families={classic:'标准数独',diagonal:'对角线数独',irregular:'锯齿数独',inequality:'不等号数独',parity:'奇偶数独',skyscraper:'摩天楼'};
const rules={classic:'每行、每列、每宫都填 1～N，各出现一次。',diagonal:'保留标准行、列、宫规则；两条虚线对角线也各含 1～N。',irregular:'每行、每列和粗线围成的每个不规则宫都各含 1～N。',inequality:'保留标准行、列、宫规则；尖端朝小数，开口朝大数。没有符号的位置无需比较大小。',parity:'保留标准行、列、宫规则；圆圈内填奇数，方框内填偶数；无标记格不限奇偶。',skyscraper:'每行每列各填 1～4，不设宫。边上的数表示从该边能看到几栋楼，高楼挡住后方矮楼。'};
const coord=(i,n)=>`${String.fromCharCode(65+Math.floor(i/n))}${i%n+1}`;
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function unit(p,kind,index) {
  if(kind==='row') return `${String.fromCharCode(65+index)} 行`;
  if(kind==='col') return `第 ${index+1} 列`;
  if(kind==='diagonal') return index?'右上至左下对角线':'左上至右下对角线';
  const cells=specFrom(p.size,p.rules).boxes[index];
  return `包含 ${coord(cells[0],p.size)} 的宫`;
}
function describe(p,s) {
  const at=i=>coord(i,p.size), removed=()=>s.removals.map(r=>`${at(r.index)} 去掉 ${r.digits.join('、')}`).join('；');
  if(s.method==='locked') return `【区块·${s.rule==='pointing'?'宫指向行列':'行列指向宫'}】${unit(p,s.unit,s.unitIndex)} 中的 ${s.value} 只在 ${s.cells.map(at).join('、')}，同属${unit(p,s.targetUnit,s.targetUnitIndex)}；${removed()}。`;
  if(s.removals) {
    if(s.rule==='inequality') return `【不等号】${s.cells.map(at).join(' < ')}；比较两边剩余数的大小，${removed()}。`;
    if(s.rule==='parity') return `【奇偶】按格内标记，${removed()}。`;
    if(s.rule==='visibility') return `【摩天楼】${unit(p,s.unit,s.unitIndex)} 两侧线索为 ${s.clues.map(v=>v||'未给').join(' / ')}；列举并筛选剩余数的合法排列，共 ${s.arrangements} 种，${removed()}。`;
    return `【附加规则】${removed()}。`;
  }
  if(s.method==='naked') return `【唯一余数】${at(s.index)} 排除 ${s.excluded.join('、')}，只剩 ${s.value}。${p.rules.kind==='classic'?'':'排除依据包含本题的附加规则。'}`;
  return `【${names[s.method]}】${unit(p,s.unit,s.unitIndex)} 中，${s.value} 只剩 ${at(s.index)} 可放，填 ${s.value}。`;
}
function gridText(p,values) {
  return '| |'+Array.from({length:p.size},(_,i)=>i+1).join('|')+'|\n|'+Array(p.size+1).fill('---').join('|')+'|\n'+Array.from({length:p.size},(_,r)=>`|${String.fromCharCode(65+r)}|${values.slice(r*p.size,(r+1)*p.size).map(v=>v||'·').join('|')}|`).join('\n');
}

let answers='# 数独教学 · 2026版 · 教师答案与逐步依据\n\n行用 A～I，列用 1～9；A1 在左上。锯齿宫用其左上起第一个格定位。此文件含全部 182 题答案，先让学生独立探索，再按需查看。\n\n完整题只有一个解。方法页盘面有多个完整解，但恰好一个空格在所有解中取同一个值；只要求找这个格，不能把其余格随意猜成唯一答案。\n\n完整题步骤严格执行“同数字宫内扫尽 → 换数 → 所有数字循环无进展 → 本课后续方法 → 回到宫内”。方法页按该页要练的方法展示。区块与附加规则中的删除是候选排除，不是直接填数。\n';
for (const lesson of bank.lessons) {
  answers+=`\n## ${lesson.id} ${lesson.level}第${lesson.number}讲 · ${lesson.title}\n`;
  for(const p of bank.puzzles.filter(p=>p.lessonId===lesson.id)) {
    const proof=audit.results.find(a=>a.id===p.id);
    answers+=`\n### ${p.id} · ${p.role==='target'?'方法探索/练习':p.role==='class'?'课堂完整题':'课后完整题'} · ${families[p.rules.kind]}\n\n${rules[p.rules.kind]}\n\n${p.role==='target'?`目标：**${coord(p.targets[0].index,p.size)} = ${p.targets[0].value}**；其他空格没有唯一确定值。`:gridText(p,p.solution)}\n\n`;
    if(p.equivalent) answers+='四宫等价观察题：同一目标也可以用宫内排除说明，本题用于比较“看数的位置”和“看格子的余数”，不宣称唯一余数必不可少。\n\n';
    answers+=p.trace.map((s,i)=>`${i+1}. ${describe(p,s)}`).join('\n')+'\n\n';
    answers+=`方法计数：${Object.entries(proof.counts).filter(([,v])=>v).map(([k,v])=>`${names[k]} ${v}`).join('；')}。`;
    if(p.role!=='target' && p.required?.length) answers+=` 必用性：分别禁用 ${p.required.map(m=>names[m]).join('、')} 后，允许的其余方法均不能完成。`;
    if(p.variantEssential) answers+=' 规则必用性：去掉本题附加规则后，完整题不再唯一，或方法页的目标不再确定。';
    answers+='\n';
  }
}
fs.writeFileSync(`${dir}/教师答案.md`,answers);

const guidance={
B1:['从图形排队转到数字：一行四个符号都不同。用空白盘试放，比较行、列、宫。','先展示 T1～T3，学生独立找“确定的一格”，老师追问为什么别的位置都不行。','六个宫内排除盘面把注意力固定在一个数字；T7、T8 改问“这个格子还能放什么”，比较等价解释。','只用宫内排除就能做完全部整题。四宫唯一余数作为观察视角，不安排伪造的“只能余数解”的完整题。'],
B2:['先问：在原来的规则之外，虚线可能表示什么？试填一组有冲突的数验证猜想。','对角线 T1、T2 后，换锯齿 T5、T6：学生沿粗线描出每宫，先数是否恰好四格。','归纳“改变了哪条规则、哪些规则保留”；再做其余单目标题。','四宫锯齿仍是四格一宫，不能沿原来的 2×2 小方块当作宫。对角线两条都生效。'],
B3:['出示不等号，学生用 1、2、3、4 排序，说明尖端与开口；只比较带符号的相邻两格。','不等号 T1、T2 与奇偶 T5、T6 先探索后归纳；让学生自己写出奇数集合与偶数集合。','让学生指出某格不能填什么，再回到宫内找位置，避免只盯新增符号。','奇偶标记是限制范围，不一定直接给答案；空白格没有奇偶限制。'],
B4:['用两组可转动积木场景，先猜再从一端低视角观察。数看到的楼栋，不数积木块。','学生搭 1、2、3、4 与 3、1、4、2，比较两侧分别看到 4/1 和 2/2 栋，再用数字替代模型。','边数 1 意味最高楼在最前；边数 4 意味从近到远依次 1、2、3、4。边数 2 或 3 保留多种可能，比较哪些位置真的确定。','单目标盘面刻意不使用直接确定一整行的边数 4。规则归纳时可用积木演示边数 4，完整题再综合使用四边线索；没有 2×2 宫规则。'],
M1:['空白六宫回顾 1～6 和每宫 2 行×3 列。','探索 T1～T3：选一个数字，在各宫间用同行、同列排除。','记录扫描顺序，填完一个数先继续找同数；同数没进展再换下一个数。','本讲所有课堂、课后整题只需宫内排除，不需候选数、行列排除或唯一余数。'],
M2:['先尽量做宫内排除，停住后让学生自己挑一条空格较少的行列。','六道行列排除目标题承担主教学；最后两道唯一余数题比较“一个数的位置”与“一个格的数字”。','归纳后让学生解释为什么整行只剩一个位置；每次填完回到宫内。','全部完整题都至少有两步行列排除；禁用行列排除时，即便保留唯一余数也会停滞。'],
M3:['给出不能直接确定值的候选范围，让学生先说明“这个数字只在这几格中”。','同在一个宫又同在一条线，讨论这条线其他地方还能不能放这个数。','既体验宫指向行列，也体验行列指向宫；先完整列出候选范围，再划掉外部候选。','所有完整题必需区块；盘面可能需要两次以上候选排除才产生一个确定值，不承诺每次排除立即填数。'],
M4:['按对角线、锯齿、不等号三个小组依次探索，各先两道方法页，规则只增加一类。','学生先提出规则，教师用一个冲突例确认；每组第三道留给独立尝试。','三个课堂完整题各体验一种变形；课后仍只使用已学基本方法与本题规则。','附加规则确实参与推理：去掉规则，整题会多解。'],
H1:['九宫不是新方法，先把 1～9 同数字扫描练得有序。','用提示很少的 T1～T3 培养确定性论证，盘面多解不影响目标唯一。','学生轮流说“哪个宫、哪个数、排除哪些行列”，不急着列满候选。','所有课堂、课后完整题仅用宫内排除即可完成。'],
H2:['先穷尽宫内排除，再比较各行各列空格数量。','八个目标盘面只在使用行列排除后才能确定一格。','每次突破后重新做宫内排除，避免学了新方法就跳过旧方法。','所有完整题至少两步行列排除，允许方法只含宫内与行列排除，不提前要求唯一余数或区块。'],
H3:['先让学生找一个格的剩余候选，再讨论一组候选位置带来的外部限制。','前四个目标盘面练唯一余数，后四个练区块；区块先说完整范围再排除。','完整题混合“余数必用”“区块必用”“两者分别必用”，不强求每道都必须同时出现两种。','每道完整题至少需要唯一余数或区块；分别撤去必需方法后验证会停滞。'],
H4:['保留九宫已学方法，比较对角线、锯齿、不等号三种常见变形。','各两道方法页先探索规则；归纳后每类一题独立练习。','三个完整题各覆盖一类规则；让学生圈出一个“只有新增规则才带来的突破”。','不追求竞赛高难技巧；规则可以改变，但每步仍须说明确定性依据。'],
};
let guide=`# 数独教学 · 2026版 · 教师用书\n\n全年独立课程，初阶四宫（1–2 年级）、中阶六宫（3–4 年级）、高阶九宫（5–6 年级）；各 4 讲，每讲 90 分钟。年级是建议范围，入阶也看学生已有数独经验。\n\n成品含 98 道稀疏单目标方法题、36 道课堂完整题、48 道课后完整题，原生组合课件共 239 页。课堂页以盘面、操作和短提问为主，教师说明集中在本手册。\n\n## 使用\n\n- 开发端课程入口见同目录“开发导入记录.json”；所有题目均为可编辑的原生数独组件。点击格子填数，可用行列宫高亮、候选、撤销和答案揭示；先留出探索时间再揭示。\n- 方法页只需要找到一个确定数，其他空格可以留白；“完成目标”不等于填满盘面。教师演示空白页不判断通关。\n- 摩天楼的积木场景可旋转观察；从行列尽头降低视角才能比较遮挡。抽象盘面四侧数字就是该方向看到的楼数。\n- “课后练习.html”可按 A4 打印，每讲四题；“教师答案.md”含全部题目的逐步理由。“method-audit.json”保留机器方法证据。\n\n## 90 分钟组织\n\n| 分钟 | 环节 | 教师动作 |\n| --- | --- | --- |\n| 0–8 | 规则热身/回顾 | 试放、指出冲突；摩天楼搭楼并换边看 |\n| 8–22 | 自主探索 | 方法页先独立看，再两人交换依据 |\n| 22–30 | 观察归纳 | 学生说方法，教师用高亮工具整理 |\n| 30–40 | 方法练习 | 其余目标题独立尝试，一题一句理由 |\n| 40–45 | 休息 | 起身、看远处 |\n| 45–58 | 课堂 C1 | 独立完整题，13 分钟 |\n| 58–63 | 交流一次突破 | 展示不同的确定性解释 |\n| 63–76 | 课堂 C2 | 独立完整题，13 分钟 |\n| 76–86 | 课堂 C3 | 综合应用，10 分钟 |\n| 86–90 | 离堂说明与作业 | 说清本课方法，布置 H1～H4 |\n\n探索页是问题池。不同班级可把交流集中到 2～3 个代表盘面，其余快速独立判断；保留 10～15 分钟完整题时间。以上为排课预算，实际速度与教学手感仍需课堂试用；学生未完成时保留推理记录，不用猜数赶进度。课后四题可分两次完成。\n\n## 方法进度与审核口径\n\n“宫内排除”=一个数字在一宫只剩一个位置；“行列排除”=一个数字在一行/列只剩一个位置；“唯一余数”=一个格只剩一个候选；“区块”=宫与行列的候选位置交集带来外部排除。\n\n完整题优先顺序：同数字逐宫扫尽 → 换数 → 全部数字循环到无进展 → 优先检查空格少的行列 → 本课允许的余数/区块/附加规则 → 有进展就回到宫内。变形规则是合法候选的组成部分，始终生效。\n\n第一讲各阶 7 道完整题全部宫内排除可解。M2、H2 的 7 道完整题每题至少两步行列排除，撤去行列方法会停滞。M3 每题必用区块。H3 每题必用唯一余数或区块，部分题两种分别必需。变形题移除新增规则后不再满足原目标。\n\n四宫特别说明：枚举 12 个首行规范终盘的部分盘面，去重得到 721584 个代表盘面，其中 565820 个唯一解盘面均可只用宫内排除完成；数字重命名覆盖其他盘面。因此初阶第 2、3 讲改为四种变形，不把行列排除包装成四宫必用技巧。B1 的两个余数方法页用于等价观察，已在答案中明示。复核脚本 check-four.mjs，证据 four-exhaustive.json。\n\n“必用”指按本课程明确定义的方法集合穷尽推理后必须引入该方法；不声称排除了所有可能的人工替代证明。单目标页逐一检查所有空格的所有可行数字，恰好一个格在全体解中固定；完整题独立精确求解确认唯一。\n\n## 逐讲教案\n`;
for(const l of bank.lessons) {
 const ps=bank.puzzles.filter(p=>p.lessonId===l.id);
 guide+=`\n### ${l.id} ${l.level}第 ${l.number} 讲 · ${l.title}\n\n目标：${l.focus}。\n\n${guidance[l.id].map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\n课堂完整题：${ps.filter(p=>p.role==='class').map(p=>`${p.id}（${families[p.rules.kind]}）`).join('、')}。\n\n课后：${ps.filter(p=>p.role==='homework').map(p=>`${p.id}（${families[p.rules.kind]}）`).join('、')}。每题圈出一次本课方法，写一句“因为……所以……”。\n`;
}
guide+=`\n## 参考取舍\n\n| 资料 | 采用什么 | 原因与调整 |\n| --- | --- | --- |\n| D:/gezhi/2026-10-13_数独课 的初/中/高阶示例、标准数独练习与解析 | 用于识别题型和表达习惯 | 原题未按本课严格方法进度分层，正式题库重新生成，逐题保存方法证据，不把参考题答案当作方法合格证明 |\n| W:/你拍一/课件/1年级第24讲 四宫数独（上/下） | 从图形到数字、先理解行列宫 | 降低符号门槛；原课从密到疏的大量整题改为稀疏单目标探索，再完成整题 |\n| W:/你拍一/课件/1年级第25讲 六宫数独（上/下） | 四宫到六宫的规则迁移 | 保留 1～6 与 2×3 宫的观察，按宫内→行列/余数→区块重组，不沿用混合方法整题顺序 |\n| W:/你拍一/课件/1年级第26讲 锯齿数独（上/下） | 宫形改变而数量与不重复规则保留 | 用粗边界逐宫描画；跳过原课五宫，保持用户指定的 4/6/9 三阶结构 |\n| W:/你拍一/课件/2年级第04讲 数塔游戏（上/下）及研前案 | 搭楼→两端观察→数字代替→四宫平面；区分确定与不确定 | 摩天楼最关键是视角与遮挡。保留实物与两侧比较，去掉不相关乘法热身、套用的目标文案和把试猜作为主要解法的安排 |\n| HoDoKu 官方方法说明 | 校对 Hidden Single / Naked Single 与 Pointing / Claiming 的定义 | 只参考方法分类，不复制其题盘；题库遵从本课“宫内优先”节奏 |\n\n方法资料：[HoDoKu Singles](https://hodoku.sourceforge.net/en/tech_singles.php)、[Locked Candidates](https://hodoku.sourceforge.net/en/tech_intersections.php)。\n\n## 交付状态\n\n- 机器检查：182 道逐题审核通过；独立原生引擎再次验证目标与答案；应用定向合同测试通过。\n- 开发端：导入后记录课程与讲次入口，采用可编辑草稿，未冻结正式发布版本。\n- 待产品负责人确认：年级适配、探索时间、投屏字号、每讲三道完整题的实际完成速度。课堂效果尚未宣称验收。\n`;
fs.writeFileSync(`${dir}/教师用书.md`,guide);

function svg(p) {
 const n=p.size,c=38,pad=24,size=n*c+2*pad,at=(r,k)=>pad+(k+.5)*c;
 const line=(x1,y1,x2,y2,w=1,extra='')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#293b37" stroke-width="${w}" ${extra}/>`;
 const txt=(x,y,s,fs=21)=>`<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-family="Arial,sans-serif">${esc(s)}</text>`;
 let out=`<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${p.id} 题盘"><rect width="${size}" height="${size}" fill="white"/>`;
 const spec=specFrom(n,p.rules), region=spec.regions;
 if(p.rules.kind==='diagonal') out+=line(pad,pad,pad+n*c,pad+n*c,2,'stroke-dasharray="5 4" opacity=".45"')+line(pad+n*c,pad,pad,pad+n*c,2,'stroke-dasharray="5 4" opacity=".45"');
 for(let r=0;r<n;r++) for(let k=0;k<n;k++) {
   const i=r*n+k,x=pad+k*c,y=pad+r*c,par=p.rules.kind==='parity'?p.rules.cells[i]:0;
   if(par===1) out+=`<circle cx="${x+c/2}" cy="${y+c/2}" r="${c*.38}" fill="none" stroke="#a5aaa8"/>`;
   if(par===2) out+=`<rect x="${x+c*.14}" y="${y+c*.14}" width="${c*.72}" height="${c*.72}" fill="none" stroke="#a5aaa8"/>`;
   out+=line(x,y,x+c,y,r===0||region&&region[i]!==region[i-n]?3:0.7);
   out+=line(x,y,x,y+c,k===0||region&&region[i]!==region[i-1]?3:0.7);
   if(p.puzzle[i]) out+=txt(x+c/2,y+c/2,p.puzzle[i]);
 }
 out+=line(pad,pad+n*c,pad+n*c,pad+n*c,3)+line(pad+n*c,pad,pad+n*c,pad+n*c,3);
 if(p.rules.kind==='inequality') for(const [a,b] of p.rules.lessThan) {
   const ax=at(0,a%n),ay=at(0,Math.floor(a/n)),bx=at(0,b%n),by=at(0,Math.floor(b/n)),x=(ax+bx)/2,y=(ay+by)/2;
   out+=`<rect x="${x-7}" y="${y-8}" width="14" height="16" fill="white"/>`+txt(x,y,ay===by?(ax<bx?'‹':'›'):(ay<by?'⌃':'⌄'),21);
 }
 if(p.rules.kind==='skyscraper') for(let k=0;k<n;k++) {
   if(p.rules.top[k]) out+=txt(at(0,k),pad/2,p.rules.top[k],18);
   if(p.rules.bottom[k]) out+=txt(at(0,k),size-pad/2,p.rules.bottom[k],18);
   if(p.rules.left[k]) out+=txt(pad/2,at(0,k),p.rules.left[k],18);
   if(p.rules.right[k]) out+=txt(size-pad/2,at(0,k),p.rules.right[k],18);
 } else for(let k=0;k<n;k++) out+=txt(at(0,k),pad/2,k+1,11)+txt(pad/2,at(0,k),String.fromCharCode(65+k),11);
 return out+'</svg>';
}
let html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>数独教学 2026版 · 课后练习</title><style>
*{box-sizing:border-box}body{font-family:"Microsoft YaHei",sans-serif;color:#243d38;margin:0;background:#eee}main{max-width:210mm;margin:auto}.sheet{width:210mm;min-height:297mm;padding:10mm 12mm;background:white;margin:12px 0;break-after:page}h1{font-size:20px;margin:0 0 5px}header p{font-size:12px;margin:5px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm 7mm;margin-top:6mm}.card{break-inside:avoid}.card h2{font-size:13px;margin:0}.card p{font-size:10px;height:9mm;margin:4px 0;line-height:1.45}.card svg{display:block;width:100%;height:82mm}.reason{border-bottom:1px solid #aaa;height:11mm;font-size:10px;padding-top:3mm}.footer{font-size:10px;margin-top:7mm}nav{padding:16px;text-align:center}button{padding:10px 20px}@page{size:A4;margin:0}@media print{body{background:white}.sheet{margin:0}nav{display:none}} </style><nav><button onclick="window.print()">打印 12 讲课后练习（A4）</button><p>每讲四题，共 48 题。答案见教师答案.md。</p></nav><main>`;
for(const l of bank.lessons) {
 const grade=l.level==='初阶'?'1–2':l.level==='中阶'?'3–4':'5–6';
 html+=`<section class="sheet"><header><h1>${l.level}第 ${l.number} 讲 · ${l.title}</h1><p>数独教学 2026版 · ${grade} 年级 · ${l.n}×${l.n}　姓名：____________　日期：____________</p><p>独立完成。每题标记一次本课方法，写一句“因为……所以……”。</p></header><div class="grid">`;
 for(const p of bank.puzzles.filter(p=>p.lessonId===l.id&&p.role==='homework')) html+=`<article class="card"><h2>${p.id} · ${families[p.rules.kind]}</h2><p>${rules[p.rules.kind]}</p>${svg(p)}<div class="reason">我的一次突破：_________________________</div></article>`;
 html+='</div><p class="footer">遇到停滞就圈出位置，记下已经排除的数字；留待课堂交流。四道题可分两次完成。</p></section>';
}
fs.writeFileSync(`${dir}/课后练习.html`,html+'</main></html>');
console.log('Teacher guide, all 182 worked answers and 48 printable homework puzzles generated.');
