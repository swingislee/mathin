// Export every printable material to A4 PDF: one folder per lesson (lesson plan, student
// handout, homework, answers) plus whole-course volumes. Usage:
//   node scripts/sudoku-2026/export-pdf.cjs [output-directory]
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');

const dir = 'content/courses/sudoku-2026';
const out = path.resolve(process.argv[2] ?? '.tmp/sudoku-2026/pdf');
const bank = JSON.parse(fs.readFileSync(`${dir}/bank.json`, 'utf8'));
// Folders sort in teaching order: 01–04 beginner, 05–08 intermediate, 09–12 advanced.
const lessons = bank.lessons.map((l, i) => ({ ...l, name: `${l.level}第${l.number}讲 ${l.title}`, folder: `${String(i + 1).padStart(2, '0')} ${l.level}第${l.number}讲 ${l.title}` }));

const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
/** Renders the Markdown subset the course generator writes: headings, tables, lists, paragraphs, step folds. */
function markdown(text, { foldSteps = 'open' } = {}) {
  const lines = text.split(/\r?\n/), html = [];
  let i = 0, skipping = false;
  const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('<details')) { if (foldSteps === 'drop') skipping = true; else html.push('<div class="steps"><p class="steps-title">全部步骤</p>'); i++; continue; }
    if (line.startsWith('</details>')) { if (skipping) skipping = false; else html.push('</div>'); i++; continue; }
    if (skipping || !line.trim()) { i++; continue; }
    const heading = /^(#{1,4}) (.*)$/.exec(line);
    if (heading) { html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const body = rows.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      html.push(`<table><thead><tr>${cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }
    const listKind = /^- /.test(line) ? 'ul' : /^\d+\. /.test(line) ? 'ol' : null;
    if (listKind) {
      const items = [];
      while (i < lines.length && (listKind === 'ul' ? /^- /.test(lines[i]) : /^\d+\. /.test(lines[i]))) items.push(lines[i++].replace(/^(- |\d+\. )/, ''));
      html.push(`<${listKind}>${items.map(it => `<li>${inline(it)}</li>`).join('')}</${listKind}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4} |\||- |\d+\. |<\/?details)/.test(lines[i])) para.push(lines[i++]);
    html.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return html.join('\n');
}
const DOC_CSS = `*{box-sizing:border-box}body{font-family:"Microsoft YaHei",sans-serif;color:#243d38;font-size:10.5pt;line-height:1.6;margin:0}
h1{font-size:18pt;margin:0 0 4mm;border-bottom:2px solid #243d38;padding-bottom:2mm}h2{font-size:14pt;margin:6mm 0 2mm;color:#a35a31}h3{font-size:12pt;margin:5mm 0 2mm;break-after:avoid}h4{font-size:11pt;margin:4mm 0 1mm}
p{margin:1.5mm 0}ul,ol{margin:1mm 0 2mm;padding-left:6mm}li{margin:.6mm 0}table{border-collapse:collapse;width:100%;margin:2mm 0;font-size:9.5pt;break-inside:auto}
th,td{border:1px solid #b9c4c0;padding:1.2mm 2mm;text-align:left;vertical-align:top}th{background:#eef3f1}tr{break-inside:avoid}code{font-family:Consolas,monospace;font-size:9pt}
a{color:#243d38;text-decoration:none}.steps{border-left:3px solid #d8cfc4;padding-left:3mm;margin:2mm 0;font-size:9.5pt}.steps-title{font-weight:700;color:#7a6a5a}
h3+table,h3+p+table{break-inside:avoid}`;
const docHtml = (title, body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style><body>${body}</body></html>`;
const footer = title => `<div style="font-size:7.5pt;width:100%;padding:0 15mm;color:#7a8682;display:flex;justify-content:space-between;font-family:'Microsoft YaHei',sans-serif"><span>数独教学 2026版 · ${esc(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

/** Split a generated Markdown document into its preamble and per-lesson sections. */
function sections(text, level) {
  const marker = new RegExp(`^${'#'.repeat(level)} ([BMH][1-4]) `, 'm'), parts = text.split(new RegExp(`(?=^${'#'.repeat(level)} [BMH][1-4] )`, 'm'));
  const byLesson = {};
  let preamble = '';
  for (const part of parts) { const m = marker.exec(part); if (m) byLesson[m[1]] = part; else preamble += part; }
  // The guide closes with course-wide notes after the last lesson; keep them out of that lesson.
  for (const [id, part] of Object.entries(byLesson)) {
    const tail = part.search(/^## /m);
    if (tail > 0) { preamble += `\n${part.slice(tail)}`; byLesson[id] = part.slice(0, tail); }
  }
  return { preamble, byLesson };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(), page = await browser.newPage();
  const written = [];
  const docPdf = async (file, title, body) => {
    await page.setContent(docHtml(title, body), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: file, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '16mm', left: '15mm', right: '15mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer(title) });
    written.push(file);
  };
  /** Print an existing course HTML sheet, optionally keeping one lesson only. */
  const sheetPdf = async (source, file, lessonId = null) => {
    await page.goto(pathToFileURL(path.resolve(dir, source)).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(id => {
      document.querySelectorAll('nav,.print').forEach(el => el.remove());
      if (id) document.querySelectorAll('[data-lesson]').forEach(el => { if (el.dataset.lesson !== id) el.remove(); });
    }, lessonId);
    await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true });
    written.push(file);
  };

  const guide = sections(fs.readFileSync(`${dir}/教师用书.md`, 'utf8'), 3);
  const answers = sections(fs.readFileSync(`${dir}/教师答案.md`, 'utf8'), 2);
  const answerIntro = answers.preamble.replace(/^# .*\n/, '');

  await docPdf(path.join(out, '00 教师用书（全册）.pdf'), '教师用书', markdown(fs.readFileSync(`${dir}/教师用书.md`, 'utf8')));
  // The whole-course answer volume keeps answers and key breakthroughs; every step is in the lesson folders.
  await docPdf(path.join(out, '00 教师答案（全册·关键突破）.pdf'), '教师答案', markdown(fs.readFileSync(`${dir}/教师答案.md`, 'utf8'), { foldSteps: 'drop' }));
  await sheetPdf('学生讲义.html', path.join(out, '00 学生讲义（全册）.pdf'));
  await sheetPdf('课后练习.html', path.join(out, '00 课后练习（全册）.pdf'));

  for (const lesson of lessons) {
    const folder = path.join(out, lesson.folder);
    fs.mkdirSync(folder, { recursive: true });
    await docPdf(path.join(folder, '1 教案.pdf'), `${lesson.name} · 教案`, `<h1>${esc(lesson.name)} · 教案</h1>${markdown(guide.byLesson[lesson.id].replace(/^### .*\n/, ''))}`);
    await sheetPdf('学生讲义.html', path.join(folder, '2 学生讲义.pdf'), lesson.id);
    await sheetPdf('课后练习.html', path.join(folder, '3 课后练习.pdf'), lesson.id);
    await docPdf(path.join(folder, '4 教师答案.pdf'), `${lesson.name} · 教师答案`, `<h1>${esc(lesson.name)} · 教师答案</h1>${markdown(answerIntro)}${markdown(answers.byLesson[lesson.id].replace(/^## .*\n/, ''))}`);
  }
  await browser.close();
  const pages = file => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const report = written.map(f => ({ file: path.relative(out, f), pages: pages(f), kb: Math.round(fs.statSync(f).size / 1024) }));
  fs.writeFileSync(path.join(out, '目录.txt'), `数独教学 2026版 · PDF 打印版（A4）\r\n生成时间：${new Date().toLocaleString('zh-CN')}\r\n\r\n每讲文件夹：1 教案、2 学生讲义（发给学生，无答案）、3 课后练习（无答案）、4 教师答案（含全部步骤）。\r\n全册合订本以 00 开头；全册答案只含答案与关键突破。\r\n\r\n${report.map(r => `${r.file}　${r.pages} 页`).join('\r\n')}\r\n`, 'utf8');
  console.log(JSON.stringify({ out, files: report.length, pages: report.reduce((n, r) => n + r.pages, 0) }));
  for (const r of report) console.log(`${r.pages}\t${r.kb}KB\t${r.file}`);
})().catch(error => { console.error(error); process.exit(1); });
