import type { LeadLane, LeadLight } from "./lead-board-contract";

export function leadBoardMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    title: en ? "Lead board" : "组长观察台",
    info: en ? "Each dot is one student. Its color follows the light rules from top to bottom; the first matching rule wins."
      : "每个点是一名学生，颜色按灯规则从上往下判断，第一条符合的规则决定颜色。",
    unit: en ? "Organization" : "组织", settings: en ? "Light rules" : "灯规则设置", done: en ? "Done" : "完成",
    whole: en ? "Whole team" : "全组",
    lights: {
      gray: en ? "Gray · nothing due yet" : "灰 · 暂无需处理", red: en ? "Red · well overdue" : "红 · 拖延较久", orange: en ? "Orange · overdue" : "橙 · 已超时",
      yellow: en ? "Yellow · due soon" : "黄 · 快到时间", green: en ? "Green · done on time" : "绿 · 按时完成", blue: en ? "Blue · done well" : "蓝 · 完成得好",
    } satisfies Record<LeadLight, string>,
    lightShort: { gray: en ? "Gray" : "灰", red: en ? "Red" : "红", orange: en ? "Orange" : "橙", yellow: en ? "Yellow" : "黄", green: en ? "Green" : "绿", blue: en ? "Blue" : "蓝" } satisfies Record<LeadLight, string>,
    lanes: { support: en ? "Support" : "学服", teach: en ? "Teaching" : "授课", assess: en ? "Assessment" : "测评" } satisfies Record<LeadLane, string>,
    clusters: {
      first: en ? "First contact" : "待首联", assess: en ? "Awaiting assessment" : "待测评", after: en ? "After assessment" : "测评后",
      enroll: en ? "Awaiting enrollment" : "待报名", serve: en ? "Enrolled" : "在读", renew: en ? "Renewal" : "续费期", other: en ? "Other" : "其他",
    } as Record<string, string>,
    steps: { arrival: en ? "Awaiting arrival" : "待到场", record: en ? "Awaiting entry" : "待录入", explain: en ? "Awaiting explanation" : "待讲解", done: en ? "Explained" : "已讲解" } as Record<string, string>,
    labels: { A: en ? "Label A" : "A 类", B: en ? "Label B" : "B 类", C: en ? "Label C" : "C 类", D: en ? "Label D" : "D 类", none: en ? "Unlabeled" : "未标记" } as Record<string, string>,
    results: { connected: en ? "Connected" : "已沟通", unreachable: en ? "Unreachable" : "未接通", declined: en ? "Declined" : "拒绝", invalid_number: en ? "Invalid number" : "号码无效", none: en ? "No record" : "无记录" } as Record<string, string>,
    fields: {
      cluster: en ? "Stage" : "所处阶段", label: en ? "Student label" : "学生标签",
      cadenceOver: en ? "Days past the contact interval" : "超出应联系时间（天）", sinceContact: en ? "Days since last successful contact" : "距上次沟通成功（天）",
      neverContacted: en ? "Never reached successfully" : "还没有沟通成功过", attempts7d: en ? "Contact attempts in this period" : "本期联系次数",
      lastResult: en ? "Latest contact result" : "最近一次联系结果", summaryLength: en ? "Length of latest record" : "最近一条记录的字数",
      hasNext: en ? "Next contact scheduled" : "约好了下次联系时间", nextOverdue: en ? "Scheduled contact is past due" : "约好的下次联系已过时间",
      paused: en ? "Paused or no longer followed" : "已暂缓或不再跟进", learningLogged: en ? "Latest lesson record entered" : "最近一节课学情已登记",
      hoursSinceLesson: en ? "Hours since the latest lesson" : "下课后过了（小时）", contactOver: en ? "Days past the family contact interval" : "超出家长沟通间隔（天）",
      contactedEver: en ? "Family contacted individually" : "单独和家长沟通过", step: en ? "Assessment step" : "测评进行到",
      hoursOver: en ? "Hours past the step deadline" : "超出该环节时限（小时）",
    } as Record<string, string>,
    units: { day: en ? "days" : "天", hour: en ? "hours" : "小时", times: en ? "times" : "次", chars: en ? "chars" : "字" } as Record<string, string>,
    ops: { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "=": "=", in: en ? "is" : "是", notin: en ? "is not" : "不是", is: en ? "is" : "为" } as Record<string, string>,
    yes: en ? "Yes" : "是", no: en ? "No" : "否", empty: en ? "—" : "—",
    // members
    students: (n: number) => en ? `${n} students` : `负责 ${n} 名学生`,
    week: (all: number, ok: number) => en ? `${all} contacts · ${ok} effective` : `本期沟通 ${all} 次 · 有效 ${ok}`,
    grains: { week: en ? "Week" : "周", month: en ? "Month" : "月" } as Record<string, string>,
    previous: en ? "Previous" : "上一期", next: en ? "Next" : "下一期",
    current: { week: en ? "This week" : "本周", month: en ? "This month" : "本月" } as Record<string, string>,
    asOf: (time: string) => en ? `As of ${time}` : `截至 ${time}`,
    classStudents: (name: string, n: number) => en ? `${name} · ${n} students` : `${name} · ${n} 名学生`,
    lead: en ? "Lead" : "组长", noStudents: en ? "No students assigned yet" : "暂无负责学生",
    noUnits: en ? "You are not leading an organization yet. Directors can set leads in Staff → Organization." : "你还不是任何组织的组长。主管可在“员工 → 组织与分工”中设置组长。",
    noMembers: en ? "This organization has no members yet." : "该组织还没有成员。",
    // side
    howTitle: en ? "How to read" : "怎么看",
    how: en ? [
      "Support: each family is checked against the contact cycle of its stage. The further past the cycle, the warmer the color.",
      "Teaching: whether the latest lesson record is entered, and whether the family is contacted within the frequency set for the student's A/B/C/D label.",
      "Assessment: arrival, result entry within 24 hours, explanation within 48 hours after entry.",
      "Left: workload this week and the color mix of each member's students.",
    ] : [
      "学服：每户按所在阶段的联系周期判断，超出越久颜色越重。",
      "授课：最近一讲学情是否登记，以及是否按学生 A／B／C／D 标签对应的频率与家长沟通。",
      "测评：待到场、测评后 24 小时内录入、录入后 48 小时内讲解。",
      "左侧是本周工作量和每位成员负责学生的颜色分布。",
    ],
    why: (n: number, rule: string, light: string) => en ? `Rule ${n}: ${rule} → ${light}` : `命中第 ${n} 条：${rule} → ${light}`,
    whyElse: (light: string) => en ? `No rule matched; shown as ${light}` : `未命中规则，按“其他情况”显示为${light}`,
    allCases: en ? "all cases" : "所有情况", and: en ? " and " : " 且 ",
    otherMembers: en ? "With other members" : "同一学生在其他成员那里",
    records: en ? "Recent records" : "近期记录", noRecords: en ? "No records yet." : "暂无记录。", loading: en ? "Loading…" : "正在读取…",
    loadFailed: en ? "Could not load records." : "记录读取失败。",
    open360: en ? "Open student" : "打开学生 360", owner: en ? "Owner" : "负责",
    // editor
    rulesTitle: en ? "Light rules" : "灯规则",
    rulesNow: en ? "How colors are decided now" : "现在的判断方式",
    rulesOrder: en ? "Checked top to bottom; the first match decides the color." : "从上往下看，先符合哪条就是哪种颜色。",
    otherwiseLine: (light: string) => en ? `Anything else → ${light}` : `其余情况 → ${light}`,
    standardTitle: en ? "Adjust the numbers" : "调整时间要求",
    intervals: { support: en ? "Contact a family at least every (days)" : "每个阶段多久要联系一次（天）", teach: en ? "Contact a family at least every (days), by label" : "按学生标签，多久和家长沟通一次（天）" } as Record<string, string>,
    params: {
      support: { _red: en ? "Days past the interval before red" : "超出多少天变红", _warn: en ? "Days before the interval to show yellow" : "提前几天提醒（变黄）", _quality: en ? "Characters in a record to count as well done (blue)" : "记录写满多少字算写得好（变蓝）" },
      teach: { _learnLate: en ? "Hours after class without a lesson record before orange" : "下课多少小时学情没登记变橙", _learnVeryLate: en ? "…before red" : "下课多少小时学情没登记变红",
        _red: en ? "Days past the family interval before red" : "超出沟通间隔多少天变红", _warn: en ? "Days before the interval to show yellow" : "提前几天提醒（变黄）" },
      assess: { _red: en ? "Hours past a step deadline before red (entry is due within 24 hours of the assessment, explanation within 48 hours of entry)" : "超时多少小时变红（录入时限为测评后 24 小时，讲解时限为录入后 48 小时）" },
    } as Record<string, Record<string, string>>,
    customNotice: en ? "These rules were edited by hand. Adjusting the numbers replaces them with the standard rules." : "当前是手动编辑过的规则；调整上面的数字会恢复为标准规则。",
    advanced: en ? "Edit rules by hand" : "手动编辑规则（高级）",
    editorHint: en ? "Rules run top to bottom; the first rule whose conditions all hold decides the color. Changes preview immediately and apply to this organization and its sub-organizations after saving."
      : "从上往下判断，第一条条件全部满足的规则决定颜色。修改立即预览，保存后作用于本组织及下级组织。",
    ruleN: (n: number) => en ? `Rule ${n}` : `第 ${n} 条`, when: en ? "If" : "如果", andShort: en ? "and" : "且", show: en ? "show" : "显示",
    addCondition: en ? "Condition" : "条件", addRule: en ? "New rule" : "新规则", otherwise: en ? "Otherwise" : "其他情况",
    moveUp: en ? "Move up" : "上移", moveDown: en ? "Move down" : "下移", remove: en ? "Remove" : "删除",
    cadence: en ? "Contact cycle (days)" : "联系周期（天）", teachCadence: en ? "Contact frequency by student label (days)" : "按学生标签的沟通频率（天）",
    save: en ? "Save rules" : "保存规则", saving: en ? "Saving…" : "正在保存…", reset: en ? "Use defaults" : "恢复默认",
    discard: en ? "Discard" : "放弃修改", saved: en ? "Rules saved" : "规则已保存", saveFailed: en ? "Could not save the rules." : "规则保存失败。",
    inherited: (name: string) => en ? `Using rules saved on ${name}` : `沿用「${name}」保存的规则`,
    defaults: en ? "Using default rules" : "使用默认规则",
  };
}
export type LeadBoardMessages = ReturnType<typeof leadBoardMessages>;
