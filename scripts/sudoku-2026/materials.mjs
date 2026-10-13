import fs from 'node:fs';
import { LESSONS } from './lessons.mjs';
import { TAUGHT } from './generate.mjs';
import { specFrom, unitName, lineName, cellLabel } from './generators.mjs';
import { explainSteps } from '../lib/sudoku-curriculum.mjs';

const dir = 'content/courses/sudoku-2026';
const bank = JSON.parse(fs.readFileSync(`${dir}/bank.json`, 'utf8'));
const audit = JSON.parse(fs.readFileSync(`${dir}/method-audit.json`, 'utf8'));
const pkg = JSON.parse(fs.readFileSync('.tmp/sudoku-2026/course-package.json', 'utf8'));
const receipt = fs.existsSync(`${dir}/开发导入记录.json`) ? JSON.parse(fs.readFileSync(`${dir}/开发导入记录.json`, 'utf8')) : null;
const byId = new Map(bank.puzzles.map(p => [p.id, { ...p, explained: explainSteps(p.puzzle, specFrom(p.size, p.rules), p.trace) }]));
const LEVEL_TEXT = { 初阶: '四宫', 中阶: '六宫', 高阶: '九宫' };
const FAMILY = { classic: '标准数独', diagonal: '对角线数独', window: '窗口数独', irregular: '锯齿数独', inequality: '不等号数独', parity: '奇偶数独', skyscraper: '摩天楼' };
const METHOD = { box: '宫内排除', line: '行列排除', naked: '唯一余数', locked: '区块', extra: '变形规则' };
const RELATION = { row: '同行', col: '同列', box: '同宫', diagonal: '同在虚线', window: '同在窗口' };
const SIDE = { left: '左边', right: '右边', top: '上边', bottom: '下边' };
const RULE_NAME = { parity: '单双数', inequality: '不等号', 'sky-limit': '边数', locked: '区块' };
const CJK = /[㐀-鿿]/;
const fill = (template, words) => (template ?? '').replace(/\{(\w+)\}/g, (match, key, offset, source) => {
  if (words[key] === undefined) throw new Error(`missing ${key} in ${template}`);
  let value = String(words[key]);
  if (CJK.test(source[offset - 1] ?? '') && /^[A-Za-z0-9]/.test(value)) value = ` ${value}`;
  if (CJK.test(source[offset + match.length] ?? '') && /[A-Za-z0-9]$/.test(value)) value = `${value} `;
  return value;
});
const oneLine = s => (s ?? '').replaceAll('\n', ' / ');
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** One step in words a teacher can say aloud: which cells were closed and by what. */
function describe(p, step, explained) {
  const n = p.size, spec = specFrom(n, p.rules), at = i => cellLabel(i, n);
  const blocked = reasons => {
    const parts = [], occupied = reasons.filter(r => r.kind === 'occupied').map(r => at(r.cell));
    if (occupied.length) parts.push(`${occupied.join('、')} 已有数`);
    const groups = new Map();
    for (const r of reasons.filter(r => r.by !== undefined)) groups.set(`${r.by}:${r.kind}`, [...groups.get(`${r.by}:${r.kind}`) ?? [], r.cell]);
    for (const [key, cells] of groups) { const [by, kind] = key.split(':'); parts.push(`${cells.map(at).join('、')} 被 ${at(+by)}（${RELATION[kind]}）挡住`); }
    const removed = reasons.filter(r => r.kind === 'removed').map(r => `${at(r.cell)}（已被${RULE_NAME[r.rule] ?? '前面的推理'}划掉）`);
    if (removed.length) parts.push(removed.join('、'));
    return parts.join('；');
  };
  if (step.method === 'naked') {
    const parts = explained.reasons.map(r => r.kind === 'removed' ? `${r.digit}（已被${RULE_NAME[r.rule] ?? '前面的推理'}划掉）` : `${r.digit}（${RELATION[r.kind]} ${at(r.by)}）`);
    return `【唯一余数】${at(step.index)}：排除 ${parts.join('、')}，只剩 ${step.value}。`;
  }
  if (!step.removals && ['box', 'line'].includes(step.method) || step.rule === 'region') {
    const label = step.method === 'box' ? '宫内排除' : step.method === 'line' ? (p.family === 'skyscraper' ? '行列补齐' : '行列排除') : '区域排除';
    return `【${label}】${unitName(spec, step.unit, step.unitIndex, p.rules)}里的 ${step.value}：${blocked(explained.reasons)}；只剩 ${at(step.index)}，填 ${step.value}。`;
  }
  if (step.method === 'locked') {
    const from = unitName(spec, step.unit, step.unitIndex, p.rules), to = unitName(spec, step.targetUnit, step.targetUnitIndex, p.rules);
    return `【区块·${step.rule === 'pointing' ? '宫 → 线' : '线 → 宫'}】${from}里的 ${step.value} 只在 ${step.cells.map(at).join('、')}，都在${to}；所以 ${step.removals.map(r => at(r.index)).join('、')} 不能放 ${step.value}。`;
  }
  const removed = () => step.removals.map(r => `${at(r.index)} 去掉 ${r.digits.join('、')}`).join('；');
  if (step.rule === 'parity') return `【单双数】${at(step.cells[0])} 是${step.parity === 1 ? '圆圈（单数）' : '方框（双数）'}：${removed()}。`;
  if (step.rule === 'inequality') return `【不等号】${at(step.cells[0])} < ${at(step.cells[1])}：${removed()}。`;
  const where = `${lineName(n, step.unit, step.unitIndex)}${SIDE[step.side]}`;
  if (step.rule === 'sky-one') return `【边数 1】${where}是 1：最前面的 ${at(step.index)} 是 4 层。`;
  if (step.rule === 'sky-full') return `【边数 4】${where}是 4：${at(step.index)} 是 ${step.value} 层。`;
  if (step.rule === 'sky-limit') return `【边数 ${step.clue}】${where}是 ${step.clue}：前面的楼不能太高，${removed()}。`;
  throw new Error(`${p.id}: cannot describe ${step.method}/${step.rule}`);
}

