/* 排布原型共用同一份示例事实；所有编辑只保存在本浏览器。 */
(() => {
  'use strict';
  const root = document.getElementById('layout-lab');
  const variant = ['a', 'b', 'c', 'd'].includes(document.body.dataset.layout) ? document.body.dataset.layout : 'a';
  const storageKey = 'mathin-school-layout-demo-v1';
  const layouts = {
    a: { name: 'A 对象集中', file: 'a-objects.html', defaultPage: 'classes', caption: '学生找人，班级处理在读，活动处理场次。' },
    b: { name: 'B 业务分区', file: 'b-business.html', defaultPage: 'admissions', caption: '先选招生、教学或续班，再处理这一件事。' },
    c: { name: 'C 工作清单', file: 'c-worklists.html', defaultPage: 'today', caption: '常做的工作直接列出来，点开就是待处理名单。' },
    d: { name: 'D 十标签归并', file: 'd-merged-work.html', defaultPage: 'service', caption: '同一项工作，教师和学服从同一个入口进入。' }
  };
  const classes = [
    { id: 'c1', name: '四年级 · 周六上午班', grade: 4, teacher: '李老师', time: '周六 10:00–11:30', room: '星光教室', capacity: 6, lesson: '第 4 讲 · 和差问题', day: '09.19', next: '今天 10:00', course: '数学思维' },
    { id: 'c2', name: '四年级 · 周日下午班', grade: 4, teacher: '陈老师', time: '周日 14:00–15:30', room: '月亮教室', capacity: 6, lesson: '第 4 讲 · 和差问题', day: '09.20', next: '明天 14:00', course: '数学思维' },
    { id: 'c3', name: '五年级 · 周六下午班', grade: 5, teacher: '李老师', time: '周六 14:00–15:30', room: '星光教室', capacity: 6, lesson: '第 4 讲 · 相遇问题', day: '09.19', next: '今天 14:00', course: '数学思维' }
  ];
  const seed = [
    ['s1', '林安然', 4, 'c1', '在读', '考虑中', '家长关注寒假上课时间'],
    ['s2', '陈一诺', 4, 'c1', '在读', '意向确认', '想与本班同学一起继续'],
    ['s3', '周子睿', 4, 'c1', '在读', '未联系', '课堂思路清晰，表达可再主动'],
    ['s4', '许星禾', 4, 'c1', '在读', '未联系', '本周需要沟通作业习惯'],
    ['s5', '刘沐阳', 4, 'c2', '在读', '考虑中', '寒假时间尚未确定'],
    ['s6', '顾书言', 4, 'c2', '在读', '意向确认', '已告知家长课程安排'],
    ['s7', '王予宁', 4, 'c2', '在读', '未联系', '本周上课表现稳定'],
    ['s8', '宋知夏', 5, 'c3', '在读', '意向确认', '希望增加拓展练习'],
    ['s9', '夏子航', 5, 'c3', '在读', '未联系', '需要加强画图理解'],
    ['s10', '何以宁', 5, 'c3', '在读', '本轮不续', '寒假回外地，秋季继续上课'],
    ['s11', '沈念', 4, null, '等班', '未联系', '已报名秋季数学，周六上午可上课'],
    ['s12', '陆明哲', 4, null, '等班', '未联系', '已报名秋季数学，周日下午可上课'],
    ['s13', '白可欣', 5, null, '等班', '未联系', '已报名秋季数学，等待匹配班级'],
    ['s14', '苏晨', 4, null, '待首联', '未联系', '周末社区体验活动留资'],
    ['s15', '叶小满', 4, null, '待测评', '未联系', '已约周六 16:00 测评'],
    ['s16', '周北辰', 5, null, '待首联', '未联系', '朋友介绍，想了解秋季课程'],
    ['s17', '方柚', 4, null, '测后跟进', '未联系', '测评已完成，家长考虑周日下午']
  ];
  function freshData() {
    return { version: 1, people: seed.map(([id, name, grade, classId, stage, renewal, note]) => ({ id, name, grade, classId, stage, renewal, note, attendance: '待登记', assessment: stage === '测后跟进' ? '已完成' : '待测评', activity: '已预约', records: [] })) };
  }
  function readData() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved?.version === 1 && Array.isArray(saved.people) && saved.people.length === seed.length && saved.people.every((p, i) => p.id === seed[i][0] && Array.isArray(p.records))) return saved;
    } catch { /* 私密浏览及本地文件可直接使用内存中的示例。 */ }
    return freshData();
  }
  let data = readData();
  function initializeMergedExamples() {
    if (variant !== 'd' || Array.isArray(data.formerPeople)) return;
    data.formerPeople = [
      { id:'f1',name:'梁悦',grade:5,classId:null,stage:'已停读／课程结束',pastClass:'四年级 · 春季周六班',ended:'2026.06.27',followUp:'尚未回访',note:'春季结束后暂停，家长希望秋季再了解。',records:[] },
      { id:'f2',name:'江予川',grade:5,classId:null,stage:'已停读／课程结束',pastClass:'四年级 · 春季周日班',ended:'2026.06.28',followUp:'下期再联系',note:'近期课外安排较多，可以寒假前再联系。',records:[] }
    ];
  }
  initializeMergedExamples();
  const params = new URLSearchParams(location.search);
  let state = { page: layouts[variant].defaultPage, tab: variant === 'b' ? 'firstcontact' : 'arrange', role: ['support','teacher','manager'].includes(params.get('role')) ? params.get('role') : 'support', expanded: new Set(['c1']), search: '', grade: 'all', classroom: 'all', scene: '', editor: null, drawerTab: 'entry', saved: false, placement: null, draft: {} };
  let toastTimer;
  let returnFocus = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const person = id => data.people.find(p => p.id === id) || data.formerPeople?.find(p => p.id === id);
  const classroom = id => classes.find(c => c.id === id);
  const members = id => data.people.filter(p => p.classId === id);
  const waiting = () => data.people.filter(p => p.stage === '等班');
  const scopeClasses = () => classes.filter(c => (state.role !== 'teacher' || c.teacher === '李老师') && (state.grade === 'all' || c.grade === Number(state.grade)) && (state.classroom === 'all' || c.id === state.classroom));
  const scopePeople = () => data.people.filter(p => (state.grade === 'all' || p.grade === Number(state.grade)) && (state.classroom === 'all' || p.classId === state.classroom) && (!state.search || (p.name + p.note).includes(state.search)));
  const renewals = () => scopePeople().filter(p => p.classId && (state.role !== 'teacher' || classroom(p.classId)?.teacher === '李老师'));
  const activityPeople = () => ['s1','s2','s11','s14','s15','s17'].map(person);
  function tone(value) { return ['意向确认','已到场','已完成','出勤','已接通'].includes(value) ? 'green' : ['考虑中','待沟通','请假','待登记'].includes(value) ? 'yellow' : ['本轮不续','缺席','暂不考虑'].includes(value) ? 'rose' : ''; }
  const tag = (value, color) => `<span class="tag ${color || tone(value)}">${esc(value)}</span>`;
  const btn = (text, action, attrs = '', style = '') => `<button type="button" class="button ${style}" data-action="${action}" ${attrs}>${text}</button>`;
  const textBtn = (text, action, attrs = '') => `<button type="button" class="text-button" data-action="${action}" ${attrs}>${text}</button>`;
  function options(values, selected) { return values.map(item => { const [value, label] = Array.isArray(item) ? item : [item,item]; return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`; }).join(''); }
  function field(label, name, values, value) { return `<label class="field"><span>${label}</span><select name="${name}">${options(values,value)}</select></label>`; }
  function pageTitle() {
    if (variant === 'd') return { sources:'线索',firstcontact:'首联',assessments:'测评',enrollment:'报名与分班',service:'在读与续班',former:'停读回访',activities:'活动',activity:'数学探险 · 周末公开课',students:'查找学生' }[state.page] || '工作';
    const names = { today: '今天的工作', classes: variant === 'b' ? '教学' : variant === 'c' ? '在读班级' : '班级', students: variant === 'b' ? '学生档案' : variant === 'c' ? '学生资料' : '学生', admissions: '招生', firstcontact: '新客联系', assessments: '测评安排', waiting: '报名等班', renewal: variant === 'c' ? '寒假续班' : '续班', activities: '活动', activity: '数学探险 · 周末公开课' };
    return names[state.page] || '班级';
  }
  function activeNav(key) { if (state.page === 'activity' && key === 'activities' && variant !== 'c') return true; return state.page === key; }
  function navItem(key, label, symbol, count) { return `<button type="button" class="nav-item ${activeNav(key) ? 'active' : ''}" data-action="navigate" data-page="${key}" ${activeNav(key) ? 'aria-current="page"' : ''}><span class="nav-symbol" aria-hidden="true">${symbol}</span><span>${label}</span>${count === undefined ? '' : `<span class="nav-count">${count}</span>`}</button>`; }
  function navigation() {
    const contacts = data.people.filter(p => p.stage === '待首联').length;
    const groups = variant === 'd' ? [
      ['工作', [['sources','线索','·'],['firstcontact','首联','·',contacts],['assessments','测评','·'],['enrollment','报名与分班','·'],['service','在读与续班','·'],['former','停读回访','·']]],
      ['场次', [['activities','活动','▣']]]
    ] : variant === 'a' ? [
      ['我的工作', [['today','今天','◷']]],
      ['学校运营', [['students','学生','◉'],['classes','班级','▦'],['activities','活动','▣']]]
    ] : variant === 'b' ? [
      ['我的工作', [['today','今天','◷']]],
      ['业务', [['admissions','招生','↗'],['classes','教学','▦'],['renewal','续班','↻'],['activities','活动','▣']]],
      ['资料', [['students','学生档案','◉']]]
    ] : [
      ['我的工作清单', [['today','今日待办','◷'],['classes','在读班级','▦']]],
      ['共同处理', [['firstcontact','新客联系','·',contacts],['assessments','测评安排','·',data.people.filter(p => p.stage === '待测评').length],['waiting','报名等班','·',waiting().length],['renewal','寒假续班','·',data.people.filter(p => p.classId && p.renewal === '未联系').length],['activity','周末公开课','·']]],
      ['查找资料', [['students','学生资料','◉'],['activities','全部活动','▣']]]
    ];
    return `<aside class="sidebar"><div class="brand"><span class="brand-mark">m</span><div><div class="wordmark">Mathin</div><div class="brand-sub">一起探索数学</div></div></div><nav aria-label="主要导航">${groups.map(([title, items]) => `<div class="nav-group"><div class="nav-title">${title}</div>${items.map(item => navItem(...item)).join('')}</div>`).join('')}</nav><div class="sidebar-tail"><div class="small muted" style="margin-bottom:16px">教研资料 · 机构设置</div><div class="account"><span class="avatar">${state.role === 'teacher' ? '李' : state.role === 'manager' ? '周' : '林'}</span><div>${state.role === 'teacher' ? '李老师' : state.role === 'manager' ? '周主管' : '林老师'}<div class="small">${state.role === 'teacher' ? '授课教师' : state.role === 'manager' ? '学校负责人' : '学服老师'}</div></div></div></div></aside>`;
  }
  function prototypeBar() {
    const scenario = state.scene ? `&scene=${encodeURIComponent(state.scene)}` : '';
    return `<header class="lab-bar"><span class="lab-label">工作区排布试用</span><nav class="lab-variants" aria-label="切换排布方案">${Object.entries(layouts).map(([id, config]) => `<a href="${config.file}?role=${state.role}${scenario}" class="${variant === id ? 'active' : ''}" ${variant === id ? 'aria-current="page"' : ''}>${config.name}</a>`).join('')}</nav><div class="lab-tools"><span class="example-label">示例数据 · 仅本浏览器保存</span><label><span class="sr-only">体验视角</span><select data-control="role" aria-label="体验视角">${options([['support','学服视角'],['teacher','教师视角'],['manager','负责人视角']],state.role)}</select></label><button type="button" data-action="reset">重置示例</button></div></header><div class="try-bar"><span class="prompt">用同一件事比较：</span>${[['classes','按班看学生'],['waiting','安排等班学生'],['renewal','处理寒假续班'],['activity','登记公开课'],['firstcontact','联系新客']].map(([id,label]) => `<button type="button" data-action="scene" data-scene="${id}" class="${state.scene === id ? 'active' : ''}">${label}</button>`).join('')}</div>`;
  }
  function tabs(items, current, action = 'tab') { return `<nav class="tabs" aria-label="工作视图">${items.map(([key,label,count]) => `<button type="button" class="${current === key ? 'active' : ''}" data-action="${action}" data-tab="${key}" aria-pressed="${current === key}">${label}${count === undefined ? '' : `<span class="tab-count">${count}</span>`}</button>`).join('')}</nav>`; }
  function command({ search = true, grade = true, classFilter = false, period = '2026 秋季', action = '' } = {}) {
    return `<div class="command">${period ? `<span class="scope">${period}</span>` : ''}${grade ? `<label><span class="sr-only">年级</span><select data-control="grade" aria-label="年级">${options([['all','全部年级'],['4','四年级'],['5','五年级']],state.grade)}</select></label>` : ''}${classFilter ? `<select data-control="classroom" aria-label="班级">${options([['all','全部班级'],...classes.map(c => [c.id,c.name])],state.classroom)}</select>` : ''}${search ? `<input type="search" data-control="search" aria-label="查找姓名或记录" placeholder="查找姓名、记录…" value="${esc(state.search)}">` : ''}<span class="right">${action || `<span class="scope">${state.role === 'teacher' ? '我任教的班级' : '全部负责范围'}</span>`}</span></div>`;
  }
  function heading(description, title = pageTitle()) { return `<div class="page-heading"><div><h1>${title}</h1><p class="description">${description}</p></div><div class="heading-meta">2026 年 9 月 19 日 · 周六<br>秋季第 4 周</div></div>`; }
  function table(headers, rows) { return `<div class="data-table"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty-state">当前范围内没有待处理记录。</td></tr>`}</tbody></table></div>`; }
  function footer(count, unit = '位学生') { return `<div class="table-foot"><span>共 ${count} ${unit}</span><span>全部展示 · 示例名单</span></div>`; }
  function openPersonButton(p, label = p.name, mode = 'profile') { return `<button type="button" class="person-name" data-action="edit" data-id="${p.id}" data-mode="${mode}">${esc(label)}</button>`; }
  function classBoard() {
    const list = scopeClasses().filter(c => !state.search || (c.name + c.teacher + members(c.id).map(p => p.name).join('')).includes(state.search));
    const emptyPeople = waiting().filter(p => state.grade === 'all' || p.grade === Number(state.grade));
    return `${emptyPeople.length ? `<div class="queue-strip"><div><strong>等班</strong> <span class="small muted">${emptyPeople.length} 人</span></div><div class="people">${emptyPeople.map(p => `<button type="button" class="person-chip" data-action="place" data-id="${p.id}">${p.name}<span class="muted">${p.grade} 年级 ＋</span></button>`).join('')}</div><span class="small muted tail">已报名秋季数学</span></div>` : ''}${[4,5].map(grade => { const group = list.filter(c => c.grade === grade); if (!group.length) return ''; return `<div class="group-label">${grade === 4 ? '四' : '五'}年级 <span>${group.length} 个班 · ${group.reduce((n,c) => n + members(c.id).length,0)} 位学生</span></div><div class="class-table"><div class="class-row class-head"><span>班级 / 固定上课时间</span><span>任课老师 / 教室</span><span>人数</span><span>最近一课</span><span>操作</span></div>${group.map(c => { const people = members(c.id); const expanded = state.expanded.has(c.id); return `<div class="class-row ${expanded ? 'expanded' : ''}"><div><button type="button" class="class-name" data-action="expand" data-id="${c.id}" aria-expanded="${expanded}"><span class="chevron">${expanded ? '▾' : '▸'}</span>${c.name}</button><div class="class-meta">${c.time}</div></div><div class="class-cell">${c.teacher}<small>${c.room}</small></div><div class="class-cell mono">${people.length} / ${c.capacity}</div><div class="class-cell">${c.next}<small>${c.lesson.split(' · ')[0]}</small></div><div>${textBtn('上课记录','class-records',`data-id="${c.id}"`)}</div></div>${expanded ? `<div class="class-detail"><div class="class-detail-top"><span class="small muted">${variant === 'c' ? '展开后直接处理这个班的学生' : '班级名单'} · ${c.course} · 2026 秋季</span><div class="inline-items">${textBtn('整班续班','class-renewal',`data-id="${c.id}"`)}${textBtn('班级安排','class-info',`data-id="${c.id}"`)}</div></div><div class="member-grid">${people.map(p => `<button type="button" class="member" data-action="edit" data-id="${p.id}" data-mode="teaching"><span class="member-name"><span>${p.name}</span><span class="small muted">${p.grade} 年级</span></span>${tag(p.renewal === '未联系' ? '寒假待联系' : p.renewal)}<div class="member-status">${p.attendance === '待登记' ? p.note.slice(0,15) : `本课${p.attendance} · 已登记`}</div></button>`).join('')}${people.length < c.capacity ? `<button type="button" class="member empty" data-action="place-in-class" data-id="${c.id}">＋ 安排学生<br><span class="small">余 ${c.capacity - people.length} 个位置</span></button>` : ''}</div></div>` : ''}`; }).join('')}</div>`; }).join('')}${!list.length ? '<div class="empty-state">没有符合条件的班级。</div>' : ''}<p class="view-note"><span class="note-rule"></span>点学生查看与登记；从班级可以连续处理教学和续班。</p>`;
  }
  function teachingTable() {
    const scoped = scopeClasses();
    return `${scoped.map(c => { const people = members(c.id).filter(p => !state.search || (p.name+p.note).includes(state.search)); return `<div class="group-label">${c.name}<span>${c.day} · ${c.lesson} · ${c.teacher}</span></div>${table(['学生','本课出勤','课堂 / 家长反馈','寒假续班','本课登记'],people.map(p => `<tr><td>${openPersonButton(p)}</td><td>${tag(p.attendance)}</td><td>${esc(p.records.find(r => r.mode === 'teaching')?.note || p.note)}</td><td>${tag(p.renewal)}</td><td class="actions">${textBtn('登记','edit',`data-id="${p.id}" data-mode="teaching"`)}</td></tr>`))}`; }).join('')}<p class="view-note"><span class="note-rule"></span>本周课次记录 · 出勤、学习情况和课后沟通在同一行处理。</p>`;
  }
  function classesPage() {
    const availableTabs = [['arrange','班级安排'],['teaching','上课与记录'],...(variant === 'a' ? [['renewal','续班跟进']] : [])];
    const actualTab = availableTabs.some(item => item[0] === state.tab) ? state.tab : 'arrange';
    return heading(variant === 'a' ? '名单、入班安排、每次上课和续班，都从班级展开。' : variant === 'b' ? '组织班级，完成每一课的教学与记录。' : '按班连续处理学生，记录留在原班级与学生下。') + tabs(availableTabs,actualTab) + command({classFilter: actualTab === 'renewal',period: actualTab === 'renewal' ? '续班目标：2027 寒假数学' : actualTab === 'teaching' ? '本周 · 09.14–09.20' : '2026 秋季'}) + (actualTab === 'teaching' ? teachingTable() : actualTab === 'renewal' ? renewalTable() : classBoard());
  }

  function renewalTable() {
    const filter = state.renewFilter || '全部';
    const all = renewals();
    const people = all.filter(p => filter === '全部' || p.renewal === filter);
    return `<div class="inline-items" style="margin-bottom:15px">${['全部','未联系','考虑中','意向确认','本轮不续'].map(value => `<button type="button" class="button ${filter === value ? 'accent' : ''}" data-action="renew-filter" data-value="${value}" aria-pressed="${filter === value}">${value} <span class="small muted">${value === '全部' ? all.length : all.filter(p => p.renewal === value).length}</span></button>`).join('')}</div>${table(['学生 / 当前班级','续报目标','本轮情况','最近沟通','处理'],people.map(p => `<tr><td>${openPersonButton(p)}<span class="sub">${classroom(p.classId)?.name || '等班'}</span></td><td>寒假数学思维<span class="sub">2027 寒假 · 原班优先</span></td><td>${tag(p.renewal)}</td><td>${esc(p.records.find(r => r.mode === 'renewal')?.note || p.note)}</td><td>${textBtn('登记续班','edit',`data-id="${p.id}" data-mode="renewal"`)}</td></tr>`))}${footer(people.length)}<p class="view-note"><span class="note-rule"></span>本轮寒假续班 · 秋季在读关系继续保留。</p>`;
  }
  function renewalPage() {
    return heading('按原班组织本轮联系，逐人登记寒假安排。') + command({ classFilter: true, period: '2027 寒假数学 · 跟进中' }) + renewalTable();
  }
  function modeFor(p) { return ['待首联','已联系','测后跟进'].includes(p.stage) ? 'contact' : p.stage === '待测评' ? 'assessment' : p.classId ? 'teaching' : 'note'; }
  function studentRows(people, mode = '') {
    return people.map(p => {
      const actionMode = mode || modeFor(p);
      return `<tr><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级 · ${esc(p.owner || '林老师')}负责</span></td><td>${p.classId ? `${classroom(p.classId).name}<span class="sub">数学思维 · 2026 秋季</span>` : `${tag(p.stage)}<span class="sub">${p.stage === '等班' ? '秋季数学已报名' : '秋季数学意向'}</span>`}</td><td>${p.classId ? tag(p.renewal === '未联系' ? '寒假待联系' : p.renewal) : tag(p.stage === '待测评' ? p.assessment : p.stage)}</td><td>${esc(p.note)}</td><td class="actions">${p.stage === '等班' ? textBtn('安排班级','place',`data-id="${p.id}"`) : textBtn(actionMode === 'assessment' ? '登记测评' : actionMode === 'teaching' ? '本课登记' : '联系登记','edit',`data-id="${p.id}" data-mode="${actionMode}"`)}</td></tr>`;
    });
  }
  function studentsPage() {
    const studentTab = ['all','firstcontact','assessment','waiting','attending','renewal'].includes(state.tab) ? state.tab : 'all';
    const choices = variant === 'a' ? [['all','全部学生'],['firstcontact','新客联系'],['assessment','测评'],['waiting','等班'],['attending','在读'],['renewal','续班跟进']] : [['all','全部资料'],['attending','在读学生'],['firstcontact','意向学生']];
    let people = scopePeople();
    if (studentTab === 'firstcontact') people = people.filter(p => variant === 'a' ? ['待首联','已联系'].includes(p.stage) : !p.classId && p.stage !== '等班');
    if (studentTab === 'assessment') people = people.filter(p => ['待测评','测后跟进'].includes(p.stage));
    if (studentTab === 'waiting') people = people.filter(p => p.stage === '等班');
    if (studentTab === 'attending' || studentTab === 'renewal') people = people.filter(p => p.classId);
    const content = studentTab === 'renewal' ? renewalTable() : table(['学生','当前课程关系','需要关注','最近记录','操作'],studentRows(people)) + footer(people.length);
    const header = heading(variant === 'a' ? '先找到学生，切换范围后连续处理，也可随时查看完整经历。' : '按姓名查找学生，查看课程、活动和沟通的完整经历。') + tabs(choices,studentTab) + command({ period: '学生与意向名单' });
    return header + (variant === 'b' ? `<div class="archive-layout"><div>${content}</div><aside class="archive-hint"><h3>按事情去处理</h3><p>新客联系、测评与等班<br>${textBtn('进入招生 →','navigate','data-page="admissions"')}</p><p>当前上课与课后记录<br>${textBtn('进入教学 →','navigate','data-page="classes"')}</p><p>下一期的课程安排<br>${textBtn('进入续班 →','navigate','data-page="renewal"')}</p><p>点姓名查看完整经历。</p></aside></div>` : content);
  }
  function admissionsPage() {
    const tab = ['firstcontact','assessment','postassessment','waiting'].includes(state.tab) ? state.tab : 'firstcontact';
    const stages = { firstcontact: '待首联', assessment: '待测评', postassessment: '测后跟进', waiting: '等班' };
    const people = scopePeople().filter(p => p.stage === stages[tab] || (tab === 'firstcontact' && p.stage === '已联系'));
    return heading('从第一次联系到课程报名，沿当前需要处理的环节推进。') + tabs([['firstcontact','新客联系',data.people.filter(p => p.stage === '待首联').length],['assessment','测评安排',data.people.filter(p => p.stage === '待测评').length],['postassessment','测后沟通',data.people.filter(p => p.stage === '测后跟进').length],['waiting','报名等班',waiting().length]],tab) + command({period: '秋季招生'}) + (tab === 'waiting' ? waitingTable(people) : table(['学生 / 负责人','课程意向','当前进展','最近情况','处理'],studentRows(people,tab === 'assessment' ? 'assessment' : 'contact')) + footer(people.length));
  }
  function waitingTable(people) {
    return table(['学生','已报名课程','可上课时间 / 备注','安排班级'],people.map(p => `<tr><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级</span></td><td>数学思维 · 2026 秋季<span class="sub">已报名 · 等待入班</span></td><td>${esc(p.note)}</td><td>${btn('选择班级','place',`data-id="${p.id}"`,'accent')}</td></tr>`)) + footer(people.length) + `<p class="view-note"><span class="note-rule"></span>安排后，学生会出现在对应班级名单中。</p>`;
  }
  function worklistPage() {
    const stage = { firstcontact: '待首联', assessments: '待测评', waiting: '等班' }[state.page];
    const people = scopePeople().filter(p => p.stage === stage || (state.page === 'firstcontact' && p.stage === '已联系'));
    const descriptions = { firstcontact: '本周新线索 · 林老师负责 · 按名单连续联系。', assessments: '已预约、待完成的测评 · 记录每次真实结果。', waiting: '已报名秋季课程，等待安排合适班级。' };
    return heading(descriptions[state.page]) + command({period: state.page === 'assessments' ? '本周测评' : '2026 秋季'}) + (state.page === 'waiting' ? waitingTable(people) : table(['学生 / 负责人','课程意向','当前进展','最近情况','处理'],studentRows(people,state.page === 'assessments' ? 'assessment' : 'contact')) + footer(people.length));
  }
  function activitiesPage() {
    return heading('围绕一场活动安排参与者、到场、观察与后续联系。') + `<div class="command"><span class="scope">即将进行 / 进行中</span><span class="right small muted">2 场活动</span></div><div class="data-table"><div class="activity-row"><div class="date-block">9 月<strong>19</strong>周六</div><div><h3>数学探险 · 周末公开课</h3><p class="small muted" style="margin-top:5px">16:00–17:00 · 星光教室 · 李老师</p></div><div class="activity-number">${activityPeople().length} 人预约<div class="small muted">${activityPeople().filter(p => p.activity === '已到场').length} 人到场</div></div>${btn('进入场次','navigate','data-page="activity"','accent')}</div><div class="activity-row"><div class="date-block">9 月<strong>26</strong>周六</div><div><h3>数独体验 · 推理挑战</h3><p class="small muted" style="margin-top:5px">10:00–11:00 · 月亮教室 · 陈老师</p></div><div class="activity-number">筹备中<div class="small muted">计划 8 个名额</div></div>${textBtn('查看安排','event-info')}</div></div>`;
  }
  function activityPage() {
    const list = activityPeople().filter(p => !state.search || (p.name + p.note).includes(state.search));
    const currentTab = state.tab === 'after' ? 'after' : 'onsite';
    return heading('9 月 19 日 16:00–17:00 · 星光教室 · 李老师') + tabs([['onsite','本场参与与登记'],['after','后续联系']],currentTab) + `<div class="activity-summary"><span>预约 <strong>${activityPeople().length}</strong> 人</span><span>到场 <strong>${activityPeople().filter(p => p.activity === '已到场').length}</strong> 人</span><span>对象 <strong>四年级体验学生及在读学生</strong></span></div>` + command({grade:false,period:''}) + table(['学生','已有课程关系',currentTab === 'after' ? '家长反馈' : '本场到场',currentTab === 'after' ? '最近联系' : '本场观察','处理'],list.map(p => `<tr><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级</span></td><td>${p.classId ? `${classroom(p.classId).name}<span class="sub">秋季数学在读</span>` : tag(p.stage)}</td><td>${currentTab === 'after' ? esc(p.records.find(r => r.mode === 'activity')?.feedback || '待了解') : tag(p.activity)}</td><td>${esc(p.records.find(r => r.mode === (currentTab === 'after' ? 'contact' : 'activity'))?.note || '待登记')}</td><td>${textBtn(currentTab === 'after' ? '联系登记' : '现场登记','edit',`data-id="${p.id}" data-mode="${currentTab === 'after' ? 'contact' : 'activity'}"`)}</td></tr>`)) + footer(list.length,'位参与者');
  }
  function todayPage() {
    const contacts = data.people.filter(p => p.stage === '待首联').length;
    const unrenewed = data.people.filter(p => p.classId && p.renewal === '未联系').length;
    return heading(state.role === 'teacher' ? '李老师，今天有 2 节课。上课前后都从这里继续。' : '今天要处理的几件事，打开后直接进入对应名单。') + `<section class="today-section"><div class="today-heading"><h2>今天的课</h2>${textBtn('查看班级 →','scene','data-scene="classes"')}</div><div class="data-table">${classes.filter(c => c.day === '09.19').map(c => `<div class="work-row"><span class="time mono">${c.time.slice(3,8)}</span><div><h3>${c.name}</h3><p class="work-sub">${c.lesson} · ${members(c.id).length} 位学生</p></div><span class="work-owner">${tag(members(c.id).every(p => p.attendance !== '待登记') ? '已完成' : '本课待记录')}</span>${btn('进入本课','class-records',`data-id="${c.id}"`)}</div>`).join('')}</div></section><section class="today-section"><div class="today-heading"><h2>${state.role === 'teacher' ? '课后与家长' : '继续处理'}</h2><span class="small muted">有具体事项的工作名单</span></div><div class="data-table">${[
      ['续班','寒假数学 · 本周联系',`${unrenewed} 位尚未联系 · 秋季在读学生`,'renewal','继续登记'],
      ['入班','秋季课程 · 等班安排',`${waiting().length} 位已报名学生等待安排`,'waiting','安排班级'],
      ['首联','社区体验 · 新客联系',`${contacts} 位家长等待首次联系`,'firstcontact','打开名单'],
      ['活动','数学探险 · 周末公开课',`今天 16:00 · ${activityPeople().length} 位参与者`,'activity','现场登记']
    ].filter(row => state.role !== 'teacher' || ['renewal','activity'].includes(row[3])).map(([type,title,sub,scene,action]) => `<div class="work-row"><span class="time">${type}</span><div><h3>${title}</h3><p class="work-sub">${sub}</p></div><span class="work-owner small muted">${scene === 'activity' ? '李老师 / 林老师' : '林老师负责'}</span>${btn(action,'scene',`data-scene="${scene}"`)}</div>`).join('')}</div></section>`;
  }
  function mergedSourceMap() {
    if (variant !== 'd') return '';
    const rows = [
      ['学服：线索','线索','核对来源、安排负责人'],
      ['学服：首联 ＋ 学生：待首联','首联','同一份联系名单与登记'],
      ['学服：测评 ＋ 学生：待测评','测评','预约、测评与教师建议'],
      ['学生：待报名 ＋ 原分班中的报名、等班','报名与分班','从报名沟通接着安排入班'],
      ['学生：待续班 ＋ 学服：续班 ＋ 原分班中的班级名单','在读与续班','日常教学、家长沟通与下一期安排'],
      ['学生：已停读／课程结束','停读回访','保留过去经历，处理再次联系']
    ];
    return `<details class="merge-map"><summary>这版如何归并原来的十个标签 <span>查看去向</span></summary><div class="merge-map-body">${rows.map(([from,to,purpose]) => `<div class="merge-map-row"><span>${from}</span><span aria-hidden="true">→</span><strong>${to}</strong><span class="muted">${purpose}</span></div>`).join('')}<p class="small muted">教师班级页和教学工作台中的日常登记一起进入“在读与续班”。活动仍按场次组织；查找学生始终可用。此处是试排说明，名称与合并范围均可继续调整。</p></div></details>`;
  }
  function globalFinder() {
    if (variant !== 'd') return '';
    const query = state.lookup || '';
    const matches = query ? [...data.people,...(data.formerPeople || [])].filter(p => p.name.includes(query)).slice(0,6) : [];
    return `<div class="global-findbar"><span class="small muted">${state.role === 'teacher' ? '李老师 · 我任教的班级' : state.role === 'manager' ? '周主管 · 全部负责范围' : '林老师 · 全部负责范围'}</span><div class="global-find"><input type="search" data-control="lookup" aria-label="随时查找学生" placeholder="随时找学生…" value="${esc(query)}">${query ? `<div class="global-results" aria-label="学生搜索结果">${matches.length ? matches.map(p => `<button type="button" data-action="edit" data-id="${p.id}" data-mode="profile"><strong>${p.name}</strong><span class="small muted">${p.grade} 年级 · ${p.stage}</span></button>`).join('') : '<p class="small muted">没有匹配的学生。</p>'}</div>` : ''}</div></div>`;
  }
  function mergedServicePeople() {
    const available = new Set(scopeClasses().map(c => c.id));
    return scopePeople().filter(p => available.has(p.classId)).filter(p => state.serviceFilter === 'lesson' ? p.attendance === '待登记' : state.serviceFilter === 'renewal' ? ['未联系','考虑中'].includes(p.renewal) : state.serviceFilter === 'declined' ? p.renewal === '本轮不续' : true);
  }
  function inlineDraft(p) {
    state.inlineDrafts ||= {};
    return state.inlineDrafts[p.id] ||= { attendance:p.attendance,renewal:p.renewal,teachingNote:p.records.find(r => r.mode === 'teaching')?.note || '',renewalNote:p.records.find(r => r.mode === 'renewal')?.note || '' };
  }
  function serviceInline(p) {
    if (state.inlineId !== p.id) return '';
    const values = inlineDraft(p);
    return `<tr class="service-detail-row"><td colspan="5"><form id="service-row-form" class="service-inline"><div class="service-fields"><section><h3>本课记录 <span>${classroom(p.classId).lesson}</span></h3>${field('出勤','attendance',['待登记','出勤','迟到','请假','缺席'],values.attendance)}<label class="field"><span>课堂观察 / 课后沟通</span><textarea name="teachingNote" placeholder="本课理解、课堂表现、与家长的沟通…">${esc(values.teachingNote)}</textarea></label></section><section><h3>下一期安排 <span>2027 寒假数学</span></h3>${field('续班情况','renewal',['未联系','考虑中','意向确认','本轮不续'],values.renewal)}<label class="field"><span>家长想法 / 后续安排</span><textarea name="renewalNote" placeholder="可以只记本课，也可以接着处理续班…">${esc(values.renewalNote)}</textarea></label></section></div><div class="service-save"><span class="small muted">${state.inlineSaved === p.id ? '✓ 本次记录已保存' : `${p.name} · 按本次实际处理的内容填写`}</span>${btn('收起','inline-close')}${btn('保存并下一位','save-service-next')}${btn('保存','save-service','','primary')}</div></form></td></tr>`;
  }
  function serviceRows(people) {
    return people.flatMap(p => [`<tr class="${state.inlineId === p.id ? 'service-active' : ''}"><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级</span></td><td>${tag(p.attendance)}<span class="sub">${esc((p.records.find(r => r.mode === 'teaching')?.note || '本课记录待补充').slice(0,23))}</span></td><td>${tag(p.renewal)}<span class="sub">寒假数学 · 本轮安排</span></td><td class="service-recent">${esc(p.note)}</td><td>${textBtn(state.inlineId === p.id ? '收起' : '展开登记','inline-open',`data-id="${p.id}"`)}</td></tr>`,serviceInline(p)]).filter(Boolean);
  }
  function mergedServicePage() {
    const people = mergedServicePeople();
    const rows = state.grouping === 'student' ? serviceRows(people) : scopeClasses().flatMap(c => {
      const list = people.filter(p => p.classId === c.id);
      if (!list.length && state.serviceFilter && state.serviceFilter !== 'all') return [];
      const expanded = state.expanded.has(c.id);
      return [`<tr class="service-group"><td colspan="5"><div><button type="button" data-action="expand" data-id="${c.id}" aria-expanded="${expanded}">${expanded ? '▾' : '▸'} ${c.name} <span class="muted small">${list.length} 人 · ${c.teacher} · ${c.time}</span></button>${textBtn('班级安排','class-info',`data-id="${c.id}"`)}</div></td></tr>`,...(expanded ? serviceRows(list) : [])];
    });
    return heading('本期上课、家长沟通、下期续班，沿同一份名单接着处理。') + command({ classFilter:true,period:'2026 秋季在读 · 寒假续班已开启' }) + `<div class="service-controls"><label><span>处理范围</span><select data-control="serviceFilter" aria-label="在读工作范围">${options([['all','全部在读'],['lesson','本课待登记'],['renewal','续班待联系'],['declined','本轮不续，继续本期']],state.serviceFilter || 'all')}</select></label><label><span>名单排列</span><select data-control="grouping" aria-label="名单排列">${options([['class','按班级'],['student','按学生']],state.grouping || 'class')}</select></label><span class="small muted">本范围 ${people.length} 位学生</span></div>${table(['学生','本周课堂','本轮寒假续班','最近情况','登记'],rows)}<p class="view-note"><span class="note-rule"></span>姓名打开完整经历；“展开登记”在当前名单内处理。班级用于组织这份名单。</p>`;
  }
  function mergedEnrollmentPage() {
    const people = scopePeople().filter(p => ['测后跟进','等班'].includes(p.stage));
    return heading('测后沟通、确认报名、安排入班，在同一张名单里接续。') + command({period:'数学思维 · 2026 秋季'}) + table(['学生','当前情况','报名沟通','班级安排','下一步'],people.map(p => `<tr><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级</span></td><td>${tag(p.stage === '等班' ? '报名已确认' : p.enrollmentResult || '测后待报名')}</td><td>${esc(p.note)}</td><td>${p.stage === '等班' ? '等待安排班级' : '<span class="muted">确认报名后安排</span>'}</td><td>${p.stage === '等班' ? btn('安排班级','place',`data-id="${p.id}"`,'accent') : textBtn('登记报名','edit',`data-id="${p.id}" data-mode="enrollment"`)}</td></tr>`)) + footer(people.length) + `<div class="inline-items">${textBtn('查看在读名单 →','navigate','data-page="service"')}<span class="small muted">入班后，日常记录在“在读与续班”继续。</span></div>`;
  }
  function mergedWorkPage() {
    if (state.page === 'service') return mergedServicePage();
    if (state.page === 'enrollment') return mergedEnrollmentPage();
    if (state.page === 'sources') {
      const people = scopePeople().filter(p => ['s14','s16'].includes(p.id));
      return heading('核对获客来源，安排负责人，再进入首联。') + command({period:'本周来源名单'}) + table(['姓名','来源','负责人','当前联系情况','处理'],people.map(p => `<tr><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级</span></td><td>${p.id === 's14' ? '社区体验活动' : '朋友介绍'}</td><td>${esc(p.owner || '林老师')}</td><td>${tag(p.contactOutcome || '尚未联系')}</td><td>${textBtn('分配负责人','edit',`data-id="${p.id}" data-mode="assignment"`)}</td></tr>`)) + footer(people.length) + textBtn('进入首联名单 →','navigate','data-page="firstcontact"');
    }
    const people = (data.formerPeople || []).filter(p => !state.search || (p.name+p.note).includes(state.search));
    return heading('看过去的课程经历，记录暂停后的联系与重新报读想法。') + command({grade:false,period:'所有课程关系已结束'}) + table(['学生','过去的课程','结束时间','回访情况','处理'],people.map(p => `<tr><td>${openPersonButton(p)}<span class="sub">${p.grade} 年级</span></td><td>${p.pastClass}</td><td>${p.ended}</td><td>${tag(p.followUp)}<span class="sub">${esc(p.note)}</span></td><td>${textBtn('登记回访','edit',`data-id="${p.id}" data-mode="recontact"`)}</td></tr>`)) + footer(people.length);
  }
  function saveService(next = false) {
    const p = person(state.inlineId); const form = root.querySelector('#service-row-form');
    if (!p || !form) return;
    const people = mergedServicePeople();
    const values = Object.fromEntries(new FormData(form));
    values.teachingNote = values.teachingNote.trim(); values.renewalNote = values.renewalNote.trim();
    const changedTeaching = values.attendance !== p.attendance || values.teachingNote !== (p.records.find(r => r.mode === 'teaching')?.note || '');
    const changedRenewal = values.renewal !== p.renewal || values.renewalNote !== (p.records.find(r => r.mode === 'renewal')?.note || '');
    if (changedTeaching) { p.attendance = values.attendance; p.records.unshift({ mode:'teaching',note:values.teachingNote,result:values.attendance,context:editorContext(p,'teaching') }); }
    if (changedRenewal) { p.renewal = values.renewal; p.records.unshift({ mode:'renewal',note:values.renewalNote,result:values.renewal,context:editorContext(p,'renewal') }); }
    if (changedTeaching || changedRenewal) { p.note = values.renewalNote || values.teachingNote || p.note; persist(); }
    state.inlineSaved = p.id; state.inlineDrafts[p.id] = values;
    if (next) { const following = people[people.findIndex(row => row.id === p.id) + 1]; if (following) { state.inlineId = following.id; state.expanded.add(following.classId); } }
    render(); root.querySelector('#service-row-form select')?.focus();
    toast(changedTeaching || changedRenewal ? `${p.name} · 已保存本次处理内容` : next ? '继续处理下一位' : '当前记录已是最新');
  }
  function renderPage() {
    if (variant === 'd' && ['sources','enrollment','service','former'].includes(state.page)) return mergedWorkPage();
    if (state.page === 'classes') return classesPage();
    if (state.page === 'students') return studentsPage();
    if (state.page === 'admissions') return admissionsPage();
    if (state.page === 'renewal') return renewalPage();
    if (state.page === 'activities') return activitiesPage();
    if (state.page === 'activity') return activityPage();
    if (['firstcontact','assessments','waiting'].includes(state.page)) return worklistPage();
    return todayPage();
  }
  function sceneTarget(scene) {
    if (variant === 'd') return scene === 'waiting' ? ['enrollment','all'] : scene === 'firstcontact' ? ['firstcontact','all'] : scene === 'activity' ? ['activity','onsite'] : ['service','all'];
    if (scene === 'classes') return ['classes',state.role === 'teacher' ? 'teaching' : 'arrange'];
    if (scene === 'waiting') return variant === 'a' ? ['classes','arrange'] : variant === 'b' ? ['admissions','waiting'] : ['waiting','all'];
    if (scene === 'renewal') return variant === 'a' ? ['classes','renewal'] : ['renewal','all'];
    if (scene === 'firstcontact') return variant === 'a' ? ['students','firstcontact'] : variant === 'b' ? ['admissions','firstcontact'] : ['firstcontact','all'];
    return ['activity','onsite'];
  }
  function setScene(scene) {
    if (!['classes','waiting','renewal','activity','firstcontact'].includes(scene)) return;
    [state.page,state.tab] = sceneTarget(scene);
    state.scene = scene; state.search = ''; state.grade = 'all'; state.classroom = 'all'; state.renewFilter = '全部';
    state.serviceFilter = scene === 'renewal' ? 'renewal' : 'all';
  }
  function navigate(page) {
    if (variant === 'd') page = ['classes','renewal','today'].includes(page) ? 'service' : ['waiting','admissions'].includes(page) ? 'enrollment' : page;
    state.page = page; state.search = ''; state.grade = 'all'; state.classroom = 'all'; state.scene = ''; state.renewFilter = '全部';
    state.serviceFilter = 'all';
    state.tab = page === 'classes' ? (state.role === 'teacher' ? 'teaching' : 'arrange') : page === 'admissions' ? 'firstcontact' : page === 'activity' ? 'onsite' : 'all';
  }
  function persist() { try { localStorage.setItem(storageKey,JSON.stringify(data)); } catch { /* 保存结果仍保留在当前打开的示例中。 */ } }
  function toast(message) {
    clearTimeout(toastTimer); root.querySelector('.toast')?.remove();
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role','status'); el.textContent = message; root.append(el);
    toastTimer = setTimeout(() => el.remove(),3200);
  }

  const modeLabels = { profile: '学生资料', teaching: '本课记录', renewal: '寒假续班', contact: '联系登记', assessment: '测评登记', activity: '公开课现场', note: '沟通记录', enrollment:'报名安排',recontact:'停读回访',assignment:'线索分配' };
  function editorContext(p, mode) {
    if (mode === 'enrollment') return '数学思维 · 2026 秋季 · 确认后继续安排班级';
    if (mode === 'recontact') return `${p.pastClass} · 结束后的再次联系`;
    if (mode === 'assignment') return '新线索 · 核对来源与安排负责人';
    if (mode === 'teaching') return `${classroom(p.classId)?.name || '班级'} · ${classroom(p.classId)?.lesson || '本次课'}`;
    if (mode === 'renewal') return '2026 秋季数学 → 2027 寒假数学';
    if (mode === 'activity') return '数学探险 · 09.19 周末公开课';
    if (mode === 'assessment') return '数学学习测评 · 本次预约';
    if (mode === 'contact') return p.classId ? '家长联系 · 秋季数学' : '秋季数学 · 招生沟通';
    return p.classId ? `${classroom(p.classId).name} · 秋季数学` : '学生沟通';
  }
  function createDraft(p, mode) {
    const recent = p.records.find(r => r.mode === mode);
    return { note: recent?.note || '', attendance: p.attendance, renewal: p.renewal, activity: p.activity, contact: p.contactOutcome || '待联系', assessment: p.assessment, understanding: recent?.understanding || '能够理解，表达需引导', feedback: recent?.feedback || '', next: recent?.next || '', channel: recent?.channel || '微信', nextStep: recent?.nextStep || '继续了解课程', enrollmentResult:p.enrollmentResult || (p.stage === '等班' ? '报名已确认' : '考虑中'),followUp:p.followUp || '尚未回访',owner:p.owner || '林老师' };
  }
  function openEditor(id, mode) {
    const p = person(id); if (!p) return;
    state.editor = { id, mode }; state.drawerTab = mode === 'profile' ? 'history' : 'entry'; state.saved = false; state.draft = createDraft(p,mode);
    state.placement = null; state.info = null;
  }
  function entryFields(p, mode) {
    const draft = state.draft;
    const context = `<div class="form-context"><strong>${modeLabels[mode]}</strong>${editorContext(p,mode)}</div>`;
    let fields = '';
    if (mode === 'enrollment') fields = field('本次报名情况','enrollmentResult',['考虑中','报名已确认','暂不报名'],draft.enrollmentResult);
    if (mode === 'recontact') fields = field('本次回访结果','followUp',['尚未回访','下期再联系','重新了解课程','安排复测','暂不考虑'],draft.followUp);
    if (mode === 'assignment') fields = field('负责人','owner',['林老师','陈老师','周主管'],draft.owner);
    if (mode === 'teaching') fields = `<div class="two-fields">${field('本课出勤','attendance',['待登记','出勤','迟到','请假','缺席'],draft.attendance)}${field('学习情况','understanding',['能够理解，表达需引导','独立完成，思路清晰','需要课后再巩固'],draft.understanding)}</div>`;
    if (mode === 'renewal') fields = field('本轮续班情况','renewal',['未联系','考虑中','意向确认','本轮不续'],draft.renewal) + `<div class="two-fields">${field('联系渠道','channel',['微信','电话','当面'],draft.channel)}<label class="field"><span>下次联系（可选）</span><input type="date" name="next" value="${esc(draft.next)}"></label></div>`;
    if (mode === 'contact') fields = `<div class="two-fields">${field('联系结果','contact',['待联系','已接通','稍后再联系','暂不考虑'],draft.contact)}${field('联系渠道','channel',['微信','电话','当面'],draft.channel)}</div>${field('接下来','nextStep',['继续了解课程','协调测评时间','邀请参加公开课','暂缓联系'],draft.nextStep)}`;
    if (mode === 'assessment') fields = `<div class="two-fields">${field('本次测评','assessment',['待测评','进行中','已完成','未到场'],draft.assessment)}${field('学习表现','understanding',['能够理解，表达需引导','独立完成，思路清晰','需要课后再巩固'],draft.understanding)}</div>`;
    if (mode === 'activity') fields = field('本场参与','activity',['已预约','已到场','未到场','已取消'],draft.activity) + `<label class="field"><span>家长反馈（可选）</span><input name="feedback" value="${esc(draft.feedback)}" placeholder="例如：希望了解周日下午的数学班"></label>`;
    return `<form id="entry-form">${context}${fields}<label class="field"><span>${mode === 'teaching' ? '课堂观察 / 课后沟通' : mode === 'assessment' ? '教师建议' : mode === 'activity' ? '本场观察' : '本次记录'}${mode === 'note' ? '' : '（可选）'}</span><textarea name="note" placeholder="记录实际情况，下次接着处理…">${esc(draft.note)}</textarea></label>${mode === 'teaching' ? `<p class="small muted">寒假安排 ${tag(p.renewal)} ${textBtn('办理续班 →','drawer-mode','data-mode="renewal"')}</p>` : ''}<p class="small muted">保存后，同一学生在班级、学生资料和相应工作清单中可查看这条记录。</p></form>`;
  }
  function historyMarkup(p) {
    const base = p.pastClass ? [{ mode: 'note', title: '课程结束', note: '本期课程已结束，过去的学习经历持续保留。', context: p.pastClass, time: p.ended + ' · 课程记录' }] : p.classId ? [{ mode: 'teaching', title: '上周课堂记录', note: '能跟上本次内容，鼓励把解题思路完整说出来。', context: `${classroom(p.classId).name} · 第 3 讲`, time: '09.12 · 李老师' },{ mode: 'note', title: '秋季数学报名与入班', note: `已安排在${classroom(p.classId).name}。`, context: '数学思维 · 2026 秋季', time: '08.28 · 林老师' }] : [{ mode: 'note', title: '最近沟通', note: p.note, context: '秋季数学', time: '09.17 · 林老师' }];
    const records = [...p.records.map(r => ({ ...r, title: modeLabels[r.mode], time: '今天 · 刚刚保存' })),...base];
    return `<div class="timeline">${records.map(r => `<article class="timeline-item"><div class="label">${tag(r.title,'blue')}<span class="muted">${esc(r.result || '')}</span></div><p>${esc(r.note || '已登记本次结果。')}</p><div class="stamp">${esc(r.context)}<br>${esc(r.time)}</div></article>`).join('')}</div><div class="drawer-quick">${btn('补充沟通','drawer-mode','data-mode="note"')}${p.classId ? btn('本课登记','drawer-mode','data-mode="teaching"') + btn('寒假续班','drawer-mode','data-mode="renewal"') : ''}</div>`;
  }
  function relationshipsMarkup(p) {
    if (p.pastClass) return `<div class="relation"><div class="inline-items"><strong>数学思维 · 2026 春季</strong>${tag('课程已结束')}</div><p class="small muted">${p.pastClass}<br>结束于 ${p.ended}</p></div><div class="relation"><h3>再次联系</h3><p class="small muted">${esc(p.followUp)}</p>${textBtn('登记回访 →','drawer-mode','data-mode="recontact"')}</div>`;
    return `${p.classId ? `<div class="relation"><div class="inline-items"><strong>秋季数学思维</strong>${tag('在读','green')}</div><p class="small muted">${classroom(p.classId).name}<br>${classroom(p.classId).time} · ${classroom(p.classId).teacher}</p></div><div class="relation"><div class="inline-items"><strong>寒假数学思维</strong>${tag(p.renewal)}</div><p class="small muted">2027 寒假 · 本轮续班安排</p>${textBtn('登记本轮续班 →','drawer-mode','data-mode="renewal"')}</div>` : `<div class="relation"><div class="inline-items"><strong>秋季数学思维</strong>${tag(p.stage)}</div><p class="small muted">${p.stage === '等班' ? '已报名，等待安排班级' : '课程了解与测评阶段'}</p>${p.stage === '等班' ? textBtn('安排班级 →','place',`data-id="${p.id}"`) : textBtn('联系登记 →','drawer-mode','data-mode="contact"')}</div>`}${activityPeople().some(s => s.id === p.id) ? `<div class="relation"><div class="inline-items"><strong>数学探险 · 公开课</strong>${tag(p.activity)}</div><p class="small muted">9 月 19 日 · 一次活动参与</p>${textBtn('本场登记 →','drawer-mode','data-mode="activity"')}</div>` : ''}${p.id === 's1' ? `<div class="relation"><div class="inline-items"><strong>数独体验</strong>${tag('意向了解')}</div><p class="small muted">另一门课程的意向，与数学在读并存。</p></div>` : ''}`;
  }
  function drawer() {
    if (!state.editor) return '';
    const p = person(state.editor.id); if (!p) return '';
    const mode = state.editor.mode;
    return `<div class="overlay" data-overlay="editor"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1"><header class="drawer-heading"><div class="drawer-top"><div><h2 class="person-title" id="drawer-title">${p.name}</h2><span class="small muted">${p.grade} 年级 · ${esc(p.owner || '林老师')}负责</span></div><button type="button" class="close" data-action="close" aria-label="关闭学生登记">×</button></div><div class="drawer-context"><span>从${pageTitle()}进入</span><span>›</span><span>${modeLabels[mode]}</span></div></header>${tabs([...(mode !== 'profile' ? [['entry',modeLabels[mode]]] : []),['history','完整记录'],['relations','课程与活动']],state.drawerTab,'drawer-tab').replace('class="tabs"','class="tabs drawer-tabs"')}<div class="drawer-body">${state.drawerTab === 'entry' ? entryFields(p,mode) : state.drawerTab === 'relations' ? relationshipsMarkup(p) : historyMarkup(p)}</div><footer class="drawer-actions">${state.saved ? '<span class="saved" role="status">✓ 已保存到示例</span>' : '<span class="saved"></span>'}${btn('关闭','close')}${state.drawerTab === 'entry' ? btn('保存并下一位','save-next') + btn('保存','save','','primary') : ''}</footer></section></div>`;
  }
  function modal() {
    if (state.info) {
      const c = classroom(state.info);
      return `<div class="overlay" data-overlay="modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="drawer-top"><h2 id="modal-title">${c ? c.name : '数独体验 · 推理挑战'}</h2><button type="button" class="close" data-action="close" aria-label="关闭安排">×</button></div>${c ? `<div class="relation"><h3>2026 秋季 · ${c.course}</h3><p class="muted small">${c.time}<br>${c.teacher} · ${c.room}<br>当前 ${members(c.id).length} 人 / 容量 ${c.capacity} 人</p></div><div class="relation"><h3>最近一课</h3><p class="small muted">${c.day} · ${c.lesson}</p></div><div class="drawer-quick">${btn('查看上课记录','class-records',`data-id="${c.id}"`,'primary')}${btn('处理整班续班','class-renewal',`data-id="${c.id}"`)}</div>` : '<p class="muted">9 月 26 日 10:00–11:00 · 月亮教室</p><div class="relation"><h3>活动安排</h3><p class="small muted">陈老师带领 · 四、五年级 · 计划 8 个名额<br>现场观察推理思路与表达过程。</p></div>'}</section></div>`;
    }
    if (!state.placement) return '';
    const p = person(state.placement.studentId);
    const c = classroom(state.placement.classId);
    const choices = p ? classes.filter(target => target.grade === p.grade) : waiting().filter(s => s.grade === c.grade);
    return `<div class="overlay" data-overlay="modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="drawer-top"><h2 id="modal-title">${p ? `为${p.name}安排班级` : `安排学生 · ${c.name}`}</h2><button type="button" class="close" data-action="close" aria-label="关闭安排">×</button></div><p class="small muted">数学思维 · 2026 秋季 · ${p ? `${p.grade} 年级` : `${members(c.id).length} / ${c.capacity} 人`}</p><div class="choices">${choices.map(item => p ? `<button type="button" class="choice" data-action="assign" data-student="${p.id}" data-class="${item.id}" ${members(item.id).length >= item.capacity ? 'disabled' : ''}><span>${item.name}<span class="sub small muted" style="display:block">${item.teacher} · ${item.time}</span></span><span class="small">${members(item.id).length}/${item.capacity} 人 →</span></button>` : `<button type="button" class="choice" data-action="assign" data-student="${item.id}" data-class="${c.id}"><span>${item.name}<span class="sub small muted" style="display:block">${item.note}</span></span><span>安排 →</span></button>`).join('') || '<p class="empty-state">这个年级目前没有等班学生。</p>'}</div></section></div>`;
  }
  function saveEntry(next = false) {
    if (!state.editor || state.drawerTab !== 'entry') return;
    const p = person(state.editor.id); const mode = state.editor.mode;
    const form = root.querySelector('#entry-form'); if (!form || !p) return;
    const values = Object.fromEntries(new FormData(form));
    const note = String(values.note || '').trim();
    if (mode === 'note' && !note) { form.querySelector('textarea').focus(); toast('请先填写本次沟通记录。'); return; }
    const pending = (mode === 'teaching' && values.attendance === '待登记') || (mode === 'renewal' && values.renewal === '未联系') || (mode === 'contact' && values.contact === '待联系') || (mode === 'assessment' && values.assessment === '待测评');
    if (pending && !note) { toast('选择本次结果，或填写一条实际记录后保存。'); return; }
    let result = '';
    if (mode === 'enrollment') { result = p.enrollmentResult = values.enrollmentResult; if (result === '报名已确认') p.stage = '等班'; }
    if (mode === 'recontact') result = p.followUp = values.followUp;
    if (mode === 'assignment') result = p.owner = values.owner;
    if (mode === 'teaching') result = p.attendance = values.attendance;
    if (mode === 'renewal') result = p.renewal = values.renewal;
    if (mode === 'activity') result = p.activity = values.activity;
    if (mode === 'assessment') {
      result = p.assessment = values.assessment;
      if (values.assessment === '已完成' && p.stage === '待测评') p.stage = '测后跟进';
    }
    if (mode === 'contact') {
      result = p.contactOutcome = values.contact;
      if (p.stage === '待首联' && ['已接通','暂不考虑'].includes(values.contact)) p.stage = '已联系';
    }
    const record = { ...values, note, mode, result, context: editorContext(p,mode) };
    const previous = p.records[0];
    if (JSON.stringify(record) !== JSON.stringify(previous)) p.records.unshift(record);
    if (note) p.note = note;
    persist(); state.saved = true; state.draft = { ...state.draft,...values };
    if (next) {
      const pool = mode === 'recontact' ? data.formerPeople || [] : mode === 'assignment' ? scopePeople().filter(s => ['s14','s16'].includes(s.id)) : mode === 'enrollment' ? scopePeople().filter(s => ['测后跟进','等班'].includes(s.stage)) : mode === 'renewal' ? renewals() : mode === 'activity' ? activityPeople() : mode === 'teaching' ? members(p.classId) : scopePeople().filter(s => mode === 'assessment' ? s.stage === '待测评' || s.id === p.id : ['待首联','已联系'].includes(s.stage));
      const index = pool.findIndex(s => s.id === p.id);
      const following = pool[index + 1];
      if (following) openEditor(following.id,mode);
      else toast('当前范围已经处理到最后一位。');
    }
    if (variant === 'd' && state.inlineDrafts) delete state.inlineDrafts[p.id];
    render(true); toast(`${p.name} · ${modeLabels[mode]}已保存`);
  }
  function closeOverlay() {
    state.editor = null; state.placement = null; state.info = null; state.saved = false; render();
    const match = returnFocus && [...root.querySelectorAll('[data-action]')].find(el => el.dataset.action === returnFocus.action && el.dataset.id === returnFocus.id && el.dataset.mode === returnFocus.mode);
    (match || root.querySelector('.nav-item.active'))?.focus();
  }
  function render(focusDialog = false) {
    const activeControl = document.activeElement?.dataset?.control;
    const searchActive = ['search','lookup'].includes(activeControl);
    const cursor = searchActive ? document.activeElement.selectionStart : null;
    const isModal = Boolean(state.editor || state.placement || state.info);
    root.innerHTML = prototypeBar() + mergedSourceMap() + `<div class="app" ${isModal ? 'inert' : ''}>${navigation()}<main class="main">${globalFinder()}<div class="breadcrumbs"><span>${variant === 'c' ? '工作清单' : variant === 'd' ? '工作' : '学校运营'}</span><span> / </span><span>${pageTitle()}</span><span style="margin-left:auto" class="small">${layouts[variant].caption}</span></div>${renderPage()}</main></div>${drawer()}${modal()}`;
    if (searchActive) { const input = root.querySelector(`[data-control="${activeControl}"]`); input?.focus(); if (input && cursor !== null) input.setSelectionRange(cursor,cursor); }
    if (focusDialog) root.querySelector('[role="dialog"]')?.focus();
  }
  root.addEventListener('click', event => {
    if (event.target.classList.contains('overlay')) { closeOverlay(); return; }
    const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
    const { action, id, mode, page, scene, tab } = target.dataset;
    if (['edit','place','place-in-class','class-info','event-info'].includes(action)) returnFocus = { action, id, mode };
    if (action === 'navigate') navigate(page);
    if (action === 'scene') setScene(scene);
    if (action === 'tab') { state.tab = tab; state.search = ''; state.renewFilter = '全部'; }
    if (action === 'expand') { state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); }
    if (action === 'edit') { state.lookup = ''; openEditor(id,mode || 'profile'); }
    if (action === 'inline-open') { state.inlineId = state.inlineId === id ? null : id; state.inlineSaved = null; }
    if (action === 'inline-close') state.inlineId = null;
    if (action === 'save-service' || action === 'save-service-next') { saveService(action === 'save-service-next'); return; }
    if (action === 'drawer-tab') state.drawerTab = tab;
    if (action === 'drawer-mode') { if (state.editor) openEditor(state.editor.id,mode); }
    if (action === 'close') { closeOverlay(); return; }
    if (action === 'save' || action === 'save-next') { saveEntry(action === 'save-next'); return; }
    if (action === 'renew-filter') state.renewFilter = target.dataset.value;
    if (action === 'class-records') { navigate('classes'); state.tab = 'teaching'; state.classroom = id; state.scene = 'classes'; state.info = null; state.expanded.add(id); }
    if (action === 'class-renewal') { setScene('renewal'); state.classroom = id; state.info = null; state.expanded.add(id); }
    if (action === 'class-info') state.info = id;
    if (action === 'event-info') state.info = 'event2';
    if (action === 'place') { state.placement = { studentId: id }; state.editor = null; }
    if (action === 'place-in-class') state.placement = { classId: id };
    if (action === 'assign') {
      const p = person(target.dataset.student); const c = classroom(target.dataset.class);
      if (!p || !c || p.stage !== '等班' || p.grade !== c.grade || members(c.id).length >= c.capacity) { toast('这个班暂时不能安排该学生，请重新选择。'); return; }
      p.classId = c.id; p.stage = '在读'; p.records.unshift({ mode:'note',note:`从等班安排进入${c.name}。`,context:'数学思维 · 2026 秋季',result:'已入班' });
      persist(); state.placement = null; state.expanded.add(c.id); render(); toast(`${p.name}已安排到${c.name}`); return;
    }
    if (action === 'reset') { data = freshData(); initializeMergedExamples(); persist(); state.editor = null; state.placement = null; state.info = null; state.saved = false; state.inlineId = null; state.inlineDrafts = {}; state.inlineSaved = null; render(); toast('已恢复这组示例的初始名单。'); return; }
    render(['edit','place','place-in-class','class-info','event-info','drawer-mode','drawer-tab'].includes(action));
  });
  root.addEventListener('change', event => {
    const el = event.target;
    if (el.closest('#service-row-form') && el.name) { inlineDraft(person(state.inlineId))[el.name] = el.value; state.inlineSaved = null; root.querySelector('.service-save > span').textContent = '有待保存的修改'; return; }
    if (el.closest('#entry-form') && el.name) { state.draft[el.name] = el.value; state.saved = false; root.querySelector('.saved')?.replaceChildren(); return; }
    const control = el.dataset.control; if (!control || ['search','lookup'].includes(control)) return;
    state[control] = el.value;
    if (control === 'role') { state.classroom = 'all'; state.grade = 'all'; if (state.scene) setScene(state.scene); else if (state.role === 'teacher' && variant !== 'd') { state.page = 'classes'; state.tab = 'teaching'; } }
    render();
  });
  let searchTimer;
  root.addEventListener('input', event => {
    const el = event.target;
    if (el.closest('#service-row-form') && el.name) { inlineDraft(person(state.inlineId))[el.name] = el.value; state.inlineSaved = null; root.querySelector('.service-save > span').textContent = '有待保存的修改'; }
    if (el.closest('#entry-form') && el.name) { state.draft[el.name] = el.value; state.saved = false; root.querySelector('.saved')?.replaceChildren(); }
    if (['search','lookup'].includes(el.dataset.control)) { state[el.dataset.control] = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => render(),130); }
  });
  root.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'entry-form') saveEntry(); if (event.target.id === 'service-row-form') saveService(); });
  root.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.closest('#service-row-form')) { event.preventDefault(); saveService(); return; }
    const dialog = root.querySelector('[role="dialog"]');
    if (!dialog) return;
    if (event.key === 'Escape') { event.preventDefault(); closeOverlay(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && state.editor) { event.preventDefault(); saveEntry(); return; }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), input, select, textarea, a[href]')];
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    }
  });
  if (params.has('scene')) setScene(params.get('scene'));
  else if (state.role === 'teacher' && variant !== 'd') { state.page = 'classes'; state.tab = 'teaching'; }
  render();
})();
