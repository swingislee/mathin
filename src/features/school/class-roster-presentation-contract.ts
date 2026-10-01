import type { PlacementRosterRow } from "./placement-table-fields";

export function classRosterMessages(locale: string) {
  const en = locale === "en";
  return {
    campus: en ? "Campus" : "校区",
    room: en ? "Room" : "教室",
    campusPending: en ? "Unset" : "待设置",
    campusUnknown: en ? "Unrecorded" : "未记录",
    locationUnavailable: en ? "Unavailable" : "未读取",
    schedulePending: en ? "Pending" : "待安排",
    grade: en ? "Grade" : "年级",
    pendingRoster: en ? "Pending placement" : "待分班",
    noPending: en ? "No students awaiting placement" : "暂无待分班学生",
    studentCount: (count: number) => en ? `${count} students` : `${count} 人`,
    locationsFailed: en ? "Some class locations could not be loaded. Retry to read them." : "部分班级地点读取失败，请重试读取。",
    sourceLocation: en ? "Original location" : "原地点",
    level: en ? "Level" : "难度",
    roster: en ? "Roster" : "名册",
    lessons: en ? "Lessons" : "课次",
    details: en ? "Class details" : "班级详情",
    info: en ? "Class information" : "班级信息",
    showRoster: en ? "Show roster" : "展开名册",
    hideRoster: en ? "Hide roster" : "收起名册",
    filter: en ? "Filter classes" : "筛选班级",
  };
}

/** 地点只展示结构化关联与原地点文本，不从班名或学期推断校区。 */
export function classRosterLocation(row: PlacementRosterRow, locale: string) {
  const m = classRosterMessages(locale);
  return {
    campus: row.classroom ? row.classroom.location
      ? row.classroom.location.campusName || m.campusPending : m.locationUnavailable : m.campusUnknown,
    room: row.classroom?.location?.roomName || row.historical?.room_label || "",
  };
}