const FOCUS = { B1: ['box'], B2: ['box', 'extra'], B3: ['extra'], B4: ['extra'], M1: ['box'], M2: ['line', 'naked'], M3: ['locked'], M4: ['extra'], H1: ['box'], H2: ['line'], H3: ['naked', 'locked'], H4: ['extra'] };
/** Key breakthroughs: lesson-method steps (or the narrowest moments in box-only lessons). */
function keySteps(p) {
  const focus = FOCUS[p.lessonId], list = [];
  let placement = -1;
  p.trace.forEach((s, i) => {
    if (!s.removals) placement++;
    const narrow = !s.removals && p.profile.available[placement] <= 1;
    const lessonMethod = focus.includes(s.method) && !(['B1', 'M1', 'H1'].includes(p.lessonId)) || p.explained[i].variantUse;
    if (lessonMethod || (['B1', 'M1', 'H1', 'B2'].includes(p.lessonId) && narrow)) list.push(i);
  });
  return list.slice(0, 6);
}
const grid = (p, values) => `| |${Array.from({ length: p.size }, (_, i) => i + 1).join('|')}|\n|${Array(p.size + 1).fill('---').join('|')}|\n${Array.from({ length: p.size }, (_, r) => `|${String.fromCharCode(65 + r)}|${values.slice(r * p.size, (r + 1) * p.size).map(v => v || '·').join('|')}|`).join('\n')}`;

