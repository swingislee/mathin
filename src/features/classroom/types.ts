export type ClassroomRole = "teacher" | "student";

export interface ClassroomMeta {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  myRole: ClassroomRole;
}

export interface ClassroomMember {
  userId: string;
  displayName: string;
  role: ClassroomRole;
}

export interface ClassroomRecord extends ClassroomMeta {
  members: ClassroomMember[];
  /** 仅教师可见（经 RPC），其余为 null。 */
  inviteCode: string | null;
}

// ---------------------------------------------------------------------------
// 课件页（08-§3.6）：有序页数组存 class_sessions.courseware jsonb。
// image/video 存 Storage 路径（候课时预载为 blob）；
// game 只存 {gameId, difficulty, seed}——题面由 createRng(seed) 确定性推导，零预载天然离线。
// ---------------------------------------------------------------------------

export type CoursewarePage =
  | { id: string; type: "image"; path: string; title: string }
  | { id: string; type: "video"; path: string; title: string }
  | { id: string; type: "game"; gameId: string; difficulty: "easy" | "medium" | "hard"; seed: string; title: string }
  | { id: string; type: "board"; title: string };

export interface ClassSessionMeta {
  id: string;
  classroomId: string;
  title: string;
  pageCount: number;
  currentPage: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface ClassSessionRecord extends ClassSessionMeta {
  courseware: CoursewarePage[];
}

// ---------------------------------------------------------------------------
// 课堂事件流（08-§3.4）：id 客户端 uuid + (deviceId, seq) 幂等；
// 排序靠单写者天然有序，不依赖时钟。
// ---------------------------------------------------------------------------

export type SessionEventType =
  | "page"           // {page:number} 教师翻页
  | "page_insert"    // {index:number, page:CoursewarePage} 上课中临时插页（白板页等，仅教师）
  | "star"           // {studentId} 教师加星
  | "star_undo"      // {studentId} 撤销该生最新一颗星（原子语义：删事件不减计数）
  | "session_ctl"    // {action:"start"|"end"|"quiz_open"|"quiz_close", ...}
  | "board_snapshot" // {pageKey:string, items:StrokeItem[]}（main=页 uuid、side="side"）
  | "game_state"     // {pageId, state:{values,selected}} 游戏页镜像（单写者=教师）
  | "video_ctl"      // {pageId, action:"play"|"pause"|"seek", time} 视频同步（仅教师）
  | "tool_ctl"       // {action:"open"|"close", toolId?} 工具快捷窗（仅教师）
  | "hand"           // {up:boolean} 学生举手
  | "answer";        // {quizId, choice:number} 学生作答

export interface SessionEvent {
  id: string;
  sessionId: string;
  userId: string;
  deviceId: string;
  seq: number;
  type: SessionEventType;
  payload: Record<string, unknown>;
  /** 客户端时间 ISO 串，报告展示用；排序不依赖它。 */
  at: string;
}
