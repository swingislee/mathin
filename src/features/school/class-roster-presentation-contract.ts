import type { PlacementRosterRow } from "./placement-table-fields";

export function classRosterMessages(locale: string) {
  const en = locale === "en";
  return {
    campus: en ? "Campus" : "校区",
    room: en ? "Room" : "教室",
    campusPending: en ? "Campus unset" : "校区待设置",
    campusUnknown: en ? "Campus unrecorded" : "校区未记录",
    locationUnavailable: en ? "Location unavailable" : "地点未读取",
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