// ---------- 教师用书 ----------
const total = pkg.lessons.reduce((n, l) => n + l.pages.length, 0);
const roleCount = role => bank.puzzles.filter(p => p.role === role).length;
let guide = `# 数独教学 · 2026版 · 教师用书

全年课程：初阶四宫（1–2 年级）、中阶六宫（3–4 年级）、高阶九宫（5–6 年级），每阶 4 讲，每讲 90 分钟。年级是建议范围，入阶也看学生已有的数独经验。

共 ${total} 页课件：${roleCount('discover')} 张规则发现盘、${roleCount('target')} 张方法页、${roleCount('class')} 道课堂整题、${roleCount('homework')} 道课后题。所有题目都是可操作的原生数独组件。

## 上课怎么用

- 每讲按“发现规则 → 探索 → 一起说 → 方法卡 → 练一练 → 策略页 → 完整挑战 → 小结”推进。探索页先让学生独立找，再两人交换理由；**一起说**页和**方法卡**分开，先让学生说，再翻出方法卡。
- 方法页只要求找到页面问的格子，其他空格可以留白。棋盘上有行、列、宫高亮和答案揭示；揭示前先留出探索时间。
- 学生页只有短提问。提问链、预期回答、常见错误都在本手册的逐页说明里；答案和每一步理由在“教师答案.md”。
- 解题顺序贯穿全课：**同一个数字逐宫找到底 → 换下一个数字 → 全停住，看空格少的行列 → 看邻居多的格子 → 区块 → 每填一个数回到宫内排除**。每讲只用到已经学过的部分。
- 完整挑战按由易到难排列；时间是按本级学生估的，第一次试课请记下实际完成时间，再调整题量。

## 方法进度

| 讲次 | 本讲内容 | 整题可用方法 | 整题要求 |
| --- | --- | --- | --- |
${LESSONS.map(l => `| ${l.id} ${l.title} | ${l.goal.split('；')[0]} | ${TAUGHT[l.id].map(m => l.id === 'B4' && m === 'line' ? '行列补齐' : METHOD[m]).join('、')} | ${l.required ? `必须用到${l.required.map(m => METHOD[m]).join('、')}${l.minRequired ? `（至少 ${l.minRequired} 次）` : ''}` : l.id === 'H3' ? '每题分别必须用到唯一余数或区块' : l.allowed.includes('extra') ? '新规则必须参与推理' : '只用宫内排除'} |`).join('\n')}

## 逐讲教案
`;
for (const lesson of LESSONS) {
  const built = pkg.lessons.find(l => l.id === lesson.id), pageNo = key => lesson.pages.findIndex(p => p.key === key) + 1;
  guide += `\n### ${lesson.id} ${lesson.level}第 ${lesson.number} 讲 · ${lesson.title}（${lesson.grades} 年级 · ${LEVEL_TEXT[lesson.level]}）\n\n目标：${lesson.goal}\n\n共 ${built.pages.length} 页。\n\n| 分钟 | 环节 | 页 |\n| --- | --- | --- |\n`;
  for (const [minutes, label, from, to] of lesson.schedule) guide += `| ${minutes} | ${label} | ${from ? (pageNo(from) === pageNo(to) ? `第 ${pageNo(from)} 页` : `第 ${pageNo(from)}–${pageNo(to)} 页`) : '—'} |\n`;
  guide += '\n';
  lesson.pages.forEach((page, i) => {
    const puzzle = page.kind === 'recap' ? byId.get(`${lesson.id}-${page.reuse}`) : page.puzzle ? byId.get(`${lesson.id}-${page.key}`) : null;
    const words = puzzle?.words ?? {};
    const shown = page.kind === 'card' ? `${page.name}：${oneLine(page.body)}` : page.kind === 'opening' ? `${lesson.title} · ${page.goal}` : page.kind === 'break' ? '休息 5 分钟' : page.kind === 'tool' ? `搭楼 ${page.heights.join('、')}` : `${fill(page.heading, words)}${page.prompt ? ` ／ ${oneLine(fill(page.prompt, words))}` : ''}`;
    guide += `**第 ${i + 1} 页 · ${page.title}**：${shown}\n`;
    if (page.notes) {
      const notes = page.notes;
      guide += `- 提问：${notes.ask.map(q => fill(q, words)).join(' → ')}\n- 预期：${fill(notes.expect, words)}\n- 留意：${fill(notes.watch, words)}\n`;
    } else if (page.kind === 'full') {
      const pr = puzzle.profile;
      guide += `- ${FAMILY[puzzle.family]}，${puzzle.givens} 个提示，${pr.placements} 步填数，其中 ${pr.bottleneck} 步全盘只有一个落点。${page.role === 'class' ? '巡视：卡住的学生先问“你在找哪个数字？”，按顺序找，不猜数；完成快的学生准备讲一次突破。' : ''}\n`;
    }
    guide += '\n';
  });
}
guide += `## 题目设计口径

方法页按样式设计，再用求解器证明：

| 样式 | 含义 |
| --- | --- |
| E0 | 宫里只差一格（只作热身） |
| E1 | 一条线挡住几格，其余格已有数 |
| E2 | 只靠几条线交叉（四宫两条、六宫三条、九宫四条） |
| E4 | 线和已有数混合 |
| E5 | 一个数字找到底：后面的位置要等前面填好才出现 |
| E6 | 1～n 轮流找：宫内排除能填几格，然后停住 |
| L1 / L2 | 一行（列）还剩 2 格 / 3 格以上，用列或宫挡住 |
| L3 | 真实解题中宫内排除停住的盘面 |
| 唯一余数 | 排除依据分布在行、列、宫至少两处；四宫为点名格子的观察页 |
| K1–K4 | 宫内区块后宫内排除、宫内区块后行列排除、行列区块、区块后唯一余数 |
| 变形 | 区域页（虚线、窗口当成宫）、锯齿形状页、符号先缩小范围页、摩天楼三个窍门 |

- 方法页：页面问的格子在所有合法终盘中取值相同；单目标页全盘只有这一格（或这一对格）确定；用到的方法不超出本讲。
- 整题：唯一解；只用本讲方法即可解完；要求的方法撤掉就解不下去；变形规则撤掉就不再唯一，且至少有一次推理确实用到新规则。
- 难度：按提示数和“卡点”（全盘只有一个落点的步数）分档，同一讲由易到难排列。
- 全部推理逐步独立回放，详见“逐题校验结果.md”。

## 参考取舍

| 资料 | 采用什么 | 原因与调整 |
| --- | --- | --- |
| 用户提供的初、中、高阶示例与解析 | 题型与表达习惯 | 原题没有按本课的方法进度分层，题目全部按样式重新设计并逐题证明 |
| 你拍一 · 1年级第24讲 四宫数独 | 从图形到数字、由密到疏的整题递进 | 恢复由密到疏：初阶每个整题时段 3 道小题，提示由多到少 |
| 你拍一 · 1年级第25讲 六宫数独 | 四宫到六宫的规则迁移 | 用填好的六宫盘让学生自己说出 2×3 的宫 |
| 你拍一 · 1年级第26讲 锯齿数独 | 宫的形状变了，数量和不重复不变 | 沿粗线描宫；九宫锯齿放在高阶“区域实验室” |
| 你拍一 · 2年级第04讲 数塔游戏 | 搭楼 → 两端观察 → 数字代替 → 四宫平面 | 保留积木观察；把边数的推理整理成三个孩子能说出的窍门，不用列举排列 |
| HoDoKu 方法说明 | Hidden / Naked Single、Locked Candidates 的定义 | 只参考方法分类；区块先教宫内区块，再教行列区块 |
`;
fs.writeFileSync(`${dir}/教师用书.md`, guide);

