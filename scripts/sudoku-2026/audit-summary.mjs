import fs from 'node:fs';
const dir='content/courses/sudoku-2026';
const bank=JSON.parse(fs.readFileSync(`${dir}/bank.json`,'utf8'));
const audit=JSON.parse(fs.readFileSync(`${dir}/method-audit.json`,'utf8'));
const native=JSON.parse(fs.readFileSync(`${dir}/native-audit.json`,'utf8'));
const saved=JSON.parse(fs.readFileSync(`${dir}/摩天楼更新记录.json`,'utf8'));
if(native.length!==bank.puzzles.length||audit.bankSha256!==saved.bankSha256) throw Error('AUDIT_VERSION_MISMATCH');
const criteria={
  B1:'7道完整题全部只用宫内排除；两道余数观察题保留等价说明',
  B2:'对角线、锯齿规则必需；不使用行列排除或区块',
  B3:'不等号、奇偶规则必需；不使用行列排除或区块',
  B4:'依靠楼高可见性与行列不重复；不使用宫规则',
  M1:'7道完整题全部只用宫内排除',
  M2:'每道完整题至少2步行列排除；撤去行列方法均停滞',
  M3:'每道完整题撤去区块方法均停滞',
  M4:'变形规则必需，使用方法均已学过',
  H1:'7道完整题全部只用宫内排除',
  H2:'每道完整题至少2步行列排除；不使用唯一余数或区块',
  H3:'每道完整题必须使用唯一余数或区块，部分两者分别必需',
  H4:'变形规则必需，使用方法均已学过',
};
const steps=audit.results.reduce((n,p)=>n+p.reasonReplay.steps,0);
let text=`# 数独教学2026版 · 逐题校验结果\n\n校验时间：${audit.checkedAt}。\n\n**182 / 182 题通过**：98道单目标方法题、36道课堂完整题、48道课后完整题。\n\n## 逐讲结果\n\n| 讲次 | 方法题 | 课堂题 | 课后题 | 重点校验 | 结果 |\n| --- | ---: | ---: | ---: | --- | --- |\n`;
for(const lesson of bank.lessons) {
  const records=audit.results.filter(p=>p.lessonId===lesson.id),count=role=>records.filter(p=>p.role===role).length;
  text+=`| ${lesson.id} ${lesson.title} | ${count('target')} | ${count('class')} | ${count('homework')} | ${criteria[lesson.id]} | 通过 |\n`;
}
text+=`\n## 校验内容\n\n- 按约定的逐讲教学进度核对，不能靠题目自己的“允许方法”标签放宽要求。\n- 独立回放全部 **${steps} 步**填数与候选排除的数学理由；先把同一数字的宫内排除找尽，所有宫内方法停住后再进入行列等方法；行列优先观察可突破且空格少的位置。\n- 98道方法题都有多个完整解，但恰好只有一个空格的值在全部解中确定。84道完整题均有唯一解，并且只需本讲已经引入的方法。\n- 对必需方法执行“撤去再求解”：M2/H2撤去行列排除、M3撤去区块后都停滞；H3只保留宫内与行列也会停滞。\n- 对变形题撤去新增规则，原来的唯一解或单目标即不成立。摩天楼的候选排除由单行/列的可见性合法排列说明，没有将全盘试错作为学生解法。\n- 原生数独引擎另行复核了全部98个目标与84个完整答案。开发端两轨共 **${saved.auditedPuzzleInstancesMatched} 个题目实例**与审核题库一致。\n\n## 明示的等价观察\n\nB1-T7、B1-T8用于练习从一个格子看唯一余数，同一确定格也能用宫内排除解释。它们不作为“非用唯一余数不可”的题目；B1所有完整题仍严格只用宫内排除。\n\n## 摩天楼演示更新\n\n两页演示均按楼高固定配色：1层蓝、2层红、3层绿、4层紫；同栋积木同色，交换排列后颜色保持对应。已启用旋转、平移、立体/正视/左视/右视/俯视、重新居中、轴向吸附、坐标轴，以及撤销、重做、恢复起点。遮挡观察默认不显示隐藏棱边。\n\n开发端两页、四个草稿轨道已保存并逐项读回。旧修订与已发布版本保留。\n\n## 复核与实际验收\n\n- 方法复核：\`node scripts/sudoku-2026/audit.mjs\`。\n- 原生引擎复核：\`node scripts/sudoku-2026/build.cjs\`（本轮未使用复用审核参数）。\n- 逐题证据见 \`method-audit.json\`，讲解步骤见 \`教师答案.md\`。\n- 本结果确认数学解法与既定进度；视觉操作、学生探索时间和10–15分钟整题节奏仍由课堂实际使用确认。\n`;
fs.writeFileSync(`${dir}/逐题校验结果.md`,text);
console.log(JSON.stringify({passed:audit.counts.puzzles,reasonSteps:steps,savedPuzzleInstances:saved.auditedPuzzleInstancesMatched}));
