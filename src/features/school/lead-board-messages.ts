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
      gray: en ? "Gray · nothing due" : "灰 · 无需处理", red: en ? "Red · badly overdue" : "红 · 严重拖延", orange: en ? "Orange · overdue" : "橙 · 已拖延",
      yellow: en ? "Yellow · due soon" : "黄 · 临近期限", green: en ? "Green · done" : "绿 · 已完成", blue: en ? "Blue · done well" : "蓝 · 完成且质量好",
    } satisfies Record<LeadLight, string>,
    lightShort: { gray: en ? "Gray" : "灰", red: en ? "Red" : "红", orange: en ? "Orange" : "橙", yellow: en ? "Yellow" : "黄", green: en ? "Green" : "绿", blue: en ? "Blue" : "蓝" } satisfies Record<LeadLight, string>,
    lanes: { support: en ? "Support" : "学服", teach: en ? "Teaching" : "授课", assess: en ? "Assessment" : "测评" } satisfies Record<LeadLane, string>,
    clusters: {
      first: en ? "First contact" : "待首联", assess: en ? "Awaiting assessment" : "待测评", after: en ? "After assessment" : "测评后",
      enroll: en ? "Awaiting enrollment" : "待报名", serve: en ? "Enrolled" : "在读", renew: en ? "Renewal" : "续费期", other: en ? "Other" : "其他",
    } as Record<string, string>,
    steps: { arrival: en ? "Awaiting arrival" : "待到场", record: en ? "Awaiting entry" : "待录入", explain: en ? "Awaiting explanation" : "待讲解", done: en ? "Explained" : "已讲解" } as Record<string, string>,
    results: { connected: en ? "Connected" : "已沟通", unreachable: en ? "Unreachable" : "未接通", declined: en ? "Declined" : "拒绝", invalid_number: en ? "Invalid number" : "号码无效", none: en ? "No record" : "无记录" } as Record<string, string>,
    fields: {
      cluster: en ? "Stage" : "阶段", cadenceOver: en ? "Past contact cycle" : "超出联系周期", sinceContact: en ? "Since last effective contact" : "距上次有效沟通",
      neverContacted: en ? "Never contacted" : "从未有效沟通", attempts7d: en ? "Attempts in 7 days" : "近 7 天联系次数", lastResult: en ? "Latest result" : "最近结果",
      summaryLength: en ? "Latest summary length" : "最近摘要字数", hasNext: en ? "Next follow-up set" : "已约下次跟进", nextOverdue: en ? "Next follow-up overdue" : "下次跟进已过期",
      paused: en ? "Paused or closed" : "暂缓或已结束", learningLogged: en ? "Latest lesson record entered" : "最近一讲学情已登记",
      hoursSinceLesson: en ? "Since latest lesson" : "距最近一讲下课", contactOver: en ? "Past contact frequency" : "超出沟通频率",
      contactedEver: en ? "Ever contacted" : "有过个别沟通", step: en ? "Step" : "环节", hoursOver: en ? "Past step deadline" : "当前环节超时",
    } as Record<string, string>,
    units: { day: en ? "days" : "天", hour: en ? "hours" : "小时", times: en ? "times" : "次", chars: en ? "chars" : "字" } as Record<string, string>,
    ops: { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "=": "=", in: en ? "is" : "是", notin: en ? "is not" : "不是", is: en ? "is" : "为" } as Record<string, string>,
    yes: en ? "Yes" : "是", no: en ? "No" : "否", empty: en ? "—" : "—",
    // members
    students: (n: number) => en ? `${n} students` : `负责 ${n} 名学生`,
    week: (all: number, ok: number) => en ? `This week ${all} contacts · ${ok} effective` : `本周沟通 ${all} 次 · 有效 ${ok}`,
    lead: en ? "Lead" : "组长", noStudents: en ? "No students assigned yet" : "暂无负责学生",
    noUnits: en ? "You are not leading an organization yet. Directors can set leads in Staff → Organization." : "你还不是任何组织的组长。主管可在“员工 → 组织与分工”中设置组长。",
    noMembers: en ? "This organization has no members yet." : "该组织还没有成员。",
    // side
    howTitle: en ? "How to read" : "怎么看",
    how: en ? [
      "Support: each family is checked against the contact cycle of its stage. The further past the cycle, the warmer the color.",
      "Teaching: whether the latest lesson record is entered, and whether the student is contacted within the configured frequency.",
      "Assessment: arrival, result entry within 24 hours, explanation within 48 hours after entry.",
      "Left: workload this week and the color mix of each member's students.",
    ] : [
      "学服：每户按所在阶段的联系周期判断，超出越久颜色越重。",
      "授课：最近一讲学情是否登记，以及是否按设定的频率与学生家长沟通。",
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
    editorHint: en ? "Rules run top to bottom; the first rule whose conditions all hold decides the color. Changes preview immediately and apply to this organization and its sub-organizations after saving."
      : "从上往下判断，第一条条件全部满足的规则决定颜色。修改立即预览，保存后作用于本组织及下级组织。",
    ruleN: (n: number) => en ? `Rule ${n}` : `第 ${n} 条`, when: en ? "If" : "如果", andShort: en ? "and" : "且", show: en ? "show" : "显示",
    addCondition: en ? "Condition" : "条件", addRule: en ? "New rule" : "新规则", otherwise: en ? "Otherwise" : "其他情况",
    moveUp: en ? "Move up" : "上移", moveDown: en ? "Move down" : "下移", remove: en ? "Remove" : "删除",
    cadence: en ? "Contact cycle (days)" : "联系周期（天）", teachCadence: en ? "Contact frequency (days)" : "沟通频率（天）",
    save: en ? "Save rules" : "保存规则", saving: en ? "Saving…" : "正在保存…", reset: en ? "Use defaults" : "恢复默认",
    discard: en ? "Discard" : "放弃修改", saved: en ? "Rules saved" : "规则已保存", saveFailed: en ? "Could not save the rules." : "规则保存失败。",
    inherited: (name: string) => en ? `Using rules saved on ${name}` : `沿用「${name}」保存的规则`,
    defaults: en ? "Using default rules" : "使用默认规则",
  };
}
export type LeadBoardMessages = ReturnType<typeof leadBoardMessages>;