// ---------- 教师答案 ----------
let answers = `# 数独教学 · 2026版 · 教师答案\n\n行用字母（A 在最上），列用数字（1 在最左），例如 C4。每题先列答案，再列关键突破；全部步骤收在“全部步骤”里。理由写的是“被谁挡住”：同行、同列、同宫，或变形规则。\n`;
for (const lesson of LESSONS) {
  answers += `\n## ${lesson.id} ${lesson.level}第 ${lesson.number} 讲 · ${lesson.title}\n`;
  lesson.pages.forEach((page, i) => {
    if (!page.puzzle) return;
    const p = byId.get(`${lesson.id}-${page.key}`);
    answers += `\n### 第 ${i + 1} 页 · ${page.title}（${FAMILY[p.family]}）\n\n`;
    if (p.role === 'discover') { answers += '填好的盘面，老师带学生发现规则，没有作答。\n'; return; }
    const steps = p.trace.map((s, k) => `${k + 1}. ${describe(p, s, p.explained[k])}`);
    if (p.role === 'target') {
      answers += `答案：**${p.words.answer}**。\n\n${steps.join('\n')}\n`;
    } else {
      answers += `${grid(p, p.solution)}\n\n${p.givens} 个提示，${p.profile.placements} 步填数。关键突破：\n\n${keySteps(p).map(k => steps[k]).join('\n') || '（全程宫内排除）'}\n\n<details><summary>全部步骤</summary>\n\n${steps.join('\n')}\n\n</details>\n`;
    }
  });
}
fs.writeFileSync(`${dir}/教师答案.md`, answers);

