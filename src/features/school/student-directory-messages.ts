export function studentDirectoryMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    title: en ? "Students" : "学生", hint: en ? "Find a student, open their profile, or select people to contact." : "找学生、看档案，或选定一组学生开始沟通。",
    search: en ? "Name or phone digits" : "姓名或电话号码", scope: en ? "Scope" : "范围",
    mine: en ? "Related to me" : "与我相关", all: en ? "All accessible" : "全部可见", myGroup: en ? "My groups" : "本组学生", unassigned: en ? "Unassigned" : "未分配",
    groupBy: en ? "Group by" : "分组方式", grouping: { classroom: en ? "Class" : "按班级", grade: en ? "Grade" : "按年级", owner: en ? "Support owner" : "按负责老师", group: en ? "Business group" : "按业务组", none: en ? "Ungrouped" : "不分组" },
    missingGroup: { classroom: en ? "No current class" : "当前未入班", grade: en ? "Grade unspecified" : "年级待补", owner: en ? "No owner" : "未分配老师", group: en ? "No business group" : "未分组", none: en ? "Students" : "学生" },
    group: en ? "Group" : "查看分组", allGroups: en ? "All groups" : "全部分组", stage: en ? "Stage" : "阶段", allStages: en ? "All stages" : "全部阶段",
    grade: en ? "Grade" : "年级", unknownGrade: en ? "Grade —" : "年级待补", phone: en ? "Phone ending" : "电话尾号", noPhone: en ? "No phone" : "电话待补",
    assessment: en ? "Latest assessment" : "最近测评", assessed: en ? "Assessed" : "已测评", noAssessment: en ? "No confirmed assessment" : "暂无已确认测评",
    contact: en ? "Contact selected students" : "联系这些学生", selected: en ? "Selected" : "已选", selectPage: en ? "Select this page" : "选择本页", clear: en ? "Clear selection" : "清除选择",
    select: en ? "Select student" : "选择学生", readOnly: en ? "Profile access only" : "可查看档案", limit: en ? "Select up to 100 students per contact list." : "每次最多选择 100 名学生。",
    hidden: en ? "Selected outside this page" : "其中不在本页", selectionTitle: en ? "Selected students" : "选定学生", back: en ? "Back to directory" : "返回学生名录",
    selectionHint: en ? "This list keeps its order while you save and continue. Each row uses its current stage." : "按选定顺序连续登记，保存后保留本轮名单；每行使用该学生当前阶段。",
    unavailable: en ? "Some selected students are no longer accessible. Showing the accessible students." : "部分选定学生当前不可访问，已显示可访问的学生。",
    invalidSelection: en ? "The contact selection is invalid. Select students again." : "选定名单无效，请返回学生名录重新选择。",
    empty: en ? "No student profiles match these filters." : "当前条件下没有学生档案。", reset: en ? "Reset filters" : "重置筛选",
    groups: en ? "Manage groups" : "业务分组", import: en ? "Import" : "导入", recycle: en ? "Recycle bin" : "回收站",
    pageGroup: en ? "on this page" : "本页", shared: en ? "A student may appear in multiple groups; selection counts each student once." : "同一学生可属于多个分组，选择人数按学生去重。",
  };
}