// ---------- 课后练习（A4） ----------
function svg(p) {
  const n = p.size, c = n === 9 ? 30 : n === 6 ? 40 : 52, pad = 26, size = n * c + 2 * pad, spec = specFrom(n, p.rules), at = k => pad + (k + 0.5) * c;
  const line = (x1, y1, x2, y2, w, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#293b37" stroke-width="${w}" ${extra}/>`;
  const txt = (x, y, s, fs, extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${fs}" font-family="Arial,sans-serif" ${extra}>${esc(s)}</text>`;
  let out = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(p.id)}"><rect width="${size}" height="${size}" fill="white"/>`;
  if (p.family === 'window') for (const [r, k] of [[1, 1], [1, 5], [5, 1], [5, 5]]) out += `<rect x="${pad + k * c}" y="${pad + r * c}" width="${3 * c}" height="${3 * c}" fill="#f2e3c6"/>`;
  if (p.family === 'diagonal') out += line(pad, pad, pad + n * c, pad + n * c, 2, 'stroke-dasharray="6 5" opacity=".5"') + line(pad + n * c, pad, pad, pad + n * c, 2, 'stroke-dasharray="6 5" opacity=".5"');
  const region = spec.regions;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    const i = r * n + k, x = pad + k * c, y = pad + r * c, par = p.family === 'parity' ? p.rules.cells[i] : 0;
    if (par === 1) out += `<circle cx="${x + c / 2}" cy="${y + c / 2}" r="${c * 0.38}" fill="none" stroke="#9a8f86"/>`;
    if (par === 2) out += `<rect x="${x + c * 0.14}" y="${y + c * 0.14}" width="${c * 0.72}" height="${c * 0.72}" fill="none" stroke="#9a8f86"/>`;
    out += line(x, y, x + c, y, r === 0 || (region && region[i] !== region[i - n]) ? 3 : 0.7);
    out += line(x, y, x, y + c, k === 0 || (region && region[i] !== region[i - 1]) ? 3 : 0.7);
    if (p.puzzle[i]) out += txt(x + c / 2, y + c / 2, p.puzzle[i], c * 0.55);
  }
  out += line(pad, pad + n * c, pad + n * c, pad + n * c, 3) + line(pad + n * c, pad, pad + n * c, pad + n * c, 3);
  if (p.family === 'inequality') for (const [a, b] of p.rules.lessThan) {
    const ax = at(a % n), ay = at(Math.floor(a / n)), bx = at(b % n), by = at(Math.floor(b / n)), x = (ax + bx) / 2, y = (ay + by) / 2;
    out += `<rect x="${x - 8}" y="${y - 9}" width="16" height="18" fill="white"/>` + txt(x, y, ay === by ? (ax < bx ? '<' : '>') : (ay < by ? '∧' : '∨'), 18, 'font-weight="700"');
  }
  if (p.family === 'skyscraper') for (let k = 0; k < n; k++) {
    if (p.rules.top[k]) out += txt(at(k), pad / 2, p.rules.top[k], 18);
    if (p.rules.bottom[k]) out += txt(at(k), size - pad / 2, p.rules.bottom[k], 18);
    if (p.rules.left[k]) out += txt(pad / 2, at(k), p.rules.left[k], 18);
    if (p.rules.right[k]) out += txt(size - pad / 2, at(k), p.rules.right[k], 18);
  } else for (let k = 0; k < n; k++) out += txt(at(k), pad / 2, k + 1, 11, 'fill="#7a8682"') + txt(pad / 2, at(k), String.fromCharCode(65 + k), 11, 'fill="#7a8682"');
  return `${out}</svg>`;
}
const RULE_LINE = { classic: n => `每行、每列、每宫都填 1～${n}，各一次。`, diagonal: n => `标准规则；两条虚线上也是 1～${n} 各一次。`, window: () => '标准规则；四个阴影窗口里也是 1～9 各一次。', irregular: n => `每行、每列和每个粗线框都填 1～${n}，各一次。`, inequality: () => '标准规则；符号开口朝大数，尖尖朝小数。', parity: () => '标准规则；圆圈填单数，方框填双数。', skyscraper: () => '每行、每列 1～4 层的楼各一栋；边上的数是从这边看到的楼数。' };
let html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>数独教学 2026版 · 课后练习</title><style>
*{box-sizing:border-box}body{font-family:"Microsoft YaHei",sans-serif;color:#243d38;margin:0;background:#eee}main{max-width:210mm;margin:auto}.sheet{width:210mm;min-height:297mm;padding:10mm 12mm;background:white;margin:12px 0;break-after:page}h1{font-size:20px;margin:0 0 5px}header p{font-size:12px;margin:5px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm 7mm;margin-top:6mm}.card{break-inside:avoid}.card h2{font-size:13px;margin:0}.card p{font-size:10px;min-height:8mm;margin:4px 0;line-height:1.45}.card svg{display:block;width:100%;height:80mm}.reason{border-bottom:1px solid #aaa;height:11mm;font-size:10px;padding-top:3mm}.footer{font-size:10px;margin-top:7mm}nav{padding:16px;text-align:center}button{padding:10px 20px}@page{size:A4;margin:0}@media print{body{background:white}.sheet{margin:0}nav{display:none}}</style><nav><button onclick="window.print()">打印 12 讲课后练习（A4）</button><p>每讲四题，答案见教师答案.md。</p></nav><main>`;
for (const lesson of LESSONS) {
  const young = lesson.level === '初阶';
  html += `<section class="sheet"><header><h1>${lesson.level}第 ${lesson.number} 讲 · ${esc(lesson.title)}</h1><p>数独教学 2026版 · ${lesson.grades} 年级 · ${lesson.n}×${lesson.n}　姓名：____________　日期：____________</p><p>${young ? '独立完成。做完说给家长听：最难的一步是怎么想的。' : '独立完成。每题圈出一次本课方法，写一句“因为……所以……”。'}</p></header><div class="grid">`;
  for (const page of lesson.pages.filter(p => p.kind === 'full' && p.role === 'homework')) {
    const p = byId.get(`${lesson.id}-${page.key}`);
    html += `<article class="card"><h2>${esc(page.title)} · ${FAMILY[p.family]}</h2><p>${esc(RULE_LINE[p.family](p.size))}</p>${svg(p)}${young ? '' : '<div class="reason">我的一次突破：_________________________</div>'}</article>`;
  }
  html += '</div><p class="footer">遇到停住就圈出位置，记下已经排除的数字，下次课一起讨论。四道题可以分两次完成。</p></section>';
}
fs.writeFileSync(`${dir}/课后练习.html`, `${html}</main></html>`);

// ---------- 开始使用 与 逐题校验结果 ----------
const link = id => receipt?.lessons.find(l => l.id === id)?.developmentUrl;
let start = `# 数独教学 · 2026版\n\n${receipt ? `[打开开发端课程](${receipt.developmentUrl})\n\n` : ''}初阶四宫（1–2 年级）、中阶六宫（3–4 年级）、高阶九宫（5–6 年级），每阶 4 讲，每讲 90 分钟。适用时段：全年。课程为可编辑草稿，尚未冻结发布版本。\n\n- 教师用书.md：每讲时间表、逐页提问链、预期回答和常见错误。\n- 教师答案.md：全部题目答案与每一步“被谁挡住”的理由。\n- 课后练习.html：浏览器打开后打印 A4，每讲四题。\n- 教学逻辑校准.md：这一版的设计依据。\n- bank.json、method-audit.json、native-audit.json：题库与逐题校验证据。\n\n| 讲次 | 主题 | 页数 | 入口 |\n| --- | --- | --- | --- |\n`;
for (const l of pkg.lessons) start += `| ${l.id} | ${l.title} | ${l.pages.length} | ${link(l.id) ? `[打开本讲](${link(l.id)})` : '—'} |\n`;
fs.writeFileSync(`${dir}/开始使用.md`, start);

const counts = id => { const rs = audit.results.filter(r => r.lessonId === id), c = role => rs.filter(r => r.role === role).length; return [c('discover'), c('target'), c('class'), c('homework')]; };
let report = `# 数独教学 2026版 · 逐题校验结果\n\n校验时间：${audit.checkedAt}。全部 ${audit.counts.puzzles} 个盘面通过，独立回放 ${audit.counts.reasonSteps} 步推理理由。\n\n| 讲次 | 规则盘 | 方法页 | 课堂整题 | 课后题 | 整题提示数（课堂） |\n| --- | ---: | ---: | ---: | ---: | --- |\n`;
for (const lesson of LESSONS) {
  const [d, t, c, h] = counts(lesson.id), givens = bank.puzzles.filter(p => p.lessonId === lesson.id && p.role === 'class').map(p => p.givens).join(' → ');
  report += `| ${lesson.id} ${lesson.title} | ${d} | ${t} | ${c} | ${h} | ${givens} |\n`;
}
report += `\n## 校验内容\n\n- **数学**：整题唯一解且与存档答案一致；方法页上被问的格在所有合法终盘中取值相同，单目标页全盘只有这一格确定；规则盘是符合规则的完整盘面。\n- **进度**：每一步只用本讲及之前学过的方法；本讲要求的方法撤掉后整题解不完；变形规则撤掉后整题不再唯一，方法页的目标格不再确定。\n- **设计**：每张方法页重新判定样式，与教案中写的样式一致；整题的提示数和卡点落在计划档位，同一讲由易到难；区块两种方向都有；学生页没有内部编号和模板字母。\n- **理由回放**：不调用出题求解器，逐步重算候选，核对每一步“只剩一格 / 只剩一个数 / 区块 / 符号 / 边数”的依据。\n- **原生引擎**：全部盘面再经应用的数独校验器与原生求解器复核（native-audit.json）。\n\n课堂时间与学生手感需要试课后确认。\n`;
fs.writeFileSync(`${dir}/逐题校验结果.md`, report);
console.log(`Guide, answers, homework and reports written for ${pkg.lessons.length} lessons, ${total} pages.`);
